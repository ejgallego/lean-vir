# Alternatives To VIR

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-13
Decision context: execute or reuse Lean-authored behavior in a web product

VIR should be selected because its trade-offs fit a concrete use case, not
because browser-side Lean is inherently preferable. This document compares
architectural approaches; it is not a market survey of every implementation.

## Comparison

| Approach | Main advantage | Main cost | Best fit |
| --- | --- | --- | --- |
| Reimplement the behavior in TypeScript | Uses the native web stack, tooling, and ecosystem | Duplicates Lean logic and can diverge from Lean semantics | Small web-only behavior or teams that do not need Lean reuse |
| Run Lean on a server and call it through RPC | Uses the mature native runtime and can access a full Lean environment | Requires backend operations, network access, request serialization, and latency management | Heavy computation, trusted server state, or workflows already requiring Lean services |
| Compile each Lean application directly to Wasm | Offers better potential execution performance and a conventional deployment artifact | Couples deployment to compilation and linking; dynamic package replacement and browser interop need their own design | Stable applications whose executed Lean closure is known at build time |
| Interpret selected Lean IR with VIR | Reuses real Lean compiler IR, loads a bounded package dynamically, and deploys as static browser assets | Interpreter overhead, version coupling, restricted native support, and a trusted-package boundary | Project-controlled Lean logic that must be reused or changed independently in the browser |
| Build a new Lean evaluator or translated runtime for the web | Allows complete control over representation and browser integration | Creates a large semantic, compatibility, and maintenance obligation | Research requiring a deliberately different execution model |

## Selection Questions

Prefer TypeScript when the behavior is small, browser-specific, and has little
value as shared Lean code.

Prefer a Lean service when the workflow already needs server-owned state, a
full environment, long-running or resource-intensive computation, or strong
control over untrusted requests.

Investigate direct Wasm compilation when execution performance dominates,
the application closure is stable, and rebuilding the executable artifact is
acceptable.

Investigate VIR when all of the following are true:

- Lean code or semantics should be reused rather than reimplemented;
- the work should execute client-side or offline;
- the package is controlled and trusted by the application project;
- dynamic package loading or replacement has value; and
- the interpreted performance envelope is acceptable.

Do not choose VIR merely to avoid creating a backend if the browser would then
need to execute untrusted packages or emulate most of a full Lean environment.

## Evidence Required From The Pilot

The Lake/browser pilot must compare VIR with the user's actual fallback, not a
theoretical weakest alternative. It should record:

- what would otherwise be written in TypeScript or moved to a service;
- which Lean definitions are genuinely reused;
- integration, deployment, and upgrade work;
- runtime and loading behavior relevant to the user;
- support time and workarounds; and
- whether the user repeats the workflow.

The comparison should be revised when direct Lean-to-Wasm tooling or other
relevant alternatives materially change.

## Comparison Contract

The all-hands confirmed that comparison quality is now a product requirement.
The core comparison is JavaScript versus VIR versus FIR-native over the same
semantic input and output. LLVM/Emscripten and VIR's JSON/typed interfaces are
useful diagnostic variants, but should not obscure that central choice.

Every accepted scorecard must separate these questions:

| Dimension | Primary measure | Fairness rule |
| --- | --- | --- |
| Correctness | Exact semantic parity over the same corpus or trace | A backend that fails parity is not ranked on performance |
| First use | Time to first correct result | Split transfer, fetch, compile/instantiate, initialization, boundary setup, and first call where applicable |
| Warm use | Execute and end-to-end latency distributions plus scaling | Use the same input, warm-up, sample, process, and ordering protocol |
| Size | Raw and deterministic compressed deployable bytes | Report complete first-app cost and workload-incremental cost separately |
| Memory | Peak, retained, or isolated bytes with method stated | Do not compare browser proxies as if they were equivalent measurements |
| Integration | Implementation, binding, build, and deployment effort | Record through the real pilot, not a synthetic timing loop |
| Updates | Cost to change or replace the workload | Distinguish JS rebuild, FIR application rebuild, and VIR package replacement |

VIR size needs two views. The first application pays for the shared interpreter
runtime and its package. A later application may reuse that runtime and pay
mostly an incremental `.irpkg` cost. FIR and JavaScript artifacts may have a
different sharing boundary. Therefore report at least:

1. one-workload deployable total;
2. incremental cost of a second workload; and
3. amortized total for a declared set of workloads.

Likewise, local resource-load timing is not a substitute for real network
latency. Accepted reports record deterministic compressed bytes and cache
state. Any throttled or real-network measurement names its network profile
separately.

Do not collapse the dimensions into a single score or universal winner. The
result should state the conditions under which each approach is favored.

## Current Comparative Evidence

VIR now contains a standalone browser benchmark application for comparing
JavaScript, VIR JSON, VIR typed `Std.Format`, FIR-native, and
LLVM/Emscripten implementations under one semantic and artifact-identity
contract. Illuminate is available as a peer browser workload. This is a major
improvement over comparing architectural sketches alone.

The harness should not yet be read as an authoritative performance ranking.
The generic artifact candidate now builds, packs, re-imports, and validates on
`main`, but some Illuminate runs remain explicitly non-authoritative
rehearsals and no controlled-machine JS/VIR/FIR scorecard has been accepted.
Workload, cold startup, boundary conversion, steady-state execution, memory,
and artifact size answer different questions.

The next evidence step is tracked by
[L-004](project-review/cards/active/L-004-js-vir-fir-comparison.md): freeze the
protocol and artifacts, refresh the measurements after persistent interpreter
caches, run controlled `prettyM` and Illuminate campaigns, and publish a
conditional scorecard.
