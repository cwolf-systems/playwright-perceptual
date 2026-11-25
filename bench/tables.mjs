// The judge's verdicts as markdown, one section per result file of bench/judge.mjs:
//
//   node bench/tables.mjs <result.json> …
//
// CI prints each platform's run to its job summary, and the per-platform sections of
// docs/benchmarks/accuracy.md are this script's output on the committed baselines.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rateCell } from './stats.mjs';

const PLATFORMS = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const TOLERANCES = { none: 'none allowed', allowance: '0.1% allowed' };

/** Where a result was made: the runner image in CI, otherwise the CPU. */
function machine({ platform, cpu, image }) {
  const name = PLATFORMS[platform] ?? platform;
  return image ? `${name}, runner image ${image} (${cpu})` : `${name} (${cpu})`;
}

/** Wrong verdicts by set and by expected verdict, at both tolerances, each with its interval. */
export function accuracyTable(result) {
  const pairs = result.accuracy.pairs;
  const sets = [...new Set(pairs.map((p) => p.set))];
  const header = ['Set', 'Pairs'];
  for (const tolerance of Object.values(TOLERANCES)) {
    header.push(`Should match: failed, ${tolerance}`, `Should fail: passed, ${tolerance}`);
  }
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
  for (const set of sets) {
    const inSet = pairs.filter((p) => p.set === set);
    const cells = [set, String(inSet.length)];
    for (const tolerance of Object.keys(TOLERANCES)) {
      for (const match of [true, false]) {
        const group = inSet.filter((p) => p.match === match);
        const wrong = group.filter((p) => p.pass[tolerance] !== match).length;
        cells.push(rateCell(wrong, group.length));
      }
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function section(result) {
  const commit = result.candidate.commit?.slice(0, 7) ?? 'no commit';
  const rendered = result.accuracy.pairs.filter((p) => p.id.startsWith('rendered')).length;
  return [
    `### ${machine(result.machine)}\n`,
    `${result.candidate.name} at ${commit}, Node ${result.machine.node}; ${rendered} rendered ` +
      'pairs. Each cell: wrong verdicts, their share of the group and its 95% interval (Wilson).\n',
    accuracyTable(result),
    '',
  ].join('\n');
}

// Run as a script, not when imported by its test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: tables.mjs <result.json> …');
    process.exitCode = 2;
  }
  for (const file of files) console.log(section(JSON.parse(readFileSync(file, 'utf8'))));
}
