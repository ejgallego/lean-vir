# Examples, tutorials, and fixtures

Choose client code's home by its purpose. Compiling a fixture into a browser
package does not make it a public example. See [HARNESS.md](../HARNESS.md) for
check selection and artifact prerequisites.

## Examples

An example under `examples/` should demonstrate a useful application and be
worth opening on its own.

- [MergeSort](../../examples/MergeSort.lean) supplies the landing page's
  `SortDemo.sortArray` call and displays the array returned by Lean.
- [HostInterop](../../examples/HostInterop.lean) sets and reads the browser title,
  with explicit conversion at the JavaScript boundary.
- [Tamagotchi](../../Vir/Examples/Tamagotchi.lean) owns the reusable state machine
  and `ReactTamagotchi.View`. The standalone browser page and
  [infoview widget](../../examples/ReactTamagotchiWidget.lean) mount that same
  component.

Public pages should link to these applications. Runtime diagnostics and package
inspection belong under developer tools.

## Developer tools

[VirNativeInfoview](../../examples/VirNativeInfoview.lean) renders the live goals
and local context, with collapsible goal cards. It is the full viewer alongside
the small Hello tutorial, not a second widget runtime. The older proof-action
demo has been retired; tactic insertion and clipboard fallbacks are not features
of this viewer.

## Tutorials

Tutorials under `examples/tutorials/` teach one API with small, copyable code:

- [ReactCounter](../../examples/tutorials/ReactCounter.lean) introduces state and
  callbacks.
- [ReactProofWidgetHello](../../examples/tutorials/ReactProofWidgetHello.lean)
  introduces a live infoview component.
- [RpcReferenceWidget](../../examples/tutorials/RpcReferenceWidget.md) is an
  all-Lean infoview application whose effect owns native RPC Promise
  continuations, loading/error state, cancellation, stale-result suppression
  and same-position edit refresh policy.

## Fixtures

Put conformance, regression and stress cases under `fixtures/`, and state the
distinct contract each protects. An
[interface-shape case](../../fixtures/InterfaceShapes.lean) must exercise a distinct
supported ABI shape; a [recursive-value case](../../fixtures/RecursiveTypes.lean)
must protect a distinct encoding path. React and DOM cases belong with the
[browser suites](../../tests/browser). The goal snapshots and cancellation-only
methods under [fixtures/infoview/](../../fixtures/infoview) are test inputs, not
public `Vir` APIs.

[HostInterop regressions](../../fixtures/HostInterop.lean) exercise callbacks,
collection traversal, DOM operations, timers and animation frames. They import
the tiny title example and retain the `HostInterop.*` entry names used by tests
and benchmarks; package acquisition selects `fixtures.HostInterop` for those
regression entries.

[fixtures/manifest.json](../../fixtures/manifest.json) is the executable oracle
catalog. Its cases are available in `/demo.html` and the package runner;
public application pages do not present the fixture catalog.

## Adding client code

Browser packages contain focused compiled `Lean.IR.Decl` closures. Lake builds
the Lean modules; regenerating their `.irpkg` files normally needs no rebuild
or relink of the upstream interpreter.

1. Choose the location above and register the compiled module in the appropriate
   `lean_lib` roots/globs in [lakefile.lean](../../lakefile.lean). Keep entrypoints
   and interface types public; implementation helpers may remain private.
2. Add `{ "module": "MyModule", "roots": ["MyModule.entry"] }` to the chosen
   package's `targets` in
   [fixtures/browser-packages.json](../../fixtures/browser-packages.json).
   Selected modules build automatically. Use `lakeTargets` for additional build
   prerequisites and `packageOnly: true` for internal support roots that should
   not become JavaScript interface exports.
