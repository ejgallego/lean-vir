# Interface Pipeline

This document owns package config shape, generated manifest semantics, and the
current interface surface. Command selection and CI shape live in
`docs/HARNESS.md`; architecture status lives in `docs/IMPLEMENTATION_NOTES.md`;
the split package generator internals live in `docs/GENERATE_PACKAGE.md`.

The developer path is package-driven:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

That command:

1. elaborates the configured Lean source with Lean 4.32.0;
2. extracts the requested IR declaration closure into an `.irpkg`;
3. embeds a generated JavaScript interface manifest, JavaScript host import
   table, and package metadata in the package;
4. writes the package report next to the generated artifact.

The generated `.irpkg` is the only browser artifact needed by `/dev.html`.
After the package is loaded, the runner reads the embedded manifest and creates
the UI entries automatically. The manifest metadata records the package format,
Lean toolchain, generation time, source targets, and resolved roots.

`web/public/*.irpkg` files are generated local assets and are ignored by git.
Pass multiple config files to reuse the same prepared `vir_irpkg` generator:

```bash
npm run prepare:irpkg -- examples/quickstart.virpkg.json examples/fib.virpkg.json
```

## Pages Landing

The CI Pages build runs:

```bash
npm run build:site
```

That script first builds the upstream WASM demo, then runs `npm run
prepare:pages` to generate URL-loadable sample packages in one generator
session:

- `local-fib.irpkg`
- `local-quickstart.irpkg`
- `local-mergesort.irpkg`

Vite copies those generated packages into `web/dist/` alongside `index.html`,
`dev.html`, and the `format.html` pretty-printer workbench. The landing page
links directly to `/dev.html` with query parameters such as:

```text
dev.html?package=local-fib.irpkg&entry=fib
```

The package runner accepts `package` and `entry` query parameters. `entry` may
be a manifest `id`, `jsName`, or Lean declaration name.

## Config Shape

```json
{
  "version": 1,
  "source": "examples/Fib.lean",
  "package": "web/public/local-fib.irpkg",
  "report": "build/generated/local-fib.report.md",
  "roots": ["fib"]
}
```

If `roots` is omitted or empty, `prepare:irpkg` uses `--target-all`, packages
the declarations emitted by the source, and treats public source definitions as
interface exports. Unsupported public exports fail loudly with diagnostics in
the report. Explicit roots are preferred for stable demos and size-sensitive
experiments.

For ad hoc local files, use the direct CLI:

```bash
npm run generate:irpkg -- <source.lean> [package.irpkg] [root ...]
```

It prints the same metadata that is embedded in the package.

To inspect a generated package without starting the browser, run:

```bash
npm run inspect:irpkg -- <package.irpkg>
```

Add `--json` to emit the parsed package header and full embedded manifest.

## Interface Value Codec Surface

The embedded manifest currently supports:

