# Keep application state in Lean

`JSL α` already lets JavaScript retain a Lean value without decoding it. Use it
when Lean owns the model and its transformations, and JavaScript needs only
small display results. This example uses existing APIs.

The [tested Lean example](../../fixtures/runtime/ManagedCore.lean) provides these
operations. In your program recipe, map each role to its declaration:

| Program role | Lean declaration | Result |
| --- | --- | --- |
| `build` | `ManagedCore.buildHeld` | Opaque array carrier |
| `advance` | `ManagedCore.advanceHeld` | New array carrier |
| `summarize` | `ManagedCore.summarizeHeld` | Size/sum string |
| `holdSummary` | `ManagedCore.makeSummaryHeld` | Opaque captured-function carrier |
| `invokeSummary` | `ManagedCore.invokeSummaryHeld` | Captured model's summary |

Use the [normal application setup](EMBEDDED_RESOURCES.md) and its public
`createProgram` facade. Lean keeps the array and applies the captured function:

```js
try {
  let original = program.call("build", 10);
  let advanced = program.call("advance", original, 1);
  const later = program.call("holdSummary", advanced);

  console.log(program.call("summarize", original)); // "10:45"
  console.log(program.call("summarize", advanced)); // "10:55"
  original = null;
  advanced = null;
  console.log(program.call("invokeSummary", later)); // "10:55"
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
const heldFunction = program.call("holdSummary", program.call("build", 10));
const timer = setTimeout(() => {
  console.log(program.call("invokeSummary", heldFunction));
}, 0);
```

On unmount, cancel owned timers and drop the view's model/function references.
Cancellation does not interrupt a synchronous Lean call or release another
reachable carrier. When finished with the whole program, dispose it; there is no
public per-value release or collection deadline. Use converted Lean callbacks
when a host needs an actual JavaScript function. See the existing
[lifetime rules](../reference/HOST_BINDINGS.md#lean-backed-javascript-values).
