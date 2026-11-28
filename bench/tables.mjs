// The judge's verdicts as markdown, one section per result file of bench/judge.mjs:
//
//   node bench/tables.mjs <result.json> …
//
// CI prints each platform's run to its job summary, and the per-platform sections of
// docs/benchmarks/accuracy.md are this script's output on the committed baselines.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rateCell } from './stats.mjs';

const PLATFORMS = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };
const TOLERANCES = { none: 'none allowed', allowance: '0.1% allowed' };

/** Where a result was made: the runner image in CI, otherwise the CPU. */
function machine({ platform, cpu, image }) {
  const name = PLATFORMS[platform] ?? platform;
  const model = cpu.trim();
  return image ? `${name}, runner image ${image} (${model})` : `${name} (${model})`;
}

/**
 * What a rate in a set is over: a pair, except in the self-noise set, whose pairs are every pair of
 * one page's repeated renders and so are not independent. There it is the page, and a page is wrong
 * if any of its pairs is.
 */
const unit = (p) => (p.set === 'self-noise' ? p.id.slice(0, p.id.lastIndexOf('/')) : p.id);
const units = (pairs) => new Set(pairs.map(unit)).size;

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
        const wrong = group.filter((p) => p.pass[tolerance] !== match);
        cells.push(rateCell(units(wrong), units(group)));
      }
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function section(result) {
  const commit = result.candidate.commit?.slice(0, 7) ?? 'no commit';
  const pairs = result.accuracy.pairs;
  const rendered = pairs.filter((p) => p.id.startsWith('rendered')).length;
  const noise = pairs.filter((p) => p.set === 'self-noise');
  const noiseText = noise.length
    ? `, and ${noise.length} self-noise pairs of ${units(noise)} page${units(noise) === 1 ? '' : 's'}`
    : '';
  return [
    `### ${machine(result.machine)}\n`,
    `${result.candidate.name} at ${commit}, Node ${result.machine.node}; ${rendered} rendered ` +
      `pairs${noiseText}. Each cell: wrong verdicts, their share of the group and its 95% ` +
      'interval (Wilson); in the self-noise set, over pages.\n',
    accuracyTable(result),
    '',
  ].join('\n');
}

// Run as a script, not when imported by its test.
// Real paths on both sides: run through a symbolic link (macOS's /tmp is one), the URLs differ.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: tables.mjs <result.json> …');
    process.exitCode = 2;
  }
  for (const file of files) console.log(section(JSON.parse(readFileSync(file, 'utf8'))));
}
