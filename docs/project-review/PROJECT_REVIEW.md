# VIR Project Review

Current snapshot: 2026-08-10 at
`062fc8f4c24c1f35c43d92c38beb0782976c7e03`.

Original review baseline: 2026-07-30 at
`b528eddb94a46e16f649b290958e4bd2bd1df08a`.

## Executive Assessment

VIR has moved from a technically credible proof of concept to a mature
internal pilot platform. It now has a practical downstream Lake workflow,
modular declaration packages, declaration-site interface diagnostics, an
exact-commit SDK path, real-browser CI, a deployed analysis site, downstream
Illuminate support, and measurement-backed control of its native runtime
frontier.

The central engineering proposition is established:

- selected real Lean compiler IR runs through Lean's unmodified interpreter in
  `wasm32-wasip1`;
- downstream projects can mark exports and startup hooks, build dependency-
  ordered package sets, and install a matching browser SDK;
- the runtime boundary is explicit, tested, and quantitatively inspectable;
- alternatives can now be compared through a shared browser benchmark
  application rather than through architectural argument alone; and
- a real-environment experiment gives a concrete case for a narrow upstream
  declaration-provider seam.

VIR is not yet a supported product. The remaining product uncertainty is no
longer basic execution feasibility or browser CI. It is the browser binding
model and the lifecycle semantics of owned and borrowed values, callbacks,
resources, cancellation, reload, disposal, and React replay. Those semantics
should converge before the first SDK surface is frozen.

The recommended next phase is therefore **binding and lifecycle convergence,
followed by a deliberately scoped release and Lake/browser pilot**. Release
work remains important, but should record the chosen contract rather than
prematurely deciding it.

## Progress Since The Original Review

The current `main` is 24 commits beyond the original review baseline. Across
that delta, 255 files changed with approximately 43,400 additions and 3,900
deletions. Ten changes landed after the 2026-08-06 reassessment alone.

Material gains include:

1. **Modular package sets.** The `:vir` facet follows Lean module ownership,
   emits dependency-first package members plus a descriptor, and validates and
   installs the set atomically.
2. **Earlier, shared diagnostics.** Unsupported exports, startup hooks, and
   host imports are classified during elaboration at the declaration site,
   while package generation retains final raw-metadata and package-wide
   validation.
3. **Measured declaration lookup.** Correct Lean-compatible name hashes and a
   package-owned index reduced fresh-entry lookup by roughly 6.6x in the
   independent acceptance run and halved the controlled Illuminate callback
   mean.
4. **Measured runtime frontier.** Surface and retained-size reports now price
   each proposed native capability by exact closure gain and raw/gzip cost.
5. **Broader runtime support.** The current catalog exposes 461 native
   capabilities and supports measured scalar, string, `ByteArray`, and Float
   boundaries required by current workloads.
6. **Representative browser workloads.** Illuminate runtime support and a
   standalone five-backend `Std.Format.prettyM` application exercise VIR
   outside the original repository demos.
7. **Real browser CI.** Chromium execution is part of normal CI, its startup
   race is fixed, and Pages builds and deploys successfully from current
   `main`.
8. **Concrete upstream evidence.** The real-environment experiment showed why
   a declaration-only runtime should not be required to construct Lean's full
   compiler environment closure.

About half of the additions since 2026-08-06 belong to the deliberately
standalone benchmark webapp. That extraction boundary is useful, but it also
creates a new maintenance surface that needs an explicit owner or eventual
repository split.

## Current Evidence

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Core execution | Real compiler IR, unmodified upstream interpreter, strict Wasm link | Strong for the selected surface |
| Differential coverage | 98 passed, 0 unsupported, 0 failed | Strong and growing |
| Runtime smoke | 18 tests across pure and Lean-backed groups | Strong |
| Browser validation | Real Chromium in exact-head CI; Pages deployed | Strong |
| Lake and SDK path | Modular `:vir` sets, `:virSdk`, exact-commit artifact verification, downstream dogfood | Pilot-ready; release unexercised |
| Runnable Lean surface | 322,027 of 398,519 all-IR functions; 29,217 of 36,887 public constants | Quantified static coverage, not an interface promise |
| Native frontier | 461 explicit capabilities with measured size/closure evidence | Strong maintenance control |
| Current release Wasm | 723,398 bytes raw; 163,593 deterministic gzip | Acceptable for pilots; set a release budget before freeze |
| Alternatives | Five-backend `prettyM` app plus Illuminate peer workload | Strong comparison machinery; some campaigns still non-authoritative |
| Production dependency audit | 0 vulnerabilities | Clear |
| Development dependency audit | 3 high and 1 low finding | Release hygiene work |
| User validation | Maintainer-owned downstream examples and Illuminate workload | Useful dogfood; independent repeat use still weak |
| Ownership and review | One primary human contributor; no submitted reviews on the ten latest merged PRs | Highest sustainability risk |

The exact current-head GitHub evidence is:

