# Developer Guide

This is the implementation map for Lean VIR contributors. User setup lives in
[README.md](../README.md), command details in [HARNESS.md](HARNESS.md), and the
JavaScript boundary contract in [HOST_BINDINGS.md](reference/HOST_BINDINGS.md).

Bindings preserve upstream JavaScript values and TypeScript type relationships.
The [binding translation reference](reference/BINDING_MODALITIES.md#type-parameter-fidelity)
describes supported mappings and gaps.

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

The boundary has three lifetime mechanisms:

- externref slots root exact JS values while Lean holds them;
- JSL objects and converted callbacks retain foreign Lean payloads;
- `HostLifecycle` tracks timers, frames and React roots that need termination.

[HOST_BINDINGS.md](reference/HOST_BINDINGS.md#lean-backed-javascript-values) owns the
lifetime, finalization, rollback and shared-map limits. Native DOM listeners
remain caller-managed; ordinary JS object graphs use JavaScript reachability.

## React Boundary

The browser binding uses official React 19 and ReactDOM with exact JavaScript
values. React owns hook state and scheduling; component purity, hook ordering
and effect discipline remain application responsibilities. The [React guide](guides/REACT.md)
describes native calls, explicit conversions and optional Lean builders.

The Node wrapper provides no DOM or React implementation. Browser semantics
are tested in Chromium.

Normal infoview UI cleanup is not interpreter disposal; see the
[shell ownership contract](reference/HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

## Adding A Host Import

1. Choose the narrowest Lean effect and an explicit `Js`/`Nullable` boundary.
2. Use `@[vir_js_explicit_conversion]` only for a named conversion operation.
3. Add the target to the relevant provider without wrapping its arguments or
   result.
4. If it creates an active registration, connect termination to
   `HostLifecycle` and result-publication rollback.
5. Keep conversion explicit at the call site. Faithful bindings own the short
   operation names; do not add parallel call-and-convert wrappers.
6. Update package-generation and runtime tests. Use Chromium for DOM/React
   semantics.

## Validation

[HARNESS.md](HARNESS.md#smallest-useful-check) maps subsystems to checks and
prerequisites. Contribution and PR conventions are in
[CONTRIBUTING.md](../CONTRIBUTING.md).
