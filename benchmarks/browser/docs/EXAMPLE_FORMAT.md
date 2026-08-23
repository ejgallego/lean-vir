# Benchmark example format

A VIR client contributes one small descriptor and one browser controller. The
descriptor contains no shell commands, machine paths, generated artifacts, or
UI layout. Build source and immutable revisions remain in the central artifact
catalog.

```text
examples/<id>/
  example.json
  controller.mjs
  tests.json
  app.*                 workload-specific runner
  backends/             optional workload-specific adapters
```

An example may add modules and compact fixtures below its own directory. The
application-level `src/` directory contains only the shared catalog shell and
report dashboard; workload engines and JavaScript oracles belong to their
example package.

The manifest contract is `browser-benchmarks/example` schema version 1:

```json
{
  "schemaVersion": 1,
  "kind": "browser-benchmarks/example",
  "id": "client-example",
  "title": "Client example",
  "summary": "VIR and JavaScript comparison",
  "lifecycle": "candidate",
  "packages": [
    {
      "id": "main",
      "target": "Client/Benchmark.lean",
      "exports": ["Client.Benchmark.run"]
    }
  ],
  "controller": "examples/client-example/controller.mjs",
  "testPackage": "examples/client-example/tests.json"
}
```

The repository validator is:

```sh
npm run examples:check
```

`examples/example.schema.json` and `examples/tests.schema.json` are provided
for editor integration. The Node validator is authoritative. It also verifies
that the controller and test package exist and that every declared test and
benchmark study is exported by the controller.

## Self-contained tests and variants

`tests.json` owns the inputs and coverage contract for every selectable
variant. A compact package looks like:

```json
{
  "schemaVersion": 1,
  "kind": "browser-benchmarks/example-tests",
  "example": "client-example",
  "variants": [
    {
      "id": "default",
      "title": "Default renderer",
      "build": "client-example",
      "tests": [
        {
          "id": "quick-parity",
          "study": "smoke",
          "oracle": "js",
          "backends": ["js", "vir", "native"],
          "data": { "cases": [] }
        }
      ],
      "benchmark": {
        "study": "suite",
        "data": { "studies": ["differential", "scaling"] }
      }
    }
  ]
}
```

The first variant is named `default`. Its `build` selects a catalog record bound
to the same example and variant. Additional variants, such as an HTML generator,
carry their own build selection, differential inputs, backend set, and
benchmark suite without changing the generic runner. `oracle: "js"`
records that the JavaScript backend supplies the semantic reference. Use
`null` when a test relies on fixture output or pairwise comparison instead.
The browser presents the same variants in its shared selector and records the
selection as `?example=<id>&variant=<id>`; controllers do not implement their
own variant picker.

Run or inspect one complete selection with:

```sh
npm run example -- client-example default --plan
npm run example -- client-example default --materialize --prepare
npm run example -- client-example default --test-only
```

`--materialize` creates or verifies every exact catalogued source below the
controlled `_sources/` directory, and `--prepare` runs producer-owned setup.
The full command then builds and imports the variant's candidate and runs every
declared differential test. Existing clean producer checkouts may instead be
selected with `--toolchain` or a toolchain config. `--test-only` uses
already-staged artifacts. None of these commands treats benchmark timings as
evidence; the benchmark entry point is registered for explicit
controlled-machine runs. Candidate
bundles retain the complete `EXAMPLE_TEST.json` run, including test-package
identity, oracle, exercised backends, inputs echoed by the workload report, and
artifact provenance.

CI discovers every non-null variant build from these packages. The generic
candidate matrix then selects the example and variant through the same command,
so adding a canonical build does not require a workload-specific workflow.

Static deployment is a separate admission step. `--deploy EXAMPLE=VARIANT`
requires the selected variant to own a canonical build and requires its staged
artifact manifest, payload hashes, and complete test-package identity to match
that build. A static artifact root represents one variant per example, so the
deployment builder rejects multi-variant test packages until their artifact
sets have a variant-aware static layout. Rehearsals with `build: null` remain
available locally but are not included in the public catalog.

