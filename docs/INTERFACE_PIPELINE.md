# Interface Pipeline

This document owns package config shape, generated manifest semantics, and the
current interface surface. Command selection and CI shape live in
`docs/HARNESS.md`; architecture status lives in `docs/IMPLEMENTATION_NOTES.md`.

The developer path is package-driven:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

That command:

1. elaborates the configured Lean source with Lean 4.31.0;
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

## Supported Interface Surface

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
- `Lean.Expr`, represented as structural JavaScript objects;
- `Lean.Vir.React.Html`, represented through the same recursive custom
  inductive surface and rendered by the React host bindings.

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
(`IO`, `DomM`, or `ReactM`). JavaScript receives these values as `VirCallback`
objects. The `WIRE.FUNCTION` value payload carries no serialized numeric token;
the runtime receives the internal closure root id through a side channel and
releases the rooted Lean closure when the host-owned registration is done with
it.

`Lean.Vir.React.Html` now uses the same improved custom-inductive and
`recursiveSelf` descriptor support as other non-indexed recursive inductives.
The React-specific boundary is the host renderer and callback ownership policy,
not a separate private `reactHtml` wire type.

Entry points and host imports can be pure functions or synchronous effect
actions. Raw custom host imports can use `IO α`; browser APIs use
`Lean.Vir.Browser.DomM α`; React component construction uses
`Lean.Vir.React.ReactM α`. For Lean-to-JavaScript calls, import `Vir.Host` and
mark an opaque declaration with `@[vir_js "target.name"]`, or use the starter
declarations in `Vir.Common` and `Vir.Browser`. The manifest records each host
import under `hostImports` with its slot, Lean name, JavaScript target,
generated WASM symbol, low-level IR arity, leading erased argument count,
JavaScript-visible arguments, result type, and effect.
The JSON manifest keeps the source-level effect classification for review and
tooling: `pure`, `io`, `dom`, or `react`. The compact wasm call descriptor still
lowers that to the runtime distinction the shim needs today: pure versus
effectful.

`Lean.Vir.Js α` is represented as a `Js` resource. Its type parameter is a
Lean-side phantom while the value remains in the JavaScript object lane. This
lets a polymorphic host import such as a JavaScript array helper share one
resource ABI. Decoding `α` itself still requires a concrete supported interface
type or future explicit ABI descriptor.

Built-in browser and React object markers must appear under the same `Js`
boundary type and keep DOM-like manifest labels. For example, `Lean.Vir.Js
Lean.Vir.Browser.Element` is a resource named `Lean.Vir.Browser.Element` and
labeled `Element`; arbitrary markers remain generic `Js` resources. Naked marker
types such as `Lean.Vir.Browser.Element` are rejected at package generation.

The recursive type tree is embedded in the JSON manifest and sent as a compact
internal descriptor in each `vir_call` payload. This is intentionally still an
internal package ABI, not a committed component-model boundary.

Package loading validates every exported argument/result type before exposing
the manifest to the UI or JS caller. The validator rejects unsupported wire
tags, malformed recursive children, invalid enum constructors, inconsistent
structure field layouts, bad `trivialFieldIndex` values, and duplicate export
names. Runtime tests also round-trip every generated export type through the
compact descriptor encoder/decoder so descriptor drift fails before a call
enters WASM.

## Current Trust Boundary

The manifest and package payload are trusted in this prototype. The JavaScript
runtime validates the embedded manifest before exposing entries, then sends the
compact type descriptor from that manifest with each `vir_call` request. The
WASM shim currently uses that descriptor to decode arguments, construct Lean
runtime objects, and encode results; it does not yet independently bind the
descriptor to a package-owned export table.

This is acceptable for the current generated demo packages and local developer
packages. It is not a hardened boundary for arbitrary remote `.irpkg` files.
The WASM sandbox protects the host browser from native memory escape, but a
malformed or intentionally hostile package can still trap the interpreter,
consume CPU or WASM memory, make the tab unresponsive, or confuse result
decoding by claiming an ABI that does not match the packaged Lean declaration.

The hardening path is to make the package provider own the ABI descriptors for
each exported declaration, have `vir_call` look them up by entry name instead of
accepting caller-provided result/layout descriptors, validate layout descriptors
inside the WASM shim, and add size/depth/execution limits around package loading
and calls.

## WIT Direction

WIT is still the right interface-description model to track, but not yet the
runtime dependency for this demo path.

The current artifact is a core `wasm32-wasip1` module with a generated manifest
and a generic byte-payload call export. We are not committing this prototype to
a component-model boundary yet. For now, `interfaces/lean-vir.wit` mirrors the
generic manifest/call shape as a design reference while the browser runtime
uses the embedded JSON manifest directly.
