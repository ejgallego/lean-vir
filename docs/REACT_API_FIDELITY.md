# React API Fidelity Audit

This note compares the current Lean-authored React surface with the public
React API. It is an API-fidelity audit, not a replacement for the renderer
implementation details in [REACT_NODE.md](REACT_NODE.md) or the ProofWidgets
plan in [REACT_PROOFWIDGETS_ROADMAP.md](REACT_PROOFWIDGETS_ROADMAP.md).

This is also the first audit template for future JavaScript library bindings.
The binding should preserve the source library's names, call shapes, and
semantic contracts wherever the runtime permits it. Lean-specific differences
should expose unavoidable effect and value-representation boundaries; they
should not invent a parallel API as the primary surface.

## Principle

React fidelity is the north star:

- bind React concepts under React names;
- keep React call shapes recognizable;
- expose the runtime/effect boundary explicitly with `Js`, `JSL`, `ReactM`,
  `DomM`, and `RuntimeM` without inventing ownership semantics;
- treat helper syntax as elaboration over the React-shaped API, not as a
  substitute programming model;
- avoid implicit conversion or magic coercion at the boundary.

VIR does not enforce a property that TypeScript React does not enforce. Render
purity, hook order, replay-safe reducers, effect discipline, and complete
dependency arrays remain programmer responsibilities.

The acceptable deltas are explicit value conversions forced by the boundary.
For example, `Component.ofLean` creates an ordinary JavaScript function once;
that returned function, rather than a VIR string registry, is the component
identity seen by React. A separate Lean-first HTML/component DSL must elaborate
directly to React-shaped operations.

## Official Baseline

The audit baseline is the public React 19.2 reference, checked on
2026-09-02:

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

| React concept          | React shape                                                                         | Current Lean shape                                                                                          | Fidelity                                                                                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function component     | `function Component(props) { ... }`                                                 | `Component.ofLean : (props -> ReactM (Js Node)) -> RuntimeM (Js (Component props))`                         | Explicit representation conversion. The result is the ordinary JavaScript function and therefore has native React identity.                                                                                                                  |
| Root creation          | `createRoot(domNode, options?)`                                                     | `Root.create : Js Element -> DomM (Js Root)`                                                                | Close. Missing root options. Selector helpers are convenience, not core React.                                                                                                                                                                |
| Root render            | `root.render(reactNode)`                                                            | `Root.renderNode root (Js Node)`; Lean conveniences build the node first                                   | Good core match. `renderNode` is the sole host boundary; `Root.render` and `Root.renderComponent` are ordinary Lean composition over it.                                                                                                       |
| Root unmount           | `root.unmount()`                                                                    | `Root.unmount : Js Root -> DomM Unit`                                                                       | Good. Resource cleanup is an explicit runtime concern.                                                                                                                                                                                        |
| Element construction   | `createElement(type, props, ...children)`                                           | `Node.createElement : Js ElementType -> Js Props -> Js.Array (Js Node) -> ReactM (Js Node)`                 | Faithful boundary. Props and children are the exact JS values. Lean builders are separate conveniences.                                                                                                                                       |
| JSX                    | JSX elaborates to React elements                                                    | `Vir.ProofWidgets.Jsx` lowers to native React elements/components                                           | Good explicit syntax layer; it creates no serializable or virtual tree.                                                                                                                                                                      |
| Fragment               | `<Fragment>` / `<>`                                                                 | `Node.fragment`, `Node.keyedFragment`                                                                       | Close. Naming is Lean-style but maps directly to React fragments.                                                                                                                                                                             |
| Props                  | one props argument, including event handlers and special fields such as `key`/`ref` | exact `Js Props`; `Props.fromEntries` is an explicit builder                                                 | Good. The native binding sees one ordinary JS object; no conversion is hidden in `createElement`.                                                                                                                                             |
| Event handlers         | props such as `onClick={...}`                                                       | `Props.onClick ...` entries                                                                                 | Close. Handler names and placement now match React's props model.                                                                                                                                                                             |
| Children               | variadic children after props                                                       | `Array (Js Node)`                                                                                           | Acceptable Lean adaptation, but the user-facing call should still read like React's child list.                                                                                                                                               |
| Text children          | string/number child values                                                          | explicit `Node.text` resources                                                                              | Acceptable low-level representation. Syntax/helpers should make text children feel like React children without implicit conversion.                                                                                                           |
| `useState`             | returns `[state, setState]`                                                         | `Hooks.useState : Js a -> ReactM (Js (StateTuple (Js a)))`                                                  | Faithful boundary. `StateTuple.toState` is an explicit Lean projection helper.                                                                                                                                                                |
| state setter           | `setState(next)` or updater function                                                | `State.set`, `State.modify`                                                                                 | Close. The names differ because Lean lacks JS tuple/destructuring ergonomics, but both setter forms are present.                                                                                                                              |
| `useReducer`           | `useReducer(reducer, initialArg, init?)`                                            | exact `Js Reducer`, initial `Js state`, exact `Js ReducerTuple`                                             | Good core match; initializer form is missing. `Reducer.ofLean` is an explicit callback conversion, and purity/replay remain the programmer's responsibility.                                                                                  |
| dispatch               | `dispatch(action)`                                                                  | `ReducerDispatch.dispatch dispatch action`                                                                  | Close. Action is explicitly `Js action`, which matches the JS-land reducer surface.                                                                                                                                                           |
| `useRef`               | returns ref object with `.current`                                                  | `Hooks.useRef`, `Ref.get`, `Ref.set`                                                                        | Good. The explicit get/set API reflects the Wasm/Lean boundary.                                                                                                                                                                               |
| `useEffect`            | `useEffect(setup, dependencies?)`; cleanup optional                                 | exact `Js EffectCallback`; `EffectCallback.ofLean` is an explicit conversion                               | Good native binding. `Hooks.useLeanEffect` is only Lean composition of that conversion with exact `useEffect`; the hook host has no alternate effect protocol.                                                                                |
| effect dependencies    | any reactive JS values compared with `Object.is`                                    | `Js DependencyList` built from `Js α` values                                                                | Close. Dependency values now stay JavaScript-owned; string deps are a convenience wrapper.                                                                                                                                                    |
| `useMemo`              | `useMemo(calculateValue, dependencies)`                                             | `Hooks.useMemo calculate deps`                                                                              | Good. Calculate runs when React chooses, dependencies are the actual JavaScript array, and the result is the exact `Js` value. Purity remains the programmer's responsibility.                                                                |
| `useCallback`          | `useCallback(fn, dependencies)`                                                     | exact `Js Callback` and `Js DependencyList`                                                                 | Good. React selects and returns the exact function.                                                                                                                                                                                           |
| `useContext`           | `useContext(SomeContext)`                                                           | exact `Js Context`                                                                                          | Good consumer binding; context creation/provider conveniences remain future work.                                                                                                                                                            |
| External JS components | component value passed as element type                                              | `Js ElementType` first argument to `Node.createElement`                                                     | Foundation present. The smoke fixture binds an external component value this way; real library wrappers remain future binding work.                                                                                                           |

