/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace Lean.Vir.TypeAnchors

/-!
Descriptor-forcing wrappers for reviewed shapes that are not available as
compiler-classified declarations in the shipped public inventory. These are
review fixtures, not application APIs.
-/

def browserEventIdentity
    (value : Lean.Vir.Js Lean.Vir.Browser.Event) :
    Lean.Vir.Js Lean.Vir.Browser.Event :=
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
    (node : Lean.Vir.Js Lean.Vir.React.Node) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.render root node

def reactRootUnmountCall
    (root : Lean.Vir.Js Lean.Vir.React.Root) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.unmount root

end Lean.Vir.TypeAnchors
