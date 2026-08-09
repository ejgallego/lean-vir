# C-002 — Obtain upstream feasibility feedback

Type: Coordinate
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Upstreaming
Created: 2026-08-04
Related: [upstreaming strategy](../../../UPSTREAMING.md),
[upstream boundary](../../../UPSTREAM_BOUNDARY.md),
[Lake/browser pilot](L-002-lake-browser-pilot.md)

## Outcome Sought

Obtain a technically informed upstream response on whether small WASI
portability patches and, later, an explicit IR declaration-provider seam would
be welcome and under what constraints.

## Why Now

VIR now has a bounded real-environment experiment showing that the current
public path is disproportionate for a declaration-only runtime. Feedback can
test the narrow provider proposal while keeping package, browser, native
policy, and cross-entry cache work separate.

## Scope

- Present the current unmodified-interpreter boundary and strict WASI link.
- Separate build/platform fixes, static native registration, provider design,
  and VIR-specific package/browser APIs.
- Ask about expected semantics, tests, ownership, and second-consumer evidence.
- Record feedback; do not open a broad upstream PR from this card.

## Done When

- One appropriate Lean upstream maintainer reviews the component disposition.
- Feedback records which proposals are plausible now, need pilot evidence, or
  should remain external.
- Required test and ownership expectations are explicit.
- `UPSTREAMING.md` and `DECISIONS.md` incorporate the outcome.
- Any implementation proposal becomes a separate bounded card.

## Dependencies

- [D-001](D-001-recenter-all-hands.md) provides a concise technical framing.
- ULC-0001 is ready to present. A provider request no longer depends on the
  Lake/browser pilot, although a second consumer would strengthen adoption
  evidence.

## Evidence

The current repository compiles the real interpreter unmodified and supplies
declarations through link-time hooks. ULC-0001 records a correct
real-environment comparison: +3,449,983 stripped bytes, roughly +60% package
load, and roughly +19% steady fresh-entry execution. It concludes that a
narrow explicit provider request is justified. No upstream position has yet
been recorded.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
