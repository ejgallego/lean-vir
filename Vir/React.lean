/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

namespace Lean.Vir.React

/--
Effect used by Lean-authored React render construction.

`ReactM` is intentionally narrower than `IO`: React render construction can
allocate React-side resources exposed by this module, but arbitrary host `IO`
must stay outside the render surface unless the API exposes a render-safe
operation for it.
-/
@[irreducible] def ReactM (α : Type) : Type :=
  Lean.Vir.Browser.DomM α

namespace ReactM

/-- Runs a render-construction action in the browser/DOM effect. -/
def run (action : ReactM α) : Lean.Vir.Browser.DomM α :=
  by
    unfold ReactM at action
    exact action

protected def pure (value : α) : ReactM α :=
  by
    unfold ReactM
    exact pure value

protected def bind (action : ReactM α) (next : α → ReactM β) : ReactM β :=
  by
    unfold ReactM
    exact do
      let value ← action.run
      (next value).run

protected def map (f : α → β) (action : ReactM α) : ReactM β :=
  by
    unfold ReactM
    exact f <$> action.run

instance : Monad ReactM where
  pure := ReactM.pure
  bind := ReactM.bind

instance : Nonempty (ReactM α) :=
  by
    unfold ReactM
    infer_instance

end ReactM

instance : MonadLift ReactM Lean.Vir.Browser.DomM where
  monadLift := ReactM.run

/--
React root object class created from a browser container element.

The JavaScript host owns the underlying React root and any callbacks retained by
the currently rendered tree until `Root.unmount`, package reload, or runtime
disposal.
-/
opaque Root : Type

/-- A single React `style` object entry. Use camelCase property names. -/
structure StyleProperty where
  name : String
  value : String

/-- Conservative v0 set of React property values. -/
inductive PropValue where
  | string (value : String)
  | bool (value : Bool)
  | int (value : Int)
  | float (value : Float)
  | style (entries : Array StyleProperty)
  | classList (classes : Array String)

/-- A React property. Event handlers live in `EventHandler`, not `Property`. -/
structure Property where
  name : String
  value : PropValue

/-- A DOM-like React event handler backed by a retained Lean closure. -/
structure EventHandler where
  name : String
  callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit

/--
Narrow recursive React HTML tree.

This type uses the generic VIR custom-inductive and `recursiveSelf` interface
descriptors. The audited React-specific behavior lives in the JavaScript
renderer and callback cleanup policy.
-/
inductive Html where
  | text (value : String)
  | element
      (tag : String)
      (key? : Option String)
      (props : Array Property)
      (handlers : Array EventHandler)
      (children : Array Html)

namespace Property

/-- Raw string-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def string (name value : String) : Property :=
  { name, value := .string value }

/-- Raw boolean-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def bool (name : String) (value : Bool) : Property :=
  { name, value := .bool value }

/-- Raw integer-valued prop escape hatch. Prefer named helpers in the v0 surface. -/
def int (name : String) (value : Int) : Property :=
  { name, value := .int value }

/-- Raw floating-point prop escape hatch. Prefer named helpers in the v0 surface. -/
def float (name : String) (value : Float) : Property :=
  { name, value := .float value }

def id (value : String) : Property :=
  string "id" value

def inputName (value : String) : Property :=
  string "name" value

def className (value : String) : Property :=
  string "className" value

/-- DOMTokenList-like class helper. The host validates and deduplicates tokens. -/
def classList (classes : Array String) : Property :=
  { name := "className", value := .classList classes }

def title (value : String) : Property :=
  string "title" value

def role (value : String) : Property :=
  string "role" value

def ariaLabel (value : String) : Property :=
  string "aria-label" value

def ariaHidden (value : Bool) : Property :=
  bool "aria-hidden" value

/--
DOM `data-*` prop helper. Pass the suffix without `data-`; the JavaScript
renderer rejects an empty suffix to avoid producing `data-`.
-/
def data (name value : String) : Property :=
  string ("data-" ++ name) value

def dataTestId (value : String) : Property :=
  data "testid" value

def tabIndex (value : Int) : Property :=
  int "tabIndex" value

/-- React style-object helper. Use camelCase style names and string values. -/
def style (entries : Array StyleProperty) : Property :=
  { name := "style", value := .style entries }

def type (value : String) : Property :=
  string "type" value

def htmlFor (value : String) : Property :=
  string "htmlFor" value

def inputValue (value : String) : Property :=
  string "value" value

def placeholder (value : String) : Property :=
  string "placeholder" value

def autoComplete (value : String) : Property :=
  string "autoComplete" value