## VIR compilation routes

The central catalog supplies the client's repository and exact revision. The
standard `vir` adapter resolves each referenced `packages` entry and performs
the same operations:

1. resolve a clean checkout at the catalogued revision;
2. build the catalogued VIR runtime once;
3. invoke `lake exe vir_irpkg` with the declared target and exports;
4. place the package under the example's artifact namespace;
5. record source, runtime, package, and file digests.

Compilation stops at that package boundary. Candidate validation then packs
and imports the complete artifact set and runs the shared browser tests,
including the example controller's smoke study.

More than one package is allowed for declarations that cannot share one
closure, but the standard compilation procedure is unchanged. A client that
requires its own Lake context or a repository-owned export driver instead uses
the `package-command` adapter. That command receives exact checkout and
dependency-package paths, owns the concrete wrapper and compilation command,
and publishes the same `browser-benchmarks/source-package/v1` package contract.
FIR, LLVM, and other comparison artifacts use that contract as well; their
internal compiler commands remain producer-owned.

Every packed payload path begins with `<example-id>/`, and the browser stages
it under `artifacts/<example-id>/`. The shared stager replaces only that
directory, so refreshing one client cannot delete another client's artifacts.

## Controller boundary

`controller.mjs` is ordinary JavaScript. TypeScript may be used by a client,
but it must publish an ES module and TypeScript is not required by this
repository. [`examples/controller-contract.d.ts`](../examples/controller-contract.d.ts)
is the editor-facing type declaration for the context and returned controller.
The runtime guard remains
[`examples/controller-contract.mjs`](../examples/controller-contract.mjs).
The module exports:

```js
export const view = { /* controls and presentation */ };
export async function loadExample(context) { /* return controller */ }
```

`context.example` is the selected, validated example descriptor.
`context.artifactBaseUrl` is the URL of its derived
`artifacts/<example-id>/` directory. It is available to controllers that load
staged payloads directly, so they do not need to declare another artifact root.
`context.testPackage` and `context.variant` contain the selected self-contained
test data. The same selection is available to classic-script controllers as
`globalThis.__benchmarkExampleContext`.

Bootstrap scripts declared in `view.bootstrap.classicScripts` are resolved
from the application root. Payload scripts use `artifactScripts` and are
resolved from `context.artifactBaseUrl`; example controllers must not repeat
`artifacts/<example-id>/` in their declarations.

The returned controller implements `browser-benchmarks/controller/v1`:

```js
{
  ready: Promise<{ readyCount, backendCount }>,
  getBackends(),
  runStudy(studyId),
  dispose?()
}
```

The controller owns workload-specific input generation, correctness checks,
and its source report. `runStudy()` returns that report with `kind`, `passed`,
and `backendIds`; the existing differential test contract already checks the
backend identity. The shared shell observes the returned report and adapts
common numeric shapes to one backend filter, metric selector, chart, and value
table. Current adapters cover scenario/backends reports, scaling
`dimensions[].points`, retained-memory points, and lean-zip-style workload
cells. The source object is not rewritten.

An example may keep a specialized detailed view for data that does not fit the
shared comparison. This is presentation layering, not a new producer or report
schema: compilation descriptors remain small, client JSON remains
downloadable, and adding a metric does not require changing the controller
contract.

## Lifecycle

- `candidate`: descriptor or artifacts are under integration.
- `active`: accepted and runnable through a catalogued artifact set.
- `rehearsal`: runnable only from explicitly local inputs.
- `queued`: validator-visible but hidden from the runnable browser catalog.
- `archived`: retained for provenance but hidden from the default catalog.

Queued integrations may commit their descriptor, tests, and thin local
controller before immutable producer revisions exist. They remain hidden and
must keep `build: null`; workload engines still belong to the client-owned
source package rather than being copied into this application. See
[`LEAN_ZIP_INTEGRATION.md`](LEAN_ZIP_INTEGRATION.md) for a multi-producer
example.
