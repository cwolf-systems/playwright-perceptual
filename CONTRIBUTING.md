# Contributing

Thank you for helping. This page says what a change needs before it can be merged. Small changes
need little; changes to how images are judged need evidence.

## Setup

```sh
npm ci
npx playwright install --with-deps
```

Node is pinned in `.nvmrc`.

## Every change: CI green

A pull request is merged only when every CI job passes. Run the same checks locally first:

```sh
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run test:browser
npm run test:runner
npm run test:count -- --check
```

If you add or remove tests, `npm run test:count` updates the count in the README.

## What else a change needs

| Change                     | Also needs                                          |
| -------------------------- | --------------------------------------------------- |
| Docs, tests, tooling       | Nothing more                                        |
| A bug fix                  | A test that fails without the fix                   |
| A detector change          | A judge run                                         |
| A change to the public API | A migration note and a downstream check             |
| A new detector design      | An issue first, then approaches judged side by side |

A detector change is anything in `src/image/` or `src/compare/`, or a default that can change a
verdict.

### Judge run

The judge scores a build against expected verdicts in `bench/judge-labels.json`, with no changed
pixels allowed and with 0.1% of the image:

```sh
node bench/judge.mjs --skip-speed --out bench/results/judge-local.json
node bench/check-baseline.mjs bench/results/judge-local.json
```

The second command fails if a pair that `bench/results/judge-baseline-0.2.0.json` judged correctly
is now judged wrongly, or if a pair in the baseline is missing from your run. CI runs both on
every pull request and enforces 32 pairs: Playwright's 21 fixture pairs and the 11 synthetic
pairs. The other 172 are screenshots the judge renders, whose pixels depend on the machine; CI
reports them as not compared. They are compared only on a machine like the one the baseline was
made on (macOS, Apple M4), where the maintainer checks them before each release. A Linux
baseline, so that CI can check them too, is future work.

The judge renders the fixture pages once into `bench/data` and reuses them: add `--render` after
changing a page in `test/browser/fixtures/` or Playwright's version.

Put the judge's accuracy table in your pull request. If the change could affect speed, add
`npm run bench` before and after.

A change that loses a correct verdict is not merged, even if it gains others. If you think a
label is wrong, see [Labels are frozen](#labels-are-frozen).

### Migration note and downstream check

For any change to an exported type, option, default or behaviour:

- Add an entry to `CHANGELOG.md` that says what changed and what a user must do.
- Pack the build (`npm pack`), install it in a project that uses this package, and run that
  project's visual tests against the previous release. Say in the pull request what you ran and
  what changed.

### New detector designs

Replacing how a detector works starts with an issue. Each approach is built on its own branch and
scored by the same judge, unchanged, then compared with `node bench/judge.mjs --compare a.json
b.json`. The reasoning and the variants tried go in a design log in `docs/design/`.

## Labels are frozen

`bench/judge-labels.json` holds the expected verdict for each pair. Changing a label is its own
pull request: one label change and its reason per entry, reviewed on its own, with the baselines
regenerated. Never change a label in the same pull request as the code it would let pass. CI
warns on any pull request that changes the labels or a committed baseline.

## Quality floor

- Don't weaken a test, except together with the feature it tests. Removing a feature removes its
  tests; loosening an assertion so that a change passes is not allowed.
- Keep comments that say why. Remove a comment only when the code it explains is gone.
- Write plain code. No golfed code: prefer a named step to a clever expression.

## Public text

Code, docs, commit messages and pull requests are public. Keep them generic: no names of private
projects, internal process names, local paths or personal email addresses. Figures in the docs
must come from a script in this repository, or say that they were measured elsewhere.

## Commits and merging

- Commit under your own name and email address. Pull requests are merged by fast-forward, so your
  commits land on `main` as they are, with your authorship kept, and `main` stays linear. Rebase
  on `main`; don't merge `main` into your branch.
- `CWOLFSYSTEMS <info@cwolfsystems.com>` is the maintainer's identity only, for the maintainer's
  own commits. Don't commit under it.
- Each commit is one logical change. Its message says what changed and why.

## Releases

Don't change the version. Publishing to npm is the maintainer's step: a GitHub release runs the
release workflow.
