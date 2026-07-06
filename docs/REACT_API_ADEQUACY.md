# React API Adequacy

This note compares the current Lean-authored React surface with ordinary
TypeScript/React authoring. It is an API-fit assessment, not a replacement for
the implementation details in [REACT_NODE.md](REACT_NODE.md) or the
ProofWidgets plan in [REACT_PROOFWIDGETS_ROADMAP.md](REACT_PROOFWIDGETS_ROADMAP.md).

## Verdict

The core runtime model is adequate and worth keeping:

- Lean components are rendered as real JavaScript React function components, so
  hooks run under React's dispatcher.
- `Node` values are native React node resources, not a private recursive Lean
  tree that gets interpreted later.
- `Js α` and `JSL α` now make JavaScript-owned values and Lean-owned handles
  distinct enough to reason about React state, reducer state, and event
  callbacks.
- Root rerender, unmount, package reload, and runtime disposal have concrete
  callback/resource release paths.

The current Lean API is not yet ergonomic enough to feel like TypeScript/JSX.
It is better described as a low-level native React binding plus a small DOM-like
helper layer. That is a good foundation, but the next work should add a thin
authoring layer rather than change the boundary ABI.

## Side By Side

| React concept | TypeScript / React | Current Lean API | Assessment |
| --- | --- | --- | --- |
| Function component | `(props) => JSX.Element` | `Component props := props -> ReactM (Js Node)` | Semantically close. The explicit `ReactM` and `Js Node` are useful boundary documentation, but noisy in examples. |
| Element construction | JSX or `React.createElement(tag, props, children)` | `Node.divWith props handlers children`, `Node.createElement tag key props handlers children` | Runtime is faithful. Authoring is verbose because text nodes, props, handlers, and children are all explicit arrays. |
| Text children | `"hello"` inline in JSX | `let t <- Node.text "hello"; Node.span #[t]` plus some `*Text` helpers | Adequate for tests, too verbose for real widgets. More text-child helpers or an Html/JSX facade should be the main ergonomic layer. |
| Props | typed TS object / JSX attributes | `Array Property` with `PropValue` variants and named helpers | Good safety boundary. Coverage is partial but extensible. Missing props should be added by demand from ports. |
| Event handlers | `(event) => ...` synthetic event callback | `EventHandler.onClick fun event => ...` with `Js Browser.Event` | Shape is good. Event object is intentionally opaque. More named helpers and typed event readers will improve feel. |
| `useState` | `const [x, setX] = useState(0)` | `let x0 <- JsValue.ofNat 0; let x <- Hooks.useState x0; let n <- JsValue.toNat x.value` | Correct but too conversion-heavy. Add explicit scalar/resource helper wrappers; do not reintroduce implicit conversions. |
| state setter | `setX(next)` or `setX(prev => ...)` | `State.set state nextJs`, `State.modify state fun prevJs => ...` | Functionally close. The monadic updater is a good fit for explicit conversions. |
| `useReducer` | reducer over plain TS state/action | reducer over `Js state -> Js action -> RuntimeM (Js state)`; Lean-owned values use `JSL` | Runtime shape is good after the `JSL` split. Ergonomics still need a wrapper for the common "Lean reducer under JSL" pattern. |
| `useRef` | mutable `{ current }`, no render scheduling | `Hooks.useRef`, `Ref.get`, `Ref.set` | Adequate. It maps React semantics directly. |
| `useEffect` | setup returns optional cleanup; deps can be any JS values | setup returns a resource, cleanup receives it; deps are `Array String` | Runtime lifetime discipline is clear, but API is narrower than React. Add convenience wrappers and broader deps later. |
| `useMemo` / `useCallback` / `useContext` | standard React hooks | not exposed | Most important missing hooks for ProofWidgets-style ports after state/effect/ref. |
| External JS components | import component and render `<Component ... />` | no direct public component-resource wrapper yet | Needed for real library bindings. Keep it explicit and resource-shaped. |

## Current Strengths