- `Unit`;
- scalar values: `Nat`, `Int`, `Bool`, `String`, `Float`, `Float32`;
- fixed-width values: `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- byte data: `ByteArray`;
- recursive collections: `Array α` and `List α` for supported `α`;
- recursive option/product/tagged-union shapes: `Option α`, `α × β`,
  `Sum α β`, and `Except ε α` for supported parameters;
- non-indexed user-defined structures over manifest-supported fields, including
  parameterized instances such as `Box Nat` and `Tagged (Array String)`,
  direct `Bool`, `UInt*`, `USize`, `Float`, `Float32`, and enum fields,
  single-field wrappers over direct scalar fields, and inherited parent fields
  represented as flattened JavaScript object keys. Direct recursive structures
  are supported, but recursive inherited structures are not;
- nullary inductive enums, represented in JavaScript by generated constructor
  names;
- non-indexed custom inductives with zero or more runtime payload fields per
  constructor, including direct recursive references through supported
  container shapes;
  constructor fields typed as `optParam α default` are described as `α` while
  remaining explicit runtime fields when the constructor layout stores them;
- direct `Lean.Expr`, represented at the JavaScript boundary as structural
  expression objects;
- `Lean.Vir.React.Node`, represented as an opaque `Lean.Vir.Js` resource whose
  native React node is constructed by the React host bindings.

This broad surface is the descriptor-guided object lowering used by
JavaScript-to-Lean exports and by declarations explicitly marked as
conversions. It is not the ordinary Lean-to-JavaScript host-resource boundary,
which is deliberately narrower and accepts only `Unit`, resources, and
resource-shaped callbacks.

The numeric descriptor tag table is part of the package ABI. The JSON field is
named `interfaceTag`; these tags describe interface descriptors, not the
ordinary host-resource import mode. Lean assigns tags in
`Vir.GeneratePackage.Interface.Encode`; JavaScript validates and dispatches
them in `web/src/runtime/interface-tags.js`. Run `npm run check:package-abi`
after editing either side.
Manifest schema version 7 requires every export to carry an explicit Boolean
`startup` marker. Package generation sets it for declarations marked with
`@[vir_startup]`. The runtime still accepts version 6 manifests and normalizes
a missing marker to `false`. Version 6 intentionally rejected the old
`wireTag` field and `wire` host-import boundary label instead of accepting
aliases.

| Tag | JavaScript name | Lean interface type | Descriptor payload |
| --- | --- | --- | --- |
| 0 | `INTERFACE_TAG.NAT` | `Nat` | Primitive. |
| 1 | `INTERFACE_TAG.INT` | `Int` | Primitive. |
| 2 | `INTERFACE_TAG.BOOL` | `Bool` | Primitive. |
| 3 | `INTERFACE_TAG.STRING` | `String` | Primitive. |
| 4 | `INTERFACE_TAG.UINT8` | `UInt8` | Primitive. |
| 5 | `INTERFACE_TAG.UINT16` | `UInt16` | Primitive. |
| 6 | `INTERFACE_TAG.UINT32` | `UInt32` | Primitive. |
| 7 | `INTERFACE_TAG.UINT64` | `UInt64` | Primitive. |
| 8 | `INTERFACE_TAG.USIZE` | `USize` | Primitive. |
| 9 | `INTERFACE_TAG.BYTE_ARRAY` | `ByteArray` | Primitive byte data. |
| 10 | `INTERFACE_TAG.FLOAT` | `Float` | Primitive. |
| 11 | `INTERFACE_TAG.FLOAT32` | `Float32` | Primitive. |
| 14 | `INTERFACE_TAG.SIMPLE_ENUM` | Nullary inductive enum | Constructor names and tags. |
| 15 | `INTERFACE_TAG.EXPR` | `Lean.Expr` | Structural expression object. |
| 16 | `INTERFACE_TAG.ARRAY` | `Array α` | Element descriptor. |
| 17 | `INTERFACE_TAG.LIST` | `List α` | Element descriptor. |
| 18 | `INTERFACE_TAG.OPTION` | `Option α` | Element descriptor. |
| 19 | `INTERFACE_TAG.PROD` | `α × β` | `fst` and `snd` descriptors. |
| 20 | `INTERFACE_TAG.STRUCTURE` | Structure | Name, runtime layout counts, fields, optional trivial field. |
| 21 | `INTERFACE_TAG.TAGGED_UNION` | `Sum` / `Except` | Constructor descriptors with payload layout. |
| 22 | `INTERFACE_TAG.UNIT` | `Unit` | Primitive. |
| 23 | `INTERFACE_TAG.RESOURCE` | `@[vir_js]` resource marker | Resource name. |
| 24 | `INTERFACE_TAG.FUNCTION` | Callback function type | Argument descriptors, result descriptor, effect label. |
| 25 | `INTERFACE_TAG.CUSTOM_INDUCTIVE` | Non-indexed custom inductive | Constructor descriptors and field layouts. |
| 26 | `INTERFACE_TAG.RECURSIVE_SELF` | Recursive reference | Referenced owner name. |
| 27 | `INTERFACE_TAG.LEAN_OBJECT` | Opaque retained Lean object | Object-handle boundary descriptor. |

Large exact integer values are returned to JavaScript as decimal strings to
avoid truncating them to JavaScript numbers.
Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers over them require
the generated Lean `_boxed` declaration at the wasm32 interpreter boundary. The
package generator auto-includes that companion for requested roots and reports a
diagnostic instead of producing a partial package if the companion is missing.

For structures, the manifest records Lean constructor layout metadata alongside
the applied Lean type label, field names, and instantiated field types. The JS
runtime sends that layout to the WASM shim so direct scalar fields are written
to the same object, `USize`, and scalar slots that compiled Lean code expects.
Parent structure fields remain explicit subobjects in the manifest so the
runtime layout matches Lean, but the JS API accepts and returns inherited fields
as flattened object keys.
One-field wrappers whose only runtime field is a direct scalar, for example
`Box UInt32`, use the same `trivialFieldIndex` path as object-field wrappers
while keeping the JavaScript object shape.

`Sum` and `Except` use manifest-backed tagged-union metadata. JavaScript sends
objects such as `{ "kind": "inl", "value": 4 }` or `{ "ok": value }`; results
come back as `{ kind, value }` objects using generated constructor names. The
manifest records each constructor payload layout so direct scalar payloads are
written into the same constructor scalar slots as compiled Lean code.

Function-valued interface types are used for Lean callbacks passed to
JavaScript host imports. Their descriptors record the callback argument list,
result type, and whether applying the callback returns a synchronous effect
(`RuntimeM`, `IO`, `DomM`, or `ReactM`). JavaScript receives these values as
`VirCallback` objects. The `INTERFACE_TAG.FUNCTION` value payload carries no
serialized numeric token; the runtime receives the internal closure root id
through a side channel and releases the rooted Lean closure when the host-owned
registration is done with it. Functions are accepted only as host-import
arguments; callback arguments and results must be `Unit` or resource
descriptors, so nested callbacks are rejected.

`Lean.Vir.React.Node` is a JavaScript-owned resource marker. The recursive
structure of the rendered tree lives in the host resource graph created by
`react.node.text` and `react.node.createElement`. Text inputs are explicit
`Lean.Vir.Js String` resources. Element construction receives an explicit
`Lean.Vir.Js ElementType` resource; DOM tag strings are wrapped by
`react.elementType.tag`, and future component bindings can provide component
element types directly. Props, children, and dependency lists are explicit
React-owned resources built by `react.props.*`, `react.node.children.*`, and
`react.deps.*`. Ordinary `Property`, `PropValue`, and `EventHandler` payloads
cross only through explicit
`js.value.react.property` and `js.value.react.eventHandler` conversion targets.

Entry points and host imports can be pure functions or synchronous effect
actions. Host imports are deliberately narrower than exports: low-level
JavaScript imports should expose `Unit`, `Lean.Vir.Js α` resources,
`Lean.Vir.Js.Nullable α` resources for JavaScript `null`, callbacks whose own
arguments/results are `Unit` or resources, or explicit conversion targets such as
`js.string.value`. Raw Lean scalar, structure, array, list, option, and product
host imports are rejected, except for declarations marked with
`@[vir_js_explicit_conversion]` that convert between exactly one
`Lean.Vir.Js ...` resource and one ordinary Lean value, or for the `js.leanRef`
object-handle boundary. JavaScript
resource/runtime APIs use `Lean.Vir.RuntimeM α`; browser APIs use
`Lean.Vir.Browser.DomM α`; React component construction uses
`Lean.Vir.React.ReactM α`. For Lean-to-JavaScript calls, import `Vir.Host` and
mark an opaque declaration with
`@[vir_js "target.name"]`, or use the starter declarations in `Vir.Common` and
`Vir.Browser`. The manifest records each host import under `hostImports` with
its slot, Lean name, JavaScript target, host boundary mode (`hostResource`,
`explicitConversion`, or `objectHandle`), generated WASM symbol, low-level IR arity,
leading erased argument count, JavaScript-visible arguments, result type, and
effect.
The JSON manifest keeps the source-level effect classification for review and
tooling: `pure`, `runtime`, `io`, `dom`, or `react`. The binary package
summary stores only the runtime distinction the shim needs today: pure versus
effectful.

`Lean.Vir.Js α` is always represented as the generic `Js` resource. Its type
parameter is a Lean-side phantom while the value remains in the JavaScript
externref lane. This lets browser, React, scalar-wrapper, and future
polymorphic JavaScript helpers share one resource ABI. The marker-specific
protocol and lifetime policy live in the Lean API and JavaScript host bindings,
not in the manifest resource descriptor. Naked marker types such as
`Lean.Vir.Browser.Element` remain unsupported boundary types because they do not
cross as `Lean.Vir.Js α`.

The recursive type tree is embedded in the JSON manifest. Package format 10
stores package payloads behind a small section directory and embeds a direct
package-owned export call-summary table.
Normal `vir_call_resolved_objects` calls carry only owned Lean object pointers;
the WASM shim looks up the direct summary from the loaded package to validate
argument count, effects, and boxed wasm32 boundary requirements.
The descriptor-bearing named call format and the resolved value-byte lane have
been removed; this is intentionally still an internal package ABI, not a
committed component-model boundary.
Lean-to-JavaScript host imports use package-owned arity/effect metadata: the
shim and `VirHostState` exchange borrowed/owned Lean object
arguments and results for package-declared host imports through
`env.vir_js_call_objects`. The `leanObject` descriptor is used by
generic `Lean.Vir.LeanRef.toJSL` / `fromJSL` / `releaseJSL` object handles. On
the Lean side those handles are surfaced as `Lean.Vir.JSL α`, an alias that
remains distinct from JavaScript-shaped `Js α` resources.
Function-valued imports are rooted with only their arity and effect bit in the
shim. JavaScript keeps the full function descriptor on the `VirCallback` wrapper,
so calls back into Lean lower arguments to owned objects and lift the owned object
result using JavaScript-side manifest metadata.

Package loading validates every exported argument/result type before exposing
the manifest to the UI or JS caller. The validator rejects unsupported
descriptor tags, malformed recursive children, invalid enum constructors,
inconsistent structure field layouts, bad `trivialFieldIndex` values, and
duplicate export names. Runtime tests also round-trip every generated export
type through the compact descriptor encoder/decoder so descriptor drift fails
before a call enters WASM.

The package generator also rejects ambiguous source-time names before writing a
package. Different source targets in the same generator run must not define the
same Lean declaration name, and exported entries must not produce the same
manifest `id` or JavaScript name. Reducible type aliases are allowed at package
boundaries when they reduce to a supported interface type.

## Current Trust Boundary

The manifest and package payload are trusted in this prototype. The JavaScript
runtime validates the embedded manifest before exposing entries. The WASM shim
uses the package-owned direct export call-summary table to validate object
calls for `vir_call_resolved_objects`.
Host-import dispatch uses package-owned arity/effect metadata, while
JavaScript uses interface descriptors for argument/result object
lowering/lifting. Closure roots likewise store only arity/effect metadata;
JavaScript keeps the full callback descriptor.

This is acceptable for the current generated demo packages and local developer
packages. It is not a hardened boundary for arbitrary remote `.irpkg` files.
The WASM sandbox protects the host browser from native memory escape, but a
malformed or intentionally hostile package can still trap the interpreter,
consume CPU or WASM memory, make the tab unresponsive, or publish package ABI
metadata that does not match the packaged Lean declaration.

The remaining hardening path is to validate package-owned layout descriptors
inside the WASM shim, reject inconsistent export call summaries at load time,
and add size/depth/execution limits around package loading and calls.

## WIT Direction

WIT is still the right interface-description model to track, but not yet the
runtime dependency for this demo path.

The current artifact is a core `wasm32-wasip1` module with a generated manifest
and a generic byte-payload call export. We are not committing this prototype to
a component-model boundary yet. For now, `interfaces/lean-vir.wit` mirrors the
generic manifest/call shape as a design reference while the browser runtime
uses the embedded JSON manifest directly.
