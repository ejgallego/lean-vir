# VIR All-Hands Runbook

Audience: technically mixed internal all-hands.
Length: 20 minutes total.

Goals:

- explain the problem VIR addresses and what it does;
- show the developer workflow and one working result;
- state the supported and trusted boundary;
- compare VIR with the main architectural alternatives;
- distinguish plausible Lean-upstream improvements from VIR product code; and
- close with the sponsored productization path and first pilot.

Detailed evidence belongs in the
[project review](PROJECT_REVIEW.md),
[technical appendix](TECHNICAL_APPENDIX.md),
[alternatives](../ALTERNATIVES.md), and
[upstreaming strategy](../UPSTREAMING.md). The presentation-only source is
[SLIDES.md](SLIDES.md).

## Timing

| Time | Segment |
| --- | --- |
| 0:00–2:00 | Question and product thesis |
| 2:00–4:00 | Problem and intended users |
| 4:00–7:00 | Developer workflow and demonstration |
| 7:00–10:00 | Architecture, evidence, and supported boundary |
| 10:00–14:00 | Alternatives |
| 14:00–17:30 | Upstream candidates and risks |
| 17:30–20:00 | Sponsored productization path and close |

## Slide 1 — Lean Logic, Running In The Browser

Speaker notes, 0:00–2:00:

> VIR asks a specific architectural question: when should selected Lean code
> run in a browser instead of being rewritten in TypeScript, compiled into one
> application artifact, or served by a Lean backend? VIR's answer is to load a
> bounded package and execute its real Lean compiler IR through Lean's own IR
> interpreter, compiled for `wasm32-wasip1`.

> This is not a proposal to put an unrestricted Lean process in every tab. The
> useful claim is narrower: project-controlled Lean code can be packaged,
> called, and connected to browser behavior through a versioned runtime.

## Slide 2 — The Problem VIR Addresses

Speaker notes, 2:00–4:00:

> The motivating user already has meaningful Lean code. Rewriting it creates a
> second implementation and a synchronization problem. A server preserves Lean
> behavior but adds infrastructure and a network boundary. A compiled Wasm
> application may be the right answer when the closure is stable and
> performance dominates. VIR is interesting when client-side or offline
> execution, Lean reuse, and replaceable packages matter together.

Speak the boundary aloud:

> The project controls and trusts the package. VIR does not currently claim
> safe execution of arbitrary uploaded IR.

## Slide 3 — How A Developer Uses It

Demo, 4:00–7:00:

1. Show `@[vir_export]` and `@[vir_startup]` in the downstream example.
2. Show the module `:vir` build and package report.
3. Show the exact-commit `:virSdk` installation path and name the later tagged
   path without claiming it already exists.
4. Refresh the browser page:
   - JavaScript calls one exported Lean declaration;
   - a Lean startup hook creates browser behavior.
5. If rehearsed time remains, show no more than 20 seconds of the React or
   infoview experiment and label it experimental.

Speaker bridge:

> The JavaScript application is not calling a hard-coded `fib` Wasm export.
> The package carries declarations and an interface manifest; the runtime
> resolves the declared Lean surface and lowers supported values at the call
> boundary.

## Slide 4 — How It Works

Speaker notes, 7:00–8:30:

> The architectural result I trust most is the separation line. VIR keeps the
> upstream interpreter source unmodified. A package-backed provider supplies
> real `Lean.IR.Decl` objects. A future loader can replace that provider without
> replacing the interpreter. Native support is statically linked and restricted
> to an audited table rather than general dynamic lookup.

> The object, resource, and callback boundary is shared by direct calls, DOM
> and canvas behavior, React experiments, and the infoview work. Reload and
> disposal have explicit cleanup tests. The remaining design work is to make
> one ownership and lifecycle contract explain all those paths, especially
> partial failure, cancellation, and React replay.

## Slide 5 — What Is Real And What Is Bounded

Speaker notes, 8:30–10:00:

> The current repository passes 98 conformance fixtures and 18 runtime smoke
> tests. Exact-head CI includes real Chromium, and Pages builds and deploys the
> demo plus the runnable-surface and retained-size explorers. The current
> stripped runtime is 723,398 bytes raw and 163,593 bytes with deterministic
> gzip. Static analysis finds complete VIR-runnable closures for 322,027 of
> 398,519 installed Lean IR functions and 29,217 of 36,887 public constants.
> Those are measured closure facts, not claims that every declaration has a
> supported browser interface.

> The current validated development shape is matching-version,
> project-generated trusted
> packages; explicit calls and startup hooks; synchronous host calls; tested
> structured values, resources, callbacks, reload, and disposal. It does not
> include arbitrary packages, a complete Lean environment, Promise imports,
> general native lookup, complete React or ProofWidgets APIs, or native speed.

