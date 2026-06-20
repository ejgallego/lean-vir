# ProofWidgets Porting Notes

This note tracks the next concrete ProofWidgets compatibility work without
turning it into a full coverage matrix yet.

## Upstream Targets

Reference repository: <https://github.com/leanprover-community/ProofWidgets4>.
The upstream README points users to `ProofWidgets/Demos/` for live-codeable
demos and calls out library-backed widgets such as Penrose, Recharts, Rubiks,
and red-black trees. The directory currently includes small syntax/UI demos
such as `Jsx.lean`, interactive examples such as `LazyComputation.lean`, and
library-heavy demos such as `Plot.lean`, `Venn.lean`, `Rubiks.lean`, and
`RbTree.lean`.

Initial VIR porting order:

1. `ProofWidgets/Demos/Jsx.lean`: validate the shallow HTML/React authoring
   model with ordinary Lean combinators before adding syntax sugar.
2. `ProofWidgets/Demos/LazyComputation.lean`: validate server RPC references,
   user actions, and infoview request lifetimes.
3. `ProofWidgets/Demos/Plot.lean`: first serious external-library pressure
   test because it depends on Recharts-style components.

## Current Gap

The current VIR demo proves that a Lean-authored React component can receive a
real infoview surface, render goals/selections, use host commands, and reload a
fresh IR package. It is not yet a faithful port of an upstream ProofWidgets
demo.

The first compatibility slice is `Vir.ProofWidgets.Html`, backed directly by
native `ReactNode` resources instead of a second recursive HTML tree.
`Html.ofComponent` passes `ComponentProps` with props and child `Html` values,
so component children are rendered by ordinary Lean component functions. The
`examples/ProofWidgetsHtml.lean` and `examples/ProofWidgetsJsxSubset.lean`
demos use `Html.text`, `Html.element`, `Html.ofComponent`, `Attr`, and
`Handler` aliases in an upstream-recognizable shape and are included in the
`demo-host.irpkg` runtime smoke package.

`ProofWidgetsJsxSubset.lean` now ports the static surface of upstream
`ProofWidgets/Demos/Jsx.lean` with explicit combinators plus the first narrow
reference-shaped interactive case:

- lowercase HTML tags such as `b`, `img`, `span`, and `hr`;
- string and interpolated attributes such as `src`, `alt`, and `style`;
- child array spread and string interpolation;
- an uppercase `MarkdownDisplay`-shaped component with props;
- a small callback to keep handler coverage in the same fixture;
- an `InteractiveExpr`-shaped component whose props carry
  `WithRpcRef ExprWithCtx` and whose click handler calls
  `ProofWidgets.Rpc.resolve`.

The RPC slice is deliberately small. `Vir.ProofWidgets.Rpc` defines `RpcRef`,
`WithRpcRef α`, `ResolvedRef`, `ExprWithCtx.save`, and `Rpc.resolveRef`. The
browser/virtual hosts normalize refs behind `proofwidgets.rpc.resolveRef`. In
the infoview, `Surface.proofWidgetsExpr` now carries a live
`WithRpcRef ExprWithCtx` prop backed by the preferred server-owned
`Lean.Server.WithRpcRef` path,
`Lean.Vir.Infoview.resolveProofWidgetsExprWithCtxRef`. The browser stores the
opaque RPC handle as a typed `Js ServerRef` host resource, so the callback path
does not serialize or parse RPC refs through a string field. Descriptor refs
still resolve through `Lean.Vir.Infoview.resolveProofWidgetsRpcRef` as a
fallback for tests and static examples. The `InteractiveExpr`-shaped demos use
ordinary React state to render the async result from the callback, keeping the
component behavior close to a JavaScript React component. This proves the
typed prop, host-dispatch, component-state, and infoview RPC round trip needed
by an `InteractiveExpr`-style port. It is not yet proof-script editing or the
full ProofWidgets RPC request model.

Before attempting a port, keep the authoring model shallow and familiar:

- Lean users provide a React component and widget props are derived around it.
- React lifetime is delegated to the JS React runtime.
- Reloads should follow fresh IR package revisions, not cursor-only movement.
- The binding layer should model React and DOM operations directly through
  `ReactM` and `DomM`, not via unrestricted `IO`.

Known first-slice limits:

- Attribute values are `Lean.Vir.React.Property`, not arbitrary JSON props.
- JSX syntax is intentionally deferred; `ProofWidgetsJsxSubset.lean` keeps the
  porting shape as explicit combinators for now.
- The upstream `InteractiveExpr` example still needs elaborator-backed
  `ExprWithCtx` objects and rendering before it can be considered faithfully
  ported.

## External JavaScript Libraries

External JS libraries are a required part of credible ProofWidgets support.
ProofWidgets4 documents library-backed demos for Penrose and Recharts and has
purpose-specific integrations such as Rubiks and red-black trees, so VIR needs a
first-class way to bind libraries instead of hard-coding each component in the
runtime.

Scaffolded requirements for that larger project:

- A Lean-side declaration should be able to name an ES module specifier plus a
  default or named export.
- Package metadata should record those imports so the JS loader can resolve
  them in the infoview/webview environment.
- React itself must remain external and aligned with the infoview-provided
  React runtime.
- The binding should preserve typed wrapper values such as `Js α` so
  polymorphic JS APIs can be represented without pretending they are Lean data.
- The first validation target should be a small Recharts-style component from
  `Plot.lean`, because it exercises external components, arrays of data, and
  prop objects without requiring the full ProofWidgets surface.
