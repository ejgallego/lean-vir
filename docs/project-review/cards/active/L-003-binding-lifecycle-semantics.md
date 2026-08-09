# L-003 — Converge binding and lifecycle semantics

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Pre-release semantics
Created: 2026-08-10
Related: [product direction](../../../PRODUCT.md),
[maintenance](../../../MAINTENANCE.md), [roadmap](../../ROADMAP.md),
[pilot support contract](D-004-pilot-support-contract.md)

## Outcome Sought

Establish one supportable browser-binding architecture and one lifecycle model
for values, callbacks, resources, cancellation, reload, disposal, and React
replay before freezing the first SDK surface.

## Why Now

VIR can already expose the operations required by DOM, canvas, React, and
Illuminate workloads. Recent draft work shows that the remaining uncertainty
is which binding definition is authoritative and how ownership behaves on
partial failure, cancellation, abandoned work, and teardown. Tagging first
would turn unresolved semantics into accidental compatibility promises.

## Scope

- Inventory the Lean declarations, marker metadata, manifest entries,
  generated adapters, host-target registry, and handwritten implementations
  involved in a binding.
- State the authoritative source for identifiers, signatures, conversions,
  ownership, and documentation.
- Define owned, borrowed, retained, transferred, released, cancelled,
  detached, and terminal states.
- Validate a representative scalar host call, DOM resource, event callback,
  timer or animation cancellation, and React replay/abandonment case.
- Evaluate PR #103 and PR #101 against the contract; neither draft defines the
  contract merely by existing.
- Record callback escape or generative-borrow limitations that remain outside
  the first supported surface.
- Do not expand broad DOM, React, or application-specific binding parity in
  this card.

## Done When

- A binding can be traced from its Lean declaration through package metadata
  to its JavaScript implementation without guessing which copy is canonical.
- One documented ownership table covers success, conversion failure, host or
  callback exception, cancellation, package replacement, disposal, React
  replay, and abandoned render.
- Virtual-host and real-browser tests assert balanced resources for creation,
  rollback, cancellation, reload, and disposal.
- PR #103 is either reduced and landed with independent review or its surface
  is explicitly excluded from the first release.
- PR #101's animation-frame cancellation case passes before any corresponding
  stateful API is accepted.
- `PRODUCT.md`, `MAINTENANCE.md`, and the binding/lifecycle owner documentation
  state the resulting contract and exclusions.

## Dependencies

- A named reviewer through
  [C-001](C-001-productization-ownership.md).
- Representative Illuminate and React workloads remain available as evidence.

## Evidence

- 2026-08-09: PR #103 head `031b2e79c65fc52b3930f82848d53dd37dbde8b3`
  passed all CI jobs but remained a nine-commit draft spanning 46 files.
- 2026-08-09: PR #101 head `b8214b07b89428a4e053e43b3f9a4b8c2f9d701d`
  failed real-browser smoke because a pending animation frame was not
  cancelled.
- Current `main` supports Illuminate browser operations and passes the
  repository lifecycle tests; these establish implementation breadth, not a
  frozen ownership contract.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: [D-002](D-002-first-sdk-release.md) consumes the accepted
surface; feature-specific cards are created only for bounded pilot blockers.
Durable documents updated: None
