// Judges a build of this package against frozen expected verdicts, and against the current
// checkout and 0.1.0. Run from this repository:
//
//   node bench/judge.mjs --candidate <worktree> [--name <name>] [--out <file.json>]
//   node bench/judge.mjs --compare a.json b.json …
//
// It builds the candidate with its own `npm run build` and loads its dist/ through the public
// API (`compareImages`), then reports five sections:
//
// 1. Accuracy: each pair's verdict against its expected verdict in bench/judge-labels.json, with
//    no changed pixels allowed and with 0.1% of the image, for the accuracy benchmark's 193 pairs,
//    the synthetic set and real captures. The current checkout's verdicts (this repository's own
//    dist/) are taken on the same bytes in the same run, so any pair the checkout gets right and
//    the candidate gets wrong is listed by name. Without --candidate, the candidate is the
//    checkout itself, judged against the labels alone.
// 2. Issue #2's residual: the share of a faint uniform change that is counted, and likewise the
//    share of a drift of one to three levels over a whole textured frame. The denominator is every
//    pixel past ΔE00 1 as the checkout measures it with all noise detection off, so it is the same
//    for every candidate.
// 3. Slivers: a tint of three levels of blue on a flat dark panel (ΔE00 2.11) at 200×2, 1×50 and
//    2×2, and the smallest side at which panels of every shape count all of it.
// 4. Speed: the scenes of `npm run bench` (bench/speed.mjs), a textured whole-frame drift of one
//    to three levels, a film-grain frame, and real captures, medians of 5, for the candidate,
//    the checkout and 0.1.0, each in its own process.
// 5. Size: source lines under src/image/, executable code apart from types, comments and blank
//    lines, and the same over all of src/.
//
// Then the win conditions, in order: (1) no pair whose expected verdict the checkout gets right
// goes wrong; (2) issue #2's residual and the sliver limit improve on the checkout; (3) whole-frame
// speed no slower than 0.1.0; (4) less detector code than the checkout. `--compare` ranks result
// files by them, then by less code, then by the margin below.
//
// It also reports, though not as a win condition, the margin on pairs that should match: for each
// one that passes with 0.1% allowed, its counted pixels as a share of that allowance. A build that
// passes them with room to spare is less likely to fail a capture slightly noisier than these. The
// worst share and the median are reported, and the worst over pairs allowed 10 pixels or more: a
// small image allowed a pixel or two puts every build at 50% or 100% with one counted pixel, so
// the worst share over all pairs rarely tells builds apart, and it is that last figure that breaks
// ties.
//
// The judge reads only a comparison's counted pixels. The default adapter reads `differing`; if a
// candidate renames it, add an adapter below and pass `--adapter <name>`. Candidates never carry
// one.
//
// Real captures are read in place and never copied. They come from a downstream renderer and are
// not part of this repository; their paths are read from a JSON file, PP_JUDGE_CONFIG (default
// bench/judge.local.json, which git ignores):
//
//   { "golden": "<dir of scene folders, each with 0.png, 1.png and 2.png: identical input>",
//     "pairs": { "opacity": [expected, actual], "bilinear": [expected, actual],
//                "grain": [expected, actual], "wholeFrame": [expected, actual] },
//     "v010": "<a built checkout of 0.1.0, for speed>" }
//
// PP_JUDGE_GOLDEN and PP_JUDGE_V010 override the file's entries. What is missing is skipped with
// a notice. The machine may be shared: the speed section waits for the 1-minute load to fall below
// 6 (up to ten minutes) and is otherwise skipped.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, loadavg, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import ts from 'typescript';
import { playwrightPairs, renderedPairs } from './corpus.mjs';
import { SYNTHETIC_PAIRS, surfaceOpacity } from './synthetic.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LABELS_FILE = join(ROOT, 'bench', 'judge-labels.json');
const RENDERS = join(ROOT, 'bench', 'data', 'judge-renders');

/** The allowance the benchmark also judges at: 0.1% of the image. */
const ALLOWANCE = 0.001;
const RUNS = 5;
/** Run-to-run noise allowed before a time counts as slower than 0.1.0's. */
const SPEED_NOISE = 0.05;
const LOAD_LIMIT = 6;
const LOAD_WAIT_MS = 10 * 60_000;

// How the judge calls a build and reads its counted pixels. Nothing else of a result is read.
const ADAPTERS = {
  default: {
    compare: (pkg, expected, actual) => pkg.compareImages(expected, actual),
    counted: (result) => result.differing,
  },
};

// ---------------------------------------------------------------------------------------------
// Command line

function parseArgs(argv) {
  const args = { compare: null, candidate: ROOT, build: true, speed: true, render: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--compare') args.compare = argv.slice(i + 1);
    else if (arg === '--candidate') args.candidate = resolve(value());
    else if (arg === '--name') args.name = value();
    else if (arg === '--out') args.out = resolve(value());
    else if (arg === '--adapter') args.adapter = value();
    else if (arg === '--no-build') args.build = false;
    else if (arg === '--skip-speed') args.speed = false;
    else if (arg === '--render') args.render = true;
    else if (arg === '--speed-worker') args.speedWorker = JSON.parse(value());
    else if (arg === '--count-worker') args.countWorker = JSON.parse(value());
    else if (arg === '--render-worker') args.renderWorker = JSON.parse(value());
    else throw new Error(`Unknown argument ${arg}`);
    if (args.compare) break;
  }
  return args;
}

// ---------------------------------------------------------------------------------------------
// Inputs

