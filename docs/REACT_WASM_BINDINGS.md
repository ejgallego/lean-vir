# React-First Wasm Bindings

This note records how WebAssembly interop supports VIR's React surface. The
product goal is semantic fidelity with ordinary JavaScript React, with a small
and replaceable interpreter transport.

## Current Boundary

The runtime targets a `wasm32-wasip1` core module:

- JavaScript calls exported Lean declarations through the generic object ABI.
- Lean calls synchronous JavaScript bindings through package-scoped
  `@[vir_js]` imports.
- JavaScript values use an `externref` root table while they are represented
  by Lean external objects.
- Lean callbacks and JSL objects carry private Lean roots associated with
  ordinary JavaScript functions or objects.

The `externref` table stores the actual JavaScript value. VIR does not put a
runtime wrapper between React and the value:

```text
React/JavaScript value
        │
        ▼
externref table slot  ◀── root id ──▶  Lean external object
```

The root id is private interpreter transport. Host bindings see only the exact
JavaScript value. `null`, `undefined`, primitives, objects, and functions are
all valid table values; a separate live-id set distinguishes an absent root.

## Why Externref Is Not The Whole ABI

Reference types remove serialization for JavaScript values. They do not
replace construction of ordinary Lean scalars, structures, arrays, variants,
or recursive values inside the interpreter. Those still use the
manifest-described object ABI.

Similarly, `externref` does not eliminate the need to root a Lean closure or
Lean heap value while JavaScript can reach it. VIR handles that obligation in
private WeakMap/finalizer state attached to an otherwise ordinary JavaScript
function or object.

## React Fidelity

The browser adapter installs official React and ReactDOM behavior:

- actual props objects and child/dependency arrays;
- actual React elements returned by `React.createElement`;
- React's setter, dispatch, ref, memo, reducer, and effect behavior;
- actual roots returned by `ReactDOMClient.createRoot`.

VIR does not infer React's internal state or maintain a parallel hook/resource
graph. React purity, hook ordering, replay safety, dependency correctness, and
lane behavior remain programmer responsibilities just as they are in
TypeScript.

Lean-specific builders and component/effect conveniences are explicit
adapters above this exact value boundary. They should remain separately named
and should not be described as properties of React itself.

The component adapter maps each explicit Lean component ID to one ordinary
function-component type and passes the current Lean callback as a normal prop.
Stable IDs preserve ordinary hook state; changing an ID requests React's normal
component-type remount. Hook-order correctness across updates remains the
programmer's responsibility.

Official React 19, ReactDOM, and Chromium are the sole semantic oracle. The
Node virtual document supplies cleanup-safe unsupported React shims and does
not emulate nodes, hooks, reconciliation, roots, or commits.

## Lifecycle Boundary

Ordinary React and JavaScript values use their native reference graph. VIR
keeps explicit teardown only for active resources with public termination:
listeners, timers, animation frames, and React roots. A host-call transaction
rolls back a newly created active resource if result publication fails.

React does not expose a commit acknowledgement for every direct root
submission. Recurring application updates should therefore use the component
path, where React owns render timing, rather than expecting VIR to infer when a
directly submitted tree is no longer retained.

## Future Wasm Features

JS Promise Integration should wait for a concrete asynchronous Lean API.
Promise-returning host imports do not fit the current synchronous interpreter
transaction and should eventually use a distinct async call surface.

The Component Model and WIT remain useful long-term directions for typed
resources and values, but the current core module should not emulate their
ownership model in JavaScript. Stack switching, Wasm GC, and typed function
references likewise need a concrete runtime benefit before changing this
boundary.

## Entry Points

- `lean-vir` exports the generic runtime.
- `lean-vir/host-bindings` exports common/browser factories and
  `createHostLifecycle`.
- `lean-vir/react-host-bindings` imports React and ReactDOM and exports the
  browser React binding factory.
- `lean-vir/vir-runtime-node` installs virtual DOM bindings and unsupported
  React shims for tests and tools.

## Local Probes

Run `npm run test:wasm-extensions`. The probe requires `externref` table
support and identity round-tripping. JSPI remains optional and is reported
independently.

## References

- [WebAssembly reference types](https://github.com/WebAssembly/reference-types)
- [WebAssembly active proposals](https://github.com/WebAssembly/proposals)
- [JS Promise Integration](https://github.com/WebAssembly/js-promise-integration)
- [React API reference](https://react.dev/reference/react)
