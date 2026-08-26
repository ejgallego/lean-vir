/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Js

namespace Lean.Vir.ProofWidgets

/-- Opaque marker for a server-owned ProofWidgets RPC reference object. -/
opaque ServerRef : Type

/-- Host-inspectable descriptor for a ProofWidgets-style RPC reference. -/
structure RpcRef where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  serverRef : Option (Lean.Vir.Js ServerRef) := none

/-- Resolved metadata for a ProofWidgets-style RPC reference. -/
structure ResolvedRef where
  id : String
  label : String
  typeName : String
  summary : String
  expression : String
  typeText : String
  context : String
  source : String
  position : String
  packageRevision : String
  storeKey : String
  knownConstant : Bool
  deriving Repr

namespace ResolvedRef

def statusText (info : ResolvedRef) : String :=
  let expression := if info.expression == "" then info.label else info.expression
  let typeText := if info.typeText == "" then "" else " : " ++ info.typeText
  "resolved " ++ expression ++ typeText ++ " at " ++ info.position

end ResolvedRef

/-- A Lean value paired with a host-visible ProofWidgets reference descriptor. -/
structure WithRpcRef (α : Type) where
  value : α
  ref : RpcRef

/-- Expression-with-context preview value used by the narrow RPC porting surface. -/
structure ExprWithCtx where
  code : String
  typeText : String
  context : String
  deriving Repr

end Lean.Vir.ProofWidgets