def maxLength (value : Int) : Property :=
  int "maxLength" value

def checked (value : Bool) : Property :=
  bool "checked" value

def disabled (value : Bool) : Property :=
  bool "disabled" value

end Property

namespace EventHandler

/-- Raw event handler escape hatch. Prefer named `onClick`/`onInput`/`onChange` helpers. -/
def on (name : String) (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  { name, callback }

/-- Raw event handler escape hatch for handlers that ignore the event. -/
def onUnit (name : String) (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on name fun _event => callback

def onClick (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onClick" callback

def onClickWith (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onClick" callback

def onInput (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onInput" callback

def onInputUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onInput" callback

def onChange (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onChange" callback

def onChangeUnit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onChange" callback

def onSubmit (callback : Lean.Vir.Browser.DomM Unit) : EventHandler :=
  onUnit "onSubmit" callback

def onSubmitWith (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : EventHandler :=
  on "onSubmit" callback

end EventHandler

namespace Html

/-- Raw element escape hatch. Prefer named helpers in the v0 DOM-like surface. -/
def elementWith
    (tag : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  .element tag none props handlers children

/-- Raw keyed element escape hatch. Prefer named helpers in the v0 DOM-like surface. -/
def keyedElementWith
    (tag key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  .element tag (some key) props handlers children

def div (children : Array Html) : Html :=
  elementWith "div" #[] #[] children

def keyedDiv (key : String) (children : Array Html) : Html :=
  keyedElementWith "div" key #[] #[] children

def divWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "div" props handlers children

def keyedDivWith
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  keyedElementWith "div" key props handlers children

def span (children : Array Html) : Html :=
  elementWith "span" #[] #[] children

def keyedSpan (key : String) (children : Array Html) : Html :=
  keyedElementWith "span" key #[] #[] children

def spanWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "span" props handlers children

def keyedSpanWith
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  keyedElementWith "span" key props handlers children

def input (props : Array Property := #[]) (handlers : Array EventHandler := #[]) : Html :=
  elementWith "input" props handlers #[]

def keyedInput
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[]) : Html :=
  keyedElementWith "input" key props handlers #[]

def label (children : Array Html) : Html :=
  elementWith "label" #[] #[] children

def keyedLabel (key : String) (children : Array Html) : Html :=
  keyedElementWith "label" key #[] #[] children

def labelWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "label" props handlers children

def keyedLabelWith
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  keyedElementWith "label" key props handlers children

def form (children : Array Html) : Html :=
  elementWith "form" #[] #[] children

def keyedForm (key : String) (children : Array Html) : Html :=
  keyedElementWith "form" key #[] #[] children

def formWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "form" props handlers children

def keyedFormWith
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  keyedElementWith "form" key props handlers children

def button (children : Array Html) : Html :=
  elementWith "button" #[Property.type "button"] #[] children

def keyedButton (key : String) (children : Array Html) : Html :=
  keyedElementWith "button" key #[Property.type "button"] #[] children

def buttonWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "button" (#[Property.type "button"] ++ props) handlers children

def keyedButtonWith
    (key : String)
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  keyedElementWith "button" key (#[Property.type "button"] ++ props) handlers children

end Html

namespace Root

/--
Creates a React root for an existing browser element.

Reference: [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot).
-/
@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Js Lean.Vir.Browser.Element) : Lean.Vir.Browser.DomM (Lean.Vir.Js Root)

/--
Creates a React root for the first element matching a CSS selector.
-/
def createFromSelector (selector : String) : Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Root)) := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure none
  | some container => some <$> create container

/--
Creates a React root for a selector and runs an action when the selector exists.

Returns `true` when a root was created and `false` when the selector did not match.
This is a small convenience for exported browser demos.
-/
def mountFromSelector
    (selector : String)
    (action : Lean.Vir.Js Root → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool := do
  match ← createFromSelector selector with
  | none => pure false
  | some root =>
      action root
      pure true

/--
Renders a recursive `Html` tree into a React root.

The host retains callbacks embedded in the rendered tree until the root is
rerendered, unmounted, or the owning runtime is disposed.
-/
@[vir_js "react.root.render"]
opaque render (root : @& Lean.Vir.Js Root) (html : @& Html) : Lean.Vir.Browser.DomM Unit

/--
Unmounts a React root and releases callbacks retained by its current render.

Reference: [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount).
-/
@[vir_js "react.root.unmount"]
opaque unmount (root : @& Lean.Vir.Js Root) : Lean.Vir.Browser.DomM Unit

end Root

end Lean.Vir.React
