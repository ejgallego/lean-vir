# L-001 — Measure fresh setup resource cost

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Pilot readiness
Created: 2026-08-04
Related: [technical evidence](../../TECHNICAL_APPENDIX.md),
[maintenance](../../../MAINTENANCE.md), [roadmap](../../ROADMAP.md)

## Outcome Sought

Determine whether fresh setup resource use is a productization or contributor
onboarding blocker, identify its dominant phase, and document a usable
lower-resource path.

## Why Now

The clean review setup peaked near 15.8 GB RSS and a later Lean upgrade rebuild
reached roughly 16.1 GB. This is a distinct maintenance and contributor-cost
question. Cross-backend runtime evidence now belongs to L-004, while callback
and React cleanup semantics belong to L-003.

## Scope

- Reproduce fresh setup on a second machine and identify the dominant phase.
- Measure a lower-parallelism path.
- Record wall time, peak RSS, disk use, command metadata, and machine context.
- Do not optimize unmeasured components as part of this card.

## Done When

- A second clean setup records wall time, peak RSS, machine context, and the
  dominant phase.
- A documented lower-resource command either materially reduces the peak or
  the result records why it does not.
- `docs/HARNESS.md` and `MAINTENANCE.md` state the resulting baseline,
  lower-resource command, and review rule.

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
lower-resource setup results remain open. On 2026-08-11 the cross-backend
release evidence moved to L-004, and lifecycle/resource-count questions
remained with L-003.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