## Main Mismatches

The core values and hooks are now direct. `Node.createElement` receives the
exact `Js ElementType`, `Js Props`, and JS child array; `useState` and
`useReducer` return React's exact arrays; memo, callback, context, and native
effect inputs are exact JavaScript values. Lean-side builders and tuple
projections are visibly separate from those bindings.

The main remaining gaps are breadth rather than a second semantic model:

- `createRoot` does not yet expose options;
- `useReducer` does not expose its initializer form;
- context creation/providers and a wider external-component library surface
  are not yet bound;
- Lean callbacks require explicit conversions such as `Component.ofLean` and
  `EffectCallback.ofLean` before React can receive JavaScript function values.

External component bindings should expose values as `Js ElementType`. Their
authoring path remains `Node.createElement component props children`.

## Priorities

1. Make the fidelity target explicit in docs and reviews.

   Convenience helpers are acceptable only when they preserve React semantics
   and lower to the React-shaped API. Avoid adding Lean-only primary APIs such
   as scalar-specialized hooks unless they are clearly documented as optional
   examples or local adapters.

2. Add concrete external component and context bindings.

   The core `Js ElementType` lane exists and is covered by a smoke fixture. The
   next step is to bind a real JS component source through it and keep the call
   lowering to `createElement(type, props, ...children)`.

3. Fill the remaining official call shapes.

   Prioritize root options and the reducer initializer without wrapping their
   JavaScript values or attempting to enforce extra Lean-level semantics.

4. Keep syntax as lowering only.

   `Vir.ProofWidgets.Jsx` must continue to elaborate to the faithful API. It
   must not hide conversions or define a separate runtime model.

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
2. Classify each type delta as an unavoidable effect or representation boundary.
3. Bind the 1:1 names and calls first.
4. Add Lean syntax/helpers only as thin lowering layers.
5. Keep explicit conversion functions visible at the boundaries.

That order keeps the library recognizable and makes later meta-programming or
declaration-generation work easier: the generated API has a stable target
instead of chasing a bespoke Lean wrapper design.
