# Event Callback And Closure Roadmap

`Lean.Vir.Browser.Element.addEventListener`, `Timer.setTimeout`, and
`Animation.requestAnimationFrame` are the callback APIs for browser-driven
reentry into Lean. The earlier string-named event entrypoint binding has been
removed; event listeners now use retained Lean closures directly.

## Current Contract

- Opaque browser resources are represented in Lean by abstract types such as
  `Element`, `Event`, `EventListener`, `Timeout`, and `AnimationFrame`.
- The current WASM/JS ABI still stores those resources in JavaScript-owned
  tables and passes numeric handles through the `wasm32-wasip1` boundary.
- Lean function values in host-import arguments are encoded as rooted callback
  handles. JavaScript receives them as callable `VirCallback` objects.
- `VirCallback.release()` is idempotent and calls the WASM
  `vir_closure_release` export to decrement the rooted Lean closure.
- Browser listener, timeout, and animation-frame bindings retain callbacks until
  the registration fires, is cancelled/removed, or the runtime is disposed.
- `VirRuntime.dispose()` runs host-binding cleanup and releases any remaining
  callback roots. After disposal, `vir.call(...)` and callback calls fail.
- Loading a new package into an existing runtime first tears down host-owned
  registrations from the previous package and releases outstanding callback
  roots.

The runtime is still synchronous at the host-import boundary. A JavaScript host
binding must not return a `Promise`; asynchronous browser APIs are represented by
registering a Lean callback and returning an opaque cancellation handle.

## Event APIs

`Element.addEventListener`:

- Lean passes an `Event -> IO Unit` closure directly.
- The host creates a DOM listener and calls the retained Lean closure when the
  event fires.
- The `Event` resource is callback-scoped and is released after dispatch.
- `Element.removeEventListener` removes the listener and releases its retained
  callback.
- `Event.target` and `Event.currentTarget` return `some Element` when the
  underlying event target is a DOM element, and `none` otherwise.
- `Event.preventDefault` and `Event.stopPropagation` forward to the underlying
  browser event and are also modeled in the virtual test host.
- `Event.inputElement?`, `Event.inputValue?`, and `Event.inputChecked?` are
  Lean helpers for controlled input handlers; they check `currentTarget` before
  falling back to `target`.

## Timer And Frame APIs

`Timer.setTimeout` and `Animation.requestAnimationFrame` deliberately exercise
callback retention without relying on DOM events:

- `Timer.setTimeout delay callback` maps to browser `setTimeout`.
- `Timer.clearTimeout timeout` cancels a pending timeout and releases the
  callback.
- `Animation.requestAnimationFrame callback` maps to
  `requestAnimationFrame`, with a `setTimeout(..., 16)` fallback in virtual Node
  tests.
- `Animation.cancelAnimationFrame frame` cancels a pending frame and releases the
  callback.

These APIs are one-shot. A loop is written in Lean by registering the next
callback from the current callback.

## Tests

`scripts/test-vir-runtime.mjs` covers the current callback surface:

- pure callback round-trip through a custom `test.callNatCallback` host import;
- double release, call-after-release, and stale closure handle failure;
- nested callback argument errors while Lean is inside a host import;
- callback-backed event listener dispatch, listener removal, and runtime
  teardown cleanup;
- one-shot `setTimeout`, cancelled timeout, and a recursive timeout loop;
- one-shot `requestAnimationFrame`, cancelled frame, and a recursive frame loop;
- package reload cleanup for pending listeners, timers, frames, and callback
  roots;
- callback-scoped event target/currentTarget access through React input, change,
  and checkbox callbacks;
- `preventDefault`/`stopPropagation` dispatch through virtual events and real
  browser `onChange`/`onSubmit` smoke coverage;
- virtual event helper coverage through `createVirtualEventState`;
- browser-page smoke coverage for real DOM click dispatch, `setTimeout`,
  `requestAnimationFrame`, cancellation/removal, package reload cleanup, and
  direct runtime disposal;
- manifest descriptor round-trips for host-import function types.

## Remaining Work

1. Add more focused helpers for common events while keeping `Event` opaque.
2. Keep the v1 closure-root table simple. If release overhead becomes visible,
   optimize handle allocation/release in a second phase, after leak tests make
   the ownership contract hard to regress.
3. Keep async host imports out of v1. Promise-returning host bindings need a
   later JSPI or task-queue design that can report rejection without leaving the
   interpreter state ambiguous.

## Wasm Extension Direction

- `externref` is the natural future representation for opaque host resources in
  browser engines that support reference types. It can remove the JS-side
  resource table for host-owned values, but it does not by itself solve Lean
  closure rooting, release ownership, or WASI portability.
- The Component Model and WIT `resource` semantics are the right long-term
  interface shape for typed host resources. The current manifest is intentionally
  an internal ABI and should remain replaceable.
- JS Promise Integration and Stack Switching are the relevant proposal-track
  work for future async host calls. They are not required for the synchronous
  callback registration model implemented here.
- Wasm GC and typed function references are useful to track, but Lean closures
  are currently Lean heap objects managed by Lean's runtime. They are not a
  replacement for the explicit root/release bridge in this phase.

References:

- [WebAssembly finished proposals](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md)
- [WebAssembly active proposals](https://github.com/WebAssembly/proposals)
- [WebAssembly feature status](https://webassembly.org/features/)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN `Event.stopPropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation)
- [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
