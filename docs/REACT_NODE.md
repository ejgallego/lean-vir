# React Node Renderer

VIR exposes a small Lean surface for constructing and rendering native React
values. The binding rule is simple: where the React API accepts or returns a
JavaScript value, VIR passes that exact value.

## Values

The low-level marker types are phantom Lean types over ordinary JavaScript
values:

- `Js Node` is an actual React node or element;
- `Js ElementType` is the tag, component, symbol, or React type object;
- `Js Props` is a JavaScript object;
- `Js.Array Node` and `Js DependencyList` are JavaScript arrays;
- `Js ReactRef` is React's `{ current }` object;
- state values, actions, setters, and dispatchers are the values returned or
  stored by React.

There is no React-node wrapper, ownership lease, parallel node graph, or alias
table. `React.createElement` decides which parts of props and children it
copies or retains, exactly as it does in JavaScript.

## Construction

The low-level API constructs the exact JavaScript values explicitly:

```lean
import Vir.React

open Lean.Vir.React

def greeting (name : String) : ReactM (Lean.Vir.Js Node) :=
  do
    let props ← Lean.Vir.Js.Object.empty
    Lean.Vir.Js.Object.set props
      (← Lean.Vir.JsValue.ofString "className")
      (← Lean.Vir.JsValue.ofString "greeting")
    let children ← Lean.Vir.Js.Array.ofArray #[← Node.text s!"Hello, {name}"]
    Node.createElementTag "section" props children
```

The operations are generic JavaScript construction primitives:

- `js.object.empty` creates `{}` and `js.object.set` assigns an exact value;
- generic `js.array.empty` / `js.array.push` build the exact child array;
- `react.node.createElement` forwards the values to `React.createElement`;
- fragment construction forwards to `React.Fragment`.

The optional `Vir.ProofWidgets.Html` and JSX modules provide higher-level Lean
notation. They are not part of the React host protocol and do not introduce a
JavaScript wrapper or alternate props representation.

## Roots And Components

Browser roots are the objects returned by `ReactDOMClient.createRoot`.
`Root.renderNode` forwards an actual node to `root.render`, and `Root.unmount`
forwards to `root.unmount`.

`Root.render` is ordinary Lean composition: it builds the node, then calls the
exact `Root.renderNode` binding. `Root.renderComponent` similarly builds an
element from an already-created component function and forwards that node.
There are no separate root-render host protocols.

`Component.ofLean` explicitly creates one ordinary JavaScript function. That
exact function is the React component type. Reusing it preserves component
identity; calling `Component.ofLean` again creates a distinct type and asks
React to remount it. `Node.component` passes Lean props through one `JSL`
object stored in the native props object. React controls invocation, replay,
hooks, keys, and commits.

Selector helpers keep one active root per selected container and return a
boolean when the selector is missing. Root registration is tracked only so
runtime disposal can unmount it. If a newly created root cannot be published
back to Lean, the host-call transaction unmounts it.

Direct root submissions need no VIR commit acknowledgement. React receives and
retains the exact JavaScript node graph; ordinary JavaScript reachability keeps
its callbacks and JSL values alive, and superseded graphs remain ordinary
garbage-collection candidates.

## Hooks

The browser hook runtime delegates directly to official React:

- `useState` returns React's exact JavaScript tuple;
- `useReducer` accepts an exact JavaScript reducer and returns React's tuple;
- `useRef` returns React's ref object;
- `useMemo` receives the actual dependency array and returns React's result;
- `useCallback`, `useContext`, `useEffect`, and `useEffectWithDeps` call the
  corresponding official hooks with exact JavaScript inputs;
- state setters and reducer dispatchers receive the exact JavaScript value.

`StateTuple.toState` and `ReducerTuple.toState` are explicit projection
conveniences. `Reducer.ofLean`, `MemoCalculation.ofLean`, and
`Callback.ofUnary` explicitly turn a Lean callback into an ordinary JavaScript
function. `EffectCallback.ofLean` performs the analogous one-time conversion
for a setup/cleanup pair; `useLeanEffect` is Lean-only composition over that
value and exact `useEffect`. VIR keeps no committed/speculative hook slots,
action queues, dependency leases, or render-generation records.

React restrictions remain programmer responsibilities. Lean does not add
purity, valid hook ordering, complete dependency lists, replay-safe reducers,
or lane acknowledgements that TypeScript React lacks.

