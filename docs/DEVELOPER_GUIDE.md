# Developer Guide

This is the implementation map for Lean VIR contributors. User setup lives in
[README.md](../README.md), command details in [HARNESS.md](HARNESS.md), and the
JavaScript boundary contract in [HOST_BINDINGS.md](HOST_BINDINGS.md).

TypeScript faithfulness is a correctness requirement, not an optional binding
policy. Preserve the relationships between upstream type parameters, including
collection elements, tuple positions, callback arguments and results. Unsupported
translation must remain an explicit gap; it must not become an unconstrained
Lean type parameter or an implicit cast. Runtime checks cannot justify an
incorrect static declaration. See [BINDING_MODALITIES.md](BINDING_MODALITIES.md#type-parameter-fidelity).

## Implementation Map

| Area                  | Main files                                                                   | Responsibility                                                                              |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Lean library          | `Vir/`                                                                       | Runtime monads, JavaScript phantom types, browser/React APIs, and interface classification. |
| Package tools         | `tools/`                                                                     | IR package construction, manifests, closure discovery, and reports.                         |
| Interpreter shim      | `wasm/upstream_shim/`                                                        | Upstream interpreter integration, package provider, object ABI, and externref roots.        |
| Runtime facade        | `web/src/vir-runtime.js`, `web/src/runtime/core.js`                          | Instantiation, package replacement, calls, and disposal.                                    |
| Object ABI            | `web/src/runtime/object-values.js`, `web/src/runtime/host-state.js`          | Lean object lowering/lifting and host-import dispatch.                                      |
| JS boundary           | `web/src/host-boundary.js`                                                   | Externref roots and host-call rollback transactions.                                        |
| Active host lifecycle | `web/src/host/vir-active-host-bindings.js`                                   | Shared lifecycle plus timer and frame teardown.                                             |
| Browser providers     | `web/src/vir-host-bindings.js`, `web/src/host/vir-infoview-host-bindings.js` | Browser targets and the repository-owned infoview protocol.                                 |
| React providers       | `web/src/vir-react-host-bindings.js`, `web/src/react/`                       | Official browser React host.                                                               |

## Top-Level Call Flow

For a JavaScript-to-Lean call:

1. The runtime resolves the export descriptor from the loaded package set.
2. `object-values.js` lowers JavaScript inputs into real Lean objects.
3. The upstream IR interpreter executes the declaration.
4. The object ABI lifts the Lean result back to JavaScript.
5. Temporary Lean objects are decremented on both success and failure paths.

For a Lean-to-JavaScript host import:

1. The shim supplies object pointers to `env.vir_js_call_objects`.
2. `host-state.js` lifts each argument according to its descriptor.
3. The runtime opens a host-call transaction.
4. The selected JavaScript binding receives the exact JavaScript values.
5. The returned value is lowered into a Lean object.
6. Successful lowering commits the transaction; failure rolls back any newly
   created active resource.

Host imports execute synchronously. A binding may return a native `Promise`
only when the declared result is an exact `Js` resource: the Promise object is
rooted and returned without awaiting it. Returning a Promise where VIR must
lower a structural or immediate result is rejected before commit.

## JavaScript Values And Ownership

Use JavaScript reachability for ordinary values, not a second VIR object graph.
The boundary has three distinct mechanisms:

- externref slots root exact JS values while Lean holds them;
- JSL objects and converted callbacks retain foreign Lean payloads;
- `HostLifecycle` tracks timers, frames and React roots that need termination.

[HOST_BINDINGS.md](HOST_BINDINGS.md#lean-backed-javascript-values) owns the
lifetime, finalization, rollback and shared-map limits. Native DOM listeners
remain caller-managed. Do not register passive values merely to observe them.

## React Boundary

The browser binding delegates semantics to official React 19 and ReactDOM.
Keep props, child/dependency arrays, nodes, refs, state, actions, dispatchers,
and roots as their real JavaScript values. Do not infer dependency reuse from
memo results, infer queue consumption from commits, or emulate speculative hook
state.

The programmer remains responsible for the same rules as in TypeScript:
component purity, hook ordering, effect discipline, valid dependencies, and
replay-safe reducers. A Lean helper may improve ergonomics, but it must be
named and documented as an adapter if it changes the upstream operation.

The Node wrapper deliberately provides no DOM or React implementation. Add
browser and React semantic tests to the official Chromium suite; focused Node
tests may inject only the individual host operations they exercise.

Normal infoview UI cleanup is not interpreter disposal. See the
[shell ownership contract](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal)
before changing unmount, refresh or failure handling.

## Adding A Host Import

1. Choose the narrowest Lean effect and an explicit `Js`/`Nullable` boundary.
2. Use `@[vir_js_explicit_conversion]` only for a named conversion operation.
3. Add the target to the relevant provider without wrapping its arguments or
   result.
4. If it creates an active registration, connect termination to
   `HostLifecycle` and result-publication rollback.
5. If it is intentionally more convenient than the JavaScript API, expose the
   convenience under a separate adapter name.
6. Update package-generation and runtime tests. Use Chromium for DOM/React
   semantics.

## Review Questions

- Does the binding receive and return the actual JavaScript values?
- Does `Object.is` behave as it would for the upstream API?
- Is any conversion visible and separately named?
- Is lifecycle state limited to a Lean root or an active resource that truly
  requires explicit teardown?
- Can failure after acquisition roll back without touching caller-owned input?
- Are we claiming a property that TypeScript/JavaScript does not provide?
- Can a caller choose an unrelated result or inserted-element type where the
  TypeScript declaration fixes it from the receiver or another argument?
- Does the check compare against an independently obtained TypeScript type, or
  only confirm that generated Lean repeats a handwritten configuration?
- Is a Node test accidentally becoming a browser or React emulator?

Before adding bridge bookkeeping, identify the concrete failure introduced by
crossing the Lean/JavaScript boundary, check whether a simpler representation
removes it, and supply a regression for any remaining mechanism. Do not turn
upstream programmer responsibilities into new VIR guarantees. In compatibility
reviews, distinguish missing support or semantic bugs from unavoidable foreign
heap obligations and responsibilities shared with TypeScript clients.

## Validation

Start focused and broaden for shared boundaries:

```bash
npm run test:runtime
npm run test:upstream:no-build
npm run check:bindings
npm run build:site
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

`git diff --check` and the PR message validation script are required hygiene
before updating a pull request.
