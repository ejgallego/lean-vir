# Interface Pipeline

The developer path is package-driven:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

That command:

1. elaborates the configured Lean source with Lean 4.30-rc2;
2. extracts the requested IR declaration closure into an `.irpkg`;
3. embeds a generated JavaScript interface manifest and package metadata in
   the package;
4. writes the package report next to the generated artifact.

The generated `.irpkg` is the only browser artifact needed by `/dev.html`.
After the package is loaded, the runner reads the embedded manifest and creates
the UI entries automatically. The manifest metadata records the package format,
Lean toolchain, generation time, source targets, and resolved roots.

`web/public/*.irpkg` files are generated local assets and are ignored by git.

## Pages Landing

The CI Pages build runs:

```bash
npm run build:site
```

That script first builds the upstream WASM demo, then runs `npm run
prepare:pages` to generate URL-loadable sample packages:

- `local-fib.irpkg`
- `local-mergesort.irpkg`

Vite copies those generated packages into `web/dist/` alongside `index.html`
and `dev.html`. The landing page links directly to `/dev.html` with query
parameters such as:

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
  represented as flattened JavaScript object keys;
- nullary inductive enums, represented in JavaScript by generated constructor
  names;
- `Lean.Expr`, represented as structural JavaScript objects.

Large exact integer values are returned to JavaScript as decimal strings to
avoid truncating them to JavaScript numbers.
The WASM shim prefers the typed IR bridge for JavaScript calls. It decodes each
manifest argument into the corresponding Lean IR lane (`object`, integer,
`USize`, `Float`, or `Float32`) and calls the actual package declaration instead
of requiring the generated `_boxed` wrapper. `_boxed` declarations may still be
packaged when the Lean IR closure references them internally, but they are no
longer added just to make an export callable. If the typed bridge cannot
represent a declaration and no boxed fallback is available, the call fails
loudly instead of silently omitting or partially compiling the export.
Declared native extern roots have no interpreted body, so they intentionally
fall through to `run_boxed` when the shim knows their native symbol. The JS
runtime reports the most recent successful or failed call path through
`lastCallMode()`: `typed`, `boxed-fallback`, or `unsupported`.

Design note: the pinned upstream `ir_interpreter.cpp` stays unmodified, but the
build creates a generated overlay that makes selected `interpreter` internals
public inside the build tree. The typed bridge currently reaches into the
interpreter's IR value stack (`m_arg_stack`), symbol lookup/cache result
(`symbol_cache_entry` and `lookup_symbol`), frame operations
(`push_frame`/`pop_frame`), and body evaluator (`eval_body`). This mirrors the
interpreter's internal non-boxed application path, but it is intentionally
treated as prototype plumbing rather than a stable ABI. Upstream Lean exposes
boxed external entry points such as `run_boxed`, `lean_eval_const`,
`lean_eval_main`, and `lean_run_init`; the non-boxed `interpreter::call` path is
used internally while evaluating IR `FAp` instructions, where arguments are
already references to values in the active interpreter frame.

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
