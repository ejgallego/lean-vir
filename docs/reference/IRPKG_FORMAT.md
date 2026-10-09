# IR Package Format

`.irpkg` files are the local binary packages loaded by the WASM shim. The
format is internal to this repository. This reference owns the binary envelope,
embedded manifest and package-set descriptor. [Packages](../guides/PACKAGES.md) explains
generation and loading; [JS_API.md](../guides/JS_API.md#calls-and-manifest) owns caller
value shapes and [OBJECT_ABI.md](OBJECT_ABI.md) owns pointer layout/ownership.
The binary header is authoritative for the package format version; embedded
`metadata.packageFormatVersion` must match it.

## Package-set descriptor

A composable module build does not introduce another binary format. Its
`lean-vir-ir-package-set` version-2 JSON descriptor lists dependency `.irpkg`
members in the dependency-first order reconstructed from Lean's loaded module
graphs and the public root member last. Every listed member independently owns
its declarations and initializer metadata and uses the format documented
below; the root's embedded interface manifest is the public manifest for the
aggregate runtime.

The version-2 descriptor has this shape:

```json
{
  "format": "lean-vir-ir-package-set",
  "version": 2,
  "packages": [
    {
      "module": "MySlides.Support",
      "role": "dependency",
      "path": "Runtime.parts/0.irpkg",
      "byteLength": 12345,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    {
      "module": "MySlides.Runtime",
      "role": "root",
      "path": "Runtime.irpkg",
      "byteLength": 67890,
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    }
  ]
}
```

`packages` must be non-empty. Every entry has a non-empty, unique `module` and
`path`; every entry except the last has role `dependency`, and the last has
role `root`. Each positive `byteLength` and lowercase `sha256` binds that entry
to its exact package bytes. Paths are normalized, same-directory-relative
paths: absolute URLs, parent traversal, query strings, fragments, backslashes,
and percent escapes are rejected. The loader validates the complete structure
before fetching members, then verifies every length and digest before loading
the set. Before Wasm instantiation, it also parses each member and requires the
embedded `metadata.packageSetMember` module and role to match the corresponding
descriptor entry. Raw byte-array loads enforce the same embedded identity and
dependency-first/root-last order.

JavaScript treats `module` as an opaque identity emitted by Lean's
`Name.toString`; it does not attempt to duplicate Lean's Unicode and quoted-name
parser. Module identities are never converted into package paths.

Dependency shard filenames are ordinal identities (`0.irpkg`, `1.irpkg`, ...),
while the descriptor carries the Lean module identity. This keeps filesystem
escaping out of module names and makes bytes reproducible across checkout
locations. Each member manifest also records `metadata.packageSetMember` with
its module and `dependency` or `root` role. Dependency members have no public
targets. A compiled-module root has the stable target `{ "module": ..., "mode":
"markedModule" }`. Other compiled-module target modes are rejected for these
roots. Live snapshot roots use `marked` with document provenance; neither path
supports a source-loader fallback. All members in a set must record the same
package/manifest versions and exact Lean version, toolchain, and git hash.

See [Packages](../guides/PACKAGES.md#build-a-module-package-set) for producing/publishing
a module set and [the JavaScript API](../guides/JS_API.md#module-package-sets) for loading
one.

Package format 11 has a fixed header followed by a section directory. All
multi-byte integers are unsigned little-endian 32-bit values.

## Header

| Field             | Encoding | Meaning                                                    |
| ----------------- | -------- | ---------------------------------------------------------- |
| magic             | string   | Must be `lean-vir-ir-package`.                             |
| package format    | u32      | Currently `11`.                                            |
| declaration count | u32      | Number of declaration entries in the declarations section. |
| section count     | u32      | Number of section directory entries.                       |

Strings are encoded as `u32 byteLength` followed by UTF-8 bytes. They are
length-delimited rather than NUL-terminated, so embedded zero bytes are
preserved.

## Section Directory

Each section directory entry is:

| Field       | Encoding | Meaning                                             |
| ----------- | -------- | --------------------------------------------------- |
| kind        | u32      | Stable section kind.                                |
| offset      | u32      | Absolute byte offset from the start of the package. |
| byte length | u32      | Payload byte length.                                |

The loader requires exactly one of each current section kind:

| Kind | Name                | Payload                                                             |
| ---: | ------------------- | ------------------------------------------------------------------- |
|    1 | `declarations`      | Encoded Lean IR declaration entries. The count lives in the header. |
|    2 | `initGlobals`       | Encoded array of initializer global mappings.                       |
|    3 | `hostImports`       | Encoded array of package-owned host import metadata.                |
|    4 | `exportSummaries`   | Encoded array of direct export call summaries.                      |
|    5 | `interfaceManifest` | FNV-1a-64 checksum followed by the encoded JSON interface manifest. |

The manifest payload starts with the checksum's low and high halves as two
little-endian `u32` values, followed by the usual length-prefixed UTF-8 string.
The checksum covers that string's exact UTF-8 bytes.

The directory requires known, unique section kinds whose bounded,
non-overlapping payloads begin after the complete header and directory.
Each section decoder also rejects trailing bytes. The runtime separately validates
the manifest checksum, embedded schema, and package-set identities. The checksum
detects corruption of the manifest bytes, not agreement with other sections;
it is not an authenticity boundary because an IR package already contains
executable code.

## Manifest and binary agreement

The export-summary array order is the structural call identity used by
`vir_resolve_call_export`. JavaScript resolves all public keys for a manifest
export to that export's array index, so escaped dots and string-versus-numeric
name components are never recovered by parsing `Name.toString` output. The
runtime also calls `vir_validate_package_contract` between prepare and finish:
one transient binary projection of the validated manifest is compared with the
decoded call tables. It checks ordered export names, argument counts, IO and
boxed-boundary flags, and ordered host-import names, targets, symbols, arities,
erased-prefix counts and IO flags. Manifest 10 compares canonical structural
name keys. The current loader does not accept older manifest schemas or
display-name fallback contracts.
The contract compares structural keys rather than reparsing display names.
Recomputing a manifest checksum
cannot bypass this comparison. Detailed interface types and effect labels are
not independently stored in those tables and remain producer-owned metadata;
this check does not authenticate a package or prove its IR implements its types.

## IR tags and decoded ownership

Decoded Lean objects are runtime-owned, not views into the package bytes.
Package IR constructor helpers consume owned child references, and the decoded
package owner releases the complete graph both when a later section fails and
when the package state is cleared.

Package `Name` tags and IR declaration payload tag values live in
`Vir/Package/IRTags.lean`. The mapping in
`scripts/native/ir-codec-tags.mjs` generates
`build/generated/wasm/package/package_ir_tags.h`. Name encoding is shared by the
declaration, initializer-global, host-import, and export-summary sections; the
other generated tag groups are specific to IR declarations.

These assignments are part of the format-11 wire contract; incompatible changes
require a new `packageFormatVersion`. IR type tags `10` and `11` remain reserved
for unsupported `Lean.IR.IRType.struct` and `Lean.IR.IRType.union` cases.
After editing the Lean constants or enum mapping, run `npm run generate:ir-codec-tags`, then
`npm run check:ir-codec-tags`.

Shared tags do not eliminate field-order or object-layout coupling: the Lean
encoder and native decoder must agree on both. The decoder's constructors and
reference-counting behavior must also match the pinned upstream IR layouts.

## Embedded manifest

The generator embeds the recursive interface type tree in section 5. Its
[`Manifest.Encode`](../../Vir/GeneratePackage/Manifest/Encode.lean) encoder emits:

| Record | Fields |
| --- | --- |
| Manifest | `version`, `artifact: "lean-vir-ir-package"`, `metadata`, `exports`, `hostImports`, `diagnostics`. |
| Metadata | `generator`, `packageFormatVersion`, `manifestVersion`, `leanVersion`, `leanToolchain`, `leanGithash`, `targets`, optional `packageSetMember: { module, role }`. |
| Target | Exactly one origin field: compiled `module` or live-snapshot `source`; plus `mode`, `roots`, `resolvedRoots`. Source is document provenance, not a source-loading request. |
| Export | full Lean call key `entry`, structural `nameKey`, diagnostic `source`, `args`, result pair, `effect`, Boolean `startup`. Each argument is `{ name, type: <BoundaryInterface> }`. |
| Host import | `slot`, display `name`, structural `nameKey`, `source`, JS `target`, `boundary`, generated Wasm `symbol`, IR `arity`, `erasedPrefixArgs`, named arguments with `BoundaryInterface` pairs, result pair, `effect`. |
| Diagnostic | `name`, `source`, `reason`. |

The current manifest version is 12 and every generated package must use it.
Every export carries an explicit Boolean `startup` field. Volatile generation
time is omitted from embedded metadata; only the adjacent Markdown report
records wall-clock generation time.

Version 11 retires export `id`, export `jsName`, and the `exportsByName` runtime
facade. Each full Lean `entry` is the sole public call key; provider identifiers
retain their meanings. Manifest 12 places constructor spellings in the selected
value interface rather than on native constructor metadata.

Version 10 retired the dedicated numeric List/Option/Prod categories. Option
and List use compiler-derived generic constructor layouts, Prod uses a generic
structure layout, and `{ ref: depth }` carries a lexical reference through
aggregate scopes. Version 12 represents native layout and selected JavaScript
mapping as a `{ native, value }` pair. Version 9 added `nameKey` to exports and
host imports. It is the machine identity
compared with the independently decoded binary Name. The full Lean `entry`
selects the public callable; native dispatch uses its structural identity.
Host import `name` is diagnostic display text. The runtime independently checks arity, effect,
boxed-boundary requirements and host target/symbol metadata as before.

`Vir.nameKey` defines root-to-leaf component encoding: a string component is
`s` followed by lowercase hexadecimal UTF-8 bytes and `/`; a numeral component
is `n` followed by canonical decimal digits and `/`. Anonymous is the empty key;
an empty string component is `s/`. Thus string `"1"` (`s31/`) and numeral `1`
(`n1/`) differ, as do a dotted component and multiple components. The key itself
does not narrow numerals; format 11 still rejects Name numerals above u32 when
emitting their binary representation. Native registry lookup uses the same key.

JavaScript validates the key grammar and UTF-8 before it sends the contract to
Wasm. The pinned Wasm decoder derives the canonical key from its decoded Lean
`Name`; the contract succeeds only when those structural identities agree.
These checks use structural keys rather than parsing display names.

Manifest 12 is the only supported schema. The current SDK contract is runtime
ABI 4 with package format 11, so regenerate `.irpkg` members and descriptors
with the manifest-12 generator and install the matching JavaScript and Wasm SDK
artifacts together when the generator or runtime revision changes.

The modes are `explicit`, `packageOnly`, `all`, `marked` and `markedModule`.
`explicit`/`packageOnly` require nonempty `roots`; other modes require `[]`.
`roots` and `resolvedRoots` contain unique normalized names. Compiled marked
selection uses `markedModule` and requires `module`; live marked selection
uses `marked` with `source`. These are the only accepted target spellings.

`effect` is one of `pure`, `runtime`, `io`, `dom` or `react`, preserving
source-level classification for tooling. Binary export/host summaries carry
only pure versus effectful. These are synchronous effects (`RuntimeM`, `IO`,
`DomM`, `ReactM`), not an asynchronous interpreter protocol.

Host slots are zero-based array indices; an assembled package set supports at
most 128 host imports with IR arity at most 6. The producer owns both limits in
`Vir/GeneratePackage/Basic.lean`; the Wasm build generates the C++ constants from
those definitions. Preparation checks the aggregate slot count and each import's
arity and erased/world counts before initializers can run. Nullary pure host
imports are rejected because upstream treats native constants as storage, not
functions; use an explicit `Unit` argument or an effectful result. IR arity includes
leading erased type/proof arguments and the final world argument for effectful
imports. `erasedPrefixArgs` records the leading erased arguments, skipped before
JavaScript-visible arguments (supported since package format 6). Boundary labels are:

| Boundary | Accepted interface |
| --- | --- |
| `hostResource` | `Unit`, `Js`/nullable resources and callbacks whose own arguments/results are `Unit` or resources. Raw Lean scalars and structural containers are rejected. |
| `explicitConversion` | A named `@[vir_js_explicit_conversion]` operation between exactly one `Js` resource and one ordinary supported Lean value. |
| `objectHandle` | The `js.leanRef` / `js.leanRef.value` boundary for opaque retained Lean objects. |

Host attributes and generation share typed signature/boundary validation;
generation adds package-only arity and slot checks. See
[the generator](GENERATE_PACKAGE.md#shared-interface-analysis) for that split
and [host bindings](HOST_BINDINGS.md) for authoring and lifetime rules.

## Interface descriptors

Manifest 12 represents each exported or imported argument and result as one
`{ native, value }` pair. An argument retains its parameter name as
`{ name, type: <pair> }`; an entry result is the pair directly. The compiler
derives native representation facts and a default JavaScript mapping together.
Native field types and storage live in compiler metadata. The value interface
selects a JavaScript representation and refers to those fields without
duplicating their types or physical layout.

This reference specifies admitted shapes, including metadata used by the
experimental structural converter. Official support follows the
[support scope](../SUPPORT.md); accepting a descriptor does not extend that
promise. Pair validation happens at manifest admission. Optional conversion
binds admitted pairs into cached codecs; ordinary calls and opaque reference
passage do not require structural conversion.

```text
BoundaryInterface = { native: DescriptorRef, value: ValueInterface }
DescriptorRef     = NativeDescriptor | { ref: depth }
NativeDescriptor  = { type: NativeType, metadata?: CompilerMetadata }
```

`depth` is a nonnegative lexical reference into enclosing constructor metadata.
It is not a native type, JavaScript value or declaration-name lookup. Recursive
value positions use `{ tag: "recursive" }` and bind to the corresponding
native reference.

### Native types and compiler metadata

`native.type` selects a core operation and ownership class. It does not have
separate categories for records, arrays, enums, products, options, lists,
tagged unions, functions or expressions; those are Lean objects with compiler
facts where an optional codec needs them.

| Native type tag | Additional type field | Meaning |
| --- | --- | --- |
| `nat`, `int`, `string`, `byteArray` | — | Existing native integer, text and byte operations. |
| `unsigned` | `width`: `8`, `16`, `32`, `64`, or `"usize"` | Native unsigned integer operation. |
| `float` | `width`: `32` or `64` | Native floating-point operation. |
| `leanObject` | — | Lean-owned object; layout metadata is optional. |
| `resource` | — | JavaScript-rooted resource with its distinct release policy. |

Compiler metadata is optional. `declaration` identifies or labels the Lean
type; `constructors` describes object layouts; `arrayElement` identifies a
compiler-confirmed native Lean array element; and `signature` describes a
callable. A signature contains native `args`, native `result` and `effect`.
Native fields and signature positions hold `DescriptorRef` values, not
JavaScript mappings.

### Constructor and field layouts

Each constructor's array position is its runtime ordinal. A constructor record
does not duplicate an ordinal or a JavaScript spelling:

| Representation | Fields | Additional data |
| --- | --- | --- |
| `immediate` | Empty array | No runtime fields; the table position is the ordinal. |
| `object` | Stored fields | `storage` counts and each field's `location`. |
| `identity` | One native field | Compiler-confirmed one-field wrapper without object-layout counts. |

`storage` contains `objectFieldCount`, `usizeFieldCount` and `scalarByteSize`.
Native fields contain `name` and `type: DescriptorRef`; stored fields also
contain a physical location:

```text
{ tag: "object", index }
{ tag: "usize", index }
{ tag: "scalar", size, offset }
```

The `index` addresses the corresponding object or usize buffer. Scalar `size`
and `offset` locate bytes within the constructor's scalar storage. These are
compiler-owned facts; consumers do not reconstruct allocation sizes from the
subset or order of visible fields. A structure's inherited parent stays a
native field with its own type, storage and location. The selected value
interface can expose inherited members as flattened JavaScript keys using
logical field paths.

### Value interfaces

`value.tag` selects the JavaScript representation. Constructor spellings and
field keys live here, not on the native constructor table. A native descriptor
can be paired with another explicit mapping, but a particular pair admits only
its selected spelling and shape.

| Value tag | Selected JavaScript shape |
| --- | --- |
| `bigint`, `number`, `safeInteger` | BigInt, Number, or a checked safe-integer Number mapping. |
| `string`, `bytes`, `unit` | String, `Uint8Array`, or the unit mapping (`undefined`). |
| `boolean` | `false` and `true` constructor ordinals. |
| `enum` | `cases` string spellings in native constructor order. |
| `record` | `fields: [{ key, path, value }]` mappings into one native constructor. |
| `variant` | `cases: [{ kind, payload, ... }]` spellings and constructor payload mappings. |
| `sequence` | An element mapping and optional linked `chain`; arrays and linked lists lift to JavaScript arrays. |
| `recursive` | Reuse the mapping bound to the referenced native descriptor. |
| `jsReference`, `leanReference` | Exact JavaScript resource and opaque Lean-object views. |
| `function` | Per-argument mappings and a result mapping, paired with native signature metadata. |
| `expr` | The explicit structural `Lean.Expr` representation. |

A record or named variant field mapping has a JavaScript `key`, a logical
`path`, and a nested `value` interface. Path components index declaration-order
native fields. A path can cross inherited parent fields; these logical indices
are independent of the physical `location.index` values used to access Lean
storage. Value mappings refer to the native fields without copying their types
or layouts.

Each `variant.cases` entry aligns by position with one native constructor and
contains a JavaScript `kind` plus one payload form: `none`, `value`, or named
`fields`. Enum `cases` similarly align by position with immediate constructors.
There is no second numeric `tag` field in either table: the array position is
the native ordinal, while `kind` or the enum string is the selected JS spelling.

`sequence` maps a dense JavaScript array. For a native Array, `metadata.arrayElement`
supplies its element descriptor. A linked traversal instead selects `nil`,
`cons`, `head` and `tail` positions through its `chain`; the codec reads their
physical layout from native metadata. The native type remains `leanObject` in
both cases. Callback `signature.args` and `signature.result` are native
descriptor references with an effect label. A `function` value interface
separately selects each argument and result mapping.

For example, the native layout and the JS view for an Option-like type are
separate parts of the same pair:

```json
{
  "native": {
    "type": { "tag": "leanObject" },
    "metadata": {
      "declaration": "Option",
      "constructors": [
        { "name": "Option.none", "representation": "immediate", "fields": [] },
        {
          "name": "Option.some",
          "representation": "object",
          "storage": { "objectFieldCount": 1, "usizeFieldCount": 0, "scalarByteSize": 0 },
          "fields": [
            {
              "name": "val",
              "type": { "type": { "tag": "nat" } },
              "location": { "tag": "object", "index": 0 }
            }
          ]
        }
      ]
    }
  },
  "value": {
    "tag": "variant",
    "cases": [
      { "kind": "none", "payload": "none" },
      { "kind": "some", "payload": "value", "value": { "tag": "bigint" } }
    ]
  }
}
```

Constructor positions supply ordinals; the `kind` strings provide the JS
spellings. The selected tagged Option mapping preserves `none`, `some none`
and `some ()` as distinct values. See the
[JavaScript value reference](../guides/JS_API.md#calls-and-manifest) for
application-facing shapes.

Top-level `Float`, `Float32`, `UInt64` and trivial wrappers over them require a
compiler-generated `_boxed` declaration for wasm32 calls. Generation includes
that companion or fails with an explicit diagnostic; it does not emit a partial
package. `Nat`, `Int`, and `UInt64` results use bigint at the JS boundary, while
wasm32 `USize` results use Number;
the [JS value reference](../guides/JS_API.md#calls-and-manifest) owns concrete shapes.

### Resources and callbacks

`Lean.Vir.Js α` always uses the generic `Js` resource descriptor: `α` is a
Lean-side phantom and the value stays in the JavaScript externref lane.
Resource-specific protocols belong to the Lean API and host bindings, not this
descriptor. Naked markers such as `Lean.Vir.Browser.Element` are unsupported;
they cross as `Js α`. React nodes likewise remain exact native JS values under
`Js`, with no private React tree protocol.

`leanObject` serves `Lean.Vir.LeanRef.toJSL` / `fromJSL`. Its `JSL α` handle
retains an opaque Lean value and stays distinct from JavaScript-shaped `Js α`.
Function descriptors are accepted only as host-import arguments. Their own
arguments/results must be `Unit` or resources; nested callbacks are rejected.
The JS function has no serialized numeric identity in its descriptor: the shim
roots its closure with arity/effect metadata and JS keeps the full descriptor
in private state. Pointer calls and callback rooting are specified in
[OBJECT_ABI.md](OBJECT_ABI.md) and
[UPSTREAM_BOUNDARY.md](UPSTREAM_BOUNDARY.md#host-imports-and-reentrant-callbacks).

## Validation and trust limits

The [supported-input review assumptions](../development/REVIEW_ASSUMPTIONS.md)
apply: cooperative users/developers and trusted generated packages. Unsupported
artifact manipulation has undefined behavior, not a promised rejection contract.

Before exposing entries, JavaScript validates export argument/result pairs,
host pairs and metadata. It rejects incompatible native/value mappings,
malformed recursive references, invalid constructor and field mappings,
inconsistent storage descriptions, and duplicate export names. Generation
additionally rejects cross-target declaration collisions; selecting the same
export through multiple targets is deduplicated by its Lean declaration name.

The mandatory [manifest/binary comparison](#manifest-and-binary-agreement)
already rejects disagreements in ordered export and host-call metadata at load
time. It does not prove detailed descriptor layouts or actual Lean declarations
implement the declared types. Package-owned call summaries validate argument
counts, effects and boxed-boundary requirements; full lowering/lifting metadata
remains producer-owned.

Packages remain trusted executable artifacts. Checksums detect corruption and
the Wasm sandbox prevents native memory escape, but neither authenticates a
package or makes arbitrary remote packages safe. Hostile or malformed packages
can trap the interpreter, exhaust CPU/Wasm memory, make a tab unresponsive or
provide metadata inconsistent with actual IR layouts. Independent Wasm-side
layout validation and general size/depth/execution limits are not provided.

The current artifact is core `wasm32-wasip1` with embedded JSON and the owned
object-pointer `vir_call_resolved_objects` ABI. The descriptor-bearing named
call and resolved value-byte lanes are removed. The checked-in
[WIT interface](../../interfaces/lean-vir.wit) is a proposed byte-payload interface,
not this ABI or an implemented component-model boundary.

## Inspecting

Follow [package inspection](../guides/PACKAGES.md#inspect-a-package). Text output prints
byte length, format, declaration count and section directory before the manifest
summary. JSON exposes section data under `package.sections`, with each section's
`kind`, `name`, `offset` and `byteLength`.