const sha16 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function decode(bytes) {
  const png = PNG.sync.read(bytes);
  return {
    data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}

/** Paths to real captures: the local file, then the environment. Missing entries are null. */
function captureConfig(notices) {
  const file = process.env.PP_JUDGE_CONFIG ?? join(ROOT, 'bench', 'judge.local.json');
  let config = {};
  if (existsSync(file)) config = JSON.parse(readFileSync(file, 'utf8'));
  else notices.push('No capture config (PP_JUDGE_CONFIG): real captures and 0.1.0 are skipped.');
  const golden = process.env.PP_JUDGE_GOLDEN ?? config.golden ?? null;
  const v010 = process.env.PP_JUDGE_V010 ?? config.v010 ?? null;
  const pairs = {};
  for (const role of ['opacity', 'bilinear', 'grain', 'wholeFrame']) {
    const paths = config.pairs?.[role];
    pairs[role] = paths && paths.every((p) => existsSync(p)) ? paths : null;
    if (!pairs[role]) notices.push(`Real capture pair "${role}" not found: skipped.`);
  }
  if (golden && !existsSync(golden)) notices.push('Golden captures not found: skipped.');
  if (v010 && !existsSync(join(v010, 'dist', 'index.js'))) {
    notices.push('0.1.0 build not found (PP_JUDGE_V010): speed is not compared with it.');
  }
  return {
    golden: golden && existsSync(golden) ? golden : null,
    v010: v010 && existsSync(join(v010, 'dist', 'index.js')) ? v010 : null,
    pairs,
  };
}

/**
 * The benchmark's rendered pairs, rendered once into bench/data and reused, so every candidate is
 * judged on the same bytes. `--render` renders them again.
 */
async function renderWorker() {
  const pairs = [...(await renderedPairs(1)), ...(await renderedPairs(2))];
  const staging = `${RENDERS}.${process.pid}`;
  mkdirSync(staging, { recursive: true });
  const manifest = pairs.map((p, n) => {
    writeFileSync(join(staging, `${n}-expected.png`), p.expectedPng);
    writeFileSync(join(staging, `${n}-actual.png`), p.actualPng);
    return { id: p.id, set: p.corpus === 'rendered' ? 'design' : 'held-out', n };
  });
  writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 1));
  rmSync(RENDERS, { recursive: true, force: true });
  renameSync(staging, RENDERS);
  process.stdout.write('{}');
}

/** The benchmark's pairs: Playwright's fixtures, and the rendered pairs from bench/data. */
async function benchmarkPairs() {
  const manifest = JSON.parse(readFileSync(join(RENDERS, 'manifest.json'), 'utf8'));
  const rendered = manifest.map(({ id, set, n }) => ({
    id,
    set,
    load: () => ({
      expected: decode(readFileSync(join(RENDERS, `${n}-expected.png`))),
      actual: decode(readFileSync(join(RENDERS, `${n}-actual.png`))),
    }),
  }));
  const fixtures = (await playwrightPairs()).map((p) => ({
    id: p.id,
    set: 'design',
    load: () => ({ expected: decode(p.expectedPng), actual: decode(p.actualPng) }),
  }));
  return [...fixtures, ...rendered];
}

const TEXTURED_DRIFT = 'synthetic/judge/textured drift of 1–3 levels';
const TEXTURE_MOVED = 'synthetic/judge/fine texture moved 0.3, 0.2 px';
const GROUND_BESIDE_EDGE = 'synthetic/judge/textured ground beside an edge, three levels darker';
const EDGE_SIDES_CHANGED = 'synthetic/judge/edge pixel whose sides changed colour too';

/**
 * bench/synthetic.mjs's pairs, the judge's own textured drift and its control, and two changes
 * beside an edge.
 */
const syntheticSet = () => [
  ...SYNTHETIC_PAIRS.map((p) => ({
    id: `synthetic/${p.finding}/${p.name}`,
    set: 'synthetic',
    load: p.make,
  })),
  { id: TEXTURED_DRIFT, set: 'synthetic', load: texturedDrift },
  { id: TEXTURE_MOVED, set: 'synthetic', load: textureMoved },
  { id: GROUND_BESIDE_EDGE, set: 'synthetic', load: groundBesideEdge },
  { id: EDGE_SIDES_CHANGED, set: 'synthetic', load: edgeSidesChanged },
];

/** A real pair, labelled by the hashes of its files. */
function realPair(id, set, role, expectedFile, actualFile) {
  const expectedPng = readFileSync(expectedFile);
  const actualPng = readFileSync(actualFile);
  return {
    id,
    set,
    labelKey: `${role}/${sha16(expectedPng)}-${sha16(actualPng)}`,
    load: () => ({ expected: decode(expectedPng), actual: decode(actualPng) }),
  };
}

