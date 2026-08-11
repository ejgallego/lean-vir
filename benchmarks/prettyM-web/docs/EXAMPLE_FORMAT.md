# Benchmark example format

A VIR client contributes one small descriptor and one browser controller. The
descriptor contains no shell commands, machine paths, generated artifacts, or
UI layout. Build source and immutable revisions remain in the central artifact
catalog.

```text
examples/<id>/
  example.json
  controller.mjs
```

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
  "controller": "examples/client-example/controller.mjs"
}
```

The repository validator is:

```sh
npm run examples:check
```

`examples/example.schema.json` is provided for editor integration. The Node
validator is authoritative and also verifies that the controller exists.

## Uniform VIR compilation

The central catalog supplies the client's repository and exact revision. For
every `packages` entry the harness performs the same operations:

1. resolve a clean checkout at the catalogued revision;
2. build the catalogued VIR runtime once;
3. invoke `lake exe vir_irpkg` with the declared target and exports;
4. place the package under the example's artifact namespace;
5. record source, runtime, package, and file digests; and
6. run the example controller's smoke study.

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