If challenged on maturity, distinguish implementation evidence from user
evidence: the former is strong for the selected surface; independent repeated
use is still weak.

## Slide 6 — Alternatives Solve Different Problems

Speaker notes, 10:00–14:00:

> TypeScript is the simplest answer for small web-only behavior. It becomes
> less attractive when the project genuinely needs the Lean definition and
> wants to avoid semantic duplication.

> A Lean server is the strongest default for a full environment, heavy work,
> server-owned state, or untrusted requests. Its costs are deployment, network
> access, latency, and serialization.

> Direct Lean-to-Wasm compilation has better performance potential and may be
> preferable when the application closure is known at build time. It still
> needs a browser interop and deployment design, and changing the Lean closure
> generally changes the executable artifact.

> VIR trades execution speed and a tighter version boundary for selected IR
> reuse and dynamic package loading. A new evaluator provides the most control
> but creates the largest semantic maintenance obligation.

> We can now test these trade-offs in one standalone application comparing
> JavaScript, two VIR boundaries, FIR-native, and LLVM/Emscripten on
> `Std.Format.prettyM`; Illuminate is a peer browser workload. Some runs remain
> rehearsals, so present the common semantic and artifact contract before any
> number and do not claim a universal winner.

Do not present a universal winner. The Lake/browser pilot must compare VIR
with the user's actual best fallback and show a distinctive advantage.

## Slide 7 — Upstream Small Seams, Not All Of VIR

Speaker notes, 14:00–17:30:

> There are two or three plausible upstream conversations, not one request to
> merge VIR into Lean.

> First, VIR has demonstrated that a selected Lean runtime and the real IR
> interpreter can compile and link strictly for `wasm32-wasip1`. Focused build
> support, platform guards, and tests may be generally useful. Any upstream
> version needs real or explicitly unsupported semantics for timing, tracing,
> interrupts, IO, threads, and dynamic loading—not silent demo no-ops.

> Second, embedded runtimes may benefit from a static native-symbol
> registration mechanism. That proposal must stay restricted and prove value
> beyond VIR's JavaScript imports.

> Third, the interpreter currently finds IR declarations through link-time
> hooks. We tested the obvious alternative: construct a real Lean environment,
> insert the same decoded declarations, and use the unmodified environment
> lookup. It was correct, but added 3.29 MiB to stripped Wasm, increased package
> loading by about 60%, and slowed steady fresh-entry execution by about 19%.
> That is enough to ask upstream about a narrow caller-owned declaration
> provider while keeping the existing environment API. It is not a case for
> upstreaming VIR packages, browser policy, or a broad cache abstraction.

> The `.irpkg` format, JavaScript ABI, callbacks, resources, DOM, React, and
> infoview integrations remain VIR product code for now.

Main upstreaming risks:

- committing to internal IR APIs prematurely;
- treating demo stubs as portable runtime semantics;
- expanding Lean's build and CI matrix without ownership; and
- transferring maintenance responsibility rather than reducing it.

## Slide 8 — Productization Is Sponsored; Evidence Decides Scope

Speaker notes, 17:30–20:00:

> Management supports productization, so organizational permission is not the
> main uncertainty. We should use that support for ownership, release quality,
> representative validation, and one real workflow—not for broad API expansion.

> After this meeting, we need an accountable maintainer, a backup maintainer, a
> user owner, a VIR owner for the Lake/browser pilot, and a reviewer for the
> binding and lifecycle contract. Real-browser CI is already complete. The next
> engineering gate is to make binding ownership and lifecycle behavior coherent
> enough to support; only then should the first tagged SDK freeze that surface.
> Early pilot learning can use exact-commit artifacts without pretending they
> are a compatibility promise.

> In parallel, we ask Lean upstream for feasibility feedback on the small
> candidate seams without asking it to adopt the package or browser product.

Close with:

> VIR has proved a credible execution model and can now measure its boundary.
> The next proof is a browser contract we can explain, support, and use where it
> is better than the alternatives.

Discussion prompts:

1. Which concrete Lean/browser workflow should exercise the first pilot?
2. What is its best alternative today?
3. Which binding and lifecycle behavior does that workflow actually require?
4. Who will own the user outcome, boundary review, and backup maintenance?
5. Which upstream seam has value beyond VIR?

## Demo Preparation

Primary demo: the separate `ejgallego/lean-vir-examples` client, using the
exact-commit SDK path. Do not describe that artifact as a release.

### One day before

