# React API Fidelity Audit

This note compares the current Lean-authored React surface with the public
React API. It is an API-fidelity audit, not a replacement for the renderer
implementation details in [REACT_NODE.md](REACT_NODE.md) or the ProofWidgets
plan in [REACT_PROOFWIDGETS_ROADMAP.md](REACT_PROOFWIDGETS_ROADMAP.md).

This is also the first audit template for future JavaScript library bindings.
The binding should preserve the source library's names, call shapes, and
semantic contracts wherever the runtime permits it. Lean-specific differences
should expose real ownership, effect, and value-representation boundaries; they
should not invent a parallel API as the primary surface.

## Principle

React fidelity is the north star:

- bind React concepts under React names;
- keep React call shapes recognizable;
- expose runtime ownership explicitly with `Js`, `JSL`, `ReactM`, `DomM`, and
  `RuntimeM`;
- treat helper syntax as elaboration over the React-shaped API, not as a
  substitute programming model;
- avoid implicit conversion or magic coercion at the boundary.

The acceptable type deltas are the ones forced by the runtime. For example,
`Component props := props -> ReactM (Js Node)` is not the TypeScript type of a
React function component, but it exposes that Lean render code runs in a
React-construction effect and returns a JavaScript-owned React node resource.
That is a faithful type-level adaptation. By contrast, a separate Lean-first
HTML/component DSL should not become the core React API unless it elaborates
directly to React-shaped operations.

## Official Baseline

The audit baseline is the public React 19.2 reference, checked on
2026-07-06:

