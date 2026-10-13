/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Std.Data.TreeMap
public meta import Vir.Attributes
public meta import Vir.Compiler.Interface.LibraryAdapters
public section

namespace AdapterValues

abbrev Store := Std.TreeMap Nat String compare

def decode (entries : Array (Nat × String)) : Except String Store :=
  .ok (Std.TreeMap.ofArray entries)

def encode (store : Store) : Array (Nat × String) := store.toArray

-- Experimental compiler registration; no public runtime selector is used.
run_meta do
  let .forallE _ wire outcome _ := (← Lean.getConstInfo ``decode).type
    | Lean.throwError "unexpected decoder type"
  let #[_, source] := outcome.getAppArgs
    | Lean.throwError "unexpected decoder result"
  (Vir.Interface.registerClosedLibraryAdapter source wire ``decode ``encode).run'

@[vir_export] def identity (store : Store) : Store := store
@[vir_export] def count (store : Store) : Nat := store.size
@[vir_export] def lookup (store : Store) (key : Nat) : Option String := store.get? key

structure Wrapper where
  label : String
  store : Store

@[vir_export] def wrapperIdentity (value : Wrapper) : Wrapper := value

end AdapterValues
