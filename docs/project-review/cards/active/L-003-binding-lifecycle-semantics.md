# L-003 — Converge binding and lifecycle semantics

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Pre-release semantics
Created: 2026-08-10
Related: [product direction](../../../PRODUCT.md),
[maintenance](../../../MAINTENANCE.md), [roadmap](../../ROADMAP.md),
[first supported SDK](D-002-first-sdk-release.md)

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
- Treat merged PR #103 as implementation evidence and evaluate PR #101 and PR
  #124 against the same contract; no patch defines the public contract merely
  by existing.
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
- The merged PR #103 surface has an independent contract review; any behavior
  that cannot be explained by the accepted model is explicitly excluded from
  the first release.
- PR #101's animation-frame cancellation case passes before any corresponding
  stateful API is accepted.
- `PRODUCT.md`, `MAINTENANCE.md`, and the binding/lifecycle owner documentation
  state the resulting contract and exclusions.

## Dependencies

- A named reviewer through
  [C-001](C-001-productization-ownership.md).
- Representative Illuminate and React workloads remain available as evidence.

## Evidence

- 2026-08-10: PR #103 merged as `607ef30`, adding compositional foreign-resource
  lifetime handling and extensive virtual-host and real-browser coverage. This
  materially reduces implementation risk, but the support vocabulary and
  authoritative binding-definition path remain to be consolidated.
- 2026-08-09: PR #101 head `b8214b07b89428a4e053e43b3f9a4b8c2f9d701d`
  failed real-browser smoke because a pending animation frame was not
  cancelled.
- 2026-08-10: draft PR #124 added a green browser regression for React Strict
  Mode callback replay, strengthening evidence for the same lifecycle model.
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
