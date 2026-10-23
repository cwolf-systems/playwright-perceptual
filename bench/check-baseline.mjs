// Compares a result of bench/judge.mjs with a committed baseline, and fails if any pair the
// baseline judged correctly is now judged wrongly, with no changed pixels allowed or with 0.1% of
// the image. CI runs it after the judge's accuracy section:
//
//   node bench/check-baseline.mjs <result.json> [--baseline <file>] [--rendered]
//
// The baseline defaults to bench/results/judge-baseline-0.2.0.json.
//
// Not every pair can be compared on every machine:
// - Real captures come from a downstream renderer and are not in this repository. Pairs of theirs
//   that the result lacks are skipped.
// - Rendered pairs are screenshots taken by the judge on the machine it runs on, so their bytes
//   depend on the operating system, its fonts and its GPU. They are compared only when the result
//   and the baseline come from the same platform and CPU, or with --rendered. Playwright's fixtures
//   and the synthetic set are the same bytes everywhere and are always compared.
//   Rendered pairs a machine cannot render (the GPU pairs off macOS, WebGL pages without WebGL)
//   are left out by the judge, and skipped here, except on a machine like the baseline's: there a
//   rendered pair the result lacks was lost, not left out.
// Any other pair the baseline has and the result lacks fails the check: the benchmark lost it.
//
// Exit codes: 0, no verdict lost; 1, a verdict lost or a pair missing; 2, the two files cannot be
// compared (different labels, not judge results, or the same file twice).

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_BASELINE = join(ROOT, 'bench', 'results', 'judge-baseline-0.2.0.json');
const TOLERANCES = { none: 'none allowed', allowance: '0.1% allowed' };

function parseArgs(argv) {
  const args = { baseline: DEFAULT_BASELINE, rendered: false, result: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--baseline') args.baseline = argv[++i];
    else if (arg === '--rendered') args.rendered = true;
    else if (!arg.startsWith('--') && args.result === null) args.result = arg;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.result || !args.baseline) {
    throw new Error('Usage: check-baseline.mjs <result.json> [--baseline <file>] [--rendered]');
  }
  return args;
}

function readResult(file) {
  const result = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(result?.accuracy?.pairs) || !result.judge?.labels) {
    throw new Error(`${file} is not a result of bench/judge.mjs`);
  }
  return result;
}

// The judge's ids for its rendered pairs start with the corpus name: "rendered/…" at 1× and
// "rendered 2×/…" at 2×.
const isRendered = (id) => id.startsWith('rendered');
const isReal = (set) => set.startsWith('real');
const correct = (pair, tolerance) => pair.pass[tolerance] === pair.match;

function check(result, baseline, compareRendered, sameMachine) {
  const now = new Map(result.accuracy.pairs.map((p) => [p.id, p]));
  const out = {
    lost: [],
    gained: [],
    missing: [],
    skippedReal: 0,
    skippedRendered: 0,
    notRendered: 0,
    compared: 0,
  };
  for (const before of baseline.accuracy.pairs) {
    if (isRendered(before.id) && !compareRendered) {
      out.skippedRendered++;
      continue;
    }
    const after = now.get(before.id);
    if (!after) {
      if (isReal(before.set)) out.skippedReal++;
      // The judge leaves out what a machine cannot render: WebGL pages without WebGL, and the GPU
      // pairs off macOS.
      else if (isRendered(before.id) && !sameMachine) out.notRendered++;
      else out.missing.push(before.id);
      continue;
    }
    out.compared++;
    for (const tolerance of Object.keys(TOLERANCES)) {
      const wasCorrect = correct(before, tolerance);
      const isCorrect = correct(after, tolerance);
      const entry = { id: before.id, tolerance, match: before.match, counted: after.counted };
      if (wasCorrect && !isCorrect) out.lost.push(entry);
      if (!wasCorrect && isCorrect) out.gained.push(entry);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (realpathSync(args.result) === realpathSync(args.baseline)) {
    console.log('The result and the baseline are the same file: run bench/judge.mjs first.');
    return 2;
  }
  const result = readResult(args.result);
  const baseline = readResult(args.baseline);

  // A verdict is only lost against the same expectation. Labels change in a pull request of their
  // own, which regenerates the baselines with them.
  if (result.judge.labels !== baseline.judge.labels) {
    console.log(
      `The result was judged against labels ${result.judge.labels}, the baseline against ` +
        `${baseline.judge.labels}. Regenerate the baseline with the new labels.`,
    );
    return 2;
  }

  // Rendered bytes depend on the machine, not only its operating system: they are compared on a
  // machine like the baseline's, or with --rendered. There, a rendered pair that is missing was
  // lost, not left out.
  const sameMachine =
    result.machine?.platform === baseline.machine?.platform &&
    result.machine?.cpu === baseline.machine?.cpu;
  const r = check(result, baseline, args.rendered || sameMachine, sameMachine);

  const name = (file) => file.split(/[\\/]/).pop();
  console.log(
    `## Verdicts against ${name(args.baseline)} (${baseline.candidate.name}, ` +
      `${baseline.candidate.commit?.slice(0, 7) ?? 'no commit'}, ${baseline.machine.platform})\n`,
  );
  console.log(`- Pairs compared: ${r.compared}`);
  if (r.skippedRendered) {
    console.log(
      `- Rendered pairs not compared: ${r.skippedRendered}. They were rendered on ` +
        `${result.machine.platform} (${result.machine.cpu}) and the baseline on ` +
        `${baseline.machine.platform} (${baseline.machine.cpu}), so their bytes differ.`,
    );
  }
  if (r.notRendered) {
    console.log(`- Rendered pairs this machine could not render: ${r.notRendered}`);
  }
  if (r.skippedReal) console.log(`- Real captures not available here: ${r.skippedReal}`);
  console.log(`- Verdicts gained: ${r.gained.length}`);
  console.log(`- Verdicts lost: ${r.lost.length}`);
  for (const p of r.lost) {
    console.log(
      `  - ${p.id}, ${TOLERANCES[p.tolerance]}: should ${p.match ? '' : 'not '}match, ` +
        `${p.counted === null ? 'threw' : p.counted} counted`,
    );
  }
  if (r.missing.length) {
    console.log(`- Pairs in the baseline that this run lacks: ${r.missing.length}`);
    for (const id of r.missing) console.log(`  - ${id}`);
  }
  return r.lost.length || r.missing.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
