# JSON Boundary Lanes

VIR provides two generic JSON paths alongside its manifest-driven typed
record, array, and inductive boundary. Use the typed boundary when the schema
is known. Use these JSON lanes for heterogeneous trees, opaque passthrough
fields, or APIs where duplicating a schema projector would add no value.

## Explicit Structural JSON

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

`Lean.Vir.Json` is a Lean-side representation, not an automatic export-boundary
type. JSON-facing exports use `Lean.Vir.Json.Handle` and name every complete-tree
transition explicitly:

```lean
import Vir.Json

@[vir_export]
def wrapJson (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  let owned ← Lean.Vir.Json.Handle.toJson value
  Lean.Vir.Json.Handle.ofJson
    (.object #[("payload", owned), ("accepted", .bool true)])
```

```js
import { releaseHostResource } from "lean-vir";

const input = runtime.borrowJson({ source: [1, null, "two"] });
try {
  const output = runtime.call("wrapJson", input);
  try {
    console.log(runtime.jsonValue(output));
    // { payload: { source: [1, null, "two"] }, accepted: true }
  } finally {
    releaseHostResource(output);
  }
} finally {
  releaseHostResource(input);
}
```

`Handle.toJson` materializes the complete JavaScript tree as the ordered Lean
representation; `Handle.ofJson` constructs a JavaScript-owned result handle
from a complete Lean tree. No `JSON.stringify`, VIR `String`, `Lean.Json.parse`,
or `JSON.parse` step is involved. Object entries retain the order observed from
`Object.keys`. Numbers retain their finite IEEE-754 value, including signed
zero.

An export argument or result tree containing `Lean.Vir.Json` is rejected with
a diagnostic that points to `Lean.Vir.Json.Handle`. This policy is intentional:
at VIR's current experimental stage, callers should be able to see and review
every full-tree ownership transition rather than acquire one from a type
classifier fallback.

The reverse boundary creates ordinary JavaScript objects. Their enumeration
therefore follows ECMAScript rules: array-index keys enumerate in ascending
numeric order before other string keys, while other string keys retain insertion
order. An arbitrary Lean object-entry order containing keys such as `"10"` and
`"2"` is consequently normalized when it becomes a JavaScript object.

`Lean.Vir.Json` retains interface tag 28 (`INTERFACE_TAG.JSON`) in manifest
schema version 8 because the named `js.json.handle` and `js.json.value` host
imports need its structural descriptor. The tag does not enable automatic
export marshalling. It is a library-owned type with runtime-specialized
conversion, not an application custom-inductive convention.

### Relationship To `Lean.Json`

`Lean.Vir.Json` is not an alias, coercion, or boundary spelling for
`Lean.Json`. The two types describe the same broad JSON shapes, but serve
different representations. Their correspondence is currently symbolic:

| JSON shape | `Lean.Vir.Json` | `Lean.Json` |
| --- | --- | --- |
| null | `.null` | `.null` |
| boolean | `.bool value` | `.bool value` |
| number | `.number value` with `Float` | `.num value` with `JsonNumber` |
| string | `.string value` | `.str value` |
| array | `.array items` | `.arr items` |
| object | `.object entries` with an ordered array | `.obj fields` with a tree map |

This table is documentation, not an implemented conversion API. In
particular, VIR does not define a `Coe` instance or conversion functions
between the types. Such a conversion could not be an implicit lossless
isomorphism:

- `Lean.JsonNumber` stores an exact decimal mantissa and exponent, while a
  JavaScript number and `Lean.Vir.Json.number` are IEEE-754 doubles. Converting
  a `JsonNumber` can round or overflow, and converting through `Lean.Json`
  cannot retain the sign of JavaScript negative zero.
- `Lean.Json.obj` stores fields in a tree map, which does not retain the source
  JavaScript enumeration order. `Lean.Vir.Json.object` keeps that order because
  it is observable when lifting back to JavaScript and serializing the result.

