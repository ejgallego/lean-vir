/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Manifest.Encode
import Vir.GeneratePackage.PackageFormat

open Lean

namespace Vir.GeneratePackage

open Lean.IR

abbrev EmitM := StateT ByteArray (Except String)

def maxU32 : Nat := 4294967295

structure PackageSection where
  kind : Nat
  bytes : ByteArray

def withEmitContext (context : String) (action : EmitM α) : EmitM α :=
  fun bytes =>
    match action.run bytes with
    | .ok result => .ok result
    | .error err => .error s!"{context}: {err}"

def emitU8 (value : Nat) : EmitM Unit :=
  modify fun bytes => bytes.push (UInt8.ofNat value)

def emitBool (value : Bool) : EmitM Unit :=
  emitU8 (if value then 1 else 0)

def emitU32 (value : Nat) : EmitM Unit := do
  if value > maxU32 then
    throw s!"package format stores this field as u32, but got {value}"
  emitU8 (value % 256)
  emitU8 ((value / 256) % 256)
  emitU8 ((value / 65536) % 256)
  emitU8 ((value / 16777216) % 256)

def emitBytes (chunk : ByteArray) : EmitM Unit :=
  modify fun bytes => bytes.append chunk

def currentByteOffset : EmitM Nat := do
  return (← get).size

def emitString (value : String) : EmitM Unit := do
  let bytes := value.toUTF8
  emitU32 bytes.size
  emitBytes bytes

partial def emitName : Name -> EmitM Unit
  | .anonymous => emitU8 0
  | .str pre part => do
      emitU8 1
      emitName pre
      emitString part
  | .num pre idx => do
      emitU8 2
      emitName pre
      emitU32 idx

def emitType : IRType -> EmitM Unit
  | .float => emitU8 0
  | .uint8 => emitU8 1
  | .uint16 => emitU8 2
  | .uint32 => emitU8 3
  | .uint64 => emitU8 4
  | .usize => emitU8 5
  | .erased => emitU8 6
  | .object => emitU8 7
  | .tobject => emitU8 8
  | .float32 => emitU8 9
  | .struct .. => throw "unsupported IR type: struct values are not encoded by the demo package yet"
  | .union .. => throw "unsupported IR type: union values are not encoded by the demo package yet"
  | .tagged => emitU8 12
  | .void => emitU8 13

def emitArray (items : Array α) (emitItem : α -> EmitM Unit) : EmitM Unit := do
  emitU32 items.size
  items.forM emitItem

def emitArg : Arg -> EmitM Unit
  | .var id => emitU8 0 *> emitU32 id.idx
  | .erased => emitU8 1

def emitLit : LitVal -> EmitM Unit
  | .num value => emitU8 0 *> emitString (toString value)
  | .str value => emitU8 1 *> emitString value

def emitCtorInfo (info : CtorInfo) : EmitM Unit := do
  emitName info.name
  emitU32 info.cidx
  emitU32 info.size
  emitU32 info.usize
  emitU32 info.ssize

partial def emitExpr : IR.Expr -> EmitM Unit
  | .ctor info args => emitU8 0 *> emitCtorInfo info *> emitArray args emitArg
  | .reset n x => emitU8 1 *> emitU32 n *> emitU32 x.idx
  | .reuse x info updtHeader args => do
      emitU8 2; emitU32 x.idx; emitCtorInfo info; emitBool updtHeader; emitArray args emitArg
  | .proj i x => emitU8 3 *> emitU32 i *> emitU32 x.idx
  | .uproj i x => emitU8 4 *> emitU32 i *> emitU32 x.idx
  | .sproj i offset x => emitU8 5 *> emitU32 i *> emitU32 offset *> emitU32 x.idx
  | .fap f args => emitU8 6 *> emitName f *> emitArray args emitArg
  | .pap f args => emitU8 7 *> emitName f *> emitArray args emitArg
  | .ap x args => emitU8 8 *> emitU32 x.idx *> emitArray args emitArg
  | .box ty x => emitU8 9 *> emitType ty *> emitU32 x.idx
  | .unbox x => emitU8 10 *> emitU32 x.idx
  | .lit value => emitU8 11 *> emitLit value
  | .isShared x => emitU8 12 *> emitU32 x.idx

partial def emitAlt : Alt -> EmitM Unit
  | .ctor info body => emitU8 0 *> emitCtorInfo info *> emitBody body
  | .default body => emitU8 1 *> emitBody body
where
  emitParam (p : Param) : EmitM Unit := do
    emitU32 p.x.idx
    emitBool p.borrow
    emitType p.ty

  emitBody : FnBody -> EmitM Unit
    | .vdecl x ty expr cont => do
        emitU8 0; emitU32 x.idx; emitType ty; emitExpr expr; emitBody cont
    | .jdecl jp params body cont => do
        emitU8 1; emitU32 jp.idx; emitArray params emitParam; emitBody body; emitBody cont
    | .set x i arg cont => do
        emitU8 2; emitU32 x.idx; emitU32 i; emitArg arg; emitBody cont
    | .setTag x cidx cont => do
        emitU8 3; emitU32 x.idx; emitU32 cidx; emitBody cont
    | .uset x i y cont => do
        emitU8 4; emitU32 x.idx; emitU32 i; emitU32 y.idx; emitBody cont
    | .sset x i offset y ty cont => do
        emitU8 5; emitU32 x.idx; emitU32 i; emitU32 offset; emitU32 y.idx; emitType ty; emitBody cont
    | .inc x n maybeScalar persistent cont => do
        emitU8 6; emitU32 x.idx; emitU32 n; emitBool maybeScalar; emitBool persistent; emitBody cont
    | .dec x n maybeScalar persistent cont => do
        emitU8 7; emitU32 x.idx; emitU32 n; emitBool maybeScalar; emitBool persistent; emitBody cont
    | .del x cont => do
        emitU8 8; emitU32 x.idx; emitBody cont
    | .case tid x ty alts => do
        emitU8 9; emitName tid; emitU32 x.idx; emitType ty; emitArray alts emitAlt
    | .ret arg => emitU8 10 *> emitArg arg
    | .jmp jp args => emitU8 11 *> emitU32 jp.idx *> emitArray args emitArg
    | .unreachable => emitU8 12

