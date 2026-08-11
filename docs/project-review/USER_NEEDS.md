# VIR User Needs And Pilot Workbook

VIR still has stronger implementation evidence than independent user evidence.
This workbook prevents repository demos, maintainer-owned downstream clients,
and benchmark workloads from being mistaken for validated demand.

## Evidence Labels

Use one of these labels on every need:

- **Observed use:** someone uses the path for work outside the VIR repository.
- **Dogfood:** a maintainer-owned downstream project exercises the path.
- **Repository proof:** fixtures or demos prove feasibility, not demand.
- **Interview signal:** a user describes the problem and current workaround.
- **Named pilot:** a user commits a repository, owner, and six-week outcome.
- **Hypothesis:** no direct user evidence yet.

The current downstream `lean-vir-examples` repository is valuable dogfood. It
is not independent adoption because it has the same primary maintainer.

The 2026-08-11 post-presentation feedback adds an **interview signal**: internal
technical users need a credible way to choose among JavaScript, VIR, and FIR,
especially on load latency, execution speed, and deployable size. The exact
thresholds and representative environments remain unvalidated.

## Provisional User Segments

### Lean library or application author

Job:

> Reuse selected Lean code in a browser application without rewriting the
> logic, standing up a Lean server, or defining a bespoke native Wasm export
> for every function.

Likely needs:

- predictable supported Lean value shapes;
- small, inspectable packages;
- direct JavaScript calls;
- understandable diagnostics for unsupported declarations;
- version-matched SDK artifacts;
- a simple local and CI build path;
- declaration-site explanations when a selected module or interface cannot be
  packaged.

Repository evidence:

- quickstart, `fib`, merge sort, parser, pretty printer, and structured-value
  fixtures;
- `@[vir_export]`, `:vir`, runtime `call`;
- downstream examples, modular package sets, and exact-commit SDK staging.

### Lean-authored browser UI, slides, or teaching author

Job:

> Write the behavior of an interactive browser artifact in Lean, while using
> ordinary browser rendering and event infrastructure.

Likely needs:

- startup hooks;
- DOM, input, event, timer, animation, canvas, and cleanup APIs;
- visible failure handling;
- easy staging beside a static site or presentation;
- good hot-reload or rebuild latency;
- predictable ownership and cancellation semantics for resources and retained
  callbacks.

Repository evidence:

- DOM and React Tamagotchi;
- `SlidesCanvas`;
- callback/event/timer/frame tests;
- downstream startup-hook slide example;
- Illuminate animation-player host operations and peer benchmark workload.

### Infoview or ProofWidgets author

Job:

> Build an interactive Lean proof view with server-owned context and ordinary
> React rendering, without maintaining a second JavaScript implementation of
> its logic.

Likely needs:

- live package rebuild and revision handling;
- current goals, selections, references, and source positions;
- edit, hover, navigation, and tactic commands;
- enough React and ProofWidgets compatibility to port a real widget;
- predictable lifecycle behavior inside the infoview host.

Repository evidence:

- live infoview package shell;
- current-goal `ExprWithCtx` path;
- partial ProofWidgets HTML/RPC facade;
- React proof widget examples.

### JavaScript integrator

Job:

> Embed a versioned Lean runtime and package in an existing browser or Node
> application with familiar JavaScript lifecycle and error behavior.

Likely needs:

- stable archive layout and runtime imports;
- documented values and errors;
- reusable compiled `WebAssembly.Module`;
- deterministic cleanup;
- release and integrity metadata;
- framework-neutral core APIs;
- one traceable binding source of truth and explicit owned/borrowed behavior.

Repository evidence:

- SDK archive, checksum manifest, Node wrapper, runtime factory, object ABI,
  and downstream Vite app.

### VIR and Lean runtime maintainer

Job:

> Keep the selected browser execution surface aligned with upstream Lean
> without maintaining a fork or an unbounded native runtime.

Likely needs:

- explicit provider and native lookup boundaries;
- high-signal upgrade failures;
- generated inventories;
- representative fixtures;
- package and benchmark reports;
- a roadmap that rejects unused breadth.

Repository evidence:

- pinned upstream commit, strict link, boundary registry, generated wrappers,
  runnable-surface and retained-size reports, package reports, and the Lean
  4.33.0-rc2 upgrade.

### Technical product or architecture decision maker

Job:

> Decide whether a browser workload should stay in JavaScript, run through
> VIR, or compile through FIR without relying on an architecture-only argument
> or a misleading single microbenchmark.

Likely needs:

- exact semantic parity before performance claims;
- time to first correct result split from warm execution;
- raw, compressed, first-workload, and incremental/amortized size;
- representative workload scaling and memory behavior;
- exact source, toolchain, artifact, browser, and machine identity;
- integration and update-cost evidence from a real user workflow; and
- a conditional scorecard rather than a universal winner.

Evidence:

- all-hands feedback explicitly requested the comparison;
- the shared `prettyM`/Illuminate application already supplies most raw
  instrumentation;
- accepted thresholds, controlled environments, and independent review remain
  open and are tracked by L-004.

## Seeded Use-Case Portfolio

These are starting hypotheses for the maintainer workshop, not final roadmap
priorities.

| Use case | Current evidence | Main unmet need | Disposition before interviews |
| --- | --- | --- | --- |
| Call pure or structured Lean functions from JavaScript | Repository proof plus downstream dogfood | Independent repeat use and eventual tagged distribution | **Pilot now with exact-commit SDK** |
| Build Lean-authored DOM/canvas/slides behavior | Repository proof, downstream dogfood, and Illuminate workload | Coherent binding ownership and lifecycle semantics | **Pilot after bounded semantics selection** |
| Build a live Lean-authored infoview panel | Strong repository proof | Key-user validation, commands, and real-project scale | **Pilot candidate** |
| Port a real ProofWidget | Partial compatibility proof | Choose one port and implement only its critical gaps | **Pilot candidate** |
| Ship reusable Lean components such as formatting or parsing | Technical proofs plus five-backend `prettyM` application | A user who needs the component and accepts the runtime/package trade-off | **Explore through interview** |
| Choose JS, VIR, or FIR for a browser workload | All-hands interview signal plus broad benchmark machinery | Frozen comparison protocol, controlled campaigns, accepted user thresholds | **Learn now through L-004** |
| Load arbitrary remote `.irpkg` files | Documentation identifies the gap | Worker recovery, limits, Wasm layout validation | **Defer without a named use case** |
| Await Promise-returning JavaScript APIs from Lean | Roadmap research only | JSPI/task semantics and rejection recovery | **Defer without a named use case** |
| Run a complete Lean environment in the browser | Contrary to current selected-package architecture | Module/environment loading and much larger runtime scope | **Explicit non-goal for this roadmap** |

## Prioritization Rule

For every proposed pilot or feature, score each dimension from 0 to 2:

1. **User commitment:** none, expressed interest, or named owner/repository.
2. **Repeat use:** one-off demo, occasional use, or recurring workflow.
3. **VIR advantage:** convenient, materially better, or impractical without
   VIR's real-interpreter approach.
4. **Reuse:** one case, one segment, or several segments.
5. **Readiness:** large architectural prerequisite, bounded feature work, or
   existing path.

Use the score to order discussion, not to manufacture certainty. A roadmap
item still requires a named acceptance condition. Pilot candidates need at
least 7/10 and may not score zero on user commitment.

## Maintainer Use-Case Workshop

Duration: 60 minutes.

Participants: review lead and VIR maintainer.

### 0–10 minutes: unfiltered inventory

For each use case the maintainer already has in mind, capture:

- user or team;
- target repository or artifact;
- desired browser behavior;
- why the work belongs in Lean;
- why VIR is preferable to a Lean server, JavaScript rewrite, or compiled Wasm
  path;
- desired date or dependency.

Do not discuss implementation during the first pass.