/** Each scene folder with three captures gives two pairs, first against second and third. */
function goldenSet(dir) {
  const scenes = readdirSync(dir)
    .filter((scene) => [0, 1, 2].every((i) => existsSync(join(dir, scene, `${i}.png`))))
    .sort();
  return scenes.flatMap((scene, n) =>
    [1, 2].map((i) =>
      realPair(
        `golden/${n + 1}/0v${i}`,
        'real golden',
        'golden',
        join(dir, scene, '0.png'),
        join(dir, scene, `${i}.png`),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Builds

function git(dir, ...args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function describe(dir) {
  // A node_modules symlink, as a scratch checkout may have, is not a change.
  const status = git(dir, 'status', '--porcelain')
    ?.split('\n')
    .filter((line) => line !== '' && line !== '?? node_modules');
  return { commit: git(dir, 'rev-parse', 'HEAD'), dirty: status ? status.length > 0 : null };
}

function build(dir) {
  execFileSync('npm', ['run', 'build'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Runs bench/judge.mjs again in a child process with one of the worker flags. Each build is loaded
 * in a process of its own: builds bring their own copies of @playwright/test, which refuses to be
 * loaded twice in one process, and timings stay apart.
 */
function worker(flag, input) {
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(import.meta.url), flag, JSON.stringify(input ?? {})],
    { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(output);
}

/** A build's verdict-relevant number on one pair: counted pixels, or Infinity if it threw. */
function countedBy(pkg, adapter, expected, actual) {
  try {
    const counted = adapter.counted(adapter.compare(pkg, expected, actual));
    if (typeof counted !== 'number' || Number.isNaN(counted)) {
      throw new Error('the adapter read no counted pixels; add an adapter to bench/judge.mjs');
    }
    return counted;
  } catch (error) {
    if (error.message.includes('adapter')) throw error;
    return Number.POSITIVE_INFINITY;
  }
}

// ---------------------------------------------------------------------------------------------
// Counting: one build's counted pixels on every pair, residual case and sliver panel

const DRIFT_CASE = 'synthetic textured drift';

/** The faint uniform changes of issue #2, and a drift of one to three levels over texture. */
function residualCases(opacity) {
  const cases = [
    ['synthetic surfaceOpacity', surfaceOpacity],
    [DRIFT_CASE, texturedDrift],
  ];
  if (opacity) {
    cases.push([
      'real opacity pair',
      () => ({
        expected: decode(readFileSync(opacity[0])),
        actual: decode(readFileSync(opacity[1])),
      }),
    ]);
  }
  return cases;
}

/** In a child process: one build's counted pixels, or null where it threw. */
async function countWorker({ dist, adapter: adapterName, golden, findings, past }) {
  const pkg = await import(pathToFileURL(dist).href);
  const adapter = ADAPTERS[adapterName];
  if (adapterName === 'default' && typeof pkg.compareImages !== 'function') {
    throw new Error('The build exports no compareImages; add an adapter to bench/judge.mjs');
  }
  const count = ({ expected, actual }) => countedBy(pkg, adapter, expected, actual);

  const list = [...(await benchmarkPairs()), ...syntheticSet()];
  if (golden) list.push(...goldenSet(golden));
  for (const [role, paths] of Object.entries(findings)) {
    if (paths) list.push(realPair(`findings/${role}`, 'real findings', role, ...paths));
  }
  const pairs = {};
  for (const p of list) {
    const images = p.load();
    pairs[p.id] = {
      set: p.set,
      labelKey: p.labelKey ?? p.id,
      pixels: images.expected.width * images.expected.height,
      counted: count(images),
    };
  }

  const residual = {};
  for (const [name, make] of residualCases(findings.opacity)) {
    const images = make();
    residual[name] = { counted: count(images) };
    // Every pixel past ΔE00 1, with no noise detection: the same denominator for every build.
    if (past) {
      residual[name].past = pkg.compareImages(images.expected, images.actual, {
        ignoreShifts: false,
        ignoreAntialiasing: false,
        ignoreRounding: false,
      }).differing;
    }
  }

  const slivers = {};
  for (const [width, height] of sliverPanels()) {
    slivers[`${width}×${height}`] = count(tint(width, height));
  }
  process.stdout.write(JSON.stringify({ pairs, residual, slivers }));
}

/** Counts as JSON carries them: null for a comparison that threw. */
const counted = (x) => (x === null ? Number.POSITIVE_INFINITY : x);

// ---------------------------------------------------------------------------------------------
// 1. Accuracy

const allowed = (pixels) => Math.floor(ALLOWANCE * pixels);
const SETS = ['design', 'held-out', 'synthetic', 'real golden', 'real findings'];

function accuracy(candidatePairs, checkoutPairs, labels, notices) {
  const rows = [];
  const seen = new Set();
  for (const [id, p] of Object.entries(checkoutPairs)) {
    const label = labels[p.labelKey];
    if (!label) {
      notices.push(`No frozen label for ${id} (${p.labelKey}): not judged.`);
      continue;
    }
    seen.add(p.labelKey);
    const candidate = counted(candidatePairs[id].counted);
    const checkout = counted(p.counted);
    const verdict = (n) => ({ none: n === 0, allowance: n <= allowed(p.pixels) });
    rows.push({
      id,
      set: p.set,
      match: label.match,
      pixels: p.pixels,
      counted: candidate,
      checkoutCounted: checkout,
      pass: verdict(candidate),
      checkoutPass: verdict(checkout),
    });
  }
  const benchmarkPrefixes = ['playwright/', 'rendered'];
  const notRun = Object.keys(labels).filter(
    (key) => benchmarkPrefixes.some((prefix) => key.startsWith(prefix)) && !seen.has(key),
  );
  if (notRun.length) notices.push(`${notRun.length} labelled benchmark pairs not run here.`);

  const wrong = (r, which, tolerance) => r[which][tolerance] !== r.match;
  const summary = {};
  for (const set of SETS) {
    const inSet = rows.filter((r) => r.set === set);
    if (!inSet.length) continue;
    summary[set] = { pairs: inSet.length };
    for (const tolerance of ['none', 'allowance']) {
      summary[set][tolerance] = {
        wrong: inSet.filter((r) => wrong(r, 'pass', tolerance)).length,
        checkoutWrong: inSet.filter((r) => wrong(r, 'checkoutPass', tolerance)).length,
        failing: inSet.filter((r) => !r.pass[tolerance]).length,
        checkoutFailing: inSet.filter((r) => !r.checkoutPass[tolerance]).length,
      };
    }
  }
  const changes = {};
  for (const tolerance of ['none', 'allowance']) {
    changes[tolerance] = {
      regressions: rows
        .filter((r) => !wrong(r, 'checkoutPass', tolerance) && wrong(r, 'pass', tolerance))
        .map((r) => r.id),
      fixes: rows
        .filter((r) => wrong(r, 'checkoutPass', tolerance) && !wrong(r, 'pass', tolerance))
        .map((r) => r.id),
    };
  }
  return { summary, changes, notRun: notRun.length, pairs: rows };
}

/** Pairs allowed fewer pixels than this are left out of the margin that breaks ties. */
const MARGIN_MIN_ALLOWED = 10;

/**
 * Counted pixels as a share of the allowance, over the pairs that should match and pass with it.
 * A pair allowed no pixels passes only with none counted, a share of 0. Shares are rounded to
 * 0.1%, so a tie means the same margin. Result files from before the margin carry the pairs it is
 * worked out from.
 */
function margin(pairs) {
  const passing = pairs
    .filter((p) => p.match && p.counted <= allowed(p.pixels))
    .map((p) => {
      const allowance = allowed(p.pixels);
      const share = allowance === 0 ? 0 : Math.round((p.counted / allowance) * 1000) / 1000;
      return { id: p.id, counted: p.counted, allowed: allowance, share };
    })
    .sort((a, b) => b.share - a.share || b.allowed - a.allowed);
  const large = passing.filter((p) => p.allowed >= MARGIN_MIN_ALLOWED);
  const shares = passing.map((p) => p.share).sort((a, b) => a - b);
  const middle = shares.length >> 1;
  const median =
    shares.length === 0
      ? null
      : shares.length % 2
        ? shares[middle]
        : (shares[middle - 1] + shares[middle]) / 2;
  return {
    pairs: passing.length,
    worst: passing[0] ?? null,
    median,
    worstLarge: large[0] ?? null,
    closest: passing.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------------------------
// 2. Issue #2's residual

function residual(candidate, checkout) {
  const out = {};
  for (const [name, { past, counted: checkoutCounted }] of Object.entries(checkout)) {
    const candidateCounted = counted(candidate[name].counted);
    out[name] = {
      past,
      counted: candidateCounted,
      share: candidateCounted / past,
      checkoutCounted: counted(checkoutCounted),
      checkoutShare: counted(checkoutCounted) / past,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3. Slivers

const SLIVER_SIZES = [
  [200, 2],
  [1, 50],
  [2, 2],
];
const SLIVER_SIDES = [1, 2, 3, 4];

/** A flat dark panel, and the same with three levels more blue: ΔE00 2.11. */
function tint(width, height) {
  const panel = (blue) => {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([20, 24, blue, 255], i);
    return { data, width, height };
  };
  return { expected: panel(30), actual: panel(33) };
}

/** The panels tried: the three sizes reported, then 200×s, s×50 and s×s for each side s. */
const sliverPanels = () => [
  ...SLIVER_SIZES,
  ...SLIVER_SIDES.flatMap((s) => [
    [200, s],
    [s, 50],
    [s, s],
  ]),
];

function slivers(candidate, checkout) {
  const measure = (width, height) => {
    const key = `${width}×${height}`;
    return {
      width,
      height,
      pixels: width * height,
      candidate: counted(candidate[key]),
      checkout: counted(checkout[key]),
    };
  };
  const sizes = SLIVER_SIZES.map(([w, h]) => measure(w, h));
  // The smallest side from which every panel of 200×s, s×50 and s×s, and every larger side
  // tried, counts the whole tint.
  const sweep = SLIVER_SIDES.map((s) => [measure(200, s), measure(s, 50), measure(s, s)]);
  const limit = (which) => {
    let limit = null;
    for (let k = sweep.length - 1; k >= 0; k--) {
      if (!sweep[k].every((m) => m[which] === m.pixels)) break;
      limit = SLIVER_SIDES[k];
    }
    return limit;
  };
  return { sizes, limit: limit('candidate'), checkoutLimit: limit('checkout') };
}

// ---------------------------------------------------------------------------------------------
// 4. Speed

const BENCH_SIZES = [
  [1280, 720],
  [1920, 1080],
  [3200, 2000],
];
const BENCH_CHANGES = [0, 0.01, 0.1, 1];

/** bench/speed.mjs's picture: gradients and soft bands. */
function benchScene(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = 128 + 100 * Math.sin(x / 37) * Math.cos(y / 29);
      data[i + 2] = (y * 255) / height;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** bench/speed.mjs's change: a block covering `fraction` of the image, 40 levels redder. */
function benchChanged(image, fraction) {
  const data = Uint8Array.from(image.data);
  const side = Math.sqrt(fraction * image.width * image.height);
  const w = Math.min(image.width, Math.round(fraction === 1 ? image.width : side));
  const h = Math.min(image.height, Math.round(fraction === 1 ? image.height : side));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * image.width + x) * 4;
      data[i] = Math.min(255, data[i] + 40);
    }
  }
  return { data, width: image.width, height: image.height };
}

const FRAME = [1346, 819];

/** A dark textured frame, the size of the real captures. */
function texturedFrame() {
  const [width, height] = FRAME;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = Math.floor(
        40 + 25 * Math.sin(x / 17) * Math.cos(y / 23) + 10 * Math.sin((x + y) / 5),
      );
      data.set([t, t + 8, t + 16, 255], i);
    }
  }
  return { data, width, height };
}

/**
 * The textured frame with every channel of every pixel one to three levels lighter, in a fixed
 * pattern: a drift of colour, not a move, which win condition 2 asks to be counted. It is the
 * speed section's textured worst case too.
 */
function texturedDrift() {
  const frame = texturedFrame();
  return { expected: frame, actual: adjusted(frame, (i, c) => 1 + (((i >> 2) + c) % 3)) };
}

/**
 * The control for the drift: a textured frame, and the same scene moved 0.3 px right and 0.2 px
 * down, each pixel the average over its area. A true sub-pixel move, so it should match. The
 * texture has finer detail than texturedFrame's, whose own move changes no pixel past ΔE00 1:
 * moved, this one changes about 230,000 pixels past ΔE00 1, up to 1.65. A build that counts
 * every drift without telling it from a move fails here.
 */
function textureMoved() {
  const [width, height] = FRAME;
  const scene = (x, y) =>
    40 + 25 * Math.sin(x / 17) * Math.cos(y / 23) + 15 * Math.sin((x + y) / 2);
  const SAMPLES = 4;
  const render = (dx, dy) => {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let j = 0; j < SAMPLES; j++) {
          for (let i = 0; i < SAMPLES; i++) {
            sum += scene(x + (i + 0.5) / SAMPLES + dx, y + (j + 0.5) / SAMPLES + dy);
          }
        }
        const t = Math.round(sum / SAMPLES ** 2);
        data.set([t, t + 8, t + 16, 255], (y * width + x) * 4);
      }
    }
    return { data, width, height };
  };
  return { expected: render(0, 0), actual: render(0.3, 0.2) };
}

/** A `width`×`height` image of grey `level(x, y)`. */
function greys(width, height, level) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = level(x, y);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/**
 * Faintly textured grey ground, four columns wide, beside an edge to light grey, and the same
 * ground three levels darker. The edge did not move, so this is a change of colour, and it must be
 * counted. Beside the edge, though, any window holds the edge, and a move of the edge by under a
 * pixel can carry as much colour across the window's border as the change took away.
 * A unit test of a shift detector that aligns the two images first, made a whole pair: its two
 * levels at grey 60 stay under ΔE00 1, so here the ground is at grey 100 and three levels darker,
 * and only four columns wide, so that every changed pixel lies beside the edge.
 */
function groundBesideEdge() {
  const ground = (offset) =>
    greys(8, 11, (x, y) => (x >= 4 ? 200 : 100 + ((x * 3 + y * 5) % 7) + offset));
  return { expected: ground(0), actual: ground(-3) };
}

/**
 * An edge from dark grey to light, its middle column a mixture, and the same edge with a
 * different mixture and both columns beside it eight levels lighter. Rasterisers mix an edge pixel
 * differently, but the colours either side of it keep theirs; here they changed too, so this is
 * no rasterisation difference and must be counted. Another unit test of that detector, made a
 * whole pair: only the columns beside the edge change, not the whole of each side, so that every
 * changed pixel lies on the edge or next to it.
 */
function edgeSidesChanged() {
  const edge = (left, mixed, right) =>
    greys(9, 9, (x) => [40, 40, 40, left, mixed, right, 220, 220, 220][x]);
  return { expected: edge(40, 160, 220), actual: edge(48, 120, 228) };
}

function adjusted(image, change) {
  const data = Uint8Array.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++)
      data[i + c] = Math.max(0, Math.min(255, data[i + c] + change(i, c)));
  }
  return { data, width: image.width, height: image.height };
}

/** A deterministic generator in [0, 1), so the grain is the same for every build. */
function lcg(seed) {
  let state = seed;
  return () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** The cases that change the whole frame, which win condition 3 judges. */
const WHOLE_FRAME = [
  'bench 1280×720 100%',
  'bench 1920×1080 100%',
  'bench 3200×2000 100%',
  'textured drift of 1–3 levels, 1346×819',
  'film grain of ±1 level, 1346×819',
  'real whole-frame change',
  'real film grain',
];

/** In a child process: times one build on every case, median of RUNS after one warm-up. */
async function speedWorker({ dist, adapter: adapterName, pairs }) {
  const pkg = await import(pathToFileURL(dist).href);
  const adapter = ADAPTERS[adapterName];
  const cases = [];
  for (const [width, height] of BENCH_SIZES) {
    const expected = benchScene(width, height);
    for (const fraction of BENCH_CHANGES) {
      cases.push([
        `bench ${width}×${height} ${fraction * 100}%`,
        () => ({ expected, actual: benchChanged(expected, fraction) }),
      ]);
    }
  }
  const frame = texturedFrame();
  cases.push([WHOLE_FRAME[3], texturedDrift]);
  const random = lcg(1);
  cases.push([
    WHOLE_FRAME[4],
    () => ({ expected: frame, actual: adjusted(frame, () => Math.floor(random() * 3) - 1) }),
  ]);
  const real = (paths) => () => ({
    expected: decode(readFileSync(paths[0])),
    actual: decode(readFileSync(paths[1])),
  });
  if (pairs.wholeFrame) cases.push([WHOLE_FRAME[5], real(pairs.wholeFrame)]);
  if (pairs.grain) cases.push([WHOLE_FRAME[6], real(pairs.grain)]);

  const out = {};
  for (const [name, make] of cases) {
    const { expected, actual } = make();
    adapter.compare(pkg, expected, actual);
    const times = [];
    for (let k = 0; k < RUNS; k++) {
      const start = performance.now();
      adapter.compare(pkg, expected, actual);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    out[name] = Math.round(times[RUNS >> 1] * 10) / 10;
  }
  process.stdout.write(JSON.stringify(out));
}

async function quietMachine(notices) {
  const deadline = Date.now() + LOAD_WAIT_MS;
  while (loadavg()[0] >= LOAD_LIMIT) {
    if (Date.now() > deadline) {
      notices.push(`1-minute load stayed at ${LOAD_LIMIT} or more: speed skipped.`);
      return false;
    }
    await sleep(20_000);
  }
  return true;
}

const timeBuild = (dir, adapter, pairs) =>
  worker('--speed-worker', { dist: join(dir, 'dist', 'index.js'), adapter, pairs });

// ---------------------------------------------------------------------------------------------
// 5. Size

function isTypeOnly(node) {
  return (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isTypeNode(node) ||
    ts.isTypeParameterDeclaration(node) ||
    (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly === true) ||
    (ts.isExportDeclaration(node) && node.isTypeOnly) ||
    ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.isTypeOnly)
  );
}

/** Lines of a TypeScript file: code, types only, comments only, blank. */
function countLines(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split('\n');
  const kind = lines.map((line) => (line.trim() === '' ? 'blank' : 'comment'));
  const mark = (start, end, type) => {
    const first = source.getLineAndCharacterOfPosition(start).line;
    const last = source.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line;
    for (let line = first; line <= last; line++) {
      if (kind[line] !== 'code') kind[line] = type ? 'type' : 'code';
    }
  };
  const visit = (node, inType) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
      return;
    }
    const type = inType || isTypeOnly(node);
    const children = node.getChildren(source);
    if (children.length === 0) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) mark(node.getStart(source), node.end, type);
      return;
    }
    for (const child of children) visit(child, type);
  };
  visit(source, false);
  const count = (k) => kind.filter((x) => x === k).length;
  return { code: count('code'), types: count('type'), comments: count('comment') };
}

function tsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function size(dir) {
  const total = (files) => {
    const sum = { files: files.length, code: 0, types: 0, comments: 0 };
    for (const file of files) {
      const lines = countLines(file);
      for (const k of ['code', 'types', 'comments']) sum[k] += lines[k];
    }
    return sum;
  };
  return {
    image: total(tsFiles(join(dir, 'src', 'image'))),
    src: total(tsFiles(join(dir, 'src'))),
  };
}

// ---------------------------------------------------------------------------------------------
// Win conditions

function conditions(result) {
  const { accuracy: acc, residual: res, slivers: sl, speed, size: sz } = result;
  const regressions =
    acc.changes.none.regressions.length + acc.changes.allowance.regressions.length;
  const shares = Object.entries(res)
    .filter(([name]) => name !== DRIFT_CASE)
    .map(([, r]) => r);
  const residualImproved =
    shares.length > 0 &&
    shares.every((r) => r.share >= r.checkoutShare) &&
    shares.some((r) => r.share > r.checkoutShare);
  const drift = res[DRIFT_CASE];
  const driftImproved = drift.share > drift.checkoutShare;
  const sliverImproved =
    sl.limit !== null && (sl.checkoutLimit === null || sl.limit < sl.checkoutLimit);
  let slower = null;
  let worstRatio = null;
  if (speed?.ratios) {
    const ratios = Object.values(speed.ratios);
    worstRatio = Math.max(...ratios);
    slower = Object.entries(speed.ratios)
      .filter(([, ratio]) => ratio > 1 + SPEED_NOISE)
      .map(([name]) => name);
  }
  return {
    1: { pass: regressions === 0, regressions },
    2: {
      pass: residualImproved && driftImproved && sliverImproved,
      residualImproved,
      driftImproved,
      sliverImproved,
    },
    3: { pass: slower === null ? null : slower.length === 0, worstRatio, slower },
    4: { pass: sz.candidate.image.code < sz.checkout.image.code, code: sz.candidate.image.code },
  };
}

// ---------------------------------------------------------------------------------------------
// Report

const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
const num = (x) => (Number.isFinite(x) ? x.toLocaleString('en-US') : 'threw');
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`]
    .concat(rows.map((r) => `| ${r.join(' | ')} |`))
    .join('\n');
const yes = (x) => (x === null ? 'n/a' : x ? 'yes' : 'no');

function markdown(r) {
  const out = [];
  const head = `${r.candidate.name} (${r.candidate.commit?.slice(0, 7) ?? 'no git'}${r.candidate.dirty ? ', uncommitted changes' : ''})`;
  out.push(`# Judge: ${head}\n`);
  out.push(`${r.machine.cpu}, Node ${r.machine.node}, ${r.machine.platform}\n`);
  for (const notice of r.notices) out.push(`- Notice: ${notice}`);
  if (r.notices.length) out.push('');

  out.push('## 1. Accuracy\n');
  out.push(
    'Wrong verdicts against the frozen labels; the current checkout on the same bytes in brackets.\n',
  );
  const accRows = Object.entries(r.accuracy.summary).map(([set, s]) => [
    set,
    s.pairs,
    `${s.none.wrong} (${s.none.checkoutWrong})`,
    `${s.allowance.wrong} (${s.allowance.checkoutWrong})`,
    `${s.none.failing} (${s.none.checkoutFailing})`,
  ]);
  out.push(
    table(
      ['Set', 'Pairs', 'Wrong, none allowed', 'Wrong, 0.1% allowed', 'Failing, none allowed'],
      accRows,
    ),
  );
  for (const tolerance of ['none', 'allowance']) {
    const { regressions, fixes } = r.accuracy.changes[tolerance];
    const label = tolerance === 'none' ? 'none allowed' : '0.1% allowed';
    out.push(
      `\nAgainst the current checkout, ${label}: ${regressions.length} lost, ${fixes.length} gained.`,
    );
    for (const id of regressions) {
      const p = r.accuracy.pairs.find((q) => q.id === id);
      out.push(`- lost: ${id}, should ${p.match ? '' : 'not '}match, ${num(p.counted)} counted`);
    }
    for (const id of fixes) out.push(`- gained: ${id}`);
  }

  out.push("\n## 2. Issue #2's residual, and textured drift\n");
  out.push(
    table(
      ['Pair', 'Past ΔE00 1', 'Counted', 'Share', 'Checkout counted', 'Checkout share'],
      Object.entries(r.residual).map(([name, x]) => [
        name,
        num(x.past),
        num(x.counted),
        pct(x.share),
        num(x.checkoutCounted),
        pct(x.checkoutShare),
      ]),
    ),
  );

  out.push('\n## 3. Slivers\n');
  out.push(
    table(
      ['Panel', 'Counted', 'Share', 'Checkout share'],
      r.slivers.sizes.map((s) => [
        `${s.width}×${s.height}`,
        `${s.candidate} of ${s.pixels}`,
        pct(s.candidate / s.pixels),
        pct(s.checkout / s.pixels),
      ]),
    ),
  );
  const side = (s) => (s === null ? `over ${SLIVER_SIDES.at(-1)}` : `${s} px`);
  out.push(
    `\nSmallest side from which every tint is counted in full: ${side(r.slivers.limit)} (checkout: ${side(r.slivers.checkoutLimit)}).`,
  );

  out.push('\n## 4. Speed\n');
  if (!r.speed) out.push('Skipped.');
  else {
    const builds = Object.keys(r.speed.builds);
    const names = Object.keys(r.speed.builds[builds[0]]);
    out.push(`Milliseconds, median of ${RUNS}.\n`);
    out.push(
      table(
        ['Case', ...builds, 'vs 0.1.0'],
        names.map((name) => [
          WHOLE_FRAME.includes(name) ? `**${name}**` : name,
          ...builds.map((b) => r.speed.builds[b][name] ?? ''),
          r.speed.ratios?.[name] === undefined ? '' : `${r.speed.ratios[name].toFixed(2)}×`,
        ]),
      ),
    );
    out.push('\nBold: whole-frame cases, which win condition 3 judges.');
  }

  out.push('\n## 5. Size\n');
  const sizeRow = (name, s) => [
    name,
    s.image.code,
    s.image.types,
    s.image.comments,
    s.src.code,
    s.src.types,
  ];
  out.push(
    table(
      ['Build', 'src/image code', 'types', 'comments', 'src code', 'src types'],
      [
        sizeRow(`${r.candidate.name} (candidate)`, r.size.candidate),
        sizeRow('Checkout', r.size.checkout),
      ],
    ),
  );

  out.push('\n## Margin on pairs that should match\n');
  const m = r.margin;
  out.push(
    `Counted pixels as a share of the 0.1% allowance, over the ${m.pairs} pairs that should match and pass with it. Not a win condition; the worst share at ${MARGIN_MIN_ALLOWED} pixels allowed or more breaks ties.\n`,
  );
  const shareOf = (p) =>
    p ? `${pct(p.share)} (${p.id}, ${num(p.counted)} of ${num(p.allowed)})` : 'n/a';
  out.push(
    table(
      ['Measure', 'Share'],
      [
        ['Worst', shareOf(m.worst)],
        [`Worst, ${MARGIN_MIN_ALLOWED} pixels allowed or more`, shareOf(m.worstLarge)],
        ['Median', m.median === null ? 'n/a' : pct(m.median)],
      ],
    ),
  );

  out.push('\n## Win conditions\n');
  const c = r.conditions;
  out.push(
    table(
      ['Condition', 'Met', 'Measure'],
      [
        [
          '1. No verdict the checkout gets right goes wrong',
          yes(c[1].pass),
          `${c[1].regressions} lost`,
        ],
        [
          "2. Issue #2's residual, textured drift and the sliver limit improve",
          yes(c[2].pass),
          `residual ${yes(c[2].residualImproved)}, textured drift ${yes(c[2].driftImproved)}, slivers ${yes(c[2].sliverImproved)}`,
        ],
        [
          '3. Whole-frame speed no slower than 0.1.0',
          yes(c[3].pass),
          c[3].worstRatio === null ? 'n/a' : `worst ${c[3].worstRatio.toFixed(2)}× 0.1.0`,
        ],
        ['4. Less detector code than the checkout', yes(c[4].pass), `${c[4].code} lines`],
      ],
    ),
  );
  return out.join('\n');
}

