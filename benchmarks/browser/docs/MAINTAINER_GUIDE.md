# Handoff: browser benchmark catalog and artifact pipeline

Last verified: 2026-08-12

## Purpose

`benchmarks/browser/` is a standalone browser benchmark catalog hosted in
VIR. It has no runtime dependency on the parent VIR source tree, Verso Slides,
Reveal, or Lake. Producer source stays in the repositories that own it; this
application owns selection, artifact assembly, correctness testing, serving,
and report presentation.

Read the repository `AGENTS.md`, this file, and `benchmarks/browser/README.md` before
changing the catalog. Generated sources, packages, artifacts, reports, and
machine-local toolchain configuration stay below the ignored application
directories.

## Canonical contracts

- `examples/<id>/example.json` declares identity, lifecycle, VIR package
  targets and exports, the browser controller, and the test package.
- `examples/<id>/tests.json` declares selectable variants, differential inputs,
  required backends, an optional JavaScript oracle, and the benchmark suite.
- `artifact-builds.json` selects exact producer revisions, component adapters,
  package files, dependencies, and artifact-set identity for canonical builds.
- `browser-benchmarks/source-package/v1` is the producer output boundary for
  FIR, VIR, LLVM, and future artifact producers.
- Artifact-set schema v2 requires every payload below `<example-id>/`; the
  generic stager atomically replaces only that example's artifact directory.
- `browser-benchmarks/controller/v1` is the workload-independent browser
  controller boundary. The shared shell owns discovery, variants, artifact
  status, controls, report placement, and backend filtering.

See `benchmarks/browser/docs/EXAMPLE_FORMAT.md`, `ARTIFACT_BUILDS.md`, and
`ARTIFACT_SETS.md` for the complete formats.

## Current state

- `prettyM/default` is the active canonical example. Its build contains VIR,
  FIR-native, and FIR-LLVM components and exercises five browser backends.
- `illuminate/default` is the second real client and uses the same catalog,
  shell, variant selector, artifact root, and report workflow. It remains a
  local rehearsal until Illuminate and FIR expose complete canonical producer
  entry points.
- Every canonical candidate is built from exact clean revisions materialized
  below `_sources/` or selected through an explicit FIR/VIR toolchain config.
- Source-build receipts bind the catalog, example, test package, producer
  identities, and staged bytes without recording machine-local paths.
- The fetcher and stager accept only namespaced artifact-set schema v2. No
  historical prototype lock or compatibility verifier is retained.
- `.github/workflows/example-candidate.yml` derives its matrix from catalogued
  example variants, builds ephemeral candidates, re-imports them through
  the consumer path, runs differential tests, and uploads short-lived payloads.
- The Pages workflow builds the same canonical `prettyM/default` candidate,
  admits it only after its staged manifest and test-package digest match the
  catalog, and installs the filtered app under `web/dist/benchmarks/`. It does
  not consume a pre-existing artifact archive.
- Dashboard backend filters are presentation-only; exported JSON retains the
  complete report.
- Timings from an uncontrolled or loaded machine are observations, not accepted
  performance evidence.

## Operator commands

Run application commands from `benchmarks/browser/`:

```bash
npm install
npm run examples:check
npm run example -- prettyM default --plan
npm run example -- prettyM default --materialize --prepare
npm run test:unit
npm run test:browser
npm run test:illuminate
npm run dev
```

Existing clean FIR/VIR checkouts may replace materialized sources:

```bash
npm run example -- prettyM default --prepare \
  --toolchain fir=/path/to/lean-fir \
  --toolchain vir=/path/to/lean-vir
```

The lower-level candidate consumer path is:

```bash
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- \
  --lock _artifacts/releases/prettyM-bounded-set-0002.lock.json \
  --archive _artifacts/releases/<generated-archive>.tar
```

These commands write only ignored candidate data and staged local artifacts.

## Validation expectations

Before handing off a catalog, controller, or artifact change:

- validate the example and build catalogs;
- run the unit suite and the affected example's browser differential suite;
- preserve exact rendered-text and styling-event parity;
- preserve prepare, execute, decode, and total phase boundaries;
- keep generated binaries and reports ignored; and
- record only portable source and artifact identities in generated receipts.

## Remaining integration

1. Add canonical Illuminate producer entry points and a clean catalog build,
   then admit it to Pages and remove its application-local rehearsal stager.
