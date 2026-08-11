# VIR Surface and Boundary Analysis

The surface analyzer answers one question: **which Lean functions have a
complete static IR dependency closure under VIR's current runtime policy?**
For a blocked function it also shows every terminal boundary that must be
addressed, when the report contains a complete frontier.

Use the JSON report as the authoritative, versioned artifact. Markdown is a
compact summary; the browser explorer is an interactive view of the same data.

## What the analysis counts

Starting from each selected function, the analyzer follows transitive IR
references until every path is satisfied or reaches a terminal blocker:

- `missingExtern`: an extern is absent from VIR's native capability table;
- `incompatibleExtern`: a same-named VIR capability has a different target IR ABI;
- `missingDecl`: referenced IR is absent from the captured environment; or
- `unsupportedInitGlobal`: an initializer-backed global is unsupported.

Registered native externs are graph nodes and may contribute further Lean
dependencies. Exact-target capture compares their ordered parameter ownership
and IR types plus result type with VIR's capability table; capability symbols
may still differ intentionally. A `@[vir_js]` extern is accepted as a host
boundary, but this static analysis does not verify that a particular browser
host provides it.

The headline deliberately does not test package encoding, JavaScript-callable
types, linking, or browser execution. Those are separate checks. A
closure-complete result means only that the static VIR runtime boundary is
complete.

Two function totals are useful:

- **public constants** excludes private, boxed, and compiler-generated IR;
- **all IR** includes the entire compiler-produced function set.

For aggregate totals, each blocked function has one deterministic primary
blocker: shortest path first, then lexical boundary name. This prevents double
counting. Exact target reports additionally retain the complete blocker set for
each selected function.

## How a report is produced

| Stage | Information collected or derived |
| --- | --- |
| 1. Lean capture | Function names, modules, IR dependencies, extern targets and ABIs, types, and docstrings. |
| 2. VIR policy | Native externs, their Lean dependencies, and canonical primitive namespaces. |
| 3. Closure walk | Reachable nodes, terminal blockers, and one representative path to each blocker. |
| 4. Aggregation | Runnable totals, module/library rollups, primary blockers, extern status, and—when available—complete blocker membership. |

The browser performs no reachability analysis. It only indexes and displays
the report.

There are two report scopes:

| Scope | Use it for | Blocker data |
| --- | --- | --- |
| Installed libraries | Broad `Init`, `Lean`, `Std`, and `Lake` coverage | One primary blocker per blocked root |
| Exact target | A real entry point or function set, including projects on another Lean toolchain | Complete terminal blocker set per root |

Exact target reports also distinguish captured nodes from nodes reachable from
the selected roots. The remainder is support captured for VIR capabilities.

## Run an analysis

Install dependencies and build the analyzer once:

```bash
npm install
lake build vir_surface
```

### Installed Lean libraries

Scan the installed `Init`, `Lean`, `Std`, and `Lake` modules:

```bash
npm run analyze:surface -- \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/lean-libraries.md
```

For a quick current-toolchain scan, select modules and optionally roots:

```bash
npm run analyze:surface -- \
  /tmp/lean-meta.json /tmp/lean-meta.md \
  --module Lean.Meta.Basic \
  --root Lean.Meta.mkFreshExprMVar
```

For local source, add `--source FILE --source-module MODULE`. Its imports must
already be built with VIR's pinned toolchain and visible through `LEAN_PATH`.

### A project on its own Lean toolchain

Use this form when the target project pins another Lean version:

```bash
npm run analyze:target-surface -- \
  --project /path/to/project \
  --source Library/Entry.lean \
  --module Library.Entry \
  --root Library.Entry.main \
  --output-prefix build/vir-surface/library-entry
```

Repeat `--root` for a function set. Build the target project's imports first.
The command uses the project's `lake env lean` to capture IR, then evaluates
the neutral graph with VIR's current policy. It writes:

- `.graph.json`: captured target-toolchain IR;
- `.json`: full analysis used by comparison and the explorer; and
- `.md`: concise verdict and complete terminal frontier.

The report records both Lean identities plus source, complete captured-graph,
and root-reachable graph SHA-256 hashes. The root-reachable identity excludes
support captured only for VIR capabilities, so policy experiments remain
comparable while changes in imported target dependencies are rejected.
Source labels are project-relative (or reduced to a basename for files outside
the project) so reports and graph hashes do not expose checkout locations.
The browser's **Analysis method** panel shows these identities and short
fingerprints so the rendered result can be matched to its JSON artifact.

The target exporter intentionally imports only Lean. It duplicates a small
amount of metadata and IR-reference extraction because VIR oleans built by one
Lean version cannot be loaded by another; the parity smoke test keeps the two
analysis paths aligned.

### FIR compiler profile

The following profile covers FIR's public Wasm compilation paths and their
main validation/encoding helpers:

```bash
npm run analyze:target-surface -- \
  --project "$HOME/lean/fir" \
  --source Fir/Wasm/Emit/Source.lean \
  --module Fir.Wasm.Emit.Source \
  --root Fir.Wasm.Emit.Source.compile \
  --root Fir.Wasm.Emit.Source.compileModule \
  --root Fir.Wasm.Emit.Source.compileModuleArtifact \
  --root Fir.Wasm.Emit.Source.compileModuleArtifactWith \
  --root Fir.Wasm.Emit.Source.compileModuleArtifactWithExports \
  --root Fir.Validation.Lcnf.compileEntry \
  --root Fir.Wasm.Emit.encode \
  --output-prefix build/vir-surface/fir-compiler
```

