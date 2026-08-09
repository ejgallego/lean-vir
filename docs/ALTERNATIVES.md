# Alternatives To VIR

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-10
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

## Current Comparative Evidence

VIR now contains a standalone browser benchmark application for comparing
JavaScript, VIR JSON, VIR typed `Std.Format`, FIR-native, and
LLVM/Emscripten implementations under one semantic and artifact-identity
contract. Illuminate is available as a peer browser workload. This is a major
improvement over comparing architectural sketches alone.

The harness should not yet be read as a universal performance ranking. Some
Illuminate runs remain explicitly non-authoritative rehearsals, and workload,
startup, boundary conversion, steady-state execution, memory, and artifact
size answer different questions. The all-hands should use the application to
show that the alternatives are directly comparable, while keeping any numeric
claim tied to its exact frozen artifact set and workload.
