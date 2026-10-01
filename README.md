# Lean VIR

Lean VIR runs selected [Lean 4](https://github.com/leanprover/lean4) declarations
in the browser through Lean's real IR interpreter compiled to `wasm32-wasip1`.
It packages compiled module IR; it is not a general Lean-to-Wasm compiler.

## Try it

Open the [hosted demos](https://ejgallego.github.io/lean-vir/), including
[React Tamagotchi](https://ejgallego.github.io/lean-vir/react.html) and
[`Format.pretty`](https://ejgallego.github.io/lean-vir/format.html).
No local Lean or Wasm build is needed to try the hosted site.

## Choose your workflow

- **Native applications publishing browser programs:** the
  [embedded-resource workflow](docs/guides/EMBEDDED_RESOURCES.md) is the new
  **draft** integration. A client library prepares resources through Lake;
  applications publish compiled resource values, without discovering build paths.
  It acquires the exact prebuilt runtime from a public release. Runtime production
  remains separate; an application build never compiles Wasm implicitly.
- **Custom browser hosts and package producers:** the supported
  [package workflow](docs/guides/PACKAGES.md) builds a program with
  `+Module:vir` and acquires a matching SDK with `:virSdk`.
  These remain lower-level interfaces, not extra steps for embedded-resource
  applications.
- **Editor widgets:** use [Infoview and RPC](docs/guides/INFOVIEW.md).
  Live modules use the editor's unsaved environment, not a saved program pack.
- **VIR contributors:** use the [harness](docs/HARNESS.md) to build the runtime,
  run repository demos, and select checks.

The [build-workflow guide](docs/guides/BUILD_WORKFLOWS.md) defines these boundaries,
the supporting tools, and the workflows they replace.

## Package a compiled module

Pin `lean_vir` as a Lake dependency and use its matching Lean toolchain.
Register your program module in a `lean_lib`, then mark its public entry points:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def answer : Nat := 42
```

For a module registered as `MyApp.Runtime`:

```bash
lake build +MyApp.Runtime:vir
lake build :virSdk
```

The SDK must match the producer. Unreleased revisions need an exact available
artifact; they are not a promise of an anonymously downloadable release.
See [module registration and SDK selection](docs/guides/PACKAGES.md), then
[calling Lean from JavaScript](docs/guides/CALL_LEAN_FROM_JS.md).

## Develop VIR

The default `lake build` builds the core Lean library, without browser tooling.
Runtime production is a separate contributor operation:

```bash
npm install
npm run setup
npm run doctor
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [the harness](docs/HARNESS.md)
before running broader builds or tests. Ordinary client applications should not
run this setup sequence.

[Documentation](docs/README.md) links the API guides, implementation references,
examples, and validation instructions.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Generated Wasm can contain Lean 4 object code and retains its upstream notices.
