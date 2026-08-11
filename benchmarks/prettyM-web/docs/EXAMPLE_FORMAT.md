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

Run or inspect one complete selection with:

```sh
npm run example -- client-example default --plan
npm run example -- client-example default
npm run example -- client-example default --test-only
```

The full command builds and imports the variant's catalogued candidate and then
runs every declared differential test. `--test-only` uses already-staged
artifacts. Neither command treats benchmark timings as evidence; the benchmark
entry point is registered for explicit controlled-machine runs. Candidate
bundles retain the complete `EXAMPLE_TEST.json` run, including test-package
identity, oracle, exercised backends, inputs echoed by the workload report, and
artifact provenance.

## Uniform VIR compilation

The central catalog supplies the client's repository and exact revision. For
every `packages` entry the harness performs the same operations:

1. resolve a clean checkout at the catalogued revision;
2. build the catalogued VIR runtime once;
3. invoke `lake exe vir_irpkg` with the declared target and exports;
4. place the package under the example's artifact namespace;
5. record source, runtime, package, and file digests.

Compilation stops at that package boundary. Candidate validation then packs
and imports the complete artifact set and runs the shared browser tests,
including the example controller's smoke study.

Clients do not provide compilation commands. More than one package is allowed
for declarations that cannot share one closure, but the compilation procedure
is unchanged. FIR, LLVM, or other comparison artifacts use the common
`browser-benchmarks/source-package/v1` output contract; their internal compiler
commands remain producer-owned.

Every packed payload path begins with `<example-id>/`, and the browser stages
it under `artifacts/<example-id>/`. The shared stager replaces only that
directory, so refreshing one client cannot delete another client's artifacts.

## Controller boundary

`controller.mjs` is ordinary JavaScript. TypeScript may be used by a client,
but it must publish an ES module and TypeScript is not required by this
repository. The module exports:

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
and report production. The shared shell owns discovery, navigation, controls,
artifact status, and report placement. Keeping presentation in the controller
means the compilation descriptor stays small and stable.

## Lifecycle

- `candidate`: descriptor or artifacts are under integration.
- `active`: accepted and runnable through a catalogued artifact set.
- `rehearsal`: runnable from explicitly local, non-publishable inputs.
- `queued`: validator-visible but hidden from the runnable browser catalog.
- `archived`: retained for provenance but hidden from the default catalog.
