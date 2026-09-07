/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace Lean.Vir.ProofWidgets

abbrev ReactM := Lean.Vir.React.ReactM

/--
ProofWidgets-style HTML value backed by a real React node construction action.

This is intentionally a shallow facade over `Lean.Vir.React`: `Html.element`
and `Html.text` allocate native React node resources through React's public
APIs instead of building a second recursive structural tree.
-/
abbrev Html : Type :=
  ReactM (Lean.Vir.Js Lean.Vir.React.Node)

/--
Props passed to a ProofWidgets-style component.

`children` stays in `Html` form so child-bearing components can decide where to
render nested markup, matching the usual `props.children` role without adding a
second React tree representation. Each child is a deferred React construction
action, not an already-built node: component implementations should normally
evaluate each selected child exactly once. Hooks belong in component render
functions, not in arbitrary child actions whose evaluation is conditional.
-/
structure ComponentProps (props : Type) where
  props : props
  children : Array Html := #[]

abbrev Component (props : Type := Unit) : Type :=
  Lean.Vir.Js (Lean.Vir.React.Component (ComponentProps props))

namespace Component

/-- Creates one reusable JavaScript React function for a ProofWidgets-style component. -/
def ofLean
    (render : ComponentProps props → ReactM (Lean.Vir.Js Lean.Vir.React.Node)) :
    Lean.Vir.RuntimeM (Component props) :=
  Lean.Vir.React.Component.ofLean render

end Component

def componentProps {props : Type} (value : props) (children : Array Html := #[]) :
    ComponentProps props :=
  { props := value, children }

abbrev Attr : Type :=
  Lean.Vir.React.Property

abbrev Handler : Type :=
  Lean.Vir.React.EventHandler

/-- Unified native React prop entry used as the lowering target for JSX. -/
abbrev PropEntry : Type 1 :=
  Lean.Vir.React.Props.Entry

namespace PropEntry

def key (value : String) : PropEntry :=
  Lean.Vir.React.Props.key value

def property (value : Attr) : PropEntry :=
  Lean.Vir.React.Props.property value

def eventHandler (value : Handler) : PropEntry :=
  Lean.Vir.React.Props.eventHandler value

def ref {α : Type}
    (value : Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α))) : PropEntry :=
  Lean.Vir.React.Props.ref value

end PropEntry

namespace Attr

def string (name value : String) : Attr :=
  Lean.Vir.React.Property.string name value

def bool (name : String) (value : Bool) : Attr :=
  Lean.Vir.React.Property.bool name value

def int (name : String) (value : Int) : Attr :=
  Lean.Vir.React.Property.int name value

def float (name : String) (value : Float) : Attr :=
  Lean.Vir.React.Property.float name value

def id (value : String) : Attr :=
  Lean.Vir.React.Property.id value

def className (value : String) : Attr :=
  Lean.Vir.React.Property.className value

def classList (classes : Array String) : Attr :=
  Lean.Vir.React.Property.classList classes

def title (value : String) : Attr :=
  Lean.Vir.React.Property.title value

def role (value : String) : Attr :=
  Lean.Vir.React.Property.role value

def ariaLabel (value : String) : Attr :=
  Lean.Vir.React.Property.ariaLabel value

def data (name value : String) : Attr :=
  Lean.Vir.React.Property.data name value

def dataTestId (value : String) : Attr :=
  Lean.Vir.React.Property.dataTestId value

def tabIndex (value : Int) : Attr :=
  Lean.Vir.React.Property.tabIndex value

def stylePairs (entries : Array (String × String)) : Attr :=
  Lean.Vir.React.Property.stylePairs entries

def src (value : String) : Attr :=
  Lean.Vir.React.Property.src value

def alt (value : String) : Attr :=
  Lean.Vir.React.Property.alt value

def href (value : String) : Attr :=
  Lean.Vir.React.Property.href value

def target (value : String) : Attr :=
  Lean.Vir.React.Property.target value

def rel (value : String) : Attr :=
  Lean.Vir.React.Property.rel value

def type (value : String) : Attr :=
  Lean.Vir.React.Property.type value

def inputValue (value : String) : Attr :=
  Lean.Vir.React.Property.inputValue value

def checked (value : Bool) : Attr :=
  Lean.Vir.React.Property.checked value

end Attr

namespace Handler

def on (name : String)
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Handler :=
  Lean.Vir.React.EventHandler.on name callback

