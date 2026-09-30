# Lean VIR

Run [Lean 4](https://github.com/leanprover/lean4) code in the browser, from
functions called by JavaScript to interactive applications and editor widgets.
VIR packages selected compiled Lean declarations and executes them using Lean's
IR interpreter in WebAssembly. Its browser and React bindings let Lean code use
the host's DOM, components, and events.

VIR is experimental. It supports selected declarations and host APIs, not
arbitrary Lean programs; unsupported dependencies and interface types are
reported during package generation.

## Try it

Open the [interactive demo](https://ejgallego.github.io/lean-vir/) or the
[React Tamagotchi](https://ejgallego.github.io/lean-vir/react.html).
There is nothing to install or compile to try the hosted examples.

## Use VIR in a Lean project

Start with the [package guide](docs/guides/PACKAGES.md) to add a pinned
`lean_vir` dependency and install its matching browser SDK. Your project must
use the Lean toolchain supported by that VIR revision.

VIR works with Lake-registered modules, not standalone source files. For
example, in a module `MyApp.Runtime` at `MyApp/Runtime.lean`:

```lean
module

meta import Vir.Attributes

@[vir_export]
public def MyApp.Runtime.answer : Nat := 42
```

Once `MyApp.Runtime` belongs to a `lean_lib` in your Lake configuration, build
its browser package:

```sh
lake build +MyApp.Runtime:vir
```

Serve the resulting package-set descriptor and its referenced members alongside
the matching SDK. Your JavaScript application loads that descriptor, then calls
`runtime.call("MyApp.Runtime.answer")` to obtain `42`. The
[SDK and loading instructions](docs/guides/PACKAGES.md#install-the-browser-sdk)
show the installation command, directory layout, and runtime initialization.

Lake builds your application's package; the browser SDK supplies the prebuilt
JavaScript/Wasm runtime. Using VIR in an application does not require building
that runtime or installing the WASI SDK. Keep the SDK and Lean dependency
revisions aligned.

For browser applications, use `@[vir_startup]` for initialization hooks and the
[browser library](docs/guides/LEAN_VIR_LIBRARY.md) for DOM and canvas operations.
See the [React guide](docs/guides/REACT.md) for components and hooks, or the
[infoview guide](docs/guides/INFOVIEW.md) for Lean editor widgets.

## Examples and documentation

- [Examples](examples/) — Lean applications and small tutorials.
- [JavaScript API](docs/guides/JS_API.md) — load packages, call Lean, and manage
  runtime lifetime.
- [Documentation index](docs/README.md) — guides, reference material, and design
  notes.

## Develop VIR

To build or modify VIR itself, follow the [contributor guide](CONTRIBUTING.md)
and [development setup](docs/HARNESS.md). These cover the pinned Lean toolchain,
npm dependencies, local runtime builds, the package runner, and tests.
The [developer guide](docs/DEVELOPER_GUIDE.md) explains the implementation and
repository layout.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Generated Wasm artifacts
can include Lean 4 object code, also Apache-2.0, with its upstream notices.
