/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets.Jsx

public section

namespace ReactCounter

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React
open scoped Lean.Vir.Js

def label (value : Nat) : String :=
  "react:" ++ toString value

/-- Exercise exact eager values, native initializers, and a Lean thunk storing a function. -/
def initialProbe (eager : Js String) (initializer : Js.Function0 (Js String))
    (handler : Js.Function1 (Js String) Unit) : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let eagerState ← Hooks.useState (Initial.ofValue eager)
    let lazyState ← Hooks.useState initializer
    let thunk ← Js.Function.ofLean0 (pure handler)
    let functionState ← Hooks.useState thunk
    let stored ← Js.Tuple2.first functionState
    let value ← Js.Tuple2.first lazyState
    let click ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) =>
      Js.Function.callVoid stored value
    jsx%{<button id="react-initial-probe" onClick={click}>
      {← Js.Tuple2.first eagerState}{value}
    </button>}

/-- Exercises the closed generic callback shapes without wrapping their native values. -/
def callbackShapeProbe
    (nullary : Js.Function0 (Js String))
    (unary : Js.Function1 (Js String) (Js String))
    (binary : Js.Function2 (Js String) (Js String) (Js String))
    (ternary : Js.Function3 (Js String) (Js String) (Js String) (Js String)) :
    RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let deps ← js#[]
    let selectedNullary ← Hooks.useCallback nullary deps
    let selectedUnary ← Hooks.useCallback unary deps
    let selectedBinary ← Hooks.useCallback binary deps
    let selectedTernary ← Hooks.useCallback ternary deps
    let nullaryResult ← Js.Function.call0 selectedNullary
    let unaryResult ← Js.Function.call selectedUnary (← js#"one")
    let binaryResult ← Js.Function.call2 selectedBinary (← js#"two") (← js#"three")
    let ternaryResult ← Js.Function.call3 selectedTernary
      (← js#"four") (← js#"five") (← js#"six")
    jsx%{<div id="react-callback-shapes">{nullaryResult}{unaryResult}
      {binaryResult}{ternaryResult}</div>}

def reducerInitializerProbe (reducer : Js (Reducer String String)) (initial : Js.Any)
    (init : Js.Function1 Js.Any (Js String)) (action : Js String) :
    RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    js#let (value, dispatch) ← Hooks.useReducerWithInit reducer initial init
    let click ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) =>
      Js.Function.callVoid dispatch action
    jsx%{<button onClick={click}>{value}</button>}

def eventProbe (record : Js.Function1 (Js SyntheticEvent) Unit) :
    RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let click ← Js.Function.ofLeanVoid fun (event : Js SyntheticEvent) => do
      let _ ← SyntheticEvent.nativeEvent event
      let _ ← SyntheticEvent.currentTarget event
      SyntheticEvent.preventDefault event
      SyntheticEvent.stopPropagation event
      Js.Function.callVoid record event
    jsx%{<button onClick={click}><span>event target</span></button>}

def counter : RuntimeM (FunctionComponent Props) := do
  let initial ← JsValue.ofNat 0
  let one ← JsValue.ofNat 1
  let update ← Js.Function.ofLean fun previous => Js.Nat.add previous one
  FunctionComponent.ofLean fun _ => do
    js#let (countValue, countSetter) ← Hooks.useState (α := Nat) initial
    let increment ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) =>
      Js.Function.callVoid countSetter (SetStateAction.ofUpdater update)
    jsx%{<button type="button" id="react-counter-button" onClick={increment}>react:{countValue}</button>}

partial def renderInto (root : Lean.Vir.Js Root) (value : Nat) : DomM Unit := do
  let node ← ReactM.run do
    let text ← Node.text (← Lean.Vir.JsValue.ofString (label value))
    let increment ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) => DomM.toRuntime (renderInto root (value + 1))
    jsx%{<button type="button" id="react-counter-button" onClick={increment}>{pure text}</button>}
  Root.render root node

def mount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let component ← counter
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#react-counter-root"

