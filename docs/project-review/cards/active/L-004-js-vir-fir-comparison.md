# L-004 — Establish the JS/VIR/FIR comparison contract

Type: Learn
Status: Proposed
Owner: Unassigned
Contributors: None
Milestone: Product evidence
Created: 2026-08-11
Related: [alternatives](../../../ALTERNATIVES.md),
[project review](../../PROJECT_REVIEW.md), [roadmap](../../ROADMAP.md),
[Lake/browser pilot](L-002-lake-browser-pilot.md)

## Outcome Sought

Produce an authoritative, reproducible scorecard that explains when the
JavaScript, VIR, and FIR implementations are preferable for the same browser
workload across correctness, time to first correct result, warm execution,
deployable size, memory, integration cost, and update model.

## Why Now

This was the clearest technical feedback from the all-hands. The standalone
benchmark already measures many relevant quantities, but it does not yet
define one decision-ready protocol or explain how VIR's shared runtime plus
incremental packages should be compared with per-application JS and FIR
artifacts. Without that contract, precise numbers can still answer different
questions and imply a misleading winner.

## Scope

- Make semantic parity a prerequisite for performance comparison.
- Compare the JavaScript, VIR, and FIR-native paths as the core set. Retain
  LLVM/Emscripten and the two VIR interfaces as diagnostic comparators without
  requiring every summary to rank all five.
- Define equivalent **time to first correct result** and split it into
  transfer, fetch/resource-load, Wasm compile/instantiate, runtime and package
  initialization, boundary setup, and first call where each phase applies.
- Report cold uncached, warm cached, and already-loaded paths separately.
- Report steady-state execute and end-to-end latency distributions, input
  scaling, boundary phases, and repeated calls using fresh processes and
  order-balanced runs.
- Report raw and deterministic compressed bytes for the deployable files of
  each backend. For VIR, show both first-workload total and incremental package
  cost; add a shared-runtime amortization view over multiple workloads.
- Retain peak/retained/isolated memory where the browser can measure it
  consistently. Label unavailable or incomparable fields instead of silently
  substituting proxies.
- Freeze exact source commits, toolchains, artifacts, hashes, browser, machine,
  server/cache policy, interpreter-session lifecycle, protocol, and workload
  inputs in every accepted report.
- Use `prettyM` for structured computation and Illuminate for interactive
  callback/lifecycle behavior. Do not generalize from one workload or collapse
  all dimensions into one scalar score.
- Record developer effort, rebuild/update behavior, and deployment complexity
  qualitatively in the pilot; microbenchmarks alone cannot measure those
  product differences.

## Done When

- The comparison contract and report schema distinguish correctness, cold
  load, warm execution, size, memory, integration, and update-model evidence.
- A reader can reproduce every accepted number from a frozen artifact set and
  controlled-machine protocol.
- The frozen `prettyM` artifact candidate continues to build, pack, re-import,
  and pass cross-backend parity before any campaign is called authoritative.
- At least one controlled `prettyM` campaign reports JS, VIR, and FIR-native
  time-to-first-result, steady-state/scaling, raw and compressed size, and
  memory with variability.
- Illuminate has a canonical artifact-catalog record and a controlled campaign,
  or its remaining producer integration is explicitly recorded and its timing
  stays labelled rehearsal-only.
- The final scorecard states conditions under which each backend is favored,
  including VIR first-app versus incremental-app size, without declaring a
  universal winner.
- `ALTERNATIVES.md`, `PERFORMANCE.md`, and the pilot decision record incorporate
  the conclusions.

## Dependencies

- A named evidence owner through
  [C-001](C-001-productization-ownership.md).
- Merged PR #120 supplies reproducible source and binary identity; the selected
  campaign artifact must be retained or reproducible from that catalog.
- Access to a controlled representative browser machine. Network transfer can
  be modelled from deterministic compressed bytes; measured network latency
  requires a separately declared network profile.

## Evidence

- 2026-08-11: the presentation feedback explicitly requested a good JS versus
  VIR/FIR comparison covering load latency, speed, size, and related costs.
- Current `main` already has the shared benchmark shell, `prettyM` and
  Illuminate examples, correctness parity, call-phase timings, scaling,
  retained memory, repeated calls, and cold-start/resource profiles.
- 2026-08-11: draft PR #120 generalizes examples and artifact production. Its
  first candidate run exposed an undefined `readJson` in the packer.
- 2026-08-11: PR #120 merged as `2ddbfad` after fixing that gap. The exact
  source-to-build-to-pack-to-import candidate and cross-backend parity workflow
  passed, and the corresponding
  [main-branch candidate run](https://github.com/ejgallego/lean-vir/actions/runs/31515741653)
  remained green.
- 2026-08-11: PR #131 merged as `d43a947`, retaining interpreter constant and
  symbol caches across calls in a package generation. Controlled campaigns
  must therefore use current artifacts and identify this lifecycle; older
  fresh-interpreter timings remain historical evidence only.
- 2026-08-13: draft PRs #129 and #130 add JSON boundary lanes and a Verso
  search workload. They can strengthen workload coverage after review, but are
  not prerequisites for the first accepted `prettyM` scorecard.

## Closure

Completed: Not yet
Result: Not yet recorded
Unexpected findings: None recorded
Follow-up cards: Pilot-specific optimization cards are created only after an
accepted scorecard identifies a user-visible blocker.
Durable documents updated: None
