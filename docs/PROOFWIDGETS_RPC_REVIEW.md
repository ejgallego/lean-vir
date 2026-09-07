# Native ProofWidgets RPC Review Guide

This change supplies a native RPC boundary for Lean-authored browser components.
The compatibility target is an ordinary ProofWidgets React component implemented
in Lean instead of TypeScript, with the same infoview environment and observable
semantics. It is not a new widget protocol or React execution model.

## Scope

- Carry the exact position-specific RPC session through the infoview surface.
- Forward requests and optional cancellation options to its native `call` method.
- Return the exact native Promise synchronously through `Js.Promise`; expose
  continuation operations over exact `Js.Function1` values, with explicit
  conversion for Lean closures.
- Supply phantom-type erasure and opt-in checked narrowing, initially for DOM
  elements, without decoding or replacing the JavaScript value.
- Remove the provisional reference descriptors, resolver/store, normalization
  and unused reference prefetch. Genuine server references use the official RPC
  client's existing protocol.
- Exercise the boundary with a two-file tutorial and real-server Chromium test.

## Reading Order

1. [Compatibility contract](PROOFWIDGETS_RPC_COMPATIBILITY.md) and
   [tutorial](../examples/tutorials/RpcReferenceWidget.md): intended behavior,
   upstream provenance and the actual authoring model.
2. [RPC declarations](../Vir/Infoview/Surface.bindings.json) and
   [providers](../web/src/host/vir-infoview-host-bindings.js): exact receiver,
   request, options and result forwarding. Review source configuration before
   generated declarations.
3. [Host dispatcher](../web/src/runtime/host-state.js): the small shared-boundary
   change allowing native Promises as exact JavaScript results.
4. [Browser acceptance](../tests/infoview/rpc-browser-entry.js) and
   [server fixture](../fixtures/infoview/RpcBrowserServer.lean): observable behavior
   against official React, `RpcSessions` and Lean server RPC methods.

## Correctness Questions

- **Identity:** Do requests and nested server-reference objects remain exact?
  Copying a registered reference's token into an unrelated record is not an
  ownership-preserving replacement. No second reference registry should remain.
- **Synchronous imports:** Does an exact `Js` result bypass even `.then`
  inspection, while Promise-like structural/immediate results still fail before
  host-call commit? VIR must not await or assimilate a Promise in the dispatcher.
- **Callback boundary:** Are Lean-closure conversions explicit? Native functions
  must not acquire a foreign lifetime merely because they pass through Lean.
  Conversely, converted Lean callbacks must not enter a disposed runtime.
- **Application effects:** Does cancellation remain distinct from stale-result
  suppression? The tutorial keeps the last successful child mounted during
  refresh/error, but unmounts before runtime disposal or replacement.
- **Types:** `Js.Function1` describes a call shape, not dynamic validation.
  `Js.Any` forgets only a phantom type. Checked casts return the same object on
  success; unchecked property projections still assume the server's wire shape.
- **Module integration:** Can an importing Lean module compile and execute
  `Js.erase`? Are both the module-snapshot tests and RPC tests retained, using the
  current `irPackageSet` option and matching JS/Wasm/package artifacts?
- **Evidence:** Are late successes real server replies held until after abort,
  rather than simulated cancellation? Do unexpected request, browser and teardown
  failures remain visible without skipping cleanup or hiding the first error?

## What This Does Not Claim

React purity, hook ordering, effect dependencies and server/client schema
agreement remain programmer responsibilities, as in TypeScript. Rooting foreign
Lean values is a bridge obligation; emulating React hook ownership is not.

The tutorial uses a JavaScript effect parent and a Lean renderer. It establishes
the native RPC boundary, not complete ports of `InteractiveExpr`, `HtmlDisplay`
or the other [planned parity components](PROOFWIDGETS_PORTING.md).
The fixture's goal snapshot is display data, not an elaborator expression/context.

Upstream serialized `ProofWidgets.Html` is the input to an optional renderer.
VIR's similarly named native node-building action is a different authoring API;
it does not establish wire compatibility or justify changing upstream widget
semantics. A parity port must accept the existing upstream format and reuse its
component/module-loading dependencies.

## Focused Validation

`npm run test:infoview:browser` builds the tutorial package and runs the real
server/browser acceptance plus cleanup/diagnostic unit tests. It requires a
matching generated Wasm artifact; see [HARNESS.md](HARNESS.md). The runtime RPC
smoke separately covers exact Promise/function identity and explicit Lean
continuations. The module snapshot suite remains in `npm run test:infoview`.

These tests establish their particular behaviors, not arbitrary widget parity
or deterministic JavaScript finalizer timing. Consult CI for the reviewed head;
passing checks on a predecessor do not validate a rebased successor.
