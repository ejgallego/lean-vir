# Lean VIR

Lean VIR runs selected [Lean 4](https://github.com/leanprover/lean4)
declarations in the browser through Lean's real IR interpreter compiled to
`wasm32-wasip1`.

The primary workflow is:

1. write a Lean file;
2. choose one or more declarations to export;
3. generate a `.irpkg` package;
4. load it in the browser package runner.

The browser runner reads the embedded interface manifest and builds runnable
controls automatically. For supported argument and result types, adding another
browser entry point is just adding another Lean root name to the package command.

## One Lean File To Browser

Set up the toolchain once:

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm run build:demo
```

Generate the bundled quickstart package and start the local server:

```bash
npm run quickstart
npm run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173/dev.html?package=local-quickstart.irpkg
```

To package your own file, pass the source file, output package, and any number
of Lean declarations to expose:

```bash
npm run generate:irpkg -- examples/Quickstart.lean web/public/local-quickstart.irpkg Quickstart.double Quickstart.greet Quickstart.total Quickstart.choose Quickstart.classify Quickstart.validateName
```

The export names are Lean declaration names. Use fully qualified names for
declarations inside namespaces, such as `Quickstart.total`. If you omit export
names, the generator packages public definitions from the source file:

```bash
npm run generate:irpkg -- examples/Fib.lean web/public/local-fib.irpkg
```

Put packages under `web/public/` when you want to load them by URL from the
runner. For packages written elsewhere, use the `/dev.html` file picker:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

The package runner starts a fresh WASM interpreter, reads the manifest embedded
in the `.irpkg`, renders inputs for the selected export, and calls the Lean
declaration in the browser.

Inspect a package without starting the browser:

```bash
npm run inspect:irpkg -- web/public/local-quickstart.irpkg
npm run inspect:irpkg -- --json web/public/local-quickstart.irpkg
```

## Lake Facets And Lean Browser Entries

Lake clients can mark exports directly in Lean and build the containing module:

```lean
@[vir_export]
def answer : Nat := 42

@[vir_entry]
def mount : Lean.Vir.Browser.DomM Unit := pure ()
```

```bash
lake build +MySlides.Runtime:vir
lake build :virSdk
```

The module facet writes the `.irpkg` and report under `.lake/build/vir/`; the
package facet installs the versioned browser SDK. `VirRuntime.runEntries()`
runs `@[vir_entry]` declarations in manifest order and skips each entry after
it succeeds. See
[docs/LAKE_INTEGRATION.md](docs/LAKE_INTEGRATION.md) and the entirely
Lean-authored [canvas slide example](examples/SlidesCanvas.lean), which is a
real Lake target in this repository:

```bash
lake build +SlidesCanvas:vir
```

## Calling Lean From JavaScript

Use `/dev.html` for quick manual testing. In an app, load the same `.irpkg` with
the runtime wrapper and call an exported declaration by its Lean name:

```js
import { createVirRuntimeFactory, fetchBytes } from "./src/vir-runtime.js";

const factory = createVirRuntimeFactory({ wasmUrl: "/vir-upstream.wasm" });
const bytes = await fetchBytes("/local-quickstart.irpkg");
const runtime = await factory.createRuntime({ irPackageBytes: bytes });

const result = runtime.call("Quickstart.double", 21);
```

The manifest-driven call path supports pure declarations and recognized
synchronous effects (`RuntimeM`, `IO`, `DomM`, and `ReactM`) over the currently
supported scalar, array/list, option, product, sum, except, structure, enum,
`ByteArray`, and `Lean.Expr` shapes. See
[docs/CALL_LEAN_FROM_JS.md](docs/CALL_LEAN_FROM_JS.md) for the full JavaScript
guide, including `Sum` and `Except` result shapes.

## Built-In Demos

Open the Vite URL from `npm run dev -- --port 5173` to see the DOM Tamagotchi,
the React review page, fixture browser, and links into the package runner. The
Lean sources are in [examples/](examples/), with broader fixture coverage under
[fixtures/](fixtures/).

The hosted demo is deployed from `main`:

[Lean VIR hosted demo](https://ejgallego.github.io/lean-vir/)

A downloadable static bundle is published with the hosted demo:

[lean-vir-local.tar.gz](https://ejgallego.github.io/lean-vir/downloads/lean-vir-local.tar.gz)

Unpack it, serve the extracted `lean-vir-local/` directory with a local HTTP
server, and open the server URL.

To build the same archive locally, run `npm run build:local-artifact`.

The latest developer SDK artifact contains the JavaScript runtime entry files,
their internal helper modules, the release `vir-upstream.wasm`, the optimized debug companion
`vir-upstream.dev.wasm`, and a machine-readable `lean-vir-artifact.json`
manifest:

[lean-vir-sdk.tar.gz](https://ejgallego.github.io/lean-vir/downloads/lean-vir-sdk.tar.gz)

```bash
npm run build:sdk-artifact
```

Client Lake packages can install a matching SDK archive through the package
executable. The first complete client is
[ejgallego/lean-vir-examples](https://github.com/ejgallego/lean-vir-examples).

```bash
LEAN_VIR_COMMIT=<lean-vir-git-commit>
lake exe lean_vir/vir_fetch_sdk \
  --commit "$LEAN_VIR_COMMIT" \
  --out web/public/vendor/lean-vir
```

`--commit` downloads the `lean-vir-sdk` artifact produced by
[GitHub Actions](https://github.com/ejgallego/lean-vir/actions) for that exact
commit and rejects the install if the SDK manifest was built from a different
commit. This keeps commit-pinned Lake dependencies and downloaded WASM/JS
artifacts in sync before there are tagged releases. GitHub requires
authentication for Actions artifact downloads, so set `GITHUB_TOKEN` or run
[`gh auth login`](https://cli.github.com/manual/gh_auth_login) once before using
the commit-artifact path.

Tagged releases publish the same archive as a durable
[GitHub Releases](https://github.com/ejgallego/lean-vir/releases) asset. The
`:virSdk` facet defaults to `v0.1.0` once that release has been published;
`vir_fetch_sdk --tag <tag>` selects a different release, while unreleased or
commit-pinned clients can continue to use `--commit` or `VIR_SDK_ARCHIVE`.

## Where To Go Next

- [docs/README.md](docs/README.md) for a map of maintainer and integration
  documentation.
- [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for implementation paths,
  call-flow diagrams, and object ownership.
- [docs/LOCAL_IRPKG.md](docs/LOCAL_IRPKG.md) for the full local package
  workflow.
- [docs/LAKE_INTEGRATION.md](docs/LAKE_INTEGRATION.md) for marked exports,
  Lake facets, SDK installation, and Lean-authored Slides code.
- [docs/CALL_LEAN_FROM_JS.md](docs/CALL_LEAN_FROM_JS.md) for calling exported
  Lean declarations from app JavaScript.
- [docs/JS_API.md](docs/JS_API.md) for using the runtime wrapper from
  JavaScript.
- [docs/HOST_BINDINGS.md](docs/HOST_BINDINGS.md) for JavaScript host binding
  targets, virtual hosts, and resource cleanup.
- [docs/LEAN_VIR_LIBRARY.md](docs/LEAN_VIR_LIBRARY.md) for Lean-side host
  import helpers.
- [docs/REACT_WASM_BINDINGS.md](docs/REACT_WASM_BINDINGS.md) for the
  React-first plan for `externref`, JSPI, and related Wasm interop features.
- [docs/INTERFACE_PIPELINE.md](docs/INTERFACE_PIPELINE.md) for package configs,
  manifests, supported type details, and interface internals.
- [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md) for
  maintainer-facing implementation details.

## Contributor Checks

```bash
npm run setup
npm run doctor
npm run test:site
npm run test:pages:browser
npm test
```

Generated outputs under `build/`, `web/dist/`, and `web/public/*.wasm` /
`web/public/*.irpkg` are ignored by git.

Contributor workflow and harness details live in
[CONTRIBUTING.md](CONTRIBUTING.md) and [docs/HARNESS.md](docs/HARNESS.md).

## License

This repository is licensed under Apache-2.0. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
Generated WASM artifacts can include object code compiled from Lean 4 source,
which is also Apache-2.0 and keeps its upstream notices.
