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

- scalar values: `Nat`, `Int`, `Bool`, `String`;
- fixed-width values: `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- byte data: `ByteArray`;
- recursive collections: `Array α` and `List α` for supported `α`;
- recursive option/product shapes: `Option α` and `α × β` for supported
  `α` and `β`;
- plain non-parameterized structures over manifest-supported fields, including
  direct `Bool`, `UInt*`, `USize`, and enum fields, represented as JavaScript
  objects;
- nullary inductive enums, represented in JavaScript by generated constructor
  names;
- `Lean.Expr`, represented as structural JavaScript objects.

Large exact integer values are returned to JavaScript as decimal strings to
avoid truncating them to JavaScript numbers.

For structures, the manifest records Lean constructor layout metadata alongside
field names and field types. The JS runtime sends that layout to the WASM shim
so direct scalar fields are written to the same object, `USize`, and scalar slots
that compiled Lean code expects.

The recursive type tree is embedded in the JSON manifest and sent as a compact
internal descriptor in each `vir_call` payload. This is intentionally still an
internal package ABI, not a committed component-model boundary.

## WIT Direction

WIT is still the right interface-description model to track, but not yet the
runtime dependency for this demo path.

The current artifact is a core `wasm32-wasip1` module with a generated manifest
and a generic byte-payload call export. We are not committing this prototype to
a component-model boundary yet. For now, `interfaces/lean-vir.wit` mirrors the
generic manifest/call shape as a design reference while the browser runtime
uses the embedded JSON manifest directly.