- [main CI run](https://github.com/ejgallego/lean-vir/actions/runs/31336353034);
- [Pages build and deployment](https://github.com/ejgallego/lean-vir/actions/runs/31336353178).

## Priority Findings

### F1 — Binding ownership and lifecycle semantics are the next design gate

Severity: **pre-release product gate**

The runtime can already expose DOM, timer, animation, resource, callback,
React, and application-specific host operations. Recent work shows that adding
more operations is easier than defining one coherent ownership contract across
all of them.

[PR #103](https://github.com/ejgallego/lean-vir/pull/103) is now green and
mergeable, but remains a nine-commit draft touching 46 files with roughly
6,100 additions and 1,350 deletions. It makes ownership more compositional,
transactional, and deterministic, while explicitly deferring static prevention
of some callback-handle escape.

[PR #101](https://github.com/ejgallego/lean-vir/pull/101) remains draft and its
real-browser test catches an uncancelled animation frame. This is useful
negative evidence: the current test boundary can detect a lifecycle contract
violation before that API reaches `main`.

Recommendation:

- identify the authoritative source for each binding signature and ownership
  rule;
- define owned, borrowed, retained, transferred, cancelled, and terminal
  states independently of React-specific implementation details;
- use representative DOM/resource and React/replay cases to validate the same
  contract;
- land only the surface whose creation, partial failure, cancellation, reload,
  and disposal semantics are supportable.

Tracked by
[L-003](cards/active/L-003-binding-lifecycle-semantics.md).

### F2 — The first release should follow the semantics decision

Severity: **sequencing decision, not an immediate blocker**

There is still no tag or GitHub release. The exact-commit SDK path and
downstream example make development and pilot preparation practical, so the
absence of a tag no longer blocks learning. It still blocks a compatibility
claim and a durable unauthenticated release-consumption rehearsal.

Recommendation:

- continue using exact-commit artifacts for binding and pilot learning;
- do not freeze `v0.1.0` merely to close the release gap;
- once L-003 resolves the claimed lifecycle surface, publish and consume the
  smallest honest SDK contract.

### F3 — The declaration-provider seam is ready for upstream feedback

Severity: **bounded coordination opportunity**

The real-environment experiment used Lean's public construction path and
preserved identical package behavior. Compared with VIR's indexed provider, it
added 3,449,983 stripped Wasm bytes (+524.8%), increased deterministic gzip by
603,461 bytes (+401.8%), raised package loading by roughly 60%, and slowed
steady fresh-entry execution by roughly 19%.

This is enough to request feedback on a narrow caller-owned declaration
provider while preserving the existing environment-backed entry point. It is
not evidence for upstreaming `.irpkg`, browser bindings, host policy, or the
separate cross-entry cache experiment.

### F4 — Maintenance knowledge remains concentrated

Severity: **organizational productization risk**

The implementation is substantially more systematic, but the operating model
has not caught up. Current local state contains 33 linked worktrees and 32
branches. Four draft PRs remain open, and the latest merged work has no
submitted GitHub review. Generated inventories and analysis reports reduce
implicit code knowledge; they do not provide backup judgment or release
ownership.

Recommendation:

- name the accountable maintainer, backup maintainer, pilot user, and VIR pilot
  owner;
- have someone other than the primary author review the binding/lifecycle
  contract before it becomes a release promise;
- keep benchmark application ownership explicit and reconsider extraction
  after the all-hands.

### F5 — Alternatives are directly testable, but claims must stay scoped

Severity: **communication and product-evidence risk**

The new benchmark application compares JavaScript, two VIR interfaces,
FIR-native, and LLVM/Emscripten. It captures startup, phases, scaling,
interaction, memory, repeated calls, artifact identities, and semantic parity.
Illuminate is a second example behind the same shell.

This supports an honest all-hands comparison. It does not establish that VIR
is globally faster or smaller. Some rehearsals are deliberately
non-authoritative and locally retained artifact bytes are not yet durable
release evidence.

### F6 — Setup cost and development-tool hygiene remain open

Severity: **near-term**

The original clean setup reached approximately 15.8 GB peak RSS; a later Lean
upgrade rebuild again reached roughly 16.1 GB. A second-machine and
lower-parallelism result is still missing.

Production dependencies audit cleanly. The full audit reports findings in
Vite, PostCSS/nanoid, and esbuild. These affect development tooling rather than
the packaged Lean/Wasm runtime, but should be resolved before a public tag.

### F7 — User evidence still trails implementation evidence

Severity: **pilot learning risk**

`lean-vir-examples`, Illuminate, and the benchmark application are much better
than synthetic feasibility demos. They remain driven by the same contributor
and collaborators around the implementation. The next strong signal is a user
who can repeat the Lake/browser workflow and explain why VIR is preferable to
their actual fallback.

## Product Boundary For The Next Phase

Validated development use:

- project-controlled, trusted packages;
- exact-match Lean, package, runtime, and SDK revisions;
- explicit calls and startup hooks;
- modular package sets;
- synchronous host imports;
- the documented structural value subset; and
- tested browser operations whose ownership behavior is understood.

Under active design:

- the canonical browser-binding definition and generation path;
- resource and callback ownership across replay and partial failure;
- cancellation and detached-handle semantics;
- React concurrent rendering and callback escape;
- which of those behaviors belong in the first supported SDK.

Not promised:

- arbitrary untrusted packages;
- full `.olean`, raw `.ir`, or Lean environment loading;
- Promise-valued host imports;
- unrestricted native lookup;
- complete DOM, React, or ProofWidgets APIs;
- native execution speed; or
- compatibility across unmatched revisions.

## Decisions And Requests For The All-Hands

The meeting should explain the system and ask for evidence and ownership, not
approval of a prematurely frozen release API:

1. Which concrete Lean/browser workflow should exercise the first pilot?
2. What is its best alternative today?
3. Which binding and lifecycle behavior does that workflow actually require?
4. Who will review and own the browser boundary with the primary maintainer?
5. Who will own the user outcome and support-cost record?
6. Is Lean upstream receptive to the measured narrow declaration-provider
   seam?

The next decision gate is whether the binding and lifecycle contract is small,
coherent, and useful enough to release—not whether VIR can execute Lean IR in a
browser. That question is already answered.
