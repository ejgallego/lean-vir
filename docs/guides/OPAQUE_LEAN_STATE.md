# Keep application state in Lean

`JSL α` already lets JavaScript retain a Lean value without decoding it. Use it
when Lean owns the model and its transformations, and JavaScript needs only
small display results. This example uses existing APIs.

The [tested Lean example](../../fixtures/runtime/ManagedCore.lean) provides these
operations, called by their fully qualified Lean declaration names:

| Lean declaration | Result |
| --- | --- |
| `ManagedCore.buildHeld` | Opaque array carrier |
| `ManagedCore.advanceHeld` | New array carrier |
| `ManagedCore.summarizeHeld` | Size/sum string |
| `ManagedCore.makeSummaryHeld` | Opaque captured-function carrier |
| `ManagedCore.invokeSummaryHeld` | Captured model's summary |

Use the [normal application setup](EMBEDDED_RESOURCES.md) and its public
`createProgram` facade. Lean keeps the array and applies the captured function:

```js
try {
  let original = program.call("ManagedCore.buildHeld", 10);
  let advanced = program.call("ManagedCore.advanceHeld", original, 1);
  const later = program.call("ManagedCore.makeSummaryHeld", advanced);

  console.log(program.call("ManagedCore.summarizeHeld", original)); // "10:45"
  console.log(program.call("ManagedCore.summarizeHeld", advanced)); // "10:55"
  original = null;
  advanced = null;
  console.log(program.call("ManagedCore.invokeSummaryHeld", later)); // "10:55"
} finally {
  program.dispose();
}
```

The carriers are ordinary objects with private ownership associations, not arrays
or callable JavaScript functions. Pass them back to the same program; JSON,
property copying or structured cloning does not reproduce their retained values.
The captured function can outlive the model's JavaScript carrier.

While the program is active, JavaScript can schedule a named Lean invocation:

```js
const heldFunction = program.call(
  "ManagedCore.makeSummaryHeld", program.call("ManagedCore.buildHeld", 10),
);
const timer = setTimeout(() => {
  console.log(program.call("ManagedCore.invokeSummaryHeld", heldFunction));
}, 0);
```

On unmount, cancel owned timers and drop the view's model/function references.
Cancellation does not interrupt a synchronous Lean call or release another
reachable carrier. When finished with the whole program, dispose it; there is no
public per-value release or collection deadline. Use converted Lean callbacks
when a host needs an actual JavaScript function. See the existing
[lifetime rules](../reference/HOST_BINDINGS.md#lean-backed-javascript-values).
