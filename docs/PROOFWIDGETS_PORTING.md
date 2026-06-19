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
native `ReactNode` resources instead of a second recursive HTML tree. The
`examples/ProofWidgetsHtml.lean` demo uses `Html.text`, `Html.element`,
`Html.ofComponent`, `Attr`, and `Handler` aliases in an upstream-recognizable
shape and is included in the `demo-host.irpkg` runtime smoke package.

Before attempting a port, keep the authoring model shallow and familiar:

- Lean users provide a React component and widget props are derived around it.
- React lifetime is delegated to the JS React runtime.
- Reloads should follow fresh IR package revisions, not cursor-only movement.
- The binding layer should model React and DOM operations directly through
  `ReactM` and `DomM`, not via unrestricted `IO`.

Known first-slice limits:

- `Html.ofComponent` currently renders a Lean function component with props;
  child-bearing component helpers are intentionally not exposed until the React
  component props model supports them directly.
- Attribute values are `Lean.Vir.React.Property`, not arbitrary JSON props.
- JSX syntax is intentionally deferred until the combinator surface has at least
  one faithful upstream-style port.

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
