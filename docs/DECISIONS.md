# VIR Decision Log

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-13

This log records durable product and architecture choices. Action cards record
the work that implements or tests a decision; they do not replace the current
decision here. A later entry supersedes an earlier decision rather than
rewriting its history.

## DEC-001 — Keep the upstream IR interpreter unmodified

Status: Accepted
Recorded: 2026-08-04

Decision: Compile Lean's real `ir_interpreter.cpp` for `wasm32-wasip1` without
maintaining a VIR fork. Put package lookup, platform support, native policy,
and browser integration behind local boundaries.

Reason: This maximizes semantic alignment with Lean and makes version drift
and local glue measurable.

Consequence: VIR must track Lean IR layouts, runtime dependencies, and native
extern requirements across Lean versions.

## DEC-002 — Start with trusted project-generated packages

Status: Accepted
Recorded: 2026-08-04

Decision: The initial product boundary accepts packages generated from source
controlled by the integrating project. It does not claim safe execution of
arbitrary uploaded packages.

Reason: Manifest and format validation do not provide execution budgets,
complete layout validation, worker isolation, or recovery from a hung call.

Consequence: Untrusted-package work is demand-triggered and requires a named
use case plus a separate security design.

## DEC-003 — Keep native lookup explicit and restricted

Status: Accepted
Recorded: 2026-08-04

Decision: Resolve only native symbols declared by the native extern table,
generated registries, and package-scoped host-import trampolines.

Reason: General dynamic lookup is unnecessary for current cases and would
weaken auditability and the runtime boundary.

Consequence: New native behavior requires an explicit declaration, provider,
and validation update.

## DEC-004 — Run the Lake/browser pilot first

Status: Accepted direction
Recorded: 2026-08-04

Decision: After the all-hands, use the Lake/browser integration as the first
productization pilot. Treat infoview and ProofWidgets as a follow-on lane unless
a named owner and stronger immediate evidence justify parallel work.

Reason: The Lake/browser path is the smaller foundational contract and tests
release consumption, package generation, JavaScript calls, startup hooks,
deployment, and repeat use together.

Consequence: The first pilot must demonstrate a VIR-specific advantage and
acceptable support cost, not merely repeat a repository demo.

## DEC-005 — Make the all-hands an architectural and product explanation

Status: Accepted direction
Recorded: 2026-08-04

Decision: Center the all-hands on what VIR does, how it is used, upstreaming
risks and opportunities, and comparison with alternatives. Put maintenance,
roadmap, and recruitment in the conclusion or discussion.

Reason: A technically mixed audience first needs a clear problem, mechanism,
boundary, and trade-off model.

Consequence: The existing deck and runbook require revision before the
meeting; this is tracked by
[D-001](project-review/cards/archive/2026/D-001-recenter-all-hands.md). The
presentation is now complete; DEC-008 records its main follow-up.

## DEC-006 — Use action cards as the execution layer

Status: Accepted
Recorded: 2026-08-04

Decision: Track at most eight active `Deliver`, `Learn`, or `Coordinate` cards.
Archive cards after acceptance and closure; preserve durable facts and choices
in living documentation.

Reason: This makes ownership and completion visible without turning every
insight into a permanent work item or introducing a large project-management
system.

Consequence: A roadmap phase or pilot groups bounded cards. If an external
issue tracker becomes authoritative, the Markdown board links to it rather
than duplicating live status.

## DEC-007 — Resolve binding and lifecycle semantics before freezing v0.1

Status: Accepted direction
Recorded: 2026-08-10

Decision: Do not freeze the first supported SDK surface merely because the
core execution, Lake, CI, and distribution paths are now credible. First make
the browser binding ownership model and cross-boundary resource, callback,
cancellation, reload, and disposal semantics coherent enough to support.

Reason: Recent Illuminate, stateful-browser, React, and foreign-resource work
shows that the remaining uncertainty is not whether VIR can expose more host
operations. It is which binding definition is authoritative and how owned and
borrowed values behave across success, failure, cancellation, replay, and
teardown. A premature release contract would turn active design work into an
accidental compatibility promise.

Consequence: The next phase is a bounded semantics and architecture exercise,
tracked by
[L-003](project-review/cards/active/L-003-binding-lifecycle-semantics.md).
The first tagged release follows that decision rather than setting it. The
Lake/browser pilot may use commit-matched artifacts for learning, but must not
be presented as validation of a frozen public API.

## DEC-008 — Compare JS, VIR, and FIR with a multidimensional contract

Status: Accepted direction
Recorded: 2026-08-11

Decision: Use semantic parity, time to first correct result, warm execution,
deployable size, memory, integration cost, and update behavior as separate
dimensions for the core JavaScript/VIR/FIR comparison. Freeze artifact and
environment identity, and report VIR's first-workload and incremental-package
costs separately. Do not produce one universal ranking.

Reason: The all-hands identified comparison quality as the most important
follow-up. Existing benchmark machinery is broad, but load, speed, size, and
shared-runtime amortization answer different product questions. A single
headline timing or byte count would hide those differences.

Consequence: Controlled comparison evidence is now a product-decision gate,
tracked by
[L-004](project-review/cards/active/L-004-js-vir-fir-comparison.md). The
Lake/browser pilot uses the same contract against the user's actual fallback,
and release evidence adopts its artifact-accounting rules.

## DEC-009 — Ship the support contract with the first SDK

Status: Accepted direction
Recorded: 2026-08-11

Decision: Treat the first SDK artifact and its supported/experimental/out-of-
scope matrix, trust boundary, ownership, escalation path, and failure-reporting
requirements as one deliverable.

Reason: Separate release and support cards could complete at different times
and allow the artifact to imply a broader promise than the organization has
agreed to maintain.

Consequence: D-004 is superseded and its remaining outcome is consolidated
into
[D-002](project-review/cards/active/D-002-first-sdk-release.md).
