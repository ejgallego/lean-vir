# VIR Six-Month Gated Roadmap

Updated: 2026-08-10 at
`062fc8f4c24c1f35c43d92c38beb0782976c7e03`.

This roadmap starts from the
[current project review](PROJECT_REVIEW.md). VIR is technically ready for
controlled pilot work, but the first supported SDK surface should not be
frozen before the browser binding and lifecycle semantics converge.

## Roadmap Rules

1. Keep the upstream IR interpreter unmodified.
2. Keep project-generated, trusted packages as the initial product boundary.
3. Preserve a small explicit native and host-import surface.
4. Add binding and interface breadth only for a named workload.
5. Treat commit-matched artifacts as development inputs, not release promises.
6. Freeze and tag only the surface whose ownership and lifecycle semantics can
   be explained, tested, and supported.
7. Prefer measured closure gain and workload evidence over native-frontier
   breadth.
8. Keep project tracking to at most eight outcome-oriented
   [action cards](cards/README.md).

## Before The All-Hands: Refresh The Shared Model

Outcome: the meeting presents current facts and makes the next uncertainty
clear.

- Update the review, deck, and runbook to 98 fixtures, 18 runtime tests, green
  real-browser CI and Pages, modular package sets, current Wasm size, and the
  measured runnable surface.
- Demonstrate the actual Lake-to-browser path from the downstream example.
- Use the five-backend `prettyM` application and Illuminate to explain the
  alternative space without claiming a universal performance winner.
- Present the real-environment experiment and narrow declaration-provider
  proposal.
- State that productization is sponsored while the binding/lifecycle contract
  remains under design.

Acceptance:

- the eight-slide talk and runbook contain no 2026-07-30-only maturity claims;
- the trusted-package boundary is spoken aloud;
- the close asks for users, binding requirements, review capacity, and
  upstream feedback rather than approval of a frozen API.

## Weeks 0–6: Converge The Browser Boundary

### Outcome 1: establish one binding architecture

- Inventory the current Lean declarations, marker metadata, manifest entries,
  generated JavaScript adapters, host-target registry, and handwritten host
  implementations.
- State which source is authoritative for signature, identifier, conversion,
  ownership, and documentation.
- Remove or explicitly document duplicated definitions that can drift.
- Use a small representative set: scalar host call, DOM resource, event
  callback, timer or animation cancellation, and one React boundary.
- Do not expand toward broad DOM or React parity during this outcome.

Acceptance:

- a maintainer can trace a binding from Lean declaration through package
  metadata and JavaScript implementation without guessing which copy wins;
- a binding addition or mismatch fails in one predictable validation lane;
- generated and handwritten responsibilities are explicit.

### Outcome 2: define and validate lifecycle semantics

- Define owned, borrowed, retained, transferred, released, cancelled, detached,
  and terminal states at the public boundary.
- Specify responsibility on normal return, partial conversion failure, host
  exception, callback exception, cancellation, package replacement, runtime
  disposal, React replay, abandoned render, and missing platform primitives.
- Use the work in PR #103 as implementation evidence, not as an implicit API
  specification.
- Keep PR #101 draft until its animation-frame cancellation case and the
  broader ownership contract agree.
- Record any callback escape or generative-borrow limitation that remains out
  of scope.

Acceptance:

- the same ownership vocabulary explains direct calls, DOM resources,
  callbacks, and React;
- virtual-host and real-browser tests cover creation, rollback, cancellation,
  reload, and disposal;
- successful and failing paths leave the expected live-resource counts;
- unsupported escape or lifetime patterns fail clearly or remain explicitly
  outside the supported surface.

These two outcomes are one bounded decision card:
[L-003](cards/active/L-003-binding-lifecycle-semantics.md).

### Outcome 3: keep pilot preparation moving without freezing compatibility

- Select the real downstream Lake/browser workflow and its actual alternative.
- Use an exact-commit SDK for early integration and record every workaround.
- Exercise one pure or structured export and one startup hook before adding
  lifecycle-sensitive UI breadth.
- Identify the minimum binding subset the pilot needs.
- Define the trusted-package and report-information contract.

Acceptance:

- the pilot has a named user, repository, VIR owner, first outcome, and repeat
  test;
- early integration distinguishes product gaps from release-distribution gaps;
- no development artifact is described as a compatibility promise.

### Outcome 4: convert sponsorship into shared ownership

