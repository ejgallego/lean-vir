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

def documentGetTitleCall :
    Lean.Vir.Browser.DomM (Lean.Vir.Js String) :=
  Lean.Vir.Browser.Document.getTitle

def documentSetTitleCall
    (title : Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.Browser.Document.setTitle title

def documentQuerySelectorCall
    (selector : Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js.Nullable Lean.Vir.Browser.Element) :=
  Lean.Vir.Browser.Document.querySelector selector

def documentQuerySelectorAllCall
    (selector : Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM
      (Lean.Vir.Js.NodeList (Lean.Vir.Js Lean.Vir.Browser.Element)) :=
  Lean.Vir.Browser.Document.querySelectorAll selector

def documentCreateElementCall
    (tagName : Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.Element) :=
  Lean.Vir.Browser.Document.createElement tagName

def elementGetInnerHTMLCall
    (element : Lean.Vir.Js Lean.Vir.Browser.Element) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js String) :=
  Lean.Vir.Browser.Element.getInnerHTML element

def elementSetInnerHTMLCall
    (element : Lean.Vir.Js Lean.Vir.Browser.Element)
    (html : Lean.Vir.Js String) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.Browser.Element.setInnerHTML element html

end Lean.Vir.TypeAnchors