### 10–30 minutes: current workaround and pain

Ask for each case:

1. What happens today?
2. Which step costs the most time or prevents the work entirely?
3. Is browser execution mandatory, or merely convenient?
4. Who controls the Lean source, `.irpkg`, and JavaScript host?
5. Does the use case need direct calls, startup behavior, callbacks, React, or
   infoview RPC?
6. What data types and effects cross the boundary?
7. What load time, package size, memory, and failure behavior are acceptable?
8. Which values or handles must outlive one call, and what should happen on
   cancellation, replacement, or failure?

### 30–45 minutes: evidence and blockers

Map each case to:

- an existing example or fixture;
- missing interface types or native externs;
- missing browser/React/RPC operations;
- distribution and authentication needs;
- trusted versus untrusted package assumptions;
- expected maintenance after Lean upgrades.

### 45–55 minutes: select the primary pilot

Score the cases with the five-dimension rule. Select:

- one Lake/browser embedding pilot as the primary productization experiment;
- an optional follow-on case only if it has a named owner and can proceed
  without weakening the primary pilot.

### 55–60 minutes: name ownership

Record:

- user owner;
- VIR owner;
- target repository;
- first-success date;
- six-week outcome;
- best alternative today;
- how feedback will be captured.

## Key-User Interview

Duration: 30 minutes. Do not demo VIR before understanding the user's current
workflow.

### Interview script

1. What are you trying to build, and who uses it?
2. Which parts are currently written in Lean and JavaScript?
3. What is the current browser or infoview integration?
4. Walk through the last time you attempted this workflow.
5. Where did you lose time or abandon a capability?
6. What must execute client-side, and why?
7. Which Lean values, effects, callbacks, or server context must cross the
   boundary?
8. Which values or handles must outlive one call, and what should happen on
   cancellation, replacement, or failure?
9. Who creates and controls the package?
10. What would a failure look like: wrong result, tab hang, stale view, leaked
   callback, slow load, or difficult deployment?
11. What setup time and machine requirements are acceptable?
12. Which compatibility promise do you need from a release?
13. Would you use a six-week pilot in a real repository? If yes, name the
    smallest outcome; if no, what is missing?

### Evidence to retain

- a concise job statement in the user's words;
- current workaround;
- top three blockers;
- trust and deployment assumptions;
- required interfaces;
- pilot commitment or explicit reason for declining.

Avoid recording broad enthusiasm as a pilot commitment.

## Pilot Card

Copy this section once for each selected pilot.

### Pilot: _short outcome name_

- Evidence label:
- User owner:
- VIR owner:
- Target repository:
- Job to be done:
- Current workaround:
- Why VIR:
- Package author/controller:
- Required public interfaces:
- Required binding ownership and lifecycle behavior:
- Existing repository proof:
- Missing capabilities:
- Explicit non-requirements:
- First-success date:
- Six-week outcome:
- Repeat-use test:
- Failure and rollback plan:
- Feedback location:

### Pilot acceptance

A pilot succeeds only when:

- a user other than the implementation agent runs the path;
- setup has no undocumented intervention;
- the target behavior works in its intended browser or infoview host;
- the user repeats the workflow after the initial guided session;
- runtime, package, and SDK versions are recorded;
- blockers and maintainer support time are captured;
- the user states whether they would continue using it.

Early pilot work may use an exact-commit SDK while binding semantics are under
design. A tagged release is required only for the later compatibility and
upgrade test; the evidence record must distinguish the two phases.

## Post-Talk Intake

Use a short internal form or shared document. Require only:

1. **What Lean code or interaction do you want in a browser or infoview?**
2. **What do you do today, and what blocks you?**
3. **Will you provide a repository and owner for a six-week pilot?**

Optional details:

- direct call, startup UI, React, or infoview/RPC;
- trusted or third-party packages;
- needed types and browser APIs;
- desired date.

Triage responses within five business days. Convert only named or strongly
repeated needs into backlog items.