def onClick (callback : Lean.Vir.Browser.DomM Unit) : Handler :=
  Lean.Vir.React.EventHandler.onClick callback

def onClickWith
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Handler :=
  Lean.Vir.React.EventHandler.onClickWith callback

def onInput
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Handler :=
  Lean.Vir.React.EventHandler.onInput callback

def onChange
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) :
    Handler :=
  Lean.Vir.React.EventHandler.onChange callback

def onSubmit (callback : Lean.Vir.Browser.DomM Unit) : Handler :=
  Lean.Vir.React.EventHandler.onSubmit callback

end Handler

namespace Html

def text (value : String) : Html :=
  Lean.Vir.React.Node.text value

private def propsFrom (attrs : Array Attr) (handlers : Array Handler) :
    Array Lean.Vir.React.Props.Entry :=
  attrs.map Lean.Vir.React.Props.property ++
    handlers.map Lean.Vir.React.Props.eventHandler

def children (items : Array Html) :
    ReactM (Array (Lean.Vir.Js Lean.Vir.React.Node)) :=
  items.mapM fun item => item

/-- Builds a native React element from a single unified prop array. -/
def elementWithProps
    (tag : String)
    (props : Array PropEntry := #[])
    (children : Array Html := #[]) :
    Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.elementWith tag props childNodes

def fragment (children : Array Html := #[]) : Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.fragment childNodes

def keyedFragment (key : String) (children : Array Html := #[]) : Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.keyedFragment key childNodes

def elementWith
    (tag : String)
    (attrs : Array Attr := #[])
    (handlers : Array Handler := #[])
    (children : Array Html := #[]) :
    Html :=
  elementWithProps tag (propsFrom attrs handlers) children

def keyedElementWith
    (tag key : String)
    (attrs : Array Attr := #[])
    (handlers : Array Handler := #[])
    (children : Array Html := #[]) :
    Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.keyedElementWith tag key (propsFrom attrs handlers) childNodes

def element
    (tag : String)
    (attrs : Array Attr := #[])
    (children : Array Html := #[]) :
    Html :=
  elementWith tag attrs #[] children

def keyedElement
    (tag key : String)
    (attrs : Array Attr := #[])
    (children : Array Html := #[]) :
    Html :=
  keyedElementWith tag key attrs #[] children

def ofComponent
    (component : Component props)
    (props : props)
    (children : Array Html := #[]) :
    Html :=
  Lean.Vir.React.Node.ofComponent component (componentProps props children)

/-- Builds a keyed native React component node without placing `key` in typed props. -/
def keyedOfComponent
    (key : String)
    (component : Component props)
    (props : props)
    (children : Array Html := #[]) :
    Html :=
  Lean.Vir.React.Node.keyedOfComponent key component (componentProps props children)

def component
    (component : Component props)
    (props : props)
    (children : Array Html := #[]) :
    Html :=
  ofComponent component props children

def keyedComponent
    (key : String)
    (component : Component props)
    (props : props)
    (children : Array Html := #[]) :
    Html :=
  keyedOfComponent key component props children

def div (children : Array Html) : Html :=
  element "div" #[] children

def divWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "div" attrs children

def span (children : Array Html) : Html :=
  element "span" #[] children

def spanWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "span" attrs children

def p (children : Array Html) : Html :=
  element "p" #[] children

def pWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "p" attrs children

def b (children : Array Html) : Html :=
  element "b" #[] children

def bWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "b" attrs children

def sectionWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "section" attrs children

def ulWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "ul" attrs children

def liWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "li" attrs children

def h3With (attrs : Array Attr) (children : Array Html) : Html :=
  element "h3" attrs children

def strong (children : Array Html) : Html :=
  element "strong" #[] children

def strongWith (attrs : Array Attr) (children : Array Html) : Html :=
  element "strong" attrs children

def img (attrs : Array Attr := #[]) : Html :=
  elementWith "img" attrs #[]

def hr (attrs : Array Attr := #[]) : Html :=
  elementWith "hr" attrs #[]

def br (attrs : Array Attr := #[]) : Html :=
  elementWith "br" attrs #[]

def buttonWith
    (attrs : Array Attr)
    (handlers : Array Handler)
    (children : Array Html) :
    Html :=
  elementWith "button" (#[Attr.type "button"] ++ attrs) handlers children

end Html

end Lean.Vir.ProofWidgets