## Infoview Widgets

Import `Vir.Infoview` for the widget shell and activation command. The
[live example](../examples/tutorials/ReactProofWidgetHello.lean) supplies a
`RuntimeM (Js (React.Component Surface))` factory, then uses
`vir_proof_widget View` inside its namespace. The command generates
`widgetSpec`, `createComponent`, `mount`, `irPackage` and `widgetProps`.
`show_panel_widgets` activates the bundled `Lean.Vir.Infoview.widget` with those
props. No application-authored JavaScript file is needed for this path.

For manual assembly, [ReactWidget](../Vir/Infoview/Widget.lean) supplies the
standard package roots and props. The component entry returns
`RuntimeM (Js (React.Component Surface))`; the mount entry has type:

```lean
Js React.Root → Js (React.Component Surface) → Surface → DomM Unit
```

`WidgetProps` identifies the Wasm asset, `IRPackage`, component and mount
entries. The default shell creates a private runtime/binding factory and one
component function per loaded service. Cursor and surface updates reuse that
function and the official React root; widget configuration or package revision
changes replace the service. See the
[UI cleanup contract](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal) for
normal unmount versus hard disposal and failed-load cleanup.

Packages use the authoritative active Lean module snapshot, including unsaved
widget code. Revision checks cover the compiled declaration closure and local
source ranges; imported changes are visible once the snapshot contains them.
See [module inputs](MODULE_INPUTS.md) for visibility and acquisition rules.
`autoReloadMs` enables stat/revision polling; zero disables polling.
`ReactWidget` defaults to 1000 ms, while manually constructed `WidgetProps`
defaults to zero. Cursor movement alone does not request package replacement.

Build the optional widget module with `lake build VirInfoview`; see
[setup and artifact prerequisites](HARNESS.md#setup). If the example is already
open when that module is rebuilt, restart the Lean server or reopen the file.
The shell bundle leaves `react`, `react-dom` and `@leanprover/infoview` external
to use the infoview's dependencies. Its container stops propagation of click,
context-menu, mouse-down and pointer-down events to the outer panel.

For asynchronous server methods and exact server references, use the
[RPC guide](PROOFWIDGETS_RPC_COMPATIBILITY.md). Its tutorial's JavaScript async
parent is a separate current authoring limit, not a requirement of this
synchronous widget activation path.

## JavaScript Provenance

The hook and element providers are shallow calls to public React 19 APIs; VIR
ships no copied reconciler or hook implementation. Its explicit Lean-function
conversions create ordinary JavaScript functions. The
node provider only places a `JSL` props value under `leanProps` before calling
`React.createElement`. Root selector caching, unmount registration, and
host-call rollback are browser-host policy rather than React emulation. No
React binding in this surface is classified as semantics-changing.

## Refs And Events

Refs use React's exact semantics. A callback ref is the original function; an
object ref is the original object; React may write a DOM node or `null` to its
`current` property. VIR does not preserve an independent hidden ref payload.

Event handler props store the exact callback function. The browser/React event
object is passed unchanged. Any restrictions on using the event after the
handler are those of the corresponding React/browser version, not a VIR scope.

## JSL Values In React

A `JSL α` value is an ordinary JavaScript object with a private association to
one rooted Lean value. React stores that exact object. React's ordinary object
graph keeps it reachable; collection releases the Lean root as a best-effort
backstop, and runtime disposal provides deterministic cleanup.

This is generic JSL behavior. There is no React-specific JSL alias or lease.

## Browser-Only Semantics

Official React 19, ReactDOM, and Chromium are the semantic oracle. The Node
wrapper has no React providers and does not emulate nodes, hooks, roots,
reconciliation, Strict Mode, Suspense, or commits.

Runtime-only unit tests may use a fake root to verify generic active-resource
registration and rollback. All React behavior belongs in the browser suite.

## Validation

The browser matrix covers:

- exact props, callback, ref, setter, dispatcher, and memo identity;
- actual DOM ref assignment followed by `null` on unmount;
- Strict Mode effect behavior;
- dependency changes that return the same memo result;
- interleaved state lanes;
- suspended and abandoned renders;
- root render and unmount behavior;
- reused and replaced JavaScript component-function identity.

Run:

```bash
npm run build:site
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

See [HOST_BINDINGS.md](HOST_BINDINGS.md) for the underlying JavaScript-value
and active-resource contract.
