/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Lean
public import Lean.Compiler.LCNF.ToImpureType
public import Vir.Compiler.Interface.Classify.Basic

public section
open Lean
namespace Vir.Interface

/-- Experimental library construction rule for one closed source type.
Registration is compiler-environment-wide, not a per-call representation choice. -/
structure ClosedLibraryAdapter where
  sourceType : Expr
  wireType : Expr
  decode : Name
  encode : Name
  deriving Inhabited

initialize libraryAdapters : SimplePersistentEnvExtension ClosedLibraryAdapter (Array ClosedLibraryAdapter) ←
  registerSimplePersistentEnvExtension {
    addEntryFn := Array.push
    addImportedFn := fun entries => entries.foldl (· ++ ·) #[]
  }

private def sameCodec (a b : ClosedLibraryAdapter) : Bool :=
  (⟨a.wireType⟩ : ExprStructEq) == ⟨b.wireType⟩ && a.decode == b.decode && a.encode == b.encode

/-- Imported modules can register independently. Select only a unique mapping;
identical repetitions agree, but import order must never choose between codecs. -/
def closedLibraryAdapter? (env : Environment) (type : Expr) : Except String (Option ClosedLibraryAdapter) := do
  let mut selected := none
  for rule in libraryAdapters.getState env do
    if (⟨rule.sourceType⟩ : ExprStructEq) == ⟨type.consumeMData⟩ then
      if let some previous := selected then
        unless sameCodec previous rule do
          throw s!"conflicting library adapters for {type}"
      selected := some rule
  return selected

def isLibraryAdapterOperation (env : Environment) (name : Name) : Bool :=
  (libraryAdapters.getState env).any fun rule => rule.decode == name || rule.encode == name

/-- Validate real helper types before registering a construction rule.
Rules support closed Type-0 domains and monomorphic safe helpers;
unsupported instantiations fail rather than acquiring erased ABI parameters. -/
def registerClosedLibraryAdapter (sourceType wireType : Expr) (decode encode : Name) : MetaM Unit := do
  let source ← Meta.whnf sourceType
  if (simpleInterfaceType? source).isSome || (resourceInterfaceType? source).isSome || source.isForall then
    throwError "library adapters cannot replace primitive, reference or callable boundaries"
  for type in #[sourceType, wireType] do
    if type.hasFVar || type.hasMVar || type.hasLooseBVars then
      throwError "library adapter requires a closed type"
    unless ← Meta.isDefEq (← Meta.inferType type) (.sort (.succ .zero)) do
      throwError "library adapter requires a Type-0 domain"
    let physical ← Lean.Compiler.LCNF.toImpureType (← Lean.Compiler.LCNF.toMonoType (← Lean.Compiler.LCNF.toLCNFType (← Meta.whnf type)))
    unless physical == Lean.Compiler.LCNF.ImpureType.object || physical == Lean.Compiler.LCNF.ImpureType.tobject do
      throwError "library adapter requires object-backed source and wire domains"
  let outcome := mkApp2 (mkConst ``Except [.zero, .zero]) (mkConst ``String) sourceType
  for (name, domain, result) in #[(decode, wireType, outcome), (encode, sourceType, wireType)] do
    let .defnInfo info ← getConstInfo name
      | throwError "library adapter helper {name} must be a compiled definition"
    unless info.levelParams.isEmpty && info.safety == .safe do
      throwError "library adapter helper {name} must be closed and safe"
    let expected := mkForall `value .default domain result
    unless ← Meta.isDefEq info.type expected do
      throwError "library adapter helper {name} has the wrong domain/result type"
  let previous? ← ofExcept (closedLibraryAdapter? (← getEnv) sourceType)
  if let some previous := previous? then
    unless sameCodec previous {sourceType, wireType, decode, encode} do
      throwError "conflicting library adapter for {sourceType}"
    return
  modifyEnv fun env => libraryAdapters.addEntry env { sourceType := sourceType.consumeMData, wireType, decode, encode }

end Vir.Interface