def staticTree : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString "react:static")
  jsx%{<span id="react-static-label">{pure text}</span>}

def renderStatic (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.render root (← ReactM.run staticTree)
      pure true

def renderStaticIntoSelector (selector : String) : DomM Bool := do
  let component ← FunctionComponent.ofLean fun _ => staticTree
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def effectProbe : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let effect ← Js.Function.ofLean0 do
      Js.UndefinedOr.undefined
    Hooks.useEffect effect (← Js.UndefinedOr.undefined)
    let dep ← JsValue.ofNat 1
    let effectWithDeps ← Js.Function.ofLean0 do
      Js.UndefinedOr.undefined
    Hooks.useEffect effectWithDeps (Js.UndefinedOr.ofJs (← js#[Js.erase dep]))
    let text ← Node.text (← Lean.Vir.JsValue.ofString "react:effect")
    jsx%{<span id="react-effect-label">{pure text}</span>}

def mountEffect (selector : String) : DomM Bool := do
  let component ← effectProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def memoProbe : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let dep ← JsValue.ofNat 1
    let calculate : ReactM (Lean.Vir.Js Nat) := do
      JsValue.ofNat 42
    let calculation ← Js.Function.ofLean0 calculate
    let value ← Hooks.useMemo calculation (← js#[Js.erase dep])
    let memoValue ← JsValue.toNat value
    let text ← Node.text (← Lean.Vir.JsValue.ofString s!"react:memo:{memoValue}")
    jsx%{<span id="react-memo-label">{pure text}</span>}

def mountMemo (selector : String) : DomM Bool := do
  let component ← memoProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def memoStableProbe : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← Hooks.useState (α := Nat) initial
    let countValueJs ← Js.Tuple2.first count
    let countSetter ← Js.Tuple2.second count
    let calculation ← Js.Function.ofLean0 (pure countValueJs)
    let memoValue ← Hooks.useMemo calculation (← js#[])
    let countValue ← JsValue.toNat countValueJs
    let cachedValue ← JsValue.toNat memoValue
    let text ← Node.text (← Lean.Vir.JsValue.ofString s!"react:memo-stable:{countValue}:{cachedValue}")
    let increment ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) => do
      let update ← Js.Function.ofLean fun previous => do
        let value ← JsValue.toNat previous
        JsValue.ofNat (value + 1)
      Js.Function.callVoid countSetter (SetStateAction.ofUpdater update)
    jsx%{<button type="button" id="react-memo-stable-button" onClick={increment}>{pure text}</button>}

def mountMemoStable (selector : String) : DomM Bool := do
  let component ← memoStableProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def refFragmentProbe : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← Hooks.useState (α := Nat) initial
    let countValueJs ← Js.Tuple2.first count
    let countSetter ← Js.Tuple2.second count
    let lastClick ← Hooks.useRef initial
    let countValue ← JsValue.toNat countValueJs
    let lastValueResource ← Ref.get lastClick
    let lastValue ← JsValue.toNat lastValueResource
    let labelText ← Node.text (← Lean.Vir.JsValue.ofString s!"react:ref:{countValue}:{lastValue}")
    let increment ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) => do
      let update ← Js.Function.ofLean fun previous => do
        let value ← JsValue.toNat previous
        let next ← JsValue.ofNat (value + 1)
        Ref.set lastClick next
        pure next
      Js.Function.callVoid countSetter (SetStateAction.ofUpdater update)
    let button ← jsx%{<button type="button" id="react-ref-button" onClick={increment}>{pure labelText}</button>}
    let markerText ← Node.text (← Lean.Vir.JsValue.ofString "fragment child")
    let marker ← jsx%{<span id="react-fragment-marker">{pure markerText}</span>}
    Node.fragment (← Js.Object.empty) (← js#[button, marker])

def mountRefFragment (selector : String) : DomM Bool := do
  let component ← refFragmentProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def benchTextSpan (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString ("item:" ++ toString index))
  jsx%{<span className="react-bench-text" data-index={← JsValue.ofString (toString index)}>{pure text}</span>}

partial def benchTextChildrenAux
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Node)) :
    ReactM (Array (Lean.Vir.Js Node)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let span ← benchTextSpan index
      benchTextChildrenAux (index + 1) n (acc.push span)

def benchTextChildren (count : Nat) : ReactM (Array (Lean.Vir.Js Node)) :=
  benchTextChildrenAux 0 count #[]

def benchTextTree (count : Nat) : ReactM (Lean.Vir.Js Node) := do
  let children ← benchTextChildren count
  Node.createElement (← ElementType.tag (← js#"div"))
    (← js%{ "id" := (← js#"react-bench-text-tree"), "className" := (← js#"react-bench-tree") })
    (← Js.Array.ofArray children)

partial def renderWideTextLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (← ReactM.run (benchTextTree width))
      renderWideTextLoopAux root width n (acc + 1)

def renderWideTextLoop (selector : String) (width count : Nat) : DomM Nat := do
  let container ← Browser.Document.querySelector
    (← Browser.Document.current) (← JsValue.ofString selector)
  match ← Js.Nullable.toOption container with
  | none => pure 0
  | some container => do
      let root ← Root.create container
      let rendered ← renderWideTextLoopAux root width count 0
      Root.unmount root
      pure rendered

def benchCallbackButton (root : Lean.Vir.Js Root) (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString ("callback:" ++ toString index))
  let click ← Js.Function.ofLeanVoid fun (_ : Js Lean.Vir.React.SyntheticEvent) => DomM.toRuntime do
    Root.render root (← ReactM.run (benchTextTree 1))
  jsx%{<button type="button" className="react-bench-callback"
    data-index={← JsValue.ofString (toString index)} onClick={click}>{pure text}</button>}

partial def benchCallbackChildrenAux
    (root : Lean.Vir.Js Root)
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Node)) :
    ReactM (Array (Lean.Vir.Js Node)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let button ← benchCallbackButton root index
      benchCallbackChildrenAux root (index + 1) n (acc.push button)

def benchCallbackChildren (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Array (Lean.Vir.Js Node)) :=
  benchCallbackChildrenAux root 0 count #[]

def benchCallbackTree (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Lean.Vir.Js Node) := do
  let children ← benchCallbackChildren root count
  Node.createElement (← ElementType.tag (← js#"div"))
    (← js%{ "id" := (← js#"react-bench-callback-tree"), "className" := (← js#"react-bench-tree") })
    (← Js.Array.ofArray children)

partial def renderCallbackTreeLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (← ReactM.run (benchCallbackTree root width))
      renderCallbackTreeLoopAux root width n (acc + 1)

def renderCallbackTreeLoop (selector : String) (width count : Nat) : DomM Nat := do
  let container ← Browser.Document.querySelector
    (← Browser.Document.current) (← JsValue.ofString selector)
  match ← Js.Nullable.toOption container with
  | none => pure 0
  | some container => do
      let root ← Root.create container
      let rendered ← renderCallbackTreeLoopAux root width count 0
      Root.unmount root
      pure rendered

def mountAndUnmount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      renderInto root 0
      Root.unmount root
      pure true

partial def mountAndUnmountLoopAux (selector : String) (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndUnmount selector
      mountAndUnmountLoopAux selector n (if mounted then acc + 1 else acc)

def mountAndUnmountLoop (selector : String) (count : Nat) : DomM Nat :=
  mountAndUnmountLoopAux selector count 0

def renderAfterUnmount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.unmount root
      renderInto root 0
      pure true

def nestedDivs (depth : Nat) : ReactM (Lean.Vir.Js Node) := do
  match depth with
  | 0 => Node.text (← Lean.Vir.JsValue.ofString "deep")
  | n + 1 => do
      let child ← nestedDivs n
      jsx%{<div>{pure child}</div>}

def renderTooDeep (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.render root (← ReactM.run (nestedDivs 129))
      pure true

end ReactCounter
