# Repository Instructions

This repository is a proof of concept for running Lean 4's real IR interpreter
in `wasm32-wasip1`.

Keep the repository workflow small and explicit. Do not introduce backport
policy, branch-policy metadata, or a large Python harness unless the maintainer
asks for that machinery.

## Scope

- Repository root: `/home/egallego/lean/vir`
- Primary work areas:
  - `Vir/` and `tools/` for Lean-side library and package tools
  - `wasm/upstream_shim/` for the local WASI boundary and demo host shims
  - `web/src/` for the JavaScript runtime and browser runner
  - `examples/` and `fixtures/` for demos and regression fixtures
  - `scripts/` for repository-local harness and artifact tooling
  - `docs/` for contributor and maintainer-facing details

## Toolchain

- Use Lean `leanprover/lean4:v4.32.0-rc1`.
- Use the local WASI SDK installed by `npm run install:wasi`.
- Use Node/npm for the browser harness and smoke tests.

## Local Commands

- `npm install`
- `npm run setup`
- `npm run doctor`
- `npm run fetch:lean`
- `npm run install:wasi`
- `npm run build:demo`
- `npm run build:site`
- `npm run probe:upstream`
- `npm test`
- `npm run test:upstream`
- `VIR_FIXTURE_FILTER=fib12 npm run test:fixtures`
- `VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build`
- `CHROMIUM=/path/to/chromium npm run test:pages:browser`
- `npm run dev -- --port 5173`

## Git Layout

- Use ordinary `git` commands in this checkout.
- Prefer one linked worktree per implementation task under `.worktrees/<slug>`.
- Keep the root checkout as the stable base for multi-step work when possible.
- Do not push branches unless the user explicitly asks.
- Branch names should usually be `feat/<slug>`, `fix/<slug>`,
  `docs/<slug>`, `chore/<slug>`, or local-only `wip/<slug>`.
- Commit subjects should be concise and behavior-oriented, preferably
  `type: summary`.

## Pull Requests

- Use `scripts/pr-message.sh` before opening or editing a PR description.
- Keep PR titles and bodies suitable as the final squash commit message.
- Start public PR bodies with `This PR ...`.
- Do not add generator or tool prefixes such as `[codex]`.
- Keep local worktree names, command transcripts, and routine validation logs
  out of public PR bodies.
- Treat CI as the normal validation record. Mention local validation only when
  it adds review-relevant information CI cannot show or when skipped checks
  change review risk.

## Development Notes

- Keep generated `build/` outputs out of Git.
- Keep generated `web/dist/` outputs out of Git.
- `web/public/vir-upstream.wasm` is generated and should not be committed.
- Generated `.irpkg`, `.wasm`, `.input.json`, and `.report.md` files under
  `web/public/` are local artifacts unless the maintainer explicitly says
  otherwise.
- The current browser `fib` input range is `0..17`.
- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Put demo-only WASI stubs and fixture providers under `wasm/upstream_shim/`.
- Keep the static declaration provider behind `wasm/upstream_shim/decl_provider.h`;
  future module-backed loading should replace that provider, not the upstream
  interpreter or the platform shim.
- Do not add native lookup support until a real demo case requires it.

## Documentation Map

- `README.md`: user-facing overview and getting-started guide.
- `CONTRIBUTING.md`: branch, commit, PR, and local worktree conventions.
- `docs/HARNESS.md`: setup, generated artifacts, and validation command map.
- `docs/LOCAL_IRPKG.md`: local `.irpkg` package workflow.
- `docs/CALL_LEAN_FROM_JS.md` and `docs/JS_API.md`: JavaScript runtime usage.
- `docs/UPSTREAM_BOUNDARY.md`: current upstream interpreter boundary details.