- Name one accountable maintainer and one backup maintainer.
- Name the user and VIR owners for the pilot.
- Assign a reviewer for the binding/lifecycle contract.
- Agree on protected capacity and escalation expectations.

Acceptance:

- roles and time windows are recorded;
- an unfilled review or backup role is visible rather than silently inherited
  by the primary maintainer.

## Six-Week Semantics Gate

Proceed toward the first supported SDK only if:

1. the authoritative binding path is documented and mechanically checked;
2. the ownership model covers the claimed DOM, callback, cancellation, reload,
   disposal, and React cases;
3. the pilot's required surface is a bounded subset of that model;
4. the resource-lifetime implementation has independent review;
5. exact-head CI, Pages, 98 fixtures, and 18 runtime tests remain green; and
6. unresolved behavior is explicitly excluded rather than hidden behind a
   general “experimental” label.

If the gate fails, keep using commit artifacts for focused experiments and
reduce the proposed binding surface. Do not use a tag to force convergence.

## Weeks 6–12: Release The Smallest Honest Surface And Run The Pilot

If the semantics gate passes:

### Publish and consume the first SDK release

- Resolve release-relevant development dependency advisories.
- Choose and record the Lean version policy; the current pin is 4.33.0-rc2.
- Freeze supported, experimental, and out-of-scope behavior from the semantics
  decision.
- Run package ABI, codec, native registry, Lake, runtime, fixture, site,
  analysis, and real-browser validation on the tag commit.
- Publish the existing SDK asset and consume it from a clean downstream
  checkout.
- Record checksums, Wasm/package sizes, runnable-surface counts, and the exact
  toolchain.

### Run the Lake/browser pilot

1. reproduce the user's current workflow and best alternative;
2. install the tagged SDK and project-owned package;
3. implement only critical missing capabilities within the accepted binding
   model;
4. record setup time, integration friction, load/runtime failures, lifecycle
   behavior, and maintainer support time;
5. have the user repeat one package change and one SDK reinstall or upgrade;
6. decide continue, revise, or stop.

### Twelve-week decision gate

Score from 0 to 2 on:

- named user commitment;
- successful repeat use;
- unique advantage from VIR;
- reuse across internal cases;
- remaining blocker and support cost.

Continue only with at least 7/10 and no zero for named user commitment. A lower
score stops or redesigns the pilot rather than broadening the platform.

## Months 3–6: Deepen One Proven Lane

If Lake/browser embedding wins, prioritize:

- release and compatibility diagnostics;
- lower-friction staging in downstream Lake and web builds;
- binding types used by at least two real cases;
- lifecycle regression budgets and upgrade evidence;
- benchmark-app extraction if it has a separate owner and audience.

If an infoview or ProofWidgets case has stronger named ownership, prioritize
only the edit, RPC, React, and teardown behavior required by one real port.
Do not pursue broad compatibility in parallel by default.

Continue in either lane:

- Lean upgrades with strict native and fixture checks;
- measured runtime-frontier decisions;
- release size and performance snapshots;
- package and lifecycle negative tests;
- a second person performing a documented release or upgrade;
- upstream feasibility feedback on ULC-0001.

## Demand-Triggered Research

| Investment | Start only when |
| --- | --- |
| Worker isolation and execution budgets | A named user must load packages they do not control |
| Wasm-side layout validation | The trust boundary widens beyond project-generated packages |
| JSPI or stack switching | A pilot cannot express an async API through callbacks and cancellation |
| Component Model/WIT runtime | It materially improves a release or interoperability case |
| Full module-backed loader | A selected case cannot work with declaration packages |
| Package compression | Payload evidence identifies a meaningful client load-time win |
| Broad DOM or React parity | Two named workloads require a coherent shared surface |
| Full ProofWidgets compatibility | A real upstream port and owner exist |
| General native lookup | Never without a concrete runtime case and restricted policy |

## Active Execution

The [action-card board](cards/README.md) is the execution record. Browser CI is
complete and archived. The active set covers the all-hands, productization
ownership, binding/lifecycle semantics, pilot support, setup evidence, the
Lake/browser pilot, the eventual first release, and upstream feedback.

Once per month, ask:

1. Which binding or lifecycle uncertainty was actually resolved?
2. Which user repeated a VIR workflow?
3. What support or workaround did it require?
4. Which compatibility claim is now justified?
5. Which active card lacks an owner or evidence trigger and should stop?

Record durable choices in [DECISIONS.md](../DECISIONS.md). Do not create
feature-level child cards before a workload exposes a bounded blocker.
