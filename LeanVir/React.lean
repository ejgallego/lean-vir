/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import LeanVir.Browser

namespace Lean.Vir.React

/--
Opaque React root handle created from a browser container element.

The JavaScript host owns the underlying React root and any callbacks retained by
the currently rendered tree until `Root.unmount`, package reload, or runtime
disposal.
-/
@[vir_resource "ReactRoot"]
opaque Root : Type

/-- Conservative v0 set of React property values. -/
inductive PropValue where
  | string (value : String)
  | bool (value : Bool)
  | int (value : Int)
  | float (value : Float)

/-- A React property. Event handlers live in `EventHandler`, not `Property`. -/
structure Property where
  name : String
  value : PropValue

/-- A DOM-like React event handler backed by a retained Lean closure. -/
structure EventHandler where
  name : String
  callback : Lean.Vir.Browser.Event → IO Unit

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

def title (value : String) : Property :=
  string "title" value

def role (value : String) : Property :=
  string "role" value

def ariaLabel (value : String) : Property :=
  string "aria-label" value

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

def type (value : String) : Property :=
  string "type" value

def htmlFor (value : String) : Property :=
  string "htmlFor" value

def inputValue (value : String) : Property :=
  string "value" value

def placeholder (value : String) : Property :=
  string "placeholder" value

def checked (value : Bool) : Property :=
  bool "checked" value

def disabled (value : Bool) : Property :=
  bool "disabled" value

end Property

namespace EventHandler

/-- Raw event handler escape hatch. Prefer named `onClick`/`onInput`/`onChange` helpers. -/
def on (name : String) (callback : Lean.Vir.Browser.Event → IO Unit) : EventHandler :=
  { name, callback }

/-- Raw event handler escape hatch for handlers that ignore the event. -/
def onUnit (name : String) (callback : IO Unit) : EventHandler :=
  on name fun _event => callback

def onClick (callback : IO Unit) : EventHandler :=
  onUnit "onClick" callback

def onClickWith (callback : Lean.Vir.Browser.Event → IO Unit) : EventHandler :=
  on "onClick" callback

def onInput (callback : Lean.Vir.Browser.Event → IO Unit) : EventHandler :=
  on "onInput" callback

def onInputUnit (callback : IO Unit) : EventHandler :=
  onUnit "onInput" callback

def onChange (callback : Lean.Vir.Browser.Event → IO Unit) : EventHandler :=
  on "onChange" callback

def onChangeUnit (callback : IO Unit) : EventHandler :=
  onUnit "onChange" callback

def onSubmit (callback : IO Unit) : EventHandler :=
  onUnit "onSubmit" callback

def onSubmitWith (callback : Lean.Vir.Browser.Event → IO Unit) : EventHandler :=
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

def divWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "div" props handlers children

def span (children : Array Html) : Html :=
  elementWith "span" #[] #[] children

def spanWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "span" props handlers children

def input (props : Array Property := #[]) (handlers : Array EventHandler := #[]) : Html :=
  elementWith "input" props handlers #[]

def label (children : Array Html) : Html :=
  elementWith "label" #[] #[] children

def labelWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "label" props handlers children

def form (children : Array Html) : Html :=
  elementWith "form" #[] #[] children

def formWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "form" props handlers children

def button (children : Array Html) : Html :=
  elementWith "button" #[Property.type "button"] #[] children

def buttonWith
    (props : Array Property := #[])
    (handlers : Array EventHandler := #[])
    (children : Array Html := #[]) : Html :=
  elementWith "button" (#[Property.type "button"] ++ props) handlers children

end Html

namespace Root

/--
Creates a React root for an existing browser element.

Reference: [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot).
-/
@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Browser.Element) : IO Root

/--
Creates a React root for the first element matching a CSS selector.
-/
def createFromSelector (selector : String) : IO (Option Root) := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure none
  | some container => some <$> create container

/--
Creates a React root for a selector and runs an action when the selector exists.

Returns `true` when a root was created and `false` when the selector did not match.
This is a small convenience for exported browser demos.
-/
def mountFromSelector (selector : String) (action : Root → IO Unit) : IO Bool := do
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
opaque render (root : @& Root) (html : @& Html) : IO Unit

/--
Unmounts a React root and releases callbacks retained by its current render.

Reference: [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount).
-/
@[vir_js "react.root.unmount"]
opaque unmount (root : @& Root) : IO Unit

end Root

end Lean.Vir.React
