# Keep application state in Lean

Use `JSL α` when JavaScript needs to retain a Lean value without inspecting its
contents. Lean can own a model and its transformations; JavaScript keeps opaque
carriers and asks for small display values. This avoids maintaining another copy
of the model in JavaScript. It is a boundary choice, not a measured speedup.

Start with the [application setup](EMBEDDED_RESOURCES.md). Keep its program library,
resource carrier, publisher and matching runtime setup. Replace the greeting
module with this model example in `program/Client/Program.lean`:

```lean
module
meta import Vir.Attributes
public import Vir.Js

public section
open Lean.Vir
namespace Client.Program

def summary (values : Array Nat) : String :=
  toString values.size ++ ":" ++
    toString (values.foldl (fun total value => total + value) 0)

@[vir_export] def build (count : Nat) : RuntimeM (JSL (Array Nat)) :=
  LeanRef.toJSL ((List.range count).toArray)

@[vir_export] def advance (held : JSL (Array Nat)) (delta : Nat)
    : RuntimeM (JSL (Array Nat)) := do
  let values ← LeanRef.fromJSL held
  LeanRef.toJSL (values.map (fun value => value + delta))

@[vir_export] def summarize (held : JSL (Array Nat)) : RuntimeM String := do
  let values ← LeanRef.fromJSL held
  pure (summary values)

@[vir_export] def holdSummary (held : JSL (Array Nat))
    : RuntimeM (JSL (Unit → String)) := do
  let values ← LeanRef.fromJSL held
  LeanRef.toJSL (fun () => summary values)

@[vir_export] def invokeSummary (held : JSL (Unit → String)) : RuntimeM String := do
  let invoke ← LeanRef.fromJSL held
  pure (invoke ())

end Client.Program
```

`advance` returns a new model. The old model remains usable, and `holdSummary`
captures the particular model passed to it. The function can outlive that model's
JavaScript carrier because its capture remains a Lean reference.

Use these export rows in the existing `ClientResources.json` recipe:

```json
{
  "schemaVersion": 1,
  "logicalId": "model-app/model",
  "module": "Client.Program",
  "exports": [
    { "role": "build", "declaration": "Client.Program.build", "interfaceId": "model-build-v1" },
    { "role": "advance", "declaration": "Client.Program.advance", "interfaceId": "model-advance-v1" },
    { "role": "summarize", "declaration": "Client.Program.summarize", "interfaceId": "model-summarize-v1" },
    { "role": "holdSummary", "declaration": "Client.Program.holdSummary", "interfaceId": "model-hold-summary-v1" },
    { "role": "invokeSummary", "declaration": "Client.Program.invokeSummary", "interfaceId": "model-invoke-summary-v1" }
  ],
  "supportFiles": []
}
```

Build and publish through the same owning-library workflow as the greeting.
After creating the public `program` facade with its prepared manifests:

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

The carriers are ordinary JavaScript objects with private ownership associations.
They are not arrays or callable JavaScript functions. Pass the original carriers
back to the same program; JSON, copying their properties or structured cloning
does not reproduce the retained value. A separate program has a separate runtime.

## Schedule explicit invocation

JavaScript can schedule its own function that calls the named Lean boundary:

```js
let summary = program.call("holdSummary", model);
let timer = setTimeout(() => {
  timer = null;
  render(program.call("invokeSummary", summary));
}, 0);

function stop() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  summary = null;
}
```

Here `model` is a carrier from this program and `render` belongs to the application.
On unmount, cancel owned scheduling and drop the application's model/function
references. Canceling a timer does not release another reachable carrier or
interrupt a synchronous Lean call. VIR has no public per-value disposal operation.
When the application is finished with the whole program, `program.dispose()`
terminally invalidates its carriers; do not dispose a program still shared by
other views. Retired carriers alone do not retain the old generation, but physical
collection has no deadline. See the [lifetime rules](../reference/HOST_BINDINGS.md#lean-backed-javascript-values).

Use ordinary converted Lean callbacks when a host or framework requires an actual
JavaScript function. Opaque function carriers suit explicit named invocation.
Both follow the same retained-value lifetime rules.