`Lean.Json` is therefore appropriate for parsing and rendering JSON text with
exact decimal values. `Lean.Vir.Json` is the runtime-value representation for
explicitly materializing JavaScript values without a text codec. If executable
adapters are added later, their names and result types should make the rounding,
overflow, signed-zero, and ordering policy explicit.

## Borrowed JSON Handles

`Lean.Vir.Json.Handle` retains an ordinary JavaScript JSON value as a runtime
resource. `Handle.inspect` observes exactly one level in one host call:

- scalars return their Lean scalar payload;
- arrays return an `Array Handle` for their immediate items;
- objects return an ordered `Array (String × Handle)` for their immediate
  members.

Children stay opaque until Lean inspects them. This makes the handle lane useful
for sparse reads and passthrough payloads. Inspection is sparse by depth and
subtree, not by immediate width: inspecting a container creates handles for all
of its immediate children, so its cost is proportional to that container's
length or member count.

```lean
def wanted (input : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  let result ← match ← Lean.Vir.Json.Handle.inspect input with
  | .object entries =>
      match entries.findSome? fun (key, value) =>
          if key == "wanted" then some value else none with
      | some value => Lean.Vir.Json.Handle.toJson value
      | none => pure .null
  | _ => pure .null
  Lean.Vir.Json.Handle.ofJson result
```

JavaScript explicitly creates and releases the root handle:

```js
import { releaseHostResource } from "lean-vir";

const input = runtime.borrowJson(payload);
try {
  const result = runtime.call("wanted", input);
  try {
    console.log(runtime.jsonValue(result));
  } finally {
    releaseHostResource(result);
  }
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

A borrowed handle retains a live JavaScript reference, not a snapshot. Mutating
the referenced array or object between calls changes what a later
`Handle.inspect` or `Handle.toJson` observes. Hosts should not mutate a borrowed
tree while a Lean call is inspecting it.

`Handle.array` and `Handle.object` batch construction of borrowed containers.
Their child values are used by reference, so opaque inputs can be embedded in
a result without materialization or loss of JavaScript identity. Constructed
containers are independent result handles; releasing their input handles does
not rewrite the retained JavaScript references. The object builder preserves
the entry order that an ordinary JavaScript object can represent and rejects
duplicate keys. Array-index keys still follow the ECMAScript enumeration rule
described above.

The built-in `js.json.handle`, `js.json.value`, `js.json.inspect`,
`js.json.array`, and `js.json.object` targets are explicit conversions. They
are installed by the common host bindings.
Custom `defaultHostBindings` maps should be composed with
`createBrowserHostBindings` or `createNodeHostBindings` when JSON handles are
needed.

## Validation And Limits

Both representations accept only ordinary JSON values: `null`, booleans,
finite numbers, strings, dense arrays, and plain objects with string keys. Functions,
`undefined`, `bigint`, non-finite numbers, sparse array holes, non-plain
objects, and enumerable symbol properties are rejected.

Borrowing is intentionally constant-work: it validates the root shallowly,
then `Handle.inspect` validates each visited child and detects cycles or
excessive depth along that path. `Handle.toJson` necessarily validates the
complete materialized tree when Lean calls that explicit conversion; it rejects
cycles and paths deeper than 256 levels.

`Handle.ofJson` also rejects non-finite numbers, duplicate object keys, and
trees deeper than 256 levels. Object construction defines keys directly, so a
JSON key named `__proto__` remains an ordinary own data property.

## Choosing A Lane

- Prefer the manifest-driven typed boundary for stable, known schemas. It gives
  Lean typed records and avoids dynamic field checks.
- Prefer owned structural JSON behind an explicit `Handle.toJson` /
  `Handle.ofJson` transition for bulk traversal or transformation of most of a
  heterogeneous tree.
- Prefer borrowed handles for sparse inspection, identity-preserving
  passthrough, or large opaque subtrees.
- Mix representations explicitly when useful: inspect a borrowed input
  sparsely, materialize only a selected subtree, and return a handle built with
  `Handle.ofJson`.