def emitParam (p : Param) : EmitM Unit :=
  emitAlt.emitParam p

def emitBody (body : FnBody) : EmitM Unit :=
  emitAlt.emitBody body

def emitEntryHeader (name : Name) : EmitM Unit := do
  emitName name
  match boxedBaseName? name with
  | some base => emitBool true *> emitName base
  | none => emitBool false

def emitDeclEntry (loaded : LoadedDecl) : EmitM Unit := do
  withEmitContext s!"while encoding declaration `{loaded.decl.name}` from `{loaded.source}`" do
    emitEntryHeader loaded.decl.name
    match loaded.decl with
    | .fdecl _ params resultType body _ => do
        emitU8 0
        emitArray params emitParam
        emitType resultType
        emitBody body
    | .extern _ params resultType _ => do
        emitU8 1
        emitArray params emitParam
        emitType resultType

def emitExternEntry (ext : NativeExtern) : EmitM Unit := do
  withEmitContext s!"while encoding native extern `{ext.name}` mapped to `{ext.symbol}`" do
    emitEntryHeader ext.name
    emitU8 1
    emitArray ext.params emitParam
    emitType ext.resultType

def emitHostImport (entry : HostImport) : EmitM Unit := do
  withEmitContext s!"while encoding JavaScript import `{entry.name}` mapped to `{entry.target}`" do
    emitName entry.name
    emitString entry.target
    emitString entry.symbol
    emitU32 entry.arity
    emitU32 entry.erasedPrefixArgs
    emitBool entry.effect.isEffectful

def emitInterfaceExportSummary (entry : InterfaceExport) : EmitM Unit := do
  withEmitContext s!"while encoding interface export call summary `{entry.entry}`" do
    emitName entry.entry
    emitBool entry.effect.isEffectful
    emitU32 entry.args.size
    emitBool (interfaceNeedsBoxedCallBoundary entry.args entry.result)

def emitInitGlobal (entry : InitGlobal) : EmitM Unit := do
  withEmitContext s!"while encoding initializer global `{entry.name}`" do
    emitName entry.name
    emitName entry.initName

def emitToBytes (action : EmitM Unit) : Except String ByteArray := do
  let (_, bytes) ← action.run ByteArray.empty
  return bytes

def emitSectionDirectoryEntry (pkgSection : PackageSection) (offset : Nat) : EmitM Unit := do
  emitU32 pkgSection.kind
  emitU32 offset
  emitU32 pkgSection.bytes.size

def emitPackageSectionDirectory (sections : Array PackageSection) : EmitM Unit := do
  emitU32 sections.size
  let directoryStart ← currentByteOffset
  let payloadStart := directoryStart + sections.size * 12
  discard <| sections.foldlM (init := payloadStart) fun offset pkgSection => do
    emitSectionDirectoryEntry pkgSection offset
    return offset + pkgSection.bytes.size

def emitPackageSectionPayloads (sections : Array PackageSection) : EmitM Unit :=
  sections.forM fun pkgSection => emitBytes pkgSection.bytes

def packageSections (closure : Closure) (manifest : InterfaceManifest) : Except String (Array PackageSection) := do
  let decls ← emitToBytes do
    closure.decls.forM emitDeclEntry
    closure.externs.forM emitExternEntry
  let initGlobals ← emitToBytes do
    emitArray closure.initGlobals emitInitGlobal
  let hostImports ← emitToBytes do
    emitArray manifest.hostImports emitHostImport
  let exportSummaries ← emitToBytes do
    emitArray manifest.exports emitInterfaceExportSummary
  let interfaceManifest ← emitToBytes do
    emitString manifest.toJson
  return #[
    { kind := packageSectionDeclarations, bytes := decls },
    { kind := packageSectionInitGlobals, bytes := initGlobals },
    { kind := packageSectionHostImports, bytes := hostImports },
    { kind := packageSectionExportSummaries, bytes := exportSummaries },
    { kind := packageSectionInterfaceManifest, bytes := interfaceManifest }
  ]

def emitPackageM (closure : Closure) (manifest : InterfaceManifest) : EmitM Unit := do
  let sections ← packageSections closure manifest
  emitString "lean-vir-ir-package"
  emitU32 currentPackageFormatVersion
  emitU32 (closure.decls.size + closure.externs.size)
  emitPackageSectionDirectory sections
  emitPackageSectionPayloads sections

def emitPackage (closure : Closure) (manifest : InterfaceManifest) : Except String ByteArray := do
  let (_, bytes) <- (emitPackageM closure manifest).run ByteArray.empty
  return bytes

end Vir.GeneratePackage
