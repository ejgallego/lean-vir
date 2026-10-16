# JSON-safe generated value codecs

The JSON-safe representation reuses the compiler-owned native descriptors,
constructor layouts, recursive scopes and value mappings used by `call`.
It changes the leaves that ordinary JSON cannot preserve. It is an explicit
application boundary: ordinary calls retain their native JavaScript values.

This implementation is experimental. It uses manifest 13 and resource compatibility 7. A matching
published runtime and SDK are required before applications can acquire it
through the standard resource workflow. The earlier published
manifest-12/runtime-6 pair does not support these additions.

## Encode in Lean, construct typed values in VIR

Import the generator as a meta dependency and its pure support as a runtime
dependency. Generate a named typed writer from a closed source type:

```lean
module
public import Vir.Package.JsonSafeWriter
meta import Vir.Compiler.Interface.JsonSafeWriter
public meta import Vir.Attributes
public section

namespace Preview
structure Document where
  title : String
  count : Nat
  bytes : ByteArray

run_elab Vir.Interface.JsonSafeWriter.generate `Preview.encode (Lean.mkConst ``Document)

@[vir_export] def accept (document : Document) : Nat := document.count
end Preview
```

`Preview.encode : Document → String` can run on the native server. It traverses
the typed value directly and builds JSON text without a `Lean.Json` graph or a
`ToJson` instance. The generator shares the normal classifier and selected
constructor shapes; it does not infer a wire schema from JSON instances.
Generated traversal helpers are private and are not application exports.

The existing JSON-RPC String envelope can carry this text unchanged. On the
client, parse it once and select JSON-safe arguments on the normal typed call:

```js
const document = JSON.parse(response.result);
const count = runtime.callWith(
  { argumentRepresentation: "json-safe-v1" },
  "Preview.accept",
  document,
); // bigint, because the result uses the default native representation
```

`createProgram` returns a facade with the same `callWith` method and its usual
root-export restriction. Options contain only `argumentRepresentation` and
`resultRepresentation`. Both default to `"native"`; the argument setting applies
to all arguments. Select `resultRepresentation: "json-safe-v1"` when the returned
JS value must itself be JSON-safe. A reference result must keep `"native"`.

The complete selected domains are checked before argument construction or
invocation, even when the actual collection is empty. Conversion then uses the
existing consuming call ABI, rollback on lowering failure and handle lifetimes.
Each runtime caches native and JSON-safe plans separately by immutable admitted
pair identity. There is no application pointer API or whole-value adaptation
pass before the normal constructor plan.

## Wire values

Records, variants, tagged Options, enums, booleans and sequences keep their
compiler-selected shape. Only the following leaves change:

| Lean value | JSON-safe value |
| --- | --- |
| Nat, Int, UInt64 | Canonical decimal String |
| UInt8/16/32 | Integer Number in range |
| Unit | Exactly `null` |
| ByteArray | Array of integer Numbers in 0..255 |
| String | String |

Canonical decimals have no whitespace, plus sign, exponent, leading zeros or
negative zero. Only Int accepts a negative sign. Large integers never pass
through Number. Byte conversion uses the native leaf buffer directly; it does
not materialize a complete BigInt/undefined/Uint8Array graph.

For example, these constructor distinctions survive ordinary JSON:

```js
{ kind: "none" }
{ kind: "some", value: { kind: "none" } }
{ kind: "some", value: null } // some ()
```

The selected codec supports wasm32 USize Numbers, but the Lean writer currently
rejects USize: a native-server value needs an explicit checked wasm32 range rule.
Floats, resources, opaque references, callbacks and specialized Expr views are
excluded from the JSON-safe domain. Inherited record flattening is not yet
supported by the writer. Unsupported domains fail generation or binding; there
is no silent `ToJson` fallback. Ordinary native calls keep their existing scope.

## Validated library construction

Some types require more than filling their stored fields. The compiler retains
recognized computed constructor operations, including Name's cached hash, as
private pure call-table entries. Construction invokes those operations through
the existing owned-object ABI instead of copying a raw representation with
missing invariants. These entries cannot be called through the application
export map.

Library authors can register a closed construction rule using
`Vir.Interface.registerClosedLibraryAdapter` from
`Vir.Compiler.Interface.LibraryAdapters`:

```lean
-- Both helpers must be compiled safe, monomorphic definitions.
-- decode : Wire → Except String Source
-- encode : Source → Wire
run_meta do
  Vir.Interface.registerClosedLibraryAdapter
    (Lean.mkConst ``Source) (Lean.mkConst ``Wire) ``decode ``encode
```

Registration is persistent across imports and selects the exact closed source
type. Source and wire must be object-backed Type-0 domains. Rules cannot replace
primitive, resource, reference or callable boundaries. Conflicting registrations
fail. Recursive adapter wire domains are currently rejected; each wire domain
starts a fresh closed recursive scope.

A map rule should use the library's public insertion and iteration operations.
That establishes ordering, balance and size rather than accepting unchecked raw
tree nodes. The application/library owns the rule's semantic choices, including
key validity and duplicate handling. VIR checks helper types and the emitted
private ABI; it does not prove that encode and decode are inverse functions.

The current producer also recognizes Char and literal-bound Fin fields. Explicit
mapping checks preserve Unicode scalar validity and exact natural bounds despite
proof erasure. Char permits NUL, astral scalars and noncharacters, but rejects
surrogates and values at or above 0x110000. Fin100 accepts exactly 0..99. These
checks apply to native and JSON-safe conversion, including packed fields.
Arbitrary proof-bearing domains remain unsupported; erased storage is not a
proof of a value invariant.

## Qualification and performance scope

Maintained fixtures exercise generated writers, recursive and private fields,
large integers, bytes, library adapters, unsupported-domain rejection, recovery
and ownership on both Wasm profiles. Lean observations independently check the
constructed values; a round trip alone is insufficient.

A local full `Verso.Doc.Part Verso.Genre.Manual` exercise additionally covered
all 15 current metadata fields and extension payloads with a library-provided
NameMap rule. It is an eligibility test, not a published consumer integration.
The normal descriptor and registered rules determine the accepted domain; this
is not the existing Verso `ToJson` schema.

The controlled comparison used one 33-section fixture and both encoders/decoders
in VIR/Wasm. Its paired elapsed ratio was 0.216 while the JSON-safe payload was
2.19 times larger. This is evidence of avoided conversion work, not native-server,
network, browser-rendering or complete application latency. The next useful
measurement is the actual consumer operation with server and client separated.
