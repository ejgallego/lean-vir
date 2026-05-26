# Event Callback Roadmap

`Lean.Vir.Browser.Element.addEventListener` is a pragmatic v1 binding. It lets
Lean register a DOM listener by naming an exported Lean entrypoint. The
JavaScript host passes an opaque `Lean.Vir.Browser.Event` resource to that
entrypoint while the callback is running, plus one optional static string
argument.

This is enough for the Tamagotchi demo to own its DOM event wiring from Lean,
but it is not the final callback story.

## V1 Contract

- Lean calls `Element.addEventListener element event entry argument`.
- `entry` must name an exported Lean declaration in the same loaded package.
- The exported entrypoint receives `Event` as its first argument.
- If `argument` is `some value`, the host passes `value` as the second
  argument.
- `Event` is opaque and valid only during that callback.
- The browser runtime provides these bindings by default; no special
  `createVirRuntime` option is required for `Lean.Vir.Browser.*`.
- The Node wrapper records virtual listeners so tests can mount the same Lean
  code without a real DOM.

## V2 Goals

1. Add event accessors while keeping `Event` opaque:
   `preventDefault`, `stopPropagation`, `target`, `currentTarget`, and focused
   helpers for common input events.
2. Add a real callback ABI instead of string-named entrypoints. Lean function
   values should be representable as rooted host callback resources with an
   exported apply trampoline.
3. Define callback lifetime and ownership. Listener handles should retain the
   Lean callback, and `removeEventListener` or runtime teardown should release
   it.
4. Specify event resource lifetime. The default should remain callback-scoped;
   any retained event should require an explicit snapshot or retain operation.
5. Define the runtime reentry policy. V1 is synchronous; v2 needs a clear rule
   for nested calls, traps, queued callbacks, and errors thrown from callbacks.
6. Decide the async boundary. Current host imports cannot return promises.
   Browser events may later need a task or microtask bridge, with rejection
   reporting that does not leave the runtime in an ambiguous state.
7. Expand validation. Add browser click/change tests, virtual dispatch tests,
   listener removal tests, callback release/leak tests, and explicit reentry
   failure tests.

Useful browser references:

- [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [MDN `EventTarget.removeEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener)
- [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target)
