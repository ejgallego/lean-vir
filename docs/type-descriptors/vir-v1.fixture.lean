/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace Lean.Vir.TypeAnchors

/-!
Small descriptor-forcing wrappers for the checked type-anchor manifest. These
are review fixtures, not application APIs.
-/

def reactPropertyIdentity
    (value : Lean.Vir.React.Property) :
    Lean.Vir.React.Property :=
  value

def reactEventHandlerIdentity
    (value : Lean.Vir.React.EventHandler) :
    Lean.Vir.React.EventHandler :=
  value

def reactRootIdentity
    (value : Lean.Vir.Js Lean.Vir.React.Root) :
    Lean.Vir.Js Lean.Vir.React.Root :=
  value

def reactRootCreateCall
    (container : Lean.Vir.Js Lean.Vir.Browser.Element) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.React.Root) :=
  Lean.Vir.React.Root.create container

def reactRootRenderCall
    (root : Lean.Vir.Js Lean.Vir.React.Root)
    (node : Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.render root node

def reactRootUnmountCall
    (root : Lean.Vir.Js Lean.Vir.React.Root) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.unmount root

end Lean.Vir.TypeAnchors
