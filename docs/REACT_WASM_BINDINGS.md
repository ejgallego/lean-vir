# React-First Wasm Bindings

This note records the current direction for using newer WebAssembly interop
features in Lean VIR. The product goal is excellent support for writing React
apps in Lean. Generic host interop improvements are useful when they make that
React path simpler, safer, or faster.

Status in this note was checked on 2026-06-12 against the WebAssembly proposal
repositories.

## Current Boundary

The runtime still targets a portable core `wasm32-wasip1` artifact:

- JavaScript calls Lean through the generic `vir_call` byte-payload export.
- Lean calls JavaScript through package-scoped `@[vir_js]` host imports routed
  to `env.vir_js_call`.
- Opaque browser and React resources cross the JS/Wasm boundary through
  `externref` side-channel imports. Lean stores them as GC-finalized external
  resource objects that root JavaScript host-resource objects in the host
  runtime.
- Lean closures passed to JavaScript cross through an internal closure-root
  side channel and appear as callable `VirCallback` objects that must be
  released by the host binding or runtime teardown.

That baseline describes the current implementation. The experimental React
resource prototype can intentionally require newer browser/Wasm support instead
of carrying compatibility code for older engines.

## Feature Fit

`externref` is the right term and the right first feature to prototype. It is
part of the finished Reference Types proposal and lets host references cross
the Wasm boundary without encoding them through linear memory or integer table
handles. For Lean VIR, the first candidate values are React and DOM resources:
`Element`, callback-scoped `Event`, `ReactRoot`, event listener handles, timer
handles, and animation-frame handles.

The experimental `externref` path should be strict:

- feature-detect support at runtime and fail fast on unsupported engines;
- do not design a long-term numeric-resource fallback for the prototype;
- preserve the Lean-facing `@[vir_resource]` API;
- keep explicit Lean closure root/release semantics.

The prototype uses direct side channels for opaque values while keeping the
generic byte-payload dispatcher for ordinary scalar and structured values.
`WIRE.RESOURCE` and `WIRE.FUNCTION` carry no serialized numeric payload.
JavaScript queues opaque host-resource objects before entering Wasm, and the
shim queues those same objects back before JavaScript decodes resource results
or host-import arguments. Lean closures are rooted in the shim and queued back
as internal closure root ids before JavaScript decodes `VirCallback` values.
Lean resource values are external objects whose finalizers release the host
root table entry.

The JavaScript API treats resources as opaque runtime objects and does not
accept raw numeric resource tokens or expose a supported numeric `.handle`
field.

`externref` does not replace callback rooting. Lean callbacks are still Lean
heap objects owned by the interpreter runtime. JavaScript may retain a callback
across React renders, event listeners, timers, or animation frames, so the
current `VirCallback.release()` contract remains the ownership boundary.

JS Promise Integration (JSPI) should be deferred until there is a concrete
Promise-shaped React app API. The proposal is active at Phase 4 and exposes
`WebAssembly.Suspending` plus `WebAssembly.promising` to let synchronous Wasm
code call Promise-returning JavaScript imports. That fits future APIs such as
`fetch`, IndexedDB, async local storage, or server RPC from Lean, but it should
not change the existing synchronous `vir.call(...)` surface. If adopted, it
should be exposed through a distinct async API such as `vir.callAsync(...)`.

Stack Switching remains a tracking item for coroutine-shaped runtimes. The
Component Model and WIT resources remain the long-term semantic target for
typed resources, but the current browser runtime should not depend on a
component-model artifact yet. Wasm GC and typed function references are useful
platform work, but they do not replace Lean's own heap representation in this
phase.

## React API Priorities

React authoring ergonomics can improve independently of Wasm extensions:

- expand blessed `Property` and `EventHandler` helpers for common DOM/React
  props and events;
- document app patterns for controlled inputs, form submission, state updates,
  and component-like helper functions over `Html`;
- keep `Html`, `Property`, `PropValue`, `EventHandler`, and `Root` as the
  stable Lean-facing shape while the lower boundary evolves;
- continue testing rapid rerender, unmount, package reload, and runtime dispose
  cleanup for retained callbacks.

The strict `externref` resource path is implemented. JSPI should wait for an
async Lean app use case that cannot be expressed cleanly with callback
registration.

## Local Probes

Run:

```bash
npm run test:wasm-extensions
```

The probe script checks the local JavaScript engine used by Node for:

- `externref` table support for host-resource storage;
- `externref` identity round-tripping through a tiny Wasm module;
- JSPI availability through `WebAssembly.Suspending` and
  `WebAssembly.promising`.

Missing `externref` support is reported as a failure because the experimental
React resource prototype requires it. JSPI remains optional and is reported as
skipped when the local engine does not expose it.

## References

- WebAssembly active proposals: <https://github.com/WebAssembly/proposals>
- WebAssembly finished proposals:
  <https://raw.githubusercontent.com/WebAssembly/proposals/main/finished-proposals.md>
- Reference Types proposal: <https://github.com/WebAssembly/reference-types>
- JS Promise Integration proposal:
  <https://github.com/WebAssembly/js-promise-integration>
