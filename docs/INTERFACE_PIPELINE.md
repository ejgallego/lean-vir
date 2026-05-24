# Interface Pipeline

The developer path is package-driven:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

That command:

1. elaborates the configured Lean source with Lean 4.30-rc2;
2. extracts the requested IR declaration closure into an `.irpkg`;
3. embeds a generated JavaScript interface manifest in the package;
4. writes the package report next to the generated artifact.

The generated `.irpkg` is the only browser artifact needed by `/dev.html`.
After the package is loaded, the runner reads the embedded manifest and creates
the UI entries automatically.

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

## Supported Interface Surface

The embedded manifest currently supports:

- scalar values: `Nat`, `Int`, `Bool`, `String`;
- fixed-width values: `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- byte data: `ByteArray`;
- selected homogeneous collections: `Array Nat`, `Array UInt32`, `List Nat`,
  `List String`.

Large exact integer values are returned to JavaScript as decimal strings to
avoid truncating them to JavaScript numbers.

## WIT Direction

WIT is still the right interface-description model to track, but not yet the
runtime dependency for this demo path.

The current artifact is a core `wasm32-wasip1` module with a generated manifest
and a generic byte-payload call export. A real WIT interface would move this
toward the WebAssembly Component Model and canonical ABI. For now,
`interfaces/lean-vir.wit` mirrors the generic manifest/call shape as a design
reference while the browser runtime uses the embedded JSON manifest directly.
