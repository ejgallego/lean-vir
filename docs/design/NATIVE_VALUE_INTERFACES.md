# Native descriptors and JavaScript value interfaces

Status: producer/runtime migration implemented locally for PR #233.
The [typed contract and examples](native-value-interfaces.ts) describe the emitted
pair. The [binder](../../web/src/runtime/native-value-codecs.js) consumes admitted
compiler metadata directly in optional object conversion; scalar operations and
reference ownership remain available in the managed composition.

The compiler emits the native facts and the default JavaScript view together.
There is no snapshot adapter, compatibility reader, or runtime declaration-name
selection. The binder covers primitives, enum/Bool/Unit, packed fields, inherited
records, arrays, recursive constructor values, expression conversion and callable
results. Public custom-leaf construction remains a separate API decision.

See [performance and slow paths](../../benchmarks/NATIVE_CODECS.md#performance-and-slow-paths)
for measured limits and the cost model. This source migration needs a matching
runtime/program release before consumer adoption.

VIR should describe a Lean value's compiled representation once and allow
different codecs to use that description. A JavaScript shape and a traversal
algorithm are choices above that representation. They do not require another
description of its storage.

## The pair

```ts
interface BoundaryInterface {
  native: DescriptorRef;
  value: ValueInterface;
}

interface NativeDescriptor {
  type: NativeType; // Primitive | LeanObject | Resource
  metadata?: CompilerMetadata;
}
```

`NativeType` identifies the core runtime operation and ownership boundary.
Optional compiler metadata supplies constructor order, field types, physical
field locations, allocation sizes, recursive references, and callable signatures.
`ValueInterface` selects JavaScript representations and the mappings needed to
interpret them. A compiled codec binds the two, checks their compatibility once,
and caches its lowering/lifting plan.

Opaque Lean-object passage requires no layout metadata. Structural conversion
requires a constructor table; array conversion requires a compiler-confirmed
native-array element descriptor; calling an object requires a compiler-owned
signature. These facts enable chosen
operations without creating separate core kinds for records, closures, or Expr.
The metadata is optional information on the same descriptor, not a second type
registry or an automatic conversion requirement.

The pair is used at a callable boundary. Its two members do not both describe
field types or physical layouts. A value interface refers to logical field
positions in the native descriptor; it never repeats object slot indices, scalar
offsets, or allocation counts. An application can reuse one admitted native
descriptor with several explicitly selected value interfaces.

Use one `tag` discriminant in each runtime-type or value-interface union. The
draft uses readable string tags; there is no simultaneous numeric `interfaceTag`
and textual `kind` describing
the same category. Numeric wire discriminants, if selected later, would replace
the strings rather than accompany them.

Keep the initial pair inline at its callable boundary. This draft adds no global
type/codec registry or separate ID table. Cache a bound plan by the admitted
descriptor and interface identities, never by a declaration name or display
label. Compiler recursion classification still uses the complete applied Lean
type, including parameters and universes.

## Core native tags

| Tag | Required facts / native operation |
| --- | --- |
| `nat`, `int` | Existing arbitrary-precision native construction and inspection. |
| `string`, `byteArray` | Existing distinct native string and byte-array operations. |
| `unsigned` | Width: 8, 16, 32, 64, or target `usize`. |
| `float` | Width: 32 or 64. |
| `leanObject` | Lean-owned values, including constructors, arrays, closures, and Expr; common retain/release operations. |
| `resource` | JavaScript rooting and release at the exact resource boundary. |

There are no native List, Option, Prod, Array, record, enum, or tagged-union tags.
Unit and Bool are Lean objects with constructor metadata. Their JavaScript
meanings belong to the value interface. Native arrays, function signatures and
Expr conversion also leave the core tag set: they describe optional operations
on Lean objects.
Resource has a distinct rooting policy and can be regarded as a boundary
primitive. Remaining primitive tags identify native ABI operations which a
constructor table alone does not supply; this is not a proposal to reconstruct
String or Nat through stdlib internals. The sequence codec still uses efficient
native array allocation/indexing helpers, just as an expression codec uses
expression helpers. Those operations do not require separate core type tags.

`metadata.arrayElement` is emitted only for compiler-confirmed Lean Array storage.
It supplies the element descriptor for a selected sequence codec. It is not an
element hint authorizing array operations on arbitrary constructors. A List's
sequence codec instead binds its constructor table and explicit chain traversal.

Recursive metadata uses `{ ref: depth }`, referring to an enclosing constructor
description. It is a schema reference, not another kind of runtime value.
The runtime's core object passage does not need to interpret it. Optional
structural codecs resolve it when binding their cached plans.

Each constructor has one representation:

| Representation | Facts |
| --- | --- |
| `immediate` | No runtime fields; immediate ordinal is its position in the table. |
| `object` | Runtime fields, their locations, and compiler storage counts. |
| `identity` | Sole modeled field used directly for a compiler-confirmed trivial wrapper. |

The constructor's table position is its ordinal. Do not store a second ordinal
that admission must compare with the position. This preserves the current
producer invariant rather than inventing a new tag lookup scheme. Storage counts
remain explicit compiler facts: interfaces must not infer allocation sizes from
the subset or order of field locations.

The first version admits identity wrappers with one modeled field. It needs no
second field-index fact for that case. Wrappers with additional erased fields
remain subject to the existing classification limits; this draft does not add
proof/default reconstruction.

Declaration names remain producer-owned identity/diagnostic metadata. JavaScript
spellings are emitted in the producer's default value interface using the existing
central constructor-label rule. A consumer never guesses a spelling from a
qualified name. An explicit alternate interface can choose other spellings;
this is a selected mapping, not acceptance of aliases in one codec.

## Value tags

| Tag | JavaScript value and mapping |
| --- | --- |
| `bigint` | Exact integral values, with native range checks where applicable. |
| `number` | Floating-point or bounded unsigned values; native width determines the checks. |
| `safeInteger` | Checked integer-number adapter; reject unsafe values in both directions. |
| `string`, `bytes` | String and Uint8Array. |
| `unit` | `undefined`, for a sole nullary constructor. |
| `boolean` | Explicit false/true constructor ordinals. |
| `enum` | One distinct string for each constructor, in native constructor order. |
| `record` | Ordinary object; explicit keys and native field paths. |
| `variant` | `{ kind }`, `{ kind, value }`, or `{ kind, fields }` per constructor. |
| `sequence` | Dense JS array; native-array traversal or explicit linked traversal. |
| `recursive` | Reuse the codec of the native recursive target. |
| `jsReference`, `leanReference` | Existing exact-JS and opaque-Lean carrier meanings. |
| `function` | Callback argument/result interfaces, subject to current boundary support. |
| `expr` | Existing explicit expression representation. |

`number` and `safeInteger` are separate decisions. The default Nat/Int interface
is `bigint`; a wire codec can explicitly select a safe-integer subdomain. That
adapter must reject large integers, not round them. Selecting it does not imply
that every value of an unbounded Lean type can be materialized through it.

`variant.cases` follows native constructor order. It supplies the JS spelling and
payload shape, without repeating tags, field types, or layouts. A zero-field
payload is `none`, a one-field payload can be `value`, and named payloads use
`fields`. Admission checks field coverage and constructor coverage. Ordinary
conversion checks the caller's actual kind, keys, payload, and values.

`record` requires one native constructor. Its keys can map directly to fields or
to nested paths, such as an inherited parent's field. All required construction
inputs must be supplied. Defaults and omitted fields are application wire rules,
not inferred by this interface.

`sequence.chain` selects nil/cons constructor ordinals and logical head/tail
field positions. The compiled plan obtains their physical locations from the
descriptor and uses an iterative traversal. It does not dispatch on `name ===
"List"`. Without `chain`, a sequence must bind to a Lean-object descriptor with
native-array metadata.
The first version supports the ordinary two-constructor head/tail chain, not an
arbitrary graph traversal language.

Reference and callback interfaces preserve ownership and boundary semantics.
A `function` view requires signature metadata, including the execution effect;
its binding checks the actual boundary role as well as shape compatibility.
An `expr` view selects the specialized expression codec after admission confirms
the compiler-owned type identity is `Lean.Expr`. Neither operation needs a core
function or expression tag. These codecs retain the existing callable and expression operations.

In particular, `JSL α` remains `Js (LeanRef.Handle α)`: its boundary is a
`resource` descriptor with a `jsReference` view, and its payload type is opaque.
The `leanReference` view applies to the existing native `leanObject` boundary.
Selecting a view does not manufacture a JSL carrier for an arbitrary output type.

## Replacement of existing tags

| Existing descriptor category | Core type / optional compiler facts | Default value interface |
| --- | --- | --- |
| Nat / Int (0 / 1) | `nat` / `int` | `bigint` |
| Bool (2) | `leanObject`, constructors | `boolean` |
| String (3) | `string` | `string` |
| UInt8 / UInt16 / UInt32 (4 / 5 / 6) | `unsigned`, corresponding width | `number`, checked against the native range |
| UInt64 (7) | `unsigned`, width 64 | `bigint` |
| USize (8) | `unsigned`, target usize | `number` for the current wasm32 boundary |
| ByteArray (9) | `byteArray` | `bytes` |
| Float / Float32 (10 / 11) | `float`, width 64 / 32 | `number` |
| Simple enum (14) | `leanObject`, constructors | `enum` |
| Lean.Expr (15) | `leanObject`, declaration identity | `expr` |
| Array (16) | `leanObject`, native-array element descriptor | `sequence` |
| Structure (20) | `leanObject`, constructors | `record` |
| Tagged union (21) | `leanObject`, constructors | `variant` |
| Unit (22) | `leanObject`, constructors | `unit` |
| Resource (23) | `resource` | `jsReference` |
| Function (24) | `leanObject`, signature | `function` |
| Custom inductive (25) | `leanObject`, constructors | `variant`, or an explicit alternate view |
| Recursive reference (26) | Metadata reference `{ ref: depth }`; no core type | `recursive` |
| Lean object (27) | `leanObject` | `leanReference` |

Previously retired List/Option/Prod categories (17/18/19) stay retired. Their
native form is `leanObject` with constructor metadata; default views are
respectively `sequence`, `variant`, and `record`. These are migration choices,
not compatibility modes.

## Examples

The typed examples define one `Option Nat` descriptor and two interfaces:

```js
// Producer's default interface.
{ kind: "none" }
{ kind: "some", value: 42n }

// An explicitly selected alternate interface over the same descriptor.
{ kind: "absent" }
{ kind: "present", value: 42n }
```

Each individual codec accepts only its selected spelling. Both retain constructor
distinctions. Nested Options therefore remain lossless, including `some none`
and `some ()`. The draft provides no automatic nullable/bare-value Option view.
An application may author a restricted shorthand separately.

One `List Nat` descriptor supports both an iterative sequence interface:

```js
[1n, 2n]
```

and a constructor interface:

```js
{
  kind: "cons",
  fields: {
    head: 1n,
    tail: {
      kind: "cons",
      fields: { head: 2n, tail: { kind: "nil" } },
    },
  },
}
```

The sequence codec is a specialization of traversal, not another native layout.
Prod is a one-constructor descriptor with a record view. Sum and Except use the
same constructor descriptor with variant views. An enum uses immediate
constructors with an enum view; Bool uses the same native form with a boolean
view. Unit uses one immediate constructor with a unit view.

## Recursion and ownership

Every constructor table binds one metadata recursive scope, regardless of
the chosen JS shape. Arrays and function signatures do not invent aggregate
owners. Thus `Tree -> Option Tree -> Tree` refers to depth 1, whereas a List's
tail refers to depth 0. Sum/Except no longer have a separate transparent category;
the producer must emit depths for the unified binder rule. Reusing old numeric
depths unchanged would be incorrect.

The value interface's `recursive` tag carries no second depth. Its paired native
reference determines the owner, and the bound codec for that owner determines the
representation. In a sequence plan, the chain tail is handled iteratively while
element references still resolve in the native scope.

Constructor creation preserves existing transfer-on-success ownership. A failed
conversion releases its partial owned values; inspection retains fields for its
documented scope. Public JS values contain no raw pointers. Compiling a different
view must not create a second object ownership policy or shared-service lifetime.

The lowering/lifting kernel remains part of optional object conversion. It can
specialize a plan for object-only layouts, immediate values, trivial wrappers,
and linked sequences. Canonical descriptors do not require one generic recursive
walker on every call. Plans remain cached over immutable admitted metadata.

## What is validated where

Core admission checks the native boundary. When compiler metadata is provided,
admission checks its structure, layouts, ordinals by position, and recursive
scope bounds. Binding a value interface checks its
compatibility with the admitted native descriptor once: distinct spellings,
constructor and field coverage, primitive compatibility, and sequence shape.
Dynamic conversion checks input values and returned object discriminants. It
does not revalidate the descriptor at each node.

A supported structural codec preserves constructor and field information through
Lean -> JS -> Lean. Explicit restricted adapters state their accepted domain and
reject values outside it. Field output must use own data properties so that keys
such as `__proto__` do not acquire assignment semantics. These requirements are
independent of JSON serialization.

## Relationship to explicit application codecs

A value interface describes the native structural boundary. It is not a generated
replacement for arbitrary ToJson/FromJson instances. Application codecs own their
wire mappings, defaults, custom leaves, and error rules; those choices cannot be
recovered from compiled layouts.

For example, an ordinary-JSON view of Lean.Json would need an explicit codec for
its public semantic constructors and object iteration. The presence of a native
descriptor does not authorize hand-written TreeMap storage access. The retained
Verso codec can use the native construction kernel after a public opaque
construction interface is implemented and qualified, while keeping its wire
semantics separate.

This draft deliberately does not invent a codec registry, a manifest schema for
arbitrary JavaScript functions, or a public raw-pointer construction API. The
scope/lifetime and custom-leaf call operations of the public construction seam
remain a subsequent contract. This document is not a dependency release for
consumer integration.

## Migration and qualification

Reduce the core type set to primitives, Lean objects, and resources. Move
constructor layouts, signatures, and recursion references into optional
compiler metadata and generate explicit default value interfaces. Keep primitive
ABI kernels, layout-plan caching, and existing ownership operations. Compile
the pair once; select linked traversal through the value interface rather than declaration-name
dispatch. Remove the simultaneous kind/interfaceTag category fields.

Before adopting that slice, qualify enums/Bool/Unit, trivial and inherited
records, nested Options, both List views, and Tree through Option/List/Prod and
Sum/Except. Preserve callback and failure/reuse cases. Migration is a breaking
contract change with one matching runtime revision, not compatibility adapters.
The local source cut uses manifest 12 / combined compatibility 6, preserving
ABI 4 and binary package format 11. Runtime publication, lock selection, and
consumer adoption remain separately owned.

Performance evaluation should distinguish schema unification from codec
implementation. Compare the same value interface and full call boundary before
and after, then separately compare alternate interfaces. Retain the current
regression measurements; a smaller schema alone is not evidence of faster
conversion. The existing List specialization remains a useful algorithm to reuse.

Earlier retained timing screens used the prototype and predate producer
migration. Fresh comparisons must use the emitted pair through the ordinary
runtime call path, with matched SDK/program identities and correctness checks.
