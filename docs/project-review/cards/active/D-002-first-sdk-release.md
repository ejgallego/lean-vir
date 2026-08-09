# D-002 — Publish and consume the first SDK release

Type: Deliver
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: After semantics gate
Created: 2026-08-04
Related: [roadmap](../../ROADMAP.md), [product boundary](../../../PRODUCT.md),
[maintenance](../../../MAINTENANCE.md)

## Outcome Sought

A tagged `v0.1.0` SDK can be installed and used by a clean downstream Lean and
browser project without a neighboring VIR checkout or authenticated
commit-artifact path.

## Why Now

The Lake and SDK paths pass locally and in CI, and exact-commit SDK consumption
works. A release remains necessary for a durable compatibility claim, but the
binding and lifecycle surface is still under design. The release should record
that decision rather than force it prematurely.

## Scope

- Wait for L-003 to define the smallest supportable binding and lifecycle
  surface.
- Resolve release-relevant development dependency advisories.
- Freeze the supported, experimental, and non-goal contract selected by that
  gate.
- Run the release validation on the tag commit.
- Publish the existing SDK artifact and consume it from the downstream
  example.
- Do not promise compatibility beyond the explicitly documented pilot
  surface.

## Done When

- `lake build :virSdk` installs and verifies the tag-matched SDK.
- An unmodified downstream project builds and runs an explicit export and a
  startup hook using public release inputs.
- Release evidence records checksums, Wasm/package sizes, Lean version, full
  tests, site validation, and a real-browser result.
- Release notes state the trusted-package and compatibility boundaries.
- `PRODUCT.md` and `MAINTENANCE.md` reflect the released contract.

## Dependencies

- [L-003](L-003-binding-lifecycle-semantics.md)
- [D-004](D-004-pilot-support-contract.md)

## Evidence

The 2026-07-30 review validated the downstream flow from an authenticated
commit artifact. Current `main` adds exact-commit SDK verification, modular
packages, green browser CI, and a complete downstream client path, but still
has no tag or release. Release timing was explicitly placed after the
binding/lifecycle semantics gate on 2026-08-10.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
