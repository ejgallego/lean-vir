# Examples, tutorials, and fixtures

Lean VIR keeps three different kinds of client code. Their location determines
their role; being compiled into a browser package does not make a test fixture
a public example.

## Examples

An example should demonstrate a useful application of Lean VIR and be worth
opening on its own.

- `examples/MergeSort.lean` is the first runnable example. The landing page
  calls `SortDemo.sortArray` and displays the array returned by Lean.
- `Vir/Examples/Tamagotchi.lean` owns the reusable Tamagotchi state machine and
  `ReactTamagotchi.View`. The same component is mounted by the standalone
  browser page and `examples/ReactTamagotchiWidget.lean` in the infoview.
Public pages should link to these applications. Runtime diagnostics and package
inspection belong under developer tools.

## Developer tools

`examples/ReactProofWidget.lean` is an editor tool rather than a standalone
application. It derives tactic actions from the current proof context and
inserts the selected action at the cursor. It is loaded through the infoview,
not shown in the public React page.

## Tutorials

Tutorials teach one API with intentionally small code. They are source to copy,
not a gallery of applications.

- `examples/tutorials/ReactCounter.lean` introduces state and callbacks.
- `examples/tutorials/ReactProofWidgetHello.lean` introduces a live infoview
  component without the proof-action tool's behavior.

`npm run test:tutorials` elaborates both tutorial sources. The ProofWidget
tutorial is additionally exercised through the existing browser package.

## Fixtures

A fixture exists to protect one runtime, host, or interface contract. Fixtures
are exercised by automated tests and are not deployed as examples.

- `fixtures/ReactCounter.lean` covers React effects, memoization, refs,
  lifecycle failures, and benchmark-shaped trees.
- `fixtures/ReactInput.lean` covers controlled inputs and DOM attributes.
- `fixtures/ProofWidgetsHtml.lean` and
  `fixtures/ProofWidgetsJsxSubset.lean` cover compatibility surfaces.
- `fixtures/InterfaceShapes.lean` is an ABI conformance matrix. A case belongs
  there only when it represents a distinct supported boundary shape.
- `fixtures/RecursiveTypes.lean` protects recursive value conversion. Its tree,
  chain, and JSON-shaped cases remain only while each catches a distinct
  encoding path.
- `fixtures/Boundary.lean` covers numeric and runtime boundaries.
- `fixtures/infoview/` contains the Lean-only infoview smoke driver and its
  imported-module fixture; these are test inputs, not public `Vir` modules.

`fixtures/manifest.json` is the executable test catalog. It may be large, but
the landing page and example pages must not render it. Use `demo.html` or the
package runner when diagnosing those cases locally.

## Adding client code

1. Put a useful standalone application under `examples/`.
2. Put a minimal teaching progression under `examples/tutorials/`.
3. Put conformance, regression, and stress cases under `fixtures/` and state
   the unique contract each case protects.
4. Register package roots in `fixtures/browser-packages.json`; register
   automated fixture calls in `fixtures/manifest.json`.
5. Do not add a fixture to the landing page to make it discoverable. Add or
   improve developer documentation instead.
