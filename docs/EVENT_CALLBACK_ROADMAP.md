# Event Callback And Closure Roadmap

The authoritative JavaScript-value and active-resource contract is in
[HOST_BINDINGS.md](HOST_BINDINGS.md). This note records callback-specific
behavior and remaining work.

## Current Model

A Lean function passed to a host import appears as an ordinary JavaScript
function. The public function has no numeric handle and no VIR-specific
`retain`, `release`, or `dispose` methods. Private WeakMap state associates it
with one rooted Lean closure.

JavaScript code follows normal reachability rules: a listener, timer, React
element, closure, or application object that stores the function keeps it
reachable. A `FinalizationRegistry` releases the Lean root after collection as
a best-effort backstop. Runtime disposal releases all still-live closure roots
deterministically and makes subsequent callback calls fail.

Host imports remain synchronous. Returning a Promise is an error. Asynchronous
work starts by registering a callback and returning an explicit cancellation
value or success result.

## Active Callback APIs

`Element.addEventListener`, timer registration, and animation-frame
registration are active resources. VIR tracks the registration—not a second
lease over the callback—until it is removed, cancelled, completed, replaced,
or disposed. The platform registration's ordinary reference to the function
keeps the callback alive.

Creation is transactional. If a registration succeeds but its return value
cannot be published to Lean, the host-call transaction removes or cancels the
new registration. A callback lifted for a failed host call is likewise
invalidated before the error returns to JavaScript.

DOM and React event objects are ordinary JavaScript values. Their practical
validity follows the browser or framework API; VIR does not add a dynamic
callback scope or invalidate them after callback return.

## Error And Teardown Behavior

Synchronous host exceptions are relayed to the owning top-level or callback
call. Cleanup detaches active registrations before invoking platform teardown,
attempts every sibling cleanup, and reports multiple failures as an
`AggregateError`.

Package replacement constructs and validates the new runtime before disposing
the previous runtime's listeners, schedules, roots, and Lean-backed callback
roots. Rejected replacement leaves the active runtime intact.

## Tests

The runtime suite covers:

- ordinary callable shape and identity;
- invocation, exception propagation, wrong arity, and disposal invalidation;
- finalization as an optional GC backstop;
- listener dispatch/removal and timer/frame completion/cancellation;
- package replacement and runtime teardown;
- failure after listener creation but before host-result publication;
- cleanup that throws while sibling cleanup still runs;
- real browser events and official React behavior.

## Remaining Work

- Keep async host imports out of the synchronous dispatcher until there is a
  concrete JSPI or task-queue design.
- Add event conveniences only as explicitly named Lean adapters; do not change
  the underlying event value.
- Optimize closure-root allocation only if profiling shows it matters.
- Continue testing browser APIs against their official implementations rather
  than extending the Node virtual host into a browser or React emulator.

References:

- [MDN `FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
