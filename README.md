# Lean VIR

Lean VIR runs selected [Lean 4](https://github.com/leanprover/lean4) declarations
in the browser through Lean's real IR interpreter compiled to `wasm32-wasip1`.
It packages compiled module IR; it is not a general Lean-to-Wasm compiler.

VIR officially supports the runtime, package workflow, low-level object API and
minimal two-way JS/Lean interop. DOM, React/JSX and editor/widget integrations are
experimental conveniences, including when available through default imports.
See [support scope](docs/SUPPORT.md) for the boundary and the planned 0.1.1 JSON
converters.

## Try it

Open the [hosted demos](https://ejgallego.github.io/lean-vir/), including
[experimental React Tamagotchi](https://ejgallego.github.io/lean-vir/react.html) and
[`Format.pretty`](https://ejgallego.github.io/lean-vir/format.html).
No local Lean or Wasm build is needed to try the hosted site.

## Use VIR in an application

Write your browser program in a Lean module and mark its public entry points
with `@[vir_export]`. The [Quickstart's greeting](examples/tutorials/quickstart/QuickstartApp/Program.lean)
is the first example.

The application's asset library declares that program and prepares its browser
files through Lake. It also acquires the matching prebuilt **runtime**: the
JavaScript loader and Wasm interpreter that execute the program.

Build the application with its ordinary Lake command. Its native site generator
writes the prepared files, and the browser calls the program's exported functions.
Applications do not locate VIR build directories, invoke packaging scripts, or
build Wasm. Program compilation and runtime acquisition remain independent.

Start with the [runnable Quickstart application](examples/tutorials/quickstart/README.md):

```bash
cd examples/tutorials/quickstart
lake exe publish _site
python3 -m http.server --directory _site 8000
```

Open <http://localhost:8000/> to see Lean's greeting.
The [application setup guide](docs/guides/EMBEDDED_RESOURCES.md) explains the
same project's build, asset value, publication and JavaScript call.
Use the Lean toolchain selected by your VIR dependency; HTTPS runtime acquisition
needs `curl`.
Qualification and remaining limits are recorded in
[the acceptance checklist](docs/development/RESOURCE_ACCEPTANCE.md).

## Experimental

[DOM helpers](docs/guides/LEAN_VIR_LIBRARY.md),
[React and JSX](docs/guides/REACT.md), and
[editor widgets and RPC](docs/guides/INFOVIEW.md) are available to try outside the
official support scope. Editor widgets use live environments, including unsaved
code. Their presence in the library or demos does not extend the support promise.

## Develop VIR

The default `lake build` builds the Lean library. To work on VIR itself:

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
For custom JavaScript hosts and explicit object/host-binding APIs, see the
[runtime API reference](docs/guides/JS_API.md) and
[SDK acquisition](docs/guides/PACKAGES.md#install-the-browser-sdk).

[Documentation](docs/README.md) links the API guides, implementation references,
examples, and validation instructions.

## License

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Generated Wasm can contain Lean 4 object code and retains its upstream notices.