/**
 * Ranks result files by the win conditions in order, then by less code, then by the larger margin:
 * the smaller worst share at MARGIN_MIN_ALLOWED pixels allowed or more, then the smaller worst
 * share and median over all.
 */
function compare(files) {
  const results = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  // Result files from before the margin was reported are given it from their pairs.
  for (const r of results) r.margin ??= margin(r.accuracy.pairs);
  const share = (p) => p?.share ?? Number.POSITIVE_INFINITY;
  const labelSets = new Set(results.map((r) => r.judge.labels));
  if (labelSets.size > 1)
    console.log('Notice: these results were judged against different labels.\n');
  const met = (x) => (x === true ? 0 : x === null ? 1 : 2);
  const ranked = results
    .map((r) => ({ r, c: r.conditions }))
    .sort(
      (a, b) =>
        met(a.c[1].pass) - met(b.c[1].pass) ||
        a.c[1].regressions - b.c[1].regressions ||
        met(a.c[2].pass) - met(b.c[2].pass) ||
        met(a.c[3].pass) - met(b.c[3].pass) ||
        met(a.c[4].pass) - met(b.c[4].pass) ||
        a.c[4].code - b.c[4].code ||
        share(a.r.margin.worstLarge) - share(b.r.margin.worstLarge) ||
        share(a.r.margin.worst) - share(b.r.margin.worst) ||
        (a.r.margin.median ?? Number.POSITIVE_INFINITY) -
          (b.r.margin.median ?? Number.POSITIVE_INFINITY),
    );
  const residuals = (r) =>
    Object.entries(r.residual)
      .filter(([name]) => name !== DRIFT_CASE)
      .map(([, x]) => pct(x.share))
      .join(' / ');
  const side = (s) => (s === null ? `>${SLIVER_SIDES.at(-1)}` : String(s));
  console.log(
    table(
      [
        'Rank',
        'Candidate',
        'Commit',
        '1. Lost (none / 0.1%)',
        '2. Residual (synthetic / real)',
        '2. Textured drift',
        '2. Sliver limit',
        '3. Worst whole-frame vs 0.1.0',
        '4. src/image code (types)',
        `Margin: worst at ${MARGIN_MIN_ALLOWED}+ px allowed / worst / median`,
        'Met',
      ],
      ranked.map(({ r, c }, n) => [
        n + 1,
        r.candidate.name,
        `${r.candidate.commit?.slice(0, 7) ?? '?'}${r.candidate.dirty ? '+' : ''}`,
        `${r.accuracy.changes.none.regressions.length} / ${r.accuracy.changes.allowance.regressions.length}`,
        residuals(r),
        pct(r.residual[DRIFT_CASE]?.share),
        `${side(r.slivers.limit)} px`,
        c[3].worstRatio === null ? 'n/a' : `${c[3].worstRatio.toFixed(2)}×`,
        `${r.size.candidate.image.code} (${r.size.candidate.image.types})`,
        [r.margin.worstLarge?.share, r.margin.worst?.share, r.margin.median]
          .map((x) => pct(x ?? Number.NaN))
          .join(' / '),
        [1, 2, 3, 4].map((k) => yes(c[k].pass)).join(', '),
      ]),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Main

async function judge(args) {
  const notices = [];
  const labelsText = readFileSync(LABELS_FILE, 'utf8');
  const labelsFile = JSON.parse(labelsText);
  const labels = { ...labelsFile.benchmark, ...labelsFile.synthetic, ...labelsFile.real };
  const config = captureConfig(notices);
  const adapterName = args.adapter ?? 'default';
  if (!ADAPTERS[adapterName]) throw new Error(`No adapter named ${adapterName}`);

  const candidateDir = args.candidate;
  const self = resolve(candidateDir) === ROOT;
  const name = args.name ?? (self ? 'checkout' : basename(candidateDir));
  if (args.build) build(candidateDir);
  if (!existsSync(join(ROOT, 'dist', 'index.js'))) build(ROOT);
  if (args.render || !existsSync(join(RENDERS, 'manifest.json'))) worker('--render-worker');

  const countInput = (dir, adapterName, past) => ({
    dist: join(dir, 'dist', 'index.js'),
    adapter: adapterName,
    golden: config.golden,
    findings: { opacity: config.pairs.opacity, bilinear: config.pairs.bilinear },
    past,
  });
  const checkoutCounts = worker('--count-worker', countInput(ROOT, 'default', true));
  const candidateCounts = self
    ? checkoutCounts
    : worker('--count-worker', countInput(candidateDir, adapterName, false));
  const acc = accuracy(candidateCounts.pairs, checkoutCounts.pairs, labels, notices);
  const res = residual(candidateCounts.residual, checkoutCounts.residual);
  const sl = slivers(candidateCounts.slivers, checkoutCounts.slivers);

  let speed = null;
  if (args.speed && (await quietMachine(notices))) {
    const realPairs = { wholeFrame: config.pairs.wholeFrame, grain: config.pairs.grain };
    const builds = {};
    const isV010 = config.v010 !== null && resolve(config.v010) === resolve(candidateDir);
    if (config.v010) builds['0.1.0'] = timeBuild(config.v010, 'default', realPairs);
    builds.checkout = timeBuild(ROOT, 'default', realPairs);
    // The candidate's column, apart from the references' even when it shares their name.
    const column = name in builds ? `${name} (candidate)` : name;
    if (!self && !isV010) builds[column] = timeBuild(candidateDir, adapterName, realPairs);
    const timed = builds[self ? 'checkout' : isV010 ? '0.1.0' : column];
    let ratios = null;
    if (builds['0.1.0']) {
      ratios = {};
      for (const caseName of WHOLE_FRAME) {
        const reference = builds['0.1.0'][caseName];
        if (reference !== undefined && timed[caseName] !== undefined) {
          ratios[caseName] = Math.round((timed[caseName] / reference) * 100) / 100;
        }
      }
    }
    speed = { runs: RUNS, builds, ratios };
  }

  const result = {
    judge: { labels: sha16(labelsText), commit: describe(ROOT).commit },
    candidate: { name, ...describe(candidateDir) },
    machine: { cpu: cpus()[0]?.model ?? 'unknown', node: process.version, platform: platform() },
    notices,
    accuracy: acc,
    margin: margin(acc.pairs),
    residual: res,
    slivers: sl,
    speed,
    size: { candidate: size(candidateDir), checkout: size(ROOT) },
  };
  result.conditions = conditions(result);

  const out = args.out ?? join(candidateDir, 'bench', 'results', `judge-${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(markdown(result));
  console.log(`\nResult: ${out}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.speedWorker) await speedWorker(args.speedWorker);
else if (args.countWorker) await countWorker(args.countWorker);
else if (args.renderWorker) await renderWorker();
else if (args.compare) compare(args.compare);
else await judge(args);
