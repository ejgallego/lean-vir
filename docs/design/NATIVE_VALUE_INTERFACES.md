# Native descriptors and JavaScript value interfaces

The [manifest format reference](../reference/IRPKG_FORMAT.md#interface-descriptors)
is authoritative for the current encoding and admission constraints. Its
[typed grammar](native-value-interfaces.ts) provides the compact field definitions.
This document explains the design choices; it is not another specification or a
public API for handwriting descriptors or replacing their value mappings.

## Compiler facts and value representations

The compiler emits a complete `{ native, value }` pair. Native facts identify the
primitive operation, Lean-object storage or resource ownership boundary, with
constructor order, physical layouts, array elements or callable signatures where
needed. The value interface describes JavaScript shape and spelling using logical
field paths. It contains no second copy of field types or physical locations.

The runtime binds admitted pairs into cached codecs. Core scalar operations and
opaque reference passage remain available in the managed composition; structural
materialization belongs to optional object conversion. The public runtime consumes
the producer's emitted pair. `callWith` explicitly selects ordinary JavaScript
values or the fixed [JSON-safe representation](JSON_SAFE_VALUE_CODEC.md), reusing
that pair's constructor mappings and storage facts.

This split lets Option, Prod, Sum, Except, records and user-defined inductives use
one constructor kernel. Native arrays keep their efficient allocation/indexing
operations. Lists use compiler-owned constructors with an iterative sequence
codec. These are traversal choices over native facts, not additional native tags.

## Tagged Option

Every Option uses `{ kind: "none" }` or `{ kind: "some", value }`. This preserves
`none`, `some none`, and `some ()` without type-dependent nullable shorthand.
`Js.Nullable` and `Js.UndefinedOr` retain exact JavaScript resource values.

Default integer outputs use BigInt for Nat, Int and UInt64; JSON-safe outputs
use canonical decimal Strings. Default input conversion accepts safe integer
Numbers and decimal Strings; there is no separate Number-result adapter for unbounded integers. Concrete input
and output rules belong to the [JS API](../guides/JS_API.md#calls-and-manifest).

## Recursion and local sharing

Every constructor table binds a lexical scope. A native `{ ref: depth }` identifies
an enclosing constructor description; the paired recursive view reuses its codec.
Arrays are transparent to those scopes, and callable positions start closed roots.
For example, `Tree -> Option Tree -> Tree` refers to depth 1; a List tail refers to
its own description at depth 0. Complete recursive callback signatures are allowed;
a reference to the enclosing aggregate cannot escape into a callback.

Package-local manifest indices have a separate purpose: sharing complete closed
native/value pairs. Nested open fragments are not interned. Admission resolves
indices to shared immutable objects, without a global registry or a linking pass.
Bound codecs and callback signature plans remain runtime-local.

Sharing compares complete conversion encodings: instantiated fields, layouts,
nominal metadata and value mappings. Equal encodings establish boundary-contract
agreement, not general Lean type equality. Erased or phantom parameters may leave
identical facts. Compiler recursion analysis instead uses the fully applied Lean
expression with structural parameter/universe identity. Finite descent can follow
supported aliases without weakening that identity rule.

This format needs no provisional compiler shape IDs. A future compiler shape API
can supply storage facts through the producer boundary, while nominal policies
and JavaScript mappings remain explicit. Mutual families and independently opaque
recursive-child views remain separate design questions with concrete caller needs.

## Admission, capability and ownership

Manifest admission establishes the grammar, physical layouts, lexical scopes and
native/view mapping consistency. Binding consumes those immutable facts; it does
not repeat descriptor validation. A physically valid layout can still require a
conversion the optional codec does not support, such as flattened mappings
that cross packed identity-wrapper storage. Capability checks preserve that distinction and allow
supported sibling exports to remain callable.

Conversion checks actual values, payloads, numeric ranges, returned discriminants,
native operation failures and live handles. Constructor creation transfers owned
fields on success; failed lowering releases partial values. Inspection releases
acquired children after use. Scratch buffers belong to one lowering operation and
refresh their memory views after allocation or growth. Callback codec reuse does
not merge the ownership of independent closure handles.

Generic structural conversion preserves constructor/field distinctions within
its supported domain. It materializes finite values and does not promise cycle
handling, graph-identity preservation or arbitrary-depth stack safety. The
specialized Expr view has separate metadata/Name restrictions; it is not a
lossless codec for every Lean.Expr.

The [format reference](../reference/IRPKG_FORMAT.md#validation-and-trust-limits)
states what inventory integrity, native call-table comparison and independent
consumer expectations establish. These checks do not prove executable semantics;
real Lean observations and boundary tests provide program-specific evidence.

## Application codecs and measured costs

Applications choose whether to materialize Lean state, retain opaque JSL values,
or pass exact JS resources. A native descriptor does not imply automatic JSON
conversion. Explicit application codecs own persistence/wire mappings, defaults,
custom leaves and error rules; those semantics cannot be inferred from layouts.
Closed typed library rules supply private construction operations through the
existing call ABI. The library owns the rule's semantic invariants and inverse
laws; helper type checks do not establish those properties.

[Native codec measurements](../../benchmarks/NATIVE_CODECS.md) retain the methodology,
cost model and experiment evidence. Raw manifest reduction, compressed transfer,
bundle size and complete encode/call/decode latency are different measurements.
The next performance decision should use a representative consumer's full operation
with matched runtime/program inputs and independent semantic checks.
