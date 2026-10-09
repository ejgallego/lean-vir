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
| Export | `id`, `jsName`, display/call alias `entry`, structural `nameKey`, diagnostic `source`, `args`, descriptor `result`, `effect`, Boolean `startup`. Each argument is `{ name, type: <descriptor> }`. |
| Host import | `slot`, display `name`, structural `nameKey`, `source`, JS `target`, `boundary`, generated Wasm `symbol`, IR `arity`, `erasedPrefixArgs`, `args`, descriptor `result`, `effect`. |
| Diagnostic | `name`, `source`, `reason`. |

The current manifest version is 10 and every generated package must use it.
Every export carries an explicit Boolean `startup` field. Volatile generation
time is omitted from embedded metadata; only the adjacent Markdown report
records wall-clock generation time.

Version 10 retires the dedicated List/Option/Prod tags. Option and List use
compiler-derived generic constructor layouts, Prod uses a generic structure
layout, and `recursiveRef` carries a lexical `depth` through complete aggregate
scopes. The JS codec resolves these bindings once, including through nested
containers. Version 9 added `nameKey` to exports and host imports. It is the machine identity
compared with the independently decoded binary Name; `entry`, `id`, `jsName`
and host `name` remain display/call aliases. Changing an alias does not change
the declaration that executes. The runtime independently checks arity, effect,
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
These checks deliberately do not parse display aliases.

Manifest 10 is the only supported schema. The current SDK contract is runtime
ABI 4 with package format 11, so regenerate `.irpkg` members and descriptors
with the manifest-10 generator and install the matching JavaScript and Wasm SDK
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

The table below specifies accepted descriptor shapes, including those used by
experimental automatic conversion of records and custom inductives. Official
support follows the [support scope](../SUPPORT.md); accepting a descriptor does
not extend that promise.

Every descriptor has `type` (the applied Lean type label) and `interfaceTag`.
Compound descriptors also have the `kind` and payload below. The numeric tags
are package ABI, owned by
[`Interface.Encode`](../../Vir/Compiler/Interface/Encode.lean) and checked
against [`interface-tags.js`](../../web/src/runtime/interface-tags.js) by
`npm run check:package-abi`. JS constant names in this table have the prefix
`INTERFACE_TAG.`; unlisted tags are unsupported.

| Tag | JS constant | Lean type / kind | Payload beyond `type` and `interfaceTag` |
| ---: | --- | --- | --- |
| 0 | `NAT` | `Nat` | None. |
| 1 | `INT` | `Int` | None. |
| 2 | `BOOL` | `Bool` | None. |
| 3 | `STRING` | `String` | None. |
| 4 | `UINT8` | `UInt8` | None. |
| 5 | `UINT16` | `UInt16` | None. |
| 6 | `UINT32` | `UInt32` | None. |
| 7 | `UINT64` | `UInt64` | None. |
| 8 | `USIZE` | `USize` | None. |
| 9 | `BYTE_ARRAY` | `ByteArray` | None. |
| 10 | `FLOAT` | `Float` | None. |
| 11 | `FLOAT32` | `Float32` | None. |
| 14 | `SIMPLE_ENUM` | Nullary enum / `simpleEnum` | `constructors: [{ name, jsName, tag }]`. |
| 15 | `EXPR` | `Lean.Expr` | None; caller value is a structural expression object. |
| 16 | `ARRAY` | `Array α` / `array` | `element` descriptor. |
| 20 | `STRUCTURE` | Structure / `structure` | `name`, layout counts, `fields`, optional `trivialFieldIndex`. |
| 21 | `TAGGED_UNION` | `Sum` / `Except` / `taggedUnion` | `name`, `constructors` with payload descriptor and layout. |
| 22 | `UNIT` | `Unit` | None. |
| 23 | `RESOURCE` | Opaque JS resource / `resource` | Resource `name`. |
| 24 | `FUNCTION` | Callback / `function` | `args: [{ name, type }]`, descriptor `result`, `effect`. |
| 25 | `CUSTOM_INDUCTIVE` | Non-indexed inductive / `customInductive` | `name`, `constructors` with field descriptors/layouts. |
| 26 | `RECURSIVE_REF` | Lexical recursive reference / `recursiveRef` | Referenced owner `name` and nonnegative `depth` (0 is the innermost aggregate). |
| 27 | `LEAN_OBJECT` | Retained Lean object / `leanObject` | No additional payload. |

### Constructor and field layouts

Layout counts are `objectFieldCount`, `usizeFieldCount` and `scalarByteSize`.
Each field has `name`, descriptor `type` and one `layout` record:

```text
{ kind: "object", index }
{ kind: "usize", index }
{ kind: "scalar", size, offset }
```

Structure fields may also have `subobject: true` for inherited parents.
Parent fields remain explicit subobjects in the descriptor so layout matches
Lean, while callers use flattened object keys. `trivialFieldIndex` represents
a one-runtime-field wrapper, including direct scalar wrappers, without changing
its JavaScript object shape.

Tagged-union constructor records have `name`, `jsName`, `tag`, payload `type`,
`layout` and all three layout counts. Custom-inductive constructor records have
`name`, `jsName`, `tag`, all three counts and a `fields` array. Constructor tags
are their array indices. This metadata places direct scalar payloads in the
same constructor slots compiled Lean expects.

Structures may be non-indexed parameterized instances with supported fields,
including direct scalars, enums and inherited parents. Direct recursive
structures are supported; recursive inherited structures are not. Non-indexed
custom inductives may have nullary or runtime-payload constructors and direct
recursive references through supported containers. Constructor fields of type
`optParam α default` are described as `α` and remain explicit fields when
stored by the runtime layout. Reducible aliases are accepted when they expose
a supported outer type shape.

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

Before exposing entries, JavaScript validates export argument/result trees,
host descriptors and metadata. It rejects unsupported tags, malformed recursive
children, invalid enum constructors, inconsistent field layouts, invalid
`trivialFieldIndex` and duplicate export names. Generation additionally rejects
cross-target declaration collisions and duplicate export ids/JS names.

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