1. Build the release-profile development SDK:

   ```bash
   npm ci
   npm run build:sdk-artifact
   ```

2. In a clean downstream checkout:

   ```bash
   lake update
   VIR_SDK_ARCHIVE=/absolute/path/to/lean-vir-sdk.tar.gz \
     scripts/prepare-web.sh
   node scripts/smoke-node.mjs
   (cd web && npm ci && npm run build)
   ```

3. Verify the explicit-call and startup-hook pages in a real browser.
4. Record a video under three minutes that follows the exact live sequence.
5. Keep all demo inputs local; do not rely on network access during the talk.

### Five minutes before

- close unrelated browser tabs and terminals;
- start local servers and load each page once;
- confirm the displayed package and SDK revision;
- reset the startup animation;
- cue the fallback video;
- increase terminal and editor font sizes; and
- disable notifications.

### Live demo rule

Do not rebuild the full upstream runtime during the talk. Show the completed
facet build or run only the cached package command:

```bash
lake build +Examples.Basic:vir +Examples.Slides:vir
```

If a command or page exceeds rehearsal timing by five seconds, switch to the
recording. Do not debug during the slot.

## Rehearsal Checklist

Run two timed rehearsals. Pass conditions:

- total time at or below 19:30;
- demo at or below 3:00;
- each slide has one main claim;
- “trusted project-generated package” is spoken aloud;
- alternatives are presented as trade-offs rather than straw alternatives;
- upstream candidates are separated from VIR-specific code;
- management support is not confused with completed staffing;
- all measurements match the 2026-08-10 technical refresh; and
- the closing ownership and pilot questions are visible.

Cut the optional React/infoview glimpse first. Do not cut the trust boundary,
alternatives, or upstreaming risks.

## Expected Questions

### Why interpret IR instead of compiling Lean directly to Wasm?

VIR values a versioned runtime, selected declaration packages, and package
replacement. Direct compilation has better performance potential and may be
the better choice when the executed closure is known at build time. The pilot
tests whether VIR's flexibility is valuable enough for a real workflow.

### Why not keep Lean on a server?

A server is preferable for full environments, heavy computation, server-owned
state, or untrusted requests. VIR is aimed at static, offline, or
client-resident workflows where operating and crossing a service boundary is a
material disadvantage.

### Is it safe to load arbitrary packages?

No. The supported pilot model is a package generated from controlled project
source. Wasm protects the host from native memory escape, but package metadata
can still lie, trap, consume resources, or hang its worker or tab.

### Is this all of Lean in the browser?

No. VIR packages selected declaration closures. It does not load general
`.olean`, `.ir`, or a full Lean environment.

### Does it support asynchronous JavaScript APIs?

Host imports are synchronous. Current asynchronous browser behavior uses
callbacks and cancellation handles. Promise integration requires a later,
use-case-driven design.

### What exactly might be upstreamed?

Potentially small WASI build and platform improvements, a suitably generic
static symbol registry, and a narrow formal declaration-provider seam now
supported by the real-environment experiment. VIR's
package format, JavaScript ABI, and browser libraries remain external.

### Why not tag v0.1 now that CI is green?

CI proves current implementation behavior; it does not decide which moving
binding and lifecycle semantics should become compatibility promises. Use
exact-commit artifacts for learning, resolve the ownership contract, then tag
the smallest surface we can support.

### What would make this a maintainable product?

A coherent binding/lifecycle model, a consumed release, release-visible browser
evidence, repeated downstream use, an explicit support boundary, and at least
two people able to perform releases and Lean upgrades.

## Pre-Read Message

Send two business days before the meeting:

> VIR now runs selected Lean declarations in browsers through Lean's real IR
> interpreter, with real-browser CI, measured installed-library coverage, and
> downstream workloads. The attached review explains the developer workflow,
> alternatives, measured declaration-provider case, and the remaining binding
> and lifecycle design gate. Bring questions about where VIR is preferable to
> TypeScript, a Lean service, or direct Wasm compilation, and any concrete
> workflow that could exercise the Lake/browser pilot.

## Post-Meeting Record

Capture raw questions, disagreements, use cases, and commitments in
[ALL_HANDS_NOTES.md](ALL_HANDS_NOTES.md). Within five business days:

1. promote accepted product changes to `docs/PRODUCT.md`;
2. update `docs/ALTERNATIVES.md` and `docs/UPSTREAMING.md` with substantive
   feedback;
3. record durable choices in `docs/DECISIONS.md`;
4. confirm owners through
   [C-001](cards/active/C-001-productization-ownership.md); and
5. leave at most eight bounded, owned action cards.

Do not convert uncommitted ideas into an unbounded feature backlog.
