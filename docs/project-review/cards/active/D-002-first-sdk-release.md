# D-002 — Publish and consume the first supported SDK

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
commit-artifact path, and its support, trust, compatibility, ownership, and
failure-reporting contract ships with it.

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
- State the trusted project-generated package boundary, one-active-package-set
  model, synchronous host-import limit, supported value types, and exact-match
  compatibility policy prominently.
- Name release ownership, response expectations, escalation contacts, and the
  minimum useful bug report.
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
- A pilot-facing support matrix distinguishes supported, experimental, and
  out-of-scope behavior; a report template requests Lean and SDK identity,
  package report, browser, reproduction, and minimal source.
- The named pilot owner reviews the contract before integration begins.
- `PRODUCT.md` and `MAINTENANCE.md` reflect the released contract.

## Dependencies

- [L-003](L-003-binding-lifecycle-semantics.md)
- [C-001](C-001-productization-ownership.md)
- [L-004](L-004-js-vir-fir-comparison.md) defines the release comparison and
  size snapshot; the pilot can begin before its final campaign, but the release
  evidence must use its artifact accounting rules.

## Evidence

The 2026-07-30 review validated the downstream flow from an authenticated
commit artifact. Current `main` adds exact-commit SDK verification, modular
packages, green browser CI, and a complete downstream client path, but still
has no tag or release. Release timing was explicitly placed after the
binding/lifecycle semantics gate on 2026-08-10. On 2026-08-11 the separate
pilot-support card was consolidated here so the shipped artifact and its
support claims have one completion test.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: None
Durable documents updated: None