3. For an oracle fixture, add its call to `fixtures/manifest.json` and its
   source/module pair to the package's `fixtureInputs`, following the
   [catalog rules](#fixture-catalog-rules).
4. Generate the packages with `npm run check:package` and inspect the relevant
   `build/generated/*.report.md`. The [harness](../HARNESS.md#smallest-useful-check)
   selects the additional checks for fixture behavior, native externs, host
   imports or UI changes.
5. Update `web/` when the application needs new UI, using the
   [manifest-driven entrypoints](#browser-entrypoints).

For a smaller loop, the [package guide](../guides/PACKAGES.md#generate-a-local-package)
covers explicit-root and public-definition generation, config-driven
`prepare:irpkg`, and [loading](../guides/PACKAGES.md#load-the-development-runner) a served
URL or uploaded `.irpkg` in `/dev.html`.

## Fixture catalog rules

The browser catalog is version 2. Its fixture inputs use explicit pairs such as
`{ "source": "fixtures/Basic.lean", "module": "fixtures.Basic" }`.
`source` is a navigation and coverage key; `module` is the Lake identity, never
inferred from the path. Browser fixtures are registered in `VirBrowserFixtures`
in `lakefile.lean`.

Each manifest source must occur in exactly one package's `fixtureInputs`.
Missing, duplicate and stale assignments are rejected by the
[catalog validation](../../web/app/pages/browser-package-config.js), used by
browser-package generation, the upstream smoke and the browser catalog. A
compiled module cannot be assigned to two different fixture source paths.

The [manifest validator](../../fixtures/fixture-manifest.mjs) accepts version 1
of the oracle catalog and rejects unknown fields. Each fixture has a unique
lowercase filename-safe `id`, plus `source`, `entry` and `result: { "type": "Nat" }`;
`unsafe: true` selects an unsafe host driver. The entry is always a package
root. Optional `roots` must be a non-empty list of additional roots with no
duplicate or repeated entry.

Repeated module selections union roots in first-seen order, separately for
exported and package-only roots; see the
[package planner](../../scripts/packages/browser-package-plan.mjs). A browser
`.irpkg` can bundle several modules; it does not require the per-module sharding
of Lake's `:vir` facet.

## Browser entrypoints

Use `vir.call(name, ...args)` from the [runtime API](../guides/JS_API.md#calls-and-manifest)
and include the declaration as an exported root. Do not add per-function or
per-shape Wasm exports for manifest-supported declarations. Unsupported marked
signatures fail at the declaration after Lean compilation; ad-hoc unmarked
roots are checked during package generation. The
[generator map](../reference/GENERATE_PACKAGE.md#implementation-ownership) identifies the classifier,
descriptor encoder and ABI owners when a new interface shape is needed.

`/dev.html` reads the embedded manifest to generate entry controls: enums get
select controls, while `Sum`, `Except` and other compound inputs use JSON.
Its [browser checks](../../tests/browser/dev-runner.mjs) derive entry ids and
export counts from those manifests.

For Lean-to-JavaScript calls, follow the
[host-import contract](../guides/LEAN_VIR_LIBRARY.md#packages-and-host-imports) and bind
the declared target in `hostBindings`. These synchronous `@[vir_js "..."]`
imports are separate from native extern registrations; an exact `Js` Promise
can cross without being awaited. The report's `JavaScript Host Imports` rows
show the Lean name, JS target, trampoline symbol, argument/result types, effect
and any erased-prefix count. For missing IR, native externs, initializer globals
or interface diagnostics, use [generator troubleshooting](../reference/GENERATE_PACKAGE.md#troubleshooting);
closure blockers include a first-discovered root path after `via`.

## Fixture oracle and summary

The [fixture runner](../../tests/fixtures/runner.mjs) builds the selected modules
and uses compiled `vir_irpkg` to package their IR. Its host drivers import
compiled bodies with `import all` and set `interpreter.prefer_native false`.
The host IR interpreter is the default oracle for the Wasm result.

When valid semantics intentionally differ by target, `expect` must supply
distinct decimal Nat strings for both `host` and `wasm` plus a non-empty
`reason`. For example, machine-word width can differ between a 64-bit host and
Wasm32. Equal results use the default oracle. Suspected compiler or runtime
inconsistencies must also keep that comparison so a disagreement fails.

Workers default to half of Node's `availableParallelism()`, rounded down with
at least one worker and capped by the selected fixture count. Set
`VIR_FIXTURE_JOBS=1` for serial debugging, or another positive integer for an
explicit limit. Malformed limits fail before any build starts. See the
[harness](../HARNESS.md#filters-concurrency-and-no-build-checks) for filtering and
the no-build path, which still builds Lean modules and fixture packages.

The runner writes `build/fixtures/summary.json` using
[schema version 2](../../tests/support/fixture-summary.mjs):

| Data | Meaning |
| --- | --- |
| `totals`, fixture `id`, `entry`, `status`, `detail` | Pass/fail counts and the per-case outcome or failure detail. |
| `expectedHost`, `expectedWasm`, `expectationReason` | Declared target overrides; `null` for the default oracle. |
| `host`, `wasm` | Observed values; `null` when unavailable. |
| `timing` | `totalSeconds`, `hostSeconds`, `packageSeconds`, `wasmSeconds`; unreached package/Wasm phases record zero seconds. |
| `diagnostics` | `loadedDeclCount`, `importedDecls`, `nativeExterns`, `initGlobals`, `missingDecls`, `missingNativeExterns`, `unsupportedInitGlobals`. |

Unavailable timing, diagnostics or failure detail are `null`. Missing
dependencies retain `{ name, via }`, where `via` is the declaration path.
These fields expose growth in the imported closure, initialization surface or
native boundary. The [diagnostic parser](../../tests/support/fixture-diagnostics.mjs)
and [result tests](../../tests/fixtures/runner-result.test.mjs) show concrete examples.

## Coverage boundaries

The suites exercise different boundaries:

- [Basic values](../../fixtures/Basic.lean), [lists/options](../../fixtures/ListOption.lean),
  [numeric/runtime boundaries](../../fixtures/Boundary.lean),
  [interface shapes](../../fixtures/InterfaceShapes.lean) and
  [recursive types](../../fixtures/RecursiveTypes.lean) cover value and ABI paths.
- [Parser initialization](../../fixtures/LeanParserHeader.lean),
  [module package sets](../../tests/runtime/module-package-set-smoke.mjs) and
  [Lake facets](../../tests/packages/lake-facets.sh) exercise compiled inputs,
  initialization ownership and build invalidation.
- [Package-generation cases](../../tests/runtime/package-generation-smoke.mjs) and
  [marker checks](../../tests/runtime/package-generator-smoke.mjs) distinguish
  elaboration failures from package diagnostics and exercise extern fallbacks.
- [Browser suites](../../tests/browser) and [real-server RPC checks](../../tests/infoview)
  exercise DOM, official React and editor semantics.

[Task fixtures](../../fixtures/Task.lean) exercise only synchronous, already-resolved
`Task.pure`, `Task.get` and `Task.map`. This provides no task scheduler or general
blocking IO. Other runtime limits belong to the
[upstream boundary](../reference/UPSTREAM_BOUNDARY.md#explicit-limitations); the
[API inventory](../API_COVERAGE.md) is separate from tested behavior.

## Known pretty-printer boundary

[FormatPretty](../../fixtures/FormatPretty.lean), `pretty-printer.irpkg` and the
`/format.html` workbench exercise `Std.Format.pretty`. They do not establish
support for `Lean.PrettyPrinter.ppExpr`.

Earlier local `ppExpr` probes over a minimal expression worked in host Lean,
but the delaborator closure exceeded seven thousand declarations and reached
`Task`/`Promise`, `Environment` async constants, `Lean.Meta.inferType`,
`Lean.Meta.whnf`, expression substitution/equality and IO/task state. That count
is historical probe evidence, not a size claim for current builds. The full
pretty path also reaches the parenthesizer and formatter interpreter boundary.

These dependencies arise through real environments: `Environment.checked`
stores a `Task Kernel.Environment`; `addConstAsync` and `promiseChecked` use
`IO.Promise.result?.bind`, `AsyncConsts.findRecTask` uses `Task.bind`, and
`Lean.addDecl` can use `BaseIO.mapTask`. Those runtime dependencies are outside
the small `Std.Format.pretty` package.