The current API gets the hard boundary decisions mostly right.

`Root.renderComponent` preserves JavaScript component identity across rerenders
on the same root, so hook state behaves like React users expect. Event callbacks
are retained by the rendered node resource and released on rerender/unmount
paths. This is more important than having a pretty DSL early.

`ReactM`, `DomM`, and `RuntimeM` make useful distinctions:

- `ReactM` is render construction.
- `DomM` owns root lifetime and event-side browser effects.
- `RuntimeM` owns JavaScript resource conversion and setter/dispatch calls.

The explicit `Js`/`JSL` split is also the right direction. A true JavaScript
string state value and a retained Lean `String` handle are no longer the same
type, which keeps reducer and state ownership honest.

## Current Friction

The main problem is authoring density. A simple controlled input requires:

- boxing the initial scalar with `JsValue.ofString`,
- unboxing `state.value` with `JsValue.toString`,
- allocating text nodes separately,
- building prop and handler arrays manually,
- re-boxing event values before `State.set`.

That verbosity is acceptable in low-level fixtures, but not for application or
ProofWidgets authoring. It also obscures the code that actually matters.

`useReducer` is powerful but still awkward for Lean-owned inductive state and
actions. The Tamagotchi example now has the correct model with `JSL`, but every
user has to write the same `toJSL` / `fromJSL` reducer adapter and dispatch
wrapper. That is the right place for a small explicit helper.

`useEffectWithDeps` being string-only is a reasonable v0 constraint, but it
does not match React's actual dependency model. This should not block current
work, but it should remain visible as a compatibility gap.

## Recommended Next API Work

1. Add explicit ergonomic wrappers for common scalar state.

   Example shape:

   ```lean
   Hooks.useStateNat : Nat -> ReactM (State (Js Nat))
   State.valueNat : State (Js Nat) -> RuntimeM Nat
   State.setNat : State (Js Nat) -> Nat -> RuntimeM Unit
   ```

   These wrappers would still call `JsValue` explicitly in their definitions.
   They do not reintroduce implicit conversion.

2. Add a small `JSL` reducer adapter.

   Example shape:

   ```lean
   Hooks.useLeanReducer :
     (state -> action -> RuntimeM state) ->
     state ->
     ReactM (ReducerState (LeanRef.Handle state) (LeanRef.Handle action))
   ```

   The implementation would perform the existing `toJSL` / `fromJSL` wrapping
   in one blessed place. Dispatch would still require an explicit helper such
   as `ReducerDispatch.dispatchLean`.

3. Add the missing common hooks in React order.

   `useMemo`, `useCallback`, then `useContext`. These should stay shallow
   React-compatible bindings, with dependency handling matching the effect
   dependency plan.

4. Improve element authoring without changing the runtime ABI.

   Prefer a higher-level Html/JSX-like facade over changing `Node.createElement`.
   The low-level node API should stay resource-shaped and explicit. The facade
   can make text children, attribute lists, and child arrays less noisy.

5. Broaden dependency arrays after the helper layer is stable.

   The next dependency model should accept JavaScript resource values, not just
   strings, while preserving explicit lifetime rules for resources captured by
   setup and cleanup callbacks.

6. Add external component interop only when a real demo requires it.

   The likely shape is an opaque JS component resource plus explicit props
   conversion. Avoid a generic arbitrary-props escape hatch until a concrete
   library port forces it.

## Adequacy For ProofWidgets Work

For standalone interactive demos, the current API is adequate.

For ProofWidgets-style ports, the runtime foundation is adequate, but the public
authoring surface still needs the helper layer above:

- Html/JSX-like element syntax or combinators,
- explicit scalar-state helpers,
- `JSL` reducer helpers,
- `useMemo` / `useCallback` / `useContext`,
- broader prop/event coverage driven by upstream examples.

The important constraint is to keep these as layers over the existing ABI.
Changing the ABI to hide conversion or ownership would make the API look nicer
short-term but would undo the recent boundary simplification.
