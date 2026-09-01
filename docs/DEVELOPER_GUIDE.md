# Developer Guide

This is the implementation map for Lean VIR contributors. User setup lives in
[README.md](../README.md), command details in [HARNESS.md](HARNESS.md), and the
JavaScript boundary contract in [HOST_BINDINGS.md](HOST_BINDINGS.md).

## Implementation Map

| Area                  | Main files                                                          | Responsibility                                                                              |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Lean library          | `Vir/`                                                              | Runtime monads, JavaScript phantom types, browser/React APIs, and interface classification. |
| Package tools         | `tools/`                                                            | IR package construction, manifests, closure discovery, and reports.                         |
| Interpreter shim      | `wasm/upstream_shim/`                                               | Upstream interpreter integration, package provider, object ABI, and externref roots.        |
| Runtime facade        | `web/src/vir-runtime.js`, `web/src/runtime/core.js`                 | Instantiation, package replacement, calls, and disposal.                                    |
| Object ABI            | `web/src/runtime/object-values.js`, `web/src/runtime/host-state.js` | Lean object lowering/lifting and host-import dispatch.                                      |
| JS boundary           | `web/src/host-boundary.js`                                          | Externref roots and host-call rollback transactions.                                        |
| Active host lifecycle | `web/src/host/vir-host-resources.js`                                | Listener, timer, frame, and React-root teardown.                                            |
| Browser providers     | `web/src/vir-host-bindings.js`                                      | Browser and infoview target implementations.                                                |
| React providers       | `web/src/vir-react-host-bindings.js`, `web/src/react/`              | Official browser React adapter and explicit Node unsupported shims.                         |

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

Host imports are synchronous. A Promise result is rejected before commit.

## JavaScript Values And Ownership

Do not build a second object graph in VIR. JavaScript identity and reachability
are the ownership oracle for ordinary values. Props own their properties,
arrays own their elements, closures own their captures, and React owns the
graphs it stores. Passing or returning an object preserves exact identity.

The externref table is transport, not an ownership wrapper. It roots the exact
value while a Lean external object names it. Its numeric ids are private to the
interpreter ABI.

Two value kinds contain Lean heap references and therefore need private bridge
state:

- a JSL value is an ordinary object associated with one retained Lean pointer;
- a Lean callback is an ordinary function associated with one closure root.

WeakMaps hide that association. Finalizers are a best-effort GC backstop;
runtime disposal is the deterministic release boundary. Neither value exposes
public retain/release methods.

Explicit `HostLifecycle` state is only for active platform registrations:
listeners, schedules, animation frames, and React roots. If a new active value
is returned by a host call, register its rollback before returning it. Do not
put passive values in the lifecycle merely to observe their reachability.

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

Node virtual bindings intentionally stop at DOM/event test doubles. React
operations fail with a browser-host-required error. Add React semantic tests to
the official Chromium suite instead of extending the virtual host.

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
- Is a Node test accidentally becoming a browser or React emulator?

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
