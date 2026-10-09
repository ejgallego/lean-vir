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
- `npm run test:fixtures:unit`
- `VIR_FIXTURE_FILTER=fib12 npm run test:fixtures`
- `VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build`
- `CHROMIUM=/path/to/chromium npm run test:pages:browser`
- `npm run dev -- --port 5173`

## Git Layout

- Use ordinary `git` commands in this checkout.
- Prefer one linked worktree per implementation task under `.worktrees/<slug>`.
- Keep the root checkout as the stable base for multi-step work when possible.
- Branch names should usually be `feat/<slug>`, `fix/<slug>`,
  `docs/<slug>`, `chore/<slug>`, or local-only `wip/<slug>`.
- Commit subjects should be concise and behavior-oriented, preferably
  `type: summary`.

## Agent Coordination

- When present, read `WORKBOARD.md` in the primary checkout before choosing or
  resuming work. It is the single private queue; do not create worktree copies.
  Keep its active queue short: task, owner, state, and next action or blocker.
  Owners update their entries; the coordinator maintains priorities and resolves
  conflicts. Link supporting history instead of repeating it. Give assigned
  sessions the canonical board path.
- Report discoveries with a proposed next action. The coordinator must put
  deferred work on the board with an owner and revisit trigger, or explicitly
  decline it; a mailbox mention of "after the PR" is not a queued task.
- Choose the tools, models, and degree of delegation that best fit the task.
  Work directly or use independent agents/subagents as useful; routine choices
  need no additional permission. Consider correctness, context, latency, cost,
  and coordination overhead, and adapt when the evidence changes.
- Ownership belongs to an explicit active task and write scope, not a subsystem
  or agent nickname. Labels such as "Module" describe expertise, not permanent
  control of all build/resource work. Completed tasks and historical mailbox
  claims do not reserve future work. Preserve actual in-flight edits until a
  handoff, but do not ask former owners for permission to start independent work.
  Resolve ambiguous or stale assignments once on the board, not through a chain
  of owner approvals. Delegation does not transfer an existing active task.

- Before choosing a base, read [the backport guidelines](docs/HARNESS.md#backports).
  Start new work from `main`; a maintenance checkout is for selected backports
  or explicitly requested maintenance work. Verify the branch, base commit and
  `lean-toolchain` rather than inferring the line from the worktree name.
- For a backport, name the source PR/landed commit and maintenance target in the
  lane claim. Preserve `cherry-pick -x` provenance, explain conflict adaptations,
  and validate using that line's own toolchain and generated artifacts.

- Use the canonical mailbox at `.agents/mailbox/` in the primary/root
  checkout. Linked implementation worktrees must not create separate
  mailboxes.
- Follow `docs/development/MAILBOX_PROTOCOL.md` for same-project and cross-project
  messages. A cross-project thread belongs to the project that owns the
  requested code change.
- Read the board and relevant handoffs before starting or resuming work. Use
  `npm run mailbox:list` when ownership is unclear; do not scan the entire
  mailbox for routine continuation. Check Git for actual heads and dirty work;
  messages record intent, not whether an agent is running.
- Give each implementation lane one accountable writer, a concrete agent
  address, an explicit base commit, write scope, acceptance checks, and
  publication boundary. Check for overlapping work before recording the claim.
- For parallel work, the coordinating agent owns task decomposition,
  dependencies, integration order, and final validation. Keep overlapping edits
  sequential. Review agents may inspect a lane without acquiring write ownership.
- Consult another owner only for overlapping edits or a change to a shared
  contract. Source ownership is not approval authority over unrelated work.
  Continue already-authorized scope without another agreement round trip;
  request a decision only for new scope, a real conflict, or missing authority.
  A liaison handles assigned intake and handoffs directly; the coordinator need
  not relay or re-approve each exchange. Each PR operation (publication, CI,
  landing) has one accountable owner; roles may differ, but do not duplicate them.
- Scale coordination to the work. Use explicit assignments, inspectable agent
  IDs, and durable checkpoints for long or overlapping lanes; keep independent
  work independent. Do not poll or message other lanes for routine status.
- Be quiet by default. Owners update the board/evidence at meaningful state
  changes; do not send chat or queue messages for each commit, build start, CI
  start, or ordinary progress. The board is the status surface, not a trigger
  for a notification.
- Send one consolidated handoff only when a specific recipient needs to act:
  request review/decision, take a dependency, wake an idle owner, or resolve a
  blocker. `codex queue` is targeted wake-up/assignment, not a broadcast or
  receipt mechanism. Do not send acknowledgments, receipt echoes, duplicate
  completion reports, or unchanged CI updates. For PR checks, record the final
  exact-head result once; report an earlier failure only if it changes scope or
  blocks the next action.
- Notify the human when their review/decision is needed, or promptly for a
  material blocker or scope/ownership conflict. Otherwise keep the board current
  and batch independent lane updates into one short digest when useful; do not
  fan out routine status. Keep hashes, logs, and test inventories in evidence.
  Default actionable handoffs to four lines: outcome, exact head/PR, decision
  needed, and one evidence link.
- Keep long non-interactive build/test output in ignored logs; report the result
  and a short failure excerpt when needed. Preserve full diagnostics. Do not
  suppress interactive output or progress needed for diagnosis.
- Continue approved work without another permission loop, but surface real
  blockers and decisions promptly. Do not reply merely to acknowledge this rule.
- Treat an agent's completion as a handoff for review. Verify the actual head,
  diff, dirty state, and remaining work before consuming it. Transfer ownership
  explicitly before another agent writes to the same lane. After an interruption,
  check the current source and handoff before continuing; a model switch alone
  does not require a new claim or notification.
- The validated envelope is deliberately small. Kinds, states, ownership, and
  lane metadata are recommended coordination conventions, not a requirement
  for free-form agent messages.
- Mailbox completion does not authorize a push, PR, worktree removal, or branch
  deletion. Those remain explicit maintainer actions.

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
  interfaces and their compatibility code, and update callers, docs and tests
  together. Do not retain legacy aliases or fallbacks for previous VIR revisions.

- JavaScript runtime modules and Wasm binaries must come from the same VIR
  revision/build. Users are responsible for refreshing their build setup,
  replacing deployed assets together, and refreshing stale browser/deployment
  caches after updating VIR. Mixing revisions is unsupported and has undefined
  behavior, even when instantiation succeeds. For now, do not treat mixed-revision
  failures as product bugs or merge blockers, or add compatibility adapters,
  version gates, or deployment machinery solely to support that combination.
  See [matching runtime assets](docs/guides/JS_API.md#matching-runtime-assets).

- Follow [the review assumptions](docs/development/REVIEW_ASSUMPTIONS.md).
  Supported workflows assume cooperative users/developers; unsupported artifact
  manipulation has undefined behavior. Justify checks by ordinary configuration,
  acquisition, compatibility, portability or ownership failures, not an implicit
  hostile-input threat model. Reproduce inferred defects before changing behavior.
  For runtime findings, identify the documented public caller and its required
  preconditions. Internal constructors, partial test fixtures and shipped helper
  modules do not establish support for every combination of optional arguments.
  Separate supported-path defects from internal consistency and optional hardening;
  do not expand the API contract merely to make an unsupported reproducer work.

- Keep generated `build/` outputs out of Git.
- Keep generated `web/dist/` outputs out of Git.
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
