# Lossless explicit codecs

This is a design proposal for the [planned generated JSON converters](../SUPPORT.md#planned-for-011),
not an implemented API or a change to current automatic conversion.

## Why a separate contract is needed

The automatic JavaScript representation maps `Option.none` to `null` and
`Option.some` to its bare payload. That loses distinctions under composition:

| Lean value | Current lifted JavaScript value | Lowered back |
| --- | --- | --- |
| `none : Option (Option Nat)` | `null` | `none` |
| `some none : Option (Option Nat)` | `null` | `none` |
| `some () : Option Unit` | `undefined` | `none` |

A constructor helper can unify how values are built, but it cannot recover
information discarded by a representation. Recursive context is another concern:
arrays, lists, options, products, Sum and Except carry the enclosing recursive
type, while a complete custom inductive or structure establishes its own owner.
That context is independent of the constructor's compiled field layout.

## Required laws

For every supported finite value of a declared Lean type, decoding its encoded
value must preserve the constructor and field values. For every accepted encoded
input, decoding and encoding again must produce the canonical representation.
These are structural value laws; reference identity and arbitrary function
materialization need their own contracts.

The compiler owns declaration names, JavaScript constructor names, ordinals,
field types and layouts. Manifest admission establishes descriptor consistency.
The codec reuses those facts and carries recursive context explicitly. It does
not choose a nullable representation based on the surrounding type or payload.

## Proposed first boundary

Use explicitly invoked, concrete Lean converters between JSON text and a typed
opaque `JSL` value. Applications can transform that value in Lean and invoke
the encoder when they want JSON. Thin opted-in wrappers or generated entrypoints
can use the existing call, error and reference machinery. This avoids requiring
general structural materialization to hold or operate on application state.

The exact `Js` boundary, opaque `JSL` values and callbacks remain independently
usable. The managed core stays independent of optional conversion. A codec
registry, generated JavaScript wrapper per type or another runtime entry is not
required by this proposal.

## Candidate JSON representations

These encodings are proposals to review before implementation:

| Type | Candidate representation | Requirement |
| --- | --- | --- |
| `Option α` | `{ "kind": "none" }` or `{ "kind": "some", "value": ... }` | Preserve presence for every element codec |
| `Unit` | `null` | Preserve `some ()` as `{ "kind": "some", "value": null }` |
| Lean integers | Decimal strings | Preserve arbitrary precision without JavaScript-number coercion |
| Bytes | Array of integers in `0..255` | Explicitly define order and valid elements |
| Custom constructors | Explicit constructor and payload fields | Preserve zero/one/many fields and compiler-owned names |

For example, nested `some none` would encode as
`{ "kind": "some", "value": { "kind": "none" } }`, distinct from outer
`none`. Unit can use null because the Option tag preserves the outer constructor.
Standard derivation must be checked against these laws rather than assumed
lossless: an existing nullable Option encoder cannot supply this distinction.

JSON text and JavaScript-value conversion are separate contracts. Plain
`JSON.stringify` rejects bigint and drops undefined object fields. A future
JavaScript-value codec need not use the JSON integer or unit spelling. Float
support must explicitly address nonfinite values and negative zero; unsupported
domains, cycles, indexed types and functions need clear limitations.

## Qualification and migration

Use compiler-produced types, public calls and independent Lean-side observations
of constructors and fields. Include nested options, Option Unit, options inside
products/lists/records, recursive mixed containers, zero/one/many-field
constructors, large integers and the selected byte/float rules. Check lowering,
direct Lean-produced results, ordinary conversion failure and subsequent reuse.

First agree on the initial domain, converter surface and canonical encodings with
a concrete caller. Then qualify the generated implementation and its normal
matching-asset distribution. Any replacement of the automatic nullable mapping
is a separate API change that removes the retired representation under the
[API change policy](../../CONTRIBUTING.md#api-changes).

This proposal follows the constructor/codec review of PR221 and the recursive
context repair in PR224. The current [JavaScript API](../guides/JS_API.md#calls-and-manifest)
and [boundary representation guide](../guides/LEAN_VIR_LIBRARY.md#choose-a-boundary-representation)
describe implemented behavior; this document does not extend that support scope.