### lean-zip operations profile

```bash
npm run analyze:target-surface -- \
  --project "$HOME/lean/lean-zip" \
  --source ZipTest.lean \
  --module ZipTest \
  --root Archive.create \
  --root Archive.extract \
  --root Archive.list \
  --root Gzip.compressFile \
  --root Gzip.decompressFile \
  --root Tar.extractTarGz \
  --root RawDeflate.decompressStream \
  --output-prefix build/vir-surface/lean-zip-operations
```

These paths are examples of local checkout locations, not repository setup
requirements.

## Render and serve the browser explorer

Render any surface JSON as a self-contained static site:

```bash
npm run render:surface -- \
  build/vir-surface/fir-compiler.json \
  build/vir-surface/explorer/fir
```

You may open `build/vir-surface/explorer/fir/index.html` directly. Serving it
over HTTP is more representative and avoids browser restrictions on local
scripts:

```bash
python3 -m http.server 4173 --directory build/vir-surface/explorer
```

Then open `http://127.0.0.1:4173/fir/`.

For a collection, render each report into its slug directory, using
`--collection` to add the return link, then create the landing page:

```bash
npm run render:surface -- build/vir-surface/lean-libraries.json \
  build/vir-surface/explorer/lean --collection
npm run render:surface -- build/vir-surface/fir-compiler.json \
  build/vir-surface/explorer/fir --collection
npm run render:surface -- build/vir-surface/lean-zip-operations.json \
  build/vir-surface/explorer/lean-zip --collection

npm run render:target-surface-index -- \
  build/vir-surface/explorer \
  lean "Lean libraries" build/vir-surface/lean-libraries.json \
  fir "FIR compiler" build/vir-surface/fir-compiler.json \
  lean-zip "lean-zip operations" build/vir-surface/lean-zip-operations.json
```

The landing comparison includes only selected-target reports with complete
frontiers. A broad library report still appears as a card, but its primary-only
blocker counts are not mixed into complete-frontier comparisons.

In a focused explorer:

- **Target** shows closure progress, signatures, docstrings, and paths;
- **All blockers** shows the complete terminal frontier;
- **Blocker sets** shows boundary membership across every selected function;
- **Externs** shows reached native, host, missing, and ABI-incompatible externs.

Selecting a function opens its complete blocker set. Selecting a boundary
opens its metadata and representative path without losing that function
context. Boundary-family groups are name-based navigation aids, not part of the
runnability decision.

`npm run build:analysis-site` produces the complete deployed surface and size
explorers. `npm run build:site` includes them in `web/dist/`.

## Measure size impact

Primary-blocker counts estimate **pressure**, not bytes or unlocks. An
unmeasured boundary is displayed as **Not measured**.

Size probes build the release Wasm and therefore require the normal
`npm run setup` (including the local WASI SDK) to have completed.

Measure exact stripped release-Wasm raw and deterministic-gzip deltas with:

```bash
npm run analyze:frontier-size -- \
  --output-prefix build/frontier-size-costs/example \
  Float.add Float.beq
```

Use a plan to measure a cluster directly:

```json
{
  "version": 1,
  "candidates": [
    { "id": "float-core", "names": ["Float.add", "Float.beq"] }
  ]
}
```

```bash
npm run analyze:frontier-size -- --plan /tmp/frontier-plan.json
```

Render those costs into the explorer:

```bash
npm run render:surface -- \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/explorer/lean \
  --frontier-costs build/frontier-size-costs/example.json
```

The UI displays the measured baseline's size and SHA-256 prefix. Costs are
exact only for that baseline; the renderer does not claim that an old cost file
matches the current checkout. Costs are also not additive because linker
garbage collection and compression interact, so price a proposed cluster as a
cluster.

A size result still does not tell how many functions become runnable. Measure
that separately with identical control and candidate surface scans, then use
the comparator.

## Compare runtime experiments

```bash
npm run compare:surface -- \
  control.json candidate.json \
  build/vir-surface/delta.json \
  build/vir-surface/delta.md
```

The comparator requires the same report version, Lean git hash, selected
modules, and declaration universe. Exact-target comparisons also require the
same captured source and root-reachable graph hashes. It reports exact newly
runnable functions, regressions, nearest-blocker transitions, and
module/library rollups.

This distinction matters: removing the current primary blocker may merely
expose the next boundary. Only the comparison's `newlyRunnable` set is an exact
unlock count.

## Validation and limits

Run the schema, closure, comparison, rendering, and browser-navigation checks:

```bash
npm run test:surface
CHROMIUM=/path/to/chromium npm run test:surface:browser
```

Rerun an exact-target analysis after changing either the target source or VIR's
capability policy. The complete frontier describes the current dependency
graph; a newly implemented capability may itself reveal new dependencies.

Package generation, strict linking, and host-versus-Wasm fixtures remain the
right follow-up before claiming that a closure-complete function executes
faithfully.

Older size/frontier studies are summarized in
[SURFACE_EXPERIMENTS.md](SURFACE_EXPERIMENTS.md). They explain past runtime
decisions but are not current measurements.
