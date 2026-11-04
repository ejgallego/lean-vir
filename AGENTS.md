# Repository Instructions

This repository is a proof of concept for running Lean 4's real IR interpreter
in `wasm32-wasip1`.

Keep the repository workflow small and explicit. Use ordinary Git and the
existing Node/shell harness for the zero-or-one maintenance-line workflow in
[docs/HARNESS.md](docs/HARNESS.md#backports). Keep branch-policy registries and
larger harness machinery out unless the maintainer requests them.

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

- Use the Lean toolchain pinned in `lean-toolchain`.
- For upgrades, follow [the catalog migration roadmap](docs/HARNESS.md#catalog-migration-roadmap):
  record owners and acceptance goals; port the catalog in separate follow-ups.
- Use the local WASI SDK installed by `npm run install:wasi`.
- Use Node/npm for the browser harness and smoke tests.

## Local Commands

- `npm run setup`, then `npm run doctor` to check the environment.
- `npm run build:demo` builds the Lean library and the upstream Wasm.
- `npm test` runs the full local suite; for a focused fixture check, use
  `VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build`.
- `npm run dev -- --port 5173` serves the browser runner.
- See [the harness](docs/HARNESS.md#smallest-useful-check) for the full command
  map and the smallest useful check for each area.

## Git Layout

- Use ordinary `git` commands in this checkout.
- Prefer one linked worktree per implementation task under `.worktrees/<slug>`.
- Keep the root checkout as the stable base for multi-step work when possible.
- Branch names should usually be `feat/<slug>`, `fix/<slug>`,
  `docs/<slug>`, `chore/<slug>`, or local-only `wip/<slug>`.
- Commit subjects should be concise and behavior-oriented, preferably
  `type: summary`.

## Agent Coordination

- Before choosing or resuming work, read `WORKBOARD.md` in the primary checkout
  and the relevant handoffs, and check Git for actual heads and dirty work. The
  board is the single private queue; do not create worktree copies. Keep each
  entry to task, owner, state and next action or blocker, linking history
  instead of repeating it. Owners update their entries; the coordinator sets
  priorities, resolves conflicts, and queues deferred work with an owner and
  revisit trigger or declines it. Give assigned sessions the board path.
- Use the canonical mailbox at `.agents/mailbox/` in the primary checkout and
  follow [the mailbox protocol](docs/development/MAILBOX_PROTOCOL.md) for
  messages, ownership, handoffs and wake-ups. Use `npm run mailbox:list` when
  ownership is unclear; messages record intent, not whether an agent is running.
- Give each implementation lane one accountable writer, a concrete agent
  address, an explicit base commit, write scope, acceptance checks and
  publication boundary. Check for overlapping work first and keep overlapping
  edits sequential. Ownership is task-scoped: completed tasks and old claims
  reserve nothing. The coordinator owns decomposition, integration order and
  final validation of parallel work; reviewers may inspect a lane without
  owning it.
- Start new work from `main`. Use a maintenance line only for selected
  backports, following [the backport guidelines](docs/HARNESS.md#backports);
  verify branch, base and `lean-toolchain` rather than inferring them from a
  worktree name.
- Be quiet by default. Update the board or evidence at meaningful state
  changes. Message only a named recipient who must act now, and notify the
  human only for their review or decision or a material blocker. Report
  discoveries with a proposed next action.
- Continue approved work without another permission round trip. Treat another
  agent's completion as a handoff: verify its head, diff, dirty state and
  remaining work before building on it.
- Keep long non-interactive build/test output in ignored logs with
  [quiet command capture](docs/HARNESS.md#quiet-command-capture).
- Mailbox completion does not authorize a push, PR, merge, worktree removal or
  branch deletion; those remain explicit maintainer actions.

## Pull Requests

- Publish branches only when the maintainer requests a PR, publication or landing.
- Land repository changes through a PR, including documentation-only changes
  and maintenance fixes. Direct pushes to `main` or a maintenance branch require
  an explicit maintainer exception. Follow
  [landing and completion](CONTRIBUTING.md#landing-and-completion) for authorization,
  checks and completion evidence.
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

- Follow the [API change policy](CONTRIBUTING.md#api-changes): remove retired
  interfaces and update callers, docs and tests together, without legacy
  aliases or fallbacks.
- JavaScript modules and Wasm binaries must come from the same VIR build. Mixed
  revisions are unsupported; do not treat their failures as bugs or merge
  blockers. See [matching runtime assets](docs/guides/JS_API.md#matching-runtime-assets).
- Review against [the review assumptions](docs/development/REVIEW_ASSUMPTIONS.md):
  cooperative users and documented public callers, not a hostile-input threat
  model. Reproduce an inferred defect before changing behavior.
- Keep generated `build/` and `web/dist/` outputs out of Git.
- `web/public/vir-upstream.wasm` is generated and should not be committed.
- Generated `.irpkg`, `.wasm`, `.input.json`, and `.report.md` files under
  `web/public/` are local artifacts unless the maintainer explicitly says
  otherwise.
- The current browser `fib` input range is `0..17`.
- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Put demo-only WASI stubs and fixture providers under `wasm/upstream_shim/`.
- Keep the static declaration provider behind `wasm/upstream_shim/package/decl_provider.h`;
  future module-backed loading should replace that provider, not the upstream
  interpreter or the platform shim.
- Keep native lookup restricted to symbols declared by the native extern table
  and generated registries; do not expose general dynamic lookup without a
  concrete runtime case.

## Documentation Map

- `README.md`: user-facing overview and getting-started guide.
- `CONTRIBUTING.md`: branch, commit, PR, and local worktree conventions.
- `docs/HARNESS.md`: setup, generated artifacts, and validation command map.
- `docs/development/MAILBOX_PROTOCOL.md`: local inter-agent coordination and worktree
  ownership protocol.
- `docs/guides/PACKAGES.md`: local `.irpkg` package workflow.
- `docs/guides/CALL_LEAN_FROM_JS.md` and `docs/guides/JS_API.md`: JavaScript runtime usage.
- `docs/reference/UPSTREAM_BOUNDARY.md`: current upstream interpreter boundary details.
