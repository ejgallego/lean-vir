# Lean VIR

Lean VIR runs selected [Lean 4](https://github.com/leanprover/lean4) declarations
in the browser through Lean's real IR interpreter compiled to `wasm32-wasip1`.
It packages compiled module IR; it is not a general Lean-to-Wasm compiler.

## Try it

Open the [hosted demos](https://ejgallego.github.io/lean-vir/), including
[React Tamagotchi](https://ejgallego.github.io/lean-vir/react.html) and
[`Format.pretty`](https://ejgallego.github.io/lean-vir/format.html).
No local Lean or Wasm build is needed to try the hosted site.

## Use VIR in an application

Write your browser program in a Lean module and mark its public entry points:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def answer : Nat := 42
```

The application's client library declares that program and prepares its browser
files through Lake. It also acquires the matching prebuilt **runtime**: the
JavaScript loader and Wasm interpreter that execute the program.

Build the application with its ordinary Lake command. Its native site generator
writes the prepared files, and the browser calls the program's exported functions.
Applications do not locate VIR build directories, invoke packaging scripts, or
build Wasm. Program compilation and runtime acquisition remain independent.

Follow [the application setup guide](docs/guides/EMBEDDED_RESOURCES.md) for the
library declaration, publication and JavaScript call. Use the Lean toolchain
selected by your VIR dependency; HTTPS runtime acquisition needs `curl`.
The integration is under review for the first release; current qualification
and limits are recorded in [the acceptance checklist](docs/development/RESOURCE_ACCEPTANCE.md).

## Experimental

[Editor widgets and RPC](docs/guides/INFOVIEW.md) use live editor environments,
including unsaved code. They are experimental and outside the first-release
application workflow.

## Develop VIR

The default `lake build` builds the core Lean library. To work on VIR itself:

```bash
npm install
npm run setup
npm run doctor
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [the harness](docs/HARNESS.md)
before running broader builds or tests. Ordinary client applications should not
run this setup sequence.

[Build internals](docs/guides/BUILD_WORKFLOWS.md) documents the compiler, runtime
distribution and repository tooling behind the application workflow.

[Documentation](docs/README.md) links the API guides, implementation references,
examples, and validation instructions.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Generated Wasm can contain Lean 4 object code and retains its upstream notices.
