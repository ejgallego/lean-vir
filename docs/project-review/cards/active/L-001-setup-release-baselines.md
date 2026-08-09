# L-001 — Establish setup and release baselines

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Pilot readiness
Created: 2026-08-04
Related: [technical evidence](../../TECHNICAL_APPENDIX.md),
[maintenance](../../../MAINTENANCE.md), [roadmap](../../ROADMAP.md)

## Outcome Sought

Determine whether fresh setup resource use and the callback-heavy React
benchmark represent productization blockers, and establish reproducible
release evidence for future comparisons.

## Why Now

The clean review setup peaked near 15.8 GB RSS. The stock React callback row
also mixes steady-state rendering with deferred cleanup accumulation. Both
measurements need clearer interpretation before becoming product claims or
optimization projects.

## Scope

- Reproduce fresh setup on a second machine and identify the dominant phase.
- Measure a lower-parallelism path.
- Split the React callback benchmark into cleanup-flushed steady state and an
  intentional synchronous retention stress case.
- Store comparable benchmark JSON, size reports, command metadata, and
  checksums.
- Do not optimize unmeasured components as part of this card.

## Done When

- A second clean setup records wall time, peak RSS, machine context, and the
  dominant phase.
- A documented lower-resource command either materially reduces the peak or
  the result records why it does not.
- React steady-state samples no longer inherit deferred cleanup from earlier
  samples.
- The stress row remains explicit and asserts cleanup after yielding or
  disposal.
- `docs/PERFORMANCE.md` and `MAINTENANCE.md` state the resulting baseline and
  review rule.

## Dependencies

- Access to a second representative machine or CI runner with meaningful
  memory reporting.

## Evidence

The 2026-07-30 baseline completed setup in 242 seconds at approximately 15.8 GB
peak RSS. Targeted diagnostics showed normal isolated callback renders in
single-digit milliseconds but nonlinear accumulation in long synchronous
rerender loops.

On 2026-08-06, the Lean 4.33.0-rc2 upgrade rebuild and full `npm test` passed
but again reached approximately 16.1 GB peak RSS. Since then, repository-owned
paired benchmarks, timed call phases, artifact identities, custom-inductive
normalization measurements, and a standalone browser campaign application
have substantially improved performance evidence. The second-machine and
lower-resource setup results remain open. Lifecycle semantics and resource
counts now belong to L-003; this card retains setup cost and comparable release
baselines.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
