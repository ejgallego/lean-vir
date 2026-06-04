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

def string (name value : String) : Property :=
  { name, value := .string value }

def bool (name : String) (value : Bool) : Property :=
  { name, value := .bool value }

end Property

namespace EventHandler

def mkClick (callback : IO Unit) : EventHandler :=
  { name := "onClick", callback := fun _event => callback }

end EventHandler

namespace Html

def elementSimple (tag : String) (children : Array Html) : Html :=
  .element tag none #[] #[] children

def button (label : String) (onClick : IO Unit) : Html :=
  .element "button" none #[]
    #[EventHandler.mkClick onClick]
    #[.text label]

end Html

namespace Root

/--
Creates a React root for an existing browser element.

Reference: [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot).
-/
@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Browser.Element) : IO Root

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
