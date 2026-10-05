# Lean VIR

VIR lets JavaScript applications run selected [Lean 4](https://github.com/leanprover/lean4)
functions and lets Lean call JavaScript through explicit host bindings. It uses
Lean's IR interpreter compiled to WebAssembly. Lake compiles the Lean modules;
VIR packages their IR and supplies a prebuilt runtime.

## Try it

Open the [hosted demos](https://ejgallego.github.io/lean-vir/), including the
merge-sort example, [`Format.pretty`](https://ejgallego.github.io/lean-vir/format.html),
and the [experimental React Tamagotchi](https://ejgallego.github.io/lean-vir/react.html).
There is nothing to install or compile to try them.

## Use VIR in a Lean project

### Prepare a browser application

The [application guide](docs/guides/EMBEDDED_RESOURCES.md) walks through a complete,
independent Lake project: a Lean program, runtime acquisition, publication, and a
browser call. Its greeting function lives in `program/Client/Program.lean`:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def Client.Program.greet (name : String) : String := "Hello, " ++ name
```

The module must belong to a `lean_lib` in your Lake configuration. The guide gives
that registration, the pinned VIR dependency and its matching Lean toolchain.

After completing the project setup, publish its browser files:

```sh
lake exe generate-site site
```

Lake builds the Lean program and native publisher and acquires the exact prebuilt
JavaScript/Wasm runtime. The publisher writes the program and runtime assets
under `site/`.
The guide's browser code loads their manifests with `createProgram`, then calls
`program.call("greet", "world")` to obtain `Hello, world`.

### Use a custom JavaScript host

For caller-supplied `hostBindings`, direct runtime control or low-level Lean
object access, use the SDK's [JavaScript runtime API](docs/guides/JS_API.md#entry-points-and-distribution).
The application loader above exposes `status`, `call` and `dispose`; the SDK
provides the underlying runtime and object APIs.

This route needs an SDK archive matching your pinned VIR revision. The
[SDK acquisition guide](docs/guides/PACKAGES.md#install-the-browser-sdk) explains
its release, CI-artifact and local-archive prerequisites. Application package
compilation and runtime acquisition remain separate in both workflows.

## Support scope

Official support covers the runtime, packages, low-level object API and minimal
two-way JS/Lean interop for documented workflows and pinned Lean/VIR versions.
[DOM and canvas helpers](docs/guides/LEAN_VIR_LIBRARY.md),
[React/JSX and ProofWidgets](docs/guides/REACT.md), and
[editor widgets and RPC](docs/guides/INFOVIEW.md) are experimental, including
when shipped through default imports or host providers.

See [support scope](docs/SUPPORT.md) for the full boundary and planned JSON
converters. The first release remains under review; see its
[qualification status](docs/development/RESOURCE_ACCEPTANCE.md). More
[guides and references](docs/README.md) and [Lean examples](examples/) are
available to explore the APIs.

## Develop VIR

To build or change VIR itself, start with [CONTRIBUTING.md](CONTRIBUTING.md) and
[development setup](docs/HARNESS.md) for the toolchain, npm dependencies, local
Wasm builds and tests. The [developer guide](docs/DEVELOPER_GUIDE.md) maps the
implementation.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Generated Wasm can contain Lean 4 object code and retains its upstream notices.
