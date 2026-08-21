# VIR Maintenance Model

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-13
Operational baseline: [2026 technical appendix](project-review/TECHNICAL_APPENDIX.md)

## Current Position

Management supports productization. The main organizational risk is therefore
not permission to continue, but converting that support into named capacity,
backup ownership, release discipline, and bounded support expectations.

The codebase now has green browser CI, 101 differential fixtures, 20 runtime
tests, measured runnable-surface and retained-size reports, modular packages,
and declaration-site interface diagnostics. Maintenance risk remains material
because most product, release, Lean-runtime, package-codec, binding-lifecycle,
benchmark, and browser knowledge is concentrated in one contributor. The
comparison evidence now needs its own named owner or reviewer; otherwise a
technically sophisticated benchmark remains another single-maintainer surface.

## Risk Register

| Risk | Current evidence | Near-term control |
| --- | --- | --- |
| Maintainer concentration | One primary contributor and no completed release handoff | Name a backup maintainer and have that person perform a release or upgrade |
| No release history | Commit-matched SDK and downstream dogfood work, but no tag validates the public path | Resolve binding/lifecycle semantics, then publish and consume `v0.1.0` from a clean downstream project |
| Binding and lifecycle contract still moving | Resource-lifetime hardening merged in PR #103 and Strict Mode replay coverage exists, but the public ownership vocabulary and stateful-browser cancellation case remain open | Establish one ownership model and representative failure/cancellation/reload tests before freezing the supported API |
| Comparative claims are not yet authoritative | Reproducible artifact production is merged and green, but Illuminate timings remain rehearsal-only, the call lifecycle changed with persistent caches, and no controlled JS/VIR/FIR scorecard is accepted | Name an evidence owner; freeze the comparison contract, current artifacts, machine protocol, and review criteria in L-004 |
| Browser regressions | Real Chromium now runs in normal CI and Pages is green | Keep the browser suite as a release gate and preserve bounded diagnostics |
| Lean-version coupling | Direct IR layout, runtime, and native-wrapper dependencies | Pin versions, retain strict checks, and exercise an upgrade with a second maintainer |
| Trusted-package boundary | Manifest validation is not untrusted-code isolation | State the contract prominently and reject broader claims |
| Fresh setup resource use | Approximately 15.8 GB peak RSS in one clean run | Reproduce, identify the dominant phase, and document a lower-resource path |
| Callback-heavy synchronous rendering | Deferred cleanup can accumulate nonlinearly | Separate steady-state and stress evidence; add lifecycle assertions |
| Planning distributed across branches and documents | Six draft PRs and a large local worktree portfolio are hard to distinguish from commitments | Keep at most eight active outcome cards and disposition stale work separately |

## Minimum Operating Roles

Before the pilot starts, record:

- one accountable VIR maintainer;
- one backup maintainer with protected time;
- one user owner for the Lake/browser pilot;
- one VIR pilot owner;
- one reviewer for the binding and lifecycle contract;
- one owner or independent reviewer for the JS/VIR/FIR comparison evidence;
- one management sponsor or escalation contact; and
- reviewers for release evidence and the trust boundary.

One person may hold more than one role, but every overlap should be explicit.
An unfilled backup or pilot-owner role is a blocker to sustainable
productization, not an implicit assignment to the primary maintainer.

Ownership confirmation is tracked by
[C-001](project-review/cards/active/C-001-productization-ownership.md).

## Release Discipline

Once the binding and lifecycle decision is stable enough for a supported tag:

1. record the Lean toolchain and source commit;
2. run package ABI, codec, native wrapper, Lake, runtime, fixture, site, and
   real-browser validation;
3. record Wasm/package sizes and comparable performance evidence using the
   L-004 accounting contract;
4. publish checksums and the SDK artifact;
5. consume the release from a clean downstream project; and
6. state supported, experimental, and incompatible surfaces.

Release evidence is preferable to ad hoc compatibility claims. Until then,
commit-matched artifacts are development inputs, not a substitute for a
compatibility promise. A second maintainer should perform at least one release
or Lean upgrade during the pilot period.

## Support Boundary

Current pilot handling covers matching-version, project-generated trusted
packages inside the boundary described in [PRODUCT.md](PRODUCT.md). Reports should
include:

- Lean commit and toolchain;
- VIR SDK and package format versions;
- package generation report;
- browser and operating environment;
- minimal source and reproduction steps; and
- whether the failure occurs during generation, loading, calling, callback
  execution, reload, or disposal.

Response time and escalation expectations must be agreed by the named owners
before the pilot. This document deliberately does not invent those commitments.

## Work Tracking

The [action-card board](project-review/cards/README.md) is the repo-local
execution record. It uses three types:

- `Deliver` for concrete artifacts;
- `Learn` for bounded evidence and experiments; and
- `Coordinate` for named commitments or external review.

Cards are archived when their acceptance criteria pass, or when an explicit
consolidation marks them superseded and transfers the unfinished outcome. The
board is capped at eight active cards to keep ownership and maintenance cost
visible.

If execution moves to GitHub Issues or another tracker, use one authoritative
status record rather than manually synchronizing two boards.

## Review Cadence

During the pilot, review monthly:

1. Who repeated a VIR workflow?
2. What blocked them and how much support did it consume?
3. Which release or compatibility promise was exercised?
4. Did performance, size, lifecycle, or Lean-upgrade evidence change?
5. Which active card has no owner or user trigger and should be stopped?

Record durable choices in [DECISIONS.md](DECISIONS.md), not only in meeting
minutes or an archived card.
