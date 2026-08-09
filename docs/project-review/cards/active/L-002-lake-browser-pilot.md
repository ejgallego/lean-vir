# L-002 — Run the Lake/browser pilot

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Primary pilot
Created: 2026-08-04
Related: [product thesis](../../../PRODUCT.md), [user needs](../../USER_NEEDS.md),
[roadmap](../../ROADMAP.md)

## Outcome Sought

Determine whether a real Lean library author can repeatedly ship selected Lean
logic through an exact-match VIR SDK into an ordinary static browser
application at an acceptable support cost, and later repeat the path through a
tag once the semantics gate permits a supported release.

## Why Now

This is the smallest pilot that exercises VIR's distinctive value and its
foundational Lake, package, release, JavaScript, reload, and deployment
contracts. It is the agreed first pilot after the all-hands.

## Scope

- Use a real downstream repository and project-owned package.
- Mark declarations, build through `:vir`, and install an exact-commit SDK for
  early learning.
- Repeat through tagged `:virSdk` after the release gate.
- Exercise one explicit export and one startup hook.
- Deploy as a static browser application.
- Repeat one package change and one SDK upgrade or reinstall.
- Add only capabilities that block the named workflow.

## Done When

- The user completes first integration and a later repeat without the original
  guided session.
- Evidence records setup time, load/runtime failures, API friction, support
  time, and any workaround.
- The pilot demonstrates a VIR-specific advantage over the user's best
  alternative.
- The decision gate records continue, revise, or stop.
- Durable product, alternative, maintenance, and roadmap documents incorporate
  the result.

## Dependencies

- [C-001](C-001-productization-ownership.md)
- [D-004](D-004-pilot-support-contract.md)
- Early integration may start before
  [D-002](D-002-first-sdk-release.md); tagged repeat use depends on it.
- Any lifecycle-sensitive surface depends on
  [L-003](L-003-binding-lifecycle-semantics.md).

## Evidence

The review validated an unmodified downstream example from a commit artifact.
The repository pins an older VIR commit and Lean release candidate, so it does
not yet validate a tagged upgrade or independent repeat use.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
