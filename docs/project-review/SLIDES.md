---
marp: true
paginate: true
title: "VIR: Lean logic, running in the browser"
---

# VIR

## Lean logic, running in the browser

Lean's real IR interpreter · `wasm32-wasip1` · Lake · JavaScript

**Question:** when should selected Lean code run in the client instead of being
rewritten, compiled into an application, or served over RPC?

---

# The problem VIR addresses

A project has useful Lean-authored logic or interaction and wants to:

- reuse it in a browser without a second TypeScript implementation;
- deploy static assets without operating a Lean backend;
- preserve Lean compiler IR and execution behavior;
- load or replace a bounded package independently of the runtime.

VIR is for **selected project-controlled code**, not “all of Lean in every
browser.”

---

# How a developer uses it

```lean
@[vir_export]
def answer : Nat := 42

@[vir_startup]
def mount : Lean.Vir.Browser.DomM Unit := do
  -- Create browser behavior from Lean.
  pure ()
```

```bash
lake build +MyModule:vir
VIR_SDK_COMMIT=<same-commit> lake build :virSdk
```

**Demo:** JavaScript calls `answer` · the startup hook creates browser behavior.

---

# How it works

```text
Lean source/module
   ↓  @[vir_export] / @[vir_startup]
Lake :vir facet + package generator
   ↓
trusted .irpkg: declarations + interface + initialization
   ↓
WASI loader → declaration provider → upstream IR interpreter
   ↕
object / resource / callback ABI
   ↕
JavaScript → DOM / Canvas / React / Infoview experiments
```

- The upstream interpreter remains unmodified.
- Native lookup stays explicit and restricted.

---

# What is real—and what is bounded

| Evidence | 2026-08-10 current main |
| --- | ---: |
| Conformance fixtures | **98/98 passed** |
| Runtime smoke tests | **18/18 passed** |
| Exact-head CI, real Chromium, Pages | **passed** |
| Runnable all-IR / public constants | **322,027 / 29,217** |
| Release Wasm | 723,398 B raw · 163,593 B gzip |

**Validated development use:** trusted project-generated packages, explicit
calls, startup hooks, synchronous host calls, and tested values. Binding and
lifecycle semantics remain the pre-release gate.

**Not promised:** arbitrary packages, a full Lean environment, Promise imports,
general native lookup, full React/ProofWidgets parity, or native speed.

---

# Alternatives solve different problems

| Approach | Advantage | Cost |
| --- | --- | --- |
| TypeScript implementation | Native web stack | Duplicates Lean logic |
| Lean server + RPC | Full environment, native runtime | Backend, network, serialization |
| Direct Lean-to-Wasm build | Better performance potential | Build/link and interop coupling |
| **VIR: interpret selected IR** | Dynamic package and real Lean IR | Interpreter cost, version and trust boundary |
| New web evaluator | Full design control | Large semantic maintenance burden |

The pilot must compare VIR with the user's **actual best fallback**.

**Now measurable:** one browser app compares JavaScript, two VIR paths,
FIR-native, and LLVM/Emscripten; Illuminate is a peer workload.

---

# Upstream small seams, not all of VIR

## Plausible upstream candidates

- first-class `wasm32-wasip1` build and platform guards;
- static native-symbol registration for embedded runtimes;
- an explicit declaration-provider interface, now backed by a measured
  real-environment experiment.

## Keep in VIR for now

- `.irpkg` encoding and loading;
- JavaScript object, callback, and resource ABI;
- DOM, React, infoview, and ProofWidgets integrations.

Risks: premature internal APIs, incomplete platform semantics, added test
matrix, and ownership transfer without maintenance capacity.

**Measured provider case:** a real Lean environment was correct but added
3.29 MiB stripped Wasm, about 60% package-load time, and about 19% fresh-entry
time.

---

# Productization is sponsored; evidence still decides scope

After the all-hands:

- name the maintainer, backup, user owner, pilot owner, and boundary reviewer;
- converge the binding source of truth and lifecycle semantics;
- use exact-commit artifacts for early pilot learning;
- freeze and tag only the smallest supportable SDK surface;
- obtain upstream feasibility feedback on the small candidate seams.

> VIR has proved and measured a credible execution model.
>
> The next proof is a browser contract we can support where it is better than
> the alternatives.
