# JSON Boundary Lanes

VIR provides two generic JSON paths alongside its manifest-driven typed
record, array, and inductive boundary. Use the typed boundary when the schema
is known. Use these JSON lanes for heterogeneous trees, opaque passthrough
fields, or APIs where duplicating a schema projector would add no value.

## Owned Structural JSON

`Vir.Json` defines `Lean.Vir.Json`:

```lean
inductive Lean.Vir.Json where
  | null
  | bool (value : Bool)
  | number (value : Float)
  | string (value : String)
  | array (items : Array Json)
  | object (entries : Array (String × Json))
```

An exported function can accept and return ordinary JavaScript JSON directly:

```lean
import Vir.Json

@[vir_export]
def wrapJson (value : Lean.Vir.Json) : Lean.Vir.Json :=
  .object #[("payload", value), ("accepted", .bool true)]
```

```js
runtime.call("wrapJson", { source: [1, null, "two"] });
// { payload: { source: [1, null, "two"] }, accepted: true }
```

The runtime lowers the complete JavaScript tree directly to the ordered Lean
representation and lifts it directly back. No `JSON.stringify`, VIR `String`,
`Lean.Json.parse`, or `JSON.parse` step is involved. Object entries retain
JavaScript enumeration order. Numbers retain their finite IEEE-754 value,
including signed zero.

`Lean.Vir.Json` is interface tag 28 (`INTERFACE_TAG.JSON`) in manifest schema
version 8. It is a library-owned type with runtime-specialized lowering, not an
application custom-inductive convention.

## Borrowed JSON Handles

`Lean.Vir.Json.Handle` retains an ordinary JavaScript JSON value as a runtime
resource. `Handle.inspect` observes exactly one level in one host call:

- scalars return their Lean scalar payload;
- arrays return an `Array Handle` for their immediate items;
- objects return an ordered `Array (String × Handle)` for their immediate
  members.

Children stay opaque until Lean inspects them. This makes the handle lane useful
for sparse reads and passthrough payloads.

```lean
def wanted (input : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json := do
  match ← Lean.Vir.Json.Handle.inspect input with
  | .object entries =>
      match entries.findSome? fun (key, value) =>
          if key == "wanted" then some value else none with
      | some value => Lean.Vir.Json.Handle.toJson value
      | none => pure .null
  | _ => pure .null
```

JavaScript explicitly creates and releases the root handle:

```js
import { releaseHostResource } from "lean-vir";

const input = runtime.borrowJson(payload);
try {
  const result = runtime.call("wanted", input);
  // `result` is ordinary JavaScript JSON because the Lean result is owned JSON.
} finally {
  releaseHostResource(input);
}
```

Borrowed functions can return another handle with
`Lean.Vir.Json.Handle.ofJson`. `runtime.jsonValue(handle)` reads the ordinary
JavaScript value behind such a result without consuming it; the caller still
releases the result handle. `Handle.toJson` materializes a complete borrowed
tree into the owned representation when a client deliberately wants to switch
lanes.

`Handle.array` and `Handle.object` batch construction of borrowed containers.
Their child values are used by reference, so opaque inputs can be embedded in
a result without materialization or loss of JavaScript identity. Constructed
containers are independent result handles; releasing their input handles does
not rewrite the retained JavaScript references. The object builder preserves
entry order and rejects duplicate keys.

The built-in `js.json.handle`, `js.json.value`, `js.json.inspect`,
`js.json.array`, and `js.json.object` targets are explicit conversions. They
are installed by the common host bindings.
Custom `defaultHostBindings` maps should be composed with
`createBrowserHostBindings` or `createNodeHostBindings` when JSON handles are
needed.

## Validation And Limits

Both lanes accept only ordinary JSON values: `null`, booleans, finite numbers,
strings, dense arrays, and plain objects with string keys. Functions,
`undefined`, `bigint`, non-finite numbers, sparse array holes, non-plain
objects, and enumerable symbol properties are rejected.

The owned lane validates the complete tree while lowering. It rejects cycles
and paths deeper than 256 levels before calling Lean. Borrowing is intentionally
constant-work: it validates the root shallowly, then `Handle.inspect` validates
each visited child and detects cycles or excessive depth along that path.
`Handle.toJson` necessarily validates the complete materialized tree.

Lifting owned JSON also rejects non-finite numbers, duplicate object keys, and
trees deeper than 256 levels. Object construction defines keys directly, so a
JSON key named `__proto__` remains an ordinary own data property.

## Choosing A Lane

- Prefer the manifest-driven typed boundary for stable, known schemas. It gives
  Lean typed records and avoids dynamic field checks.
- Prefer owned structural JSON for bulk traversal or transformation of most of
  a heterogeneous tree.
- Prefer borrowed handles for sparse inspection, identity-preserving
  passthrough, or large opaque subtrees.
- Mix lanes explicitly when useful: inspect a borrowed input sparsely and
  return an owned JSON result, or use `Handle.ofJson` / `Handle.toJson` at a
  deliberate ownership transition.
