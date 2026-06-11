# Harness

This document is for maintaining Lean VIR. The user-facing quickstart stays in
the top-level `README.md`. A narrower map of script entry points lives in
`scripts/README.md`.

The repository-local harness has three jobs:

- fetch and pin the upstream Lean source used for the WASI build
- build the upstream IR interpreter plus the local WASI shim
- generate and test `.irpkg`, WASM, site, and SDK artifacts

It is intentionally shell and npm based. This repository does not use a
branch-policy file, paired backports, or a large Python worktree harness.

## Setup

Install npm dependencies first:

```bash
npm install
```

Then prepare the local Lean source checkout, WASI SDK, and demo WASM:

```bash
npm run setup
npm run doctor
```

`npm run setup` expands to:

```bash
npm run fetch:lean
npm run install:wasi
npm run build:demo
```

`npm run doctor` checks the local command and artifact state after setup. It
fails for missing required pieces and warns when Chromium is not available for
browser smoke tests.

The Lean toolchain is pinned by `lean-toolchain`. The upstream source fetcher
pins the matching Lean source checkout under `third_party/lean4-src/`.

## Generated Artifacts

Generated files are useful evidence while debugging, but they are not commit
material by default:

- `build/`: object caches, generated packages, fixture reports, and summaries
- `web/dist/`: Vite Pages output
- `web/public/*.wasm`: generated browser WASM
- `web/public/*.irpkg`: generated browser packages
- `web/public/*.input.json` and `web/public/*.report.md`: generated package
  diagnostics
- `web/public/downloads/`: generated downloadable archives
- `third_party/lean4-src/`: fetched Lean source checkout
- `.tools/`: local WASI SDK and optional engine installs

The most useful generated diagnostics are:

- `build/upstream-probe/boundary.md`
- `build/generated/*.report.md`
- `build/fixtures/summary.json`
- `build/fixtures/*.report.md`

Reference these reports in local notes or final summaries when they explain a
failure, but keep them out of Git unless the maintainer asks for a tracked
fixture/report change.

## Command Map

Toolchain and build:

```bash
npm run fetch:lean
npm run install:wasi
npm run build:demo
npm run build:site
```

Package generation and inspection:

```bash
npm run generate:irpkg -- examples/Fib.lean web/public/local-fib.irpkg
npm run prepare:irpkg -- examples/quickstart.virpkg.json
npm run inspect:irpkg -- web/public/local-quickstart.irpkg
npm run inspect:irpkg -- --json web/public/local-quickstart.irpkg
node scripts/run-fixtures.mjs --help
```

Tests:

```bash
npm run test:upstream
npm run test:runtime
npm run test:fixtures
npm run test:fixtures:no-build
npm run test:site
npm run test:pages:browser
npm test
```

`npm test` runs the boundary registry check, upstream smoke, JavaScript runtime
tests, and fixture suite. It is the default pre-merge signal for code changes.

## Smallest Useful Check

- Shim/native extern registry changes:
  `npm run check:boundary-registry`
- Upstream interpreter or WASI boundary changes:
  `npm run test:upstream`
- JavaScript runtime, host bindings, manifest decoding, or callback lifecycle:
  `npm run test:runtime`
- Lean fixture behavior or package generation coverage:
  `npm run test:fixtures`
- A single fixture or fixture family:
  `VIR_FIXTURE_FILTER=<substring> npm run test:fixtures`
- A single fixture after `npm run build:demo` has already refreshed the WASM
  and browser packages:
  `VIR_FIXTURE_FILTER=<substring> npm run test:fixtures:no-build`
- Site bundle, SDK archive, or local archive shape:
  `npm run test:site`
- Browser interaction, DOM, React, timers, animation callbacks, or page runner
  behavior:
  `npm run build:site`
  then `CHROMIUM=/path/to/chromium npm run test:pages:browser`
- Broad pre-merge check:
  `npm test`

`VIR_FIXTURE_FILTER` matches fixture id, source path, entry name, and roots by
case-insensitive substring. For example:

```bash
VIR_FIXTURE_FILTER=string npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build
```

`test:fixtures:no-build` is a local iteration shortcut. It requires
`web/public/vir-upstream.wasm` from a previous `npm run build:demo`.

## Browser Smoke

`npm run test:pages:browser` runs a built `web/dist/` site against headless
Chromium over the Chrome DevTools Protocol.

The script searches common Linux/macOS Chromium paths and `PATH`. If Chromium
is elsewhere, set:

```bash
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

Run `npm run build:site` first when you want to refresh `web/dist/`.

## Implementation Map

Keep focused checks and shared helpers in the split modules instead of copying
logic into entry-point scripts or pages:

- Runtime smoke tests: `scripts/runtime-tests/*.mjs`
- Browser smoke cases and page suites: `scripts/browser-smoke-*.mjs`
- Process and benchmark helpers: `scripts/process-utils.mjs` and
  `scripts/bench-utils.mjs`
- Browser page helpers: `web/src/pages/page-utils.js` and
  `web/src/pages/input-parsers.js`
- Host resource and virtual binding internals:
  `web/src/host/vir-host-resources.js` and
  `web/src/host/vir-virtual-host-bindings.js`

## Worktree Workflow

For multi-step implementation work, prefer a linked worktree:

```bash
git worktree add -b feat/<slug> .worktrees/<slug> main
```

Keep `.worktrees/` local and ignored. Use ordinary Git commands; there is no
repository-specific worktree harness here.

The root checkout is the stable base. Avoid using it for unrelated parallel
implementation branches, and do not delete unrelated worktrees unless the
maintainer explicitly asks.
