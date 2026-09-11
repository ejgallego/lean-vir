# ProofWidgets Porting Notes

The target is ordinary ProofWidgets React components authored in Lean instead
of TypeScript, using the same browser values, infoview contexts, and upstream
libraries. A component may call server RPC, render directly, or compose other
components. `mk_rpc_widget%` and `HtmlDisplay` are optional tools for the
server-produced `ProofWidgets.Html` protocol, not the definition of a widget.

## Upstream Targets

Reference repository: <https://github.com/leanprover-community/ProofWidgets4>.

An upstream `Component Props` names a React export in a widget module; props
cross through `RpcEncodable`. VIR ports should preserve that component/props
model and reuse the infoview's module-loading environment.

The upstream README points users to `ProofWidgets/Demos/` for live-codeable
demos and calls out library-backed widgets such as Penrose, Recharts, Rubiks,
and red-black trees. The directory currently includes small syntax/UI demos
such as `Jsx.lean`, interactive examples such as `LazyComputation.lean`, and
library-heavy demos such as `Plot.lean`, `Venn.lean`, `Rubiks.lean`, and
`RbTree.lean`.

Demo-level end-to-end exercises:

1. `ProofWidgets/Demos/Jsx.lean`: validate the shallow HTML/React authoring
   model with ordinary Lean combinators before adding syntax sugar.
2. `ProofWidgets/Demos/LazyComputation.lean`: validate server RPC references,
   user actions, and infoview request lifetimes.
3. `ProofWidgets/Demos/Plot.lean`: first serious external-library pressure
   test because it depends on Recharts-style components.

## Current Foundation

The current VIR demos prove both directions: a Lean-authored React component
can receive a real infoview surface, and a VIR-native goals/hypotheses panel can
be assembled from nested Lean components with ordinary React state.

The first authoring slice is `Vir.ProofWidgets.Html`, backed directly by native
React node construction. It is not the upstream serializable `ProofWidgets.Html`
datatype and does not establish compatibility with its wire protocol.
`Html.ofComponent` passes `ComponentProps` with props and child `Html` values,
so component children are rendered by ordinary Lean component functions. The
`fixtures/ProofWidgetsHtml.lean` and `fixtures/ProofWidgetsJsxSubset.lean`
demos use `Html.text`, `Html.element`, `Html.ofComponent`, `Attr`, `Handler`,
and native JSX in an upstream-recognizable shape.

`ProofWidgetsJsxSubset.lean` ports the static surface of upstream
`ProofWidgets/Demos/Jsx.lean` through `Vir.ProofWidgets.Jsx`:

- lowercase HTML tags such as `b`, `img`, `span`, and `hr`;
- string and interpolated attributes such as `src`, `alt`, and `style`;
- child array spread and string interpolation;
- uppercase components, typed props, component keys, and child spreads;
- a small callback to keep handler coverage in the same fixture.

The [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md) renders real server
data and returns a genuine `Server.WithRpcRef` through the official client.
See the [RPC guide](PROOFWIDGETS_RPC_COMPATIBILITY.md) for session/Promise/reference
semantics and [HARNESS.md](HARNESS.md#infoview-rpc-and-lifetime-checks) for acceptance.

When implementing a port:

- Lean users provide a React component and widget props are derived around it.
- React lifetime is delegated to the JS React runtime.
- Reloads should follow fresh IR package revisions, not cursor-only movement.
- The binding layer should model React and DOM operations directly through
  `ReactM` and `DomM`, not via unrestricted `IO`.

## Planned Component Parity

The following components are planned; none is established as a completed VIR
port by the current static JSX or RPC acceptance tests. Each port should compare
the Lean-authored browser component with upstream behavior, reuse upstream
dependencies, and add only the bindings needed by that example.

| Target | Behavior and dependency to exercise |
| --- | --- |
| `InteractiveExpr` | Receive a genuine elaborator-backed `ExprWithCtx` reference, request tagged pretty-printing, and reuse infoview `InteractiveCode` for interactive display. A string goal snapshot is not a substitute. |
| `HtmlDisplay` | Port the browser renderer to Lean: consume the existing upstream `ProofWidgets.Html` wire value, construct native React nodes, and resolve component exports through upstream module-loading support. Do not design a new wire dialect. |
| `MakeEditLink` | Apply the supplied editor edit and optional selection through the official editor context; preserve children and event behavior. |
| `GoalTypePanel` / `SelectionPanel` | Preserve panel props, document position, goal locations, and selected-expression behavior while reusing upstream presentation/RPC dependencies. |
| `FilterDetails` / `Maximizable` / `InteractiveSvg` | Exercise stateful filtering and layout, then SVG events and server updates, with native React state and upstream child components. |

`InteractiveCode` is an upstream dependency to reuse, not an additional renderer
for VIR to implement. Likewise, the existing upstream `HtmlDisplay` can be used
directly before a Lean implementation of its component behavior is attempted.
Importing a component is useful interoperability, but by itself is not evidence
that its Lean-authored counterpart has been ported.

Current authoring limits include:

- The native JSX facade's `Attr` values use `Lean.Vir.React.Property`; this
  authoring API is distinct from the upstream serialized `Html` props format.
- The RPC tutorial's asynchronous parent is JavaScript-authored. It establishes
  the direct session/Promise boundary and Lean rendering, not yet the complete
  Lean-authored implementation of the components above.
- External component imports and full infoview context integration still need
  acceptance coverage beyond the position-specific RPC session.

Per-port open questions:

- Which shared server/client declarations and identity-preserving accessors
  remove duplicated schema assumptions? Follow the
  [response-type contract](PROOFWIDGETS_RPC_COMPATIBILITY.md#server-references-and-response-types)
  without introducing a second decoded object model.
- Can the infoview/webview host provide raw binary asset transport instead of
  base64 RPC payloads? This is a host-capability question, not a promised
  upstream feature or a change to widget semantics.

## Responsibilities At The Boundary

Port missing behavior without adding guarantees that the TypeScript component
does not provide. The [host contract](HOST_BINDINGS.md#semantic-fidelity) owns
the shared programmer responsibilities and foreign-heap obligations; the
[RPC guide](PROOFWIDGETS_RPC_COMPATIBILITY.md#server-references-and-response-types)
explains response types, checks and exact server-reference ownership.

## External JavaScript Libraries

External JS libraries are part of ProofWidgets support.
ProofWidgets4 documents library-backed demos for Penrose and Recharts and has
purpose-specific integrations such as Rubiks and red-black trees, so VIR needs a
first-class way to bind libraries instead of hard-coding each component in the
runtime. Prefer the existing upstream components and infoview exports whenever
they already implement the required behavior.

Scaffolded requirements for that larger project:

- A Lean-side declaration should be able to name an ES module specifier plus a
  default or named export.
- Package metadata should record those imports so the JS loader can resolve
  them in the infoview/webview environment.
- React itself must remain external and aligned with the infoview-provided
  React runtime.
- The binding should preserve exact values behind phantom types such as `Js α`,
  including polymorphic JavaScript values.
- The first validation target should be a small Recharts-style component from
  `Plot.lean`, because it exercises external components, arrays of data, and
  prop objects without requiring the full ProofWidgets surface.