- [React reference overview](https://react.dev/reference/react)
- [`createElement(type, props, ...children)`](https://react.dev/reference/react/createElement)
- [`useState(initialState)`](https://react.dev/reference/react/useState)
- [`useReducer(reducer, initialArg, init?)`](https://react.dev/reference/react/useReducer)
- [`useEffect(setup, dependencies?)`](https://react.dev/reference/react/useEffect)
- [`useMemo(calculateValue, dependencies)`](https://react.dev/reference/react/useMemo)
- [`useCallback(fn, dependencies)`](https://react.dev/reference/react/useCallback)
- [`useContext(SomeContext)`](https://react.dev/reference/react/useContext)
- [`createRoot(domNode, options?)`](https://react.dev/reference/react-dom/client/createRoot)

## Current Fidelity Audit

| React concept | React shape | Current Lean shape | Fidelity |
| --- | --- | --- | --- |
| Function component | `function Component(props) { ... }` | `Component props := props -> ReactM (Js Node)` | Good. The effect and `Js Node` wrapper are justified runtime deltas. |
| Root creation | `createRoot(domNode, options?)` | `Root.create : Js Element -> DomM (Js Root)` | Close. Missing root options. Selector helpers are convenience, not core React. |
| Root render | `root.render(reactNode)` | `Root.render root (ReactM (Js Node))`; `Root.renderComponent` | Close. `renderComponent` is the bridge that creates a real JS React component so hooks run under React. |
| Root unmount | `root.unmount()` | `Root.unmount : Js Root -> DomM Unit` | Good. Resource cleanup is an explicit runtime concern. |
| Element construction | `createElement(type, props, ...children)` | `Node.createElement elementType props children` with `Array Props.Entry` | Close. `elementType : Js ElementType` mirrors React's `type`; Lean keeps an array for child-list ergonomics, and props carry keys, properties, and handlers together. |
| JSX | JSX elaborates to React elements | no native JSX-like syntax yet | Missing. Any future syntax should elaborate to `createElement`-shaped calls. |
| Fragment | `<Fragment>` / `<>` | `Node.fragment`, `Node.keyedFragment` | Close. Naming is Lean-style but maps directly to React fragments. |
| Props | one props argument, including event handlers and special fields such as `key`/`ref` | `Array Props.Entry` with `Props.key`, property helpers, and event helpers | Close. `ref` is not in the props lane yet. |
| Event handlers | props such as `onClick={...}` | `Props.onClick ...` entries | Close. Handler names and placement now match React's props model. |
| Children | variadic children after props | `Array (Js Node)` | Acceptable Lean adaptation, but the user-facing call should still read like React's child list. |
| Text children | string/number child values | explicit `Node.text` resources | Acceptable low-level representation. Syntax/helpers should make text children feel like React children without implicit conversion. |
| `useState` | returns `[state, setState]` | `Hooks.useState : Js a -> ReactM (State (Js a))` | Good semantic match. Explicit `JsValue` conversion is a necessary boundary. Scalar convenience wrappers should not become the core API. |
| state setter | `setState(next)` or updater function | `State.set`, `State.modify` | Close. The names differ because Lean lacks JS tuple/destructuring ergonomics, but both setter forms are present. |
| `useReducer` | `useReducer(reducer, initialArg, init?)` | reducer over `Js state -> Js action -> RuntimeM (Js state)` plus initial `Js state` | Good core direction. Missing initializer form. `JSL` adapters are explicit ownership helpers, not a different reducer API. |
| dispatch | `dispatch(action)` | `ReducerDispatch.dispatch dispatch action` | Close. Action is explicitly `Js action`, which matches the JS-land reducer surface. |
| `useRef` | returns ref object with `.current` | `Hooks.useRef`, `Ref.get`, `Ref.set` | Good. The explicit get/set API reflects the Wasm/Lean boundary. |
| `useEffect` | `useEffect(setup, dependencies?)`; cleanup optional | `Hooks.useEffect setup cleanup`; `useEffectWithDeps deps setup cleanup` | Partial. Runtime cleanup discipline is useful, but the public shape is split and requires cleanup/resource forms. |
| effect dependencies | any reactive JS values compared with `Object.is` | `Js DependencyList` built from `Js α` values | Close. Dependency values now stay JavaScript-owned; string deps are a convenience wrapper. |
| `useMemo` | `useMemo(calculateValue, dependencies)` | not exposed | Missing. |
| `useCallback` | `useCallback(fn, dependencies)` | not exposed | Missing. |
| `useContext` | `useContext(SomeContext)` | not exposed | Missing. |
| External JS components | component value passed as element type | `Js ElementType` first argument to `Node.createElement` | Foundation present. Library bindings can return component element-type resources; concrete component wrappers remain future binding work. |

## Main Mismatches

The previous biggest mismatch was `Node.createElement`: Lean exposed the
internal host decomposition:

```lean
Node.createElement tag key? props handlers children
```

React's public shape is:

```javascript
createElement(type, props, ...children)
```

The public surface now uses:

```lean
Node.createElement elementType props children
```

where `elementType : Js ElementType` is the React element type and
`props : Array Props.Entry` can carry attributes, handlers, and `key`.
DOM helper calls explicitly construct tag element types with
`ElementType.ofTag`, and future JavaScript library bindings can return
component element types directly. The low-level host imports also use
JavaScript-owned `Props`, `NodeChildren`, and `ElementType` resources instead of
generic array lowering. The remaining element-construction gap is `ref` plus
concrete external component bindings.

The next mismatch is the hook surface. `useState`, `useReducer`, and `useRef`
are close enough to be trusted as the base. `useEffect` is semantically
resource-safe but not shaped like React's optional cleanup/dependency API.
`useMemo`, `useCallback`, and `useContext` are absent and should be added under
their React names.

External component interop now has the right low-level lane: future JS library
bindings should expose component values as `Js ElementType`, not as a separate
Lean component DSL. The authoring shape stays React-like:

```lean
createElement component props children
```

## Priorities

1. Make the fidelity target explicit in docs and reviews.

   Convenience helpers are acceptable only when they preserve React semantics
   and lower to the React-shaped API. Avoid adding Lean-only primary APIs such
   as scalar-specialized hooks unless they are clearly documented as optional
   examples or local adapters.

2. Add concrete external component bindings.

   The core `Js ElementType` lane exists. The next step is to bind a real JS
   component source through it and keep the call lowering to
   `createElement(type, props, ...children)`.

3. Add missing hook bindings under React names.

   Prioritize `useMemo`, `useCallback`, and `useContext`. Preserve React's
   dependency semantics as closely as the current `Js` value model allows.

4. Add `ref` to the props/element lane.

   `key` is already represented in `Props.Entry`; `ref` should be represented
   without changing the `createElement(type, props, ...children)` shape.

5. Add syntax only after the core shape is right.

   JSX-like notation or ProofWidgets-style HTML combinators are useful, but
   they should elaborate to the faithful API. They should not hide conversions
   or define a separate runtime model.

## Non-Goals

- Do not reintroduce implicit `String -> Js String`, inductive-to-handle, or
  other automatic boundary conversions.
- Do not make scalar-specialized hooks the core API.
- Do not hide `Js` versus `JSL`; JavaScript-owned values and JS-owned Lean
  handles must remain distinguishable.
- Do not optimize authoring density by changing React semantics.
- Do not add a generic untyped prop escape hatch as the primary story for
  library bindings. Escape hatches can exist, but the binding direction should
  still be source-library fidelity first.

## Implication For Future JS Library Bindings

This React audit should become the template:

1. Write down the source library's real public API shape.
2. Classify each type delta as ownership, effect, or representation.
3. Bind the 1:1 names and calls first.
4. Add Lean syntax/helpers only as thin lowering layers.
5. Keep explicit conversion functions visible at the boundaries.

That order keeps the library recognizable and makes later meta-programming or
declaration-generation work easier: the generated API has a stable target
instead of chasing a bespoke Lean wrapper design.
