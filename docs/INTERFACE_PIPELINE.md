# Interface Pipeline

The developer path is now config-driven:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

That command:

1. elaborates the configured Lean source with Lean 4.30-rc2;
2. extracts the requested IR declaration closure into an `.irpkg`;
3. writes the package report;
4. writes a browser input spec next to the package when `inputSpec.path` is set.

The generated package and input spec can then be loaded in `/dev.html` by URL:

```text
Package URL: local-fib.irpkg
Spec URL:    local-fib.input.json
```

`web/public/*.irpkg` and `web/public/*.input.json` are generated local assets and
are ignored by git.

## Pages Landing

The CI Pages build runs:

```bash
npm run build:site
```

That script first builds the upstream WASM demo, then runs `npm run
prepare:pages` to generate the URL-loadable sample package/spec pairs:

- `local-fib.irpkg`
- `local-fib.input.json`
- `local-mergesort.irpkg`
- `local-mergesort.input.json`

Vite then copies those generated assets into `web/dist/` alongside `index.html`
and `dev.html`. The landing page links directly to `/dev.html` with query
parameters such as:

```text
dev.html?package=local-fib.irpkg&spec=local-fib.input.json&entry=fib
```

The package runner accepts `package`, `spec`, and `entry` query parameters so a
generated package can be opened with the right input spec and selected entry.

## Config Shape

```json
{
  "version": 1,
  "source": "examples/Fib.lean",
  "package": "web/public/local-fib.irpkg",
  "report": "build/generated/local-fib.report.md",
  "roots": ["fib"],
  "inputSpec": {
    "path": "web/public/local-fib.input.json",
    "entries": [
      {
        "id": "fib",
        "entry": "fib",
        "result": { "type": "Nat" },
        "inputs": [
          {
            "name": "n",
            "type": "Nat",
            "defaultValue": "12",
            "min": 0,
            "max": 17
          }
        ]
      }
    ]
  }
}
```

If `roots` is omitted or empty, `prepare:irpkg` packages every IR declaration
emitted by the source, using the generator's `--target-all` mode. Explicit roots
are preferred for stable demos and size-sensitive experiments.

## Supported Interface Surface

The current browser interface supports:

- `() -> Nat`;
- `Nat -> Nat`;
- `Array Nat -> Nat`.

All results are returned to JavaScript as decimal strings. This avoids truncating
large Lean `Nat` values to JavaScript numbers.

## WIT Direction

WIT is the right interface-description model to track, but not yet the right
runtime dependency for this demo path.

The current artifact is a core `wasm32-wasip1` module with hand-written JS
marshalling over exported functions. A real WIT interface would move this toward
the WebAssembly Component Model, where interfaces are described in WIT and use
the Component Model's canonical ABI. That is a better long-term shape for typed
calls, strings, lists, and future multi-language hosts.

For now, the repo keeps a draft WIT contract in `interfaces/lean-vir.wit`, but
does not build a component from it. The JSON input spec remains the source of
truth for the browser developer UI because it works directly with the current
core WASM artifact. The practical migration path is:

1. keep extending the JSON spec with WIT-like types;
2. keep the JS runtime wrapper as the compatibility layer over core WASM;
3. once component tooling is worth adding, generate or validate the JSON spec
   against the WIT world and add a component build as a second artifact.
