/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Lean.Elab.Frontend
import Lean.Compiler.IR.CompilerM
import Lean.Compiler.LCNF.Main

open Lean

namespace Vir.GeneratePackage

open Lean.IR

structure Target where
  source : System.FilePath
  roots : Array Name

structure LoadedDecl where
  source : String
  decl : Decl

structure NativeExtern where
  name : Name
  params : Array Param
  resultType : IRType
  symbol : String

structure Closure where
  seen : NameSet := {}
  decls : Array LoadedDecl := #[]
  externs : Array NativeExtern := #[]
  missingDecls : Array Name := #[]
  missingExterns : Array Name := #[]

def defaultTargets : Array Target := #[
  {
    source := "examples/Fib.lean",
    roots := #[`fib, `fib._boxed]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.step,
      `Tamagotchi.step._boxed,
      `Tamagotchi.run,
      `Tamagotchi.run._boxed,
      `Tamagotchi.trace,
      `Tamagotchi.trace._boxed,
      `Tamagotchi.demoScript
    ]
  },
  {
    source := "examples/MergeSort.lean",
    roots := #[`SortDemo.demo, `SortDemo.demoFromArray]
  }
]

def param (idx : Nat) (borrow : Bool) (ty : IRType) : Param :=
  { x := { idx }, borrow, ty }

def nativeExterns : Array NativeExtern := #[
  {
    name := `Nat.add,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_add"
  },
  {
    name := `Nat.sub,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_sub"
  },
  {
    name := `Nat.decEq,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_eq"
  },
  {
    name := `Nat.decLe,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_le"
  },
  {
    name := `Nat.decLt,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_nat_dec_lt"
  },
  {
    name := `Nat.mul,
    params := #[param 1 true .tobject, param 2 true .tobject],
    resultType := .tobject,
    symbol := "lean_nat_mul"
  },
  {
    name := `Array.mkEmpty,
    params := #[param 1 false .erased, param 2 false .tagged],
    resultType := .object,
    symbol := "lean_array_mk_empty"
  },
  {
    name := `Array.push,
    params := #[param 1 false .erased, param 2 false .object, param 3 false .tobject],
    resultType := .object,
    symbol := "lean_array_push"
  },
  {
    name := `Array.toList,
    params := #[param 1 false .erased, param 2 false .object],
    resultType := .tobject,
    symbol := "lean_array_to_list"
  },
  {
    name := `Array.size,
    params := #[param 1 false .erased, param 2 true .object],
    resultType := .tagged,
    symbol := "lean_array_get_size"
  },
  {
    name := `Array.usize,
    params := #[param 1 false .erased, param 2 true .object],
    resultType := .usize,
    symbol := "lean_array_size"
  },
  {
    name := `Array.uget,
    params := #[param 1 false .erased, param 2 true .object, param 3 false .usize, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_uget"
  },
  {
    name := `Array.ugetBorrowed,
    params := #[param 1 false .erased, param 2 true .object, param 3 false .usize, param 4 false .erased],
    resultType := .tobject,
    symbol := "lean_array_uget_borrowed"
  },
  {
    name := `Array.uset,
    params := #[param 1 false .erased, param 2 false .object, param 3 false .usize, param 4 false .tobject, param 5 false .erased],
    resultType := .object,
    symbol := "lean_array_uset"
  },
  {
    name := `ByteArray.empty,
    params := #[],
    resultType := .object,
    symbol := "l_ByteArray_empty"
  },
  {
    name := `ByteArray.push,
    params := #[param 1 false .object, param 2 false .uint8],
    resultType := .object,
    symbol := "lean_byte_array_push"
  },
  {
    name := `ByteArray.get!,
    params := #[param 1 true .object, param 2 true .tobject],
    resultType := .uint8,
    symbol := "lean_byte_array_get"
  },
  {
    name := `ByteArray.set!,
    params := #[param 1 false .object, param 2 true .tobject, param 3 false .uint8],
    resultType := .object,
    symbol := "lean_byte_array_set"
  },
  {
    name := `ByteArray.extract,
    params := #[param 1 false .object, param 2 false .tobject, param 3 false .tobject],
    resultType := .object,
    symbol := "l_ByteArray_extract"
  },
  {
    name := `ByteArray.size,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_byte_array_size"
  },
  {
    name := `USize.ofNat,
    params := #[param 1 true .tobject],
    resultType := .usize,
    symbol := "lean_usize_of_nat"
  },
  {
    name := `USize.add,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .usize,
    symbol := "lean_usize_add"
  },
  {
    name := `USize.decEq,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .uint8,
    symbol := "lean_usize_dec_eq"
  },
  {
    name := `USize.decLt,
    params := #[param 1 false .usize, param 2 false .usize],
    resultType := .uint8,
    symbol := "lean_usize_dec_lt"
  },
  {
    name := `String.append,
    params := #[param 1 false .object, param 2 true .object],
    resultType := .object,
    symbol := "lean_string_append"
  },
  {
    name := `String.length,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_string_length"
  },
  {
    name := `String.utf8ByteSize,
    params := #[param 1 true .object],
    resultType := .tagged,
    symbol := "lean_string_utf8_byte_size"
  },
  {
    name := `String.getUTF8Byte,
    params := #[param 1 true .object, param 2 false .tobject, param 3 false .erased],
    resultType := .uint8,
    symbol := "lean_string_get_byte_fast"
  },
  {
    name := `String.decEq,
    params := #[param 1 true .object, param 2 true .object],
    resultType := .uint8,
    symbol := "lean_string_dec_eq"
  },
  {
    name := `UInt8.toNat,
    params := #[param 1 false .uint8],
    resultType := .tagged,
    symbol := "lean_uint8_to_nat"
  }
]

def nativeExtern? (n : Name) : Option NativeExtern :=
  nativeExterns.find? fun ext => ext.name == n

def primitiveNamespaces : List String :=
  [
    "Array", "Bool", "ByteArray", "Char", "Float", "Float32", "IO", "Int",
    "Nat", "Ptr", "ST", "String", "UInt8", "UInt16", "UInt32", "UInt64",
    "USize"
  ]

partial def nameHead? : Name -> Option String
  | .anonymous => none
  | .str .anonymous part => some part
  | .str pre _ => nameHead? pre
  | .num pre _ => nameHead? pre

def isNativeExternCandidate (n : Name) : Bool :=
  match nameHead? n with
  | some head => primitiveNamespaces.contains head
  | none => false

def sanitizeSource (input : String) : String :=
  "\n".intercalate <|
    input.splitOn "\n" |>.filter fun line =>
      !(line.trimAsciiStart.copy.startsWith "#eval")

def moduleNameFor (path : System.FilePath) : Name :=
  .str (.str `VirIRInput (path.fileStem.getD "Input")) "Generated"

unsafe def frontendEnv (target : Target) : IO Environment := do
  -- Match Lean's CLI startup path: the frontend imports modules with loaded extensions.
  enableInitializersExecution
  let contents <- IO.FS.readFile target.source
  let opts := Elab.async.set ({} : Options) false
  let fileName := target.source.toString
  match <- Elab.runFrontend (sanitizeSource contents) opts fileName (moduleNameFor target.source) with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for {fileName}"

unsafe def loadDeclIndex (targets : Array Target) : IO (NameMap LoadedDecl) := do
  initSearchPath (← getBuildDir)
  let mut index : NameMap LoadedDecl := {}
  for target in targets do
    let env <- frontendEnv target
    for decl in getDecls env do
      index := index.insert decl.name { source := target.source.toString, decl }
  return index

def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap f _ => refs.push f
  | .pap f _ => refs.push f
  | _ => refs

partial def refsOfBody : FnBody -> Array Name -> Array Name
  | .vdecl _ _ expr cont, refs => refsOfBody cont (refsOfExpr expr refs)
  | .jdecl _ _ body cont, refs => refsOfBody cont (refsOfBody body refs)
  | .set _ _ _ cont, refs => refsOfBody cont refs
  | .setTag _ _ cont, refs => refsOfBody cont refs
  | .uset _ _ _ cont, refs => refsOfBody cont refs
  | .sset _ _ _ _ _ cont, refs => refsOfBody cont refs
  | .inc _ _ _ _ cont, refs => refsOfBody cont refs
  | .dec _ _ _ _ cont, refs => refsOfBody cont refs
  | .del _ cont, refs => refsOfBody cont refs
  | .case _ _ _ alts, refs =>
      alts.foldl (fun refs alt =>
        match alt with
        | .ctor _ body => refsOfBody body refs
        | .default body => refsOfBody body refs) refs
  | .ret _, refs => refs
  | .jmp _ _, refs => refs
  | .unreachable, refs => refs

def refsOfDecl : Decl -> Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

partial def collectName (index : NameMap LoadedDecl) (name : Name) (state : Closure) : Closure :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    match nativeExtern? name with
    | some ext => { state with externs := state.externs.push ext }
    | none =>
        match index.find? name with
        | none =>
            if isNativeExternCandidate name then
              { state with missingExterns := state.missingExterns.push name }
            else
              { state with missingDecls := state.missingDecls.push name }
        | some loaded =>
            let state := { state with decls := state.decls.push loaded }
            refsOfDecl loaded.decl |>.foldl (fun state dep => collectName index dep state) state

def collectClosure (targets : Array Target) (index : NameMap LoadedDecl) : Closure :=
  targets.foldl (fun state target =>
    target.roots.foldl (fun state root => collectName index root state) state) {}

abbrev EmitM := StateT ByteArray (Except String)

def maxU32 : Nat := 4294967295

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
  | .num value => emitU8 0 *> emitU32 value
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

def boxedBaseName? : Name -> Option Name
  | .str pre "_boxed" => some pre
  | _ => none

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

def emitPackageM (closure : Closure) : EmitM Unit := do
  emitString "lean-vir-ir-package"
  emitU32 1
  emitU32 (closure.decls.size + closure.externs.size)
  closure.decls.forM emitDeclEntry
  closure.externs.forM emitExternEntry

def emitPackage (closure : Closure) : Except String ByteArray := do
  let (_, bytes) <- (emitPackageM closure).run ByteArray.empty
  return bytes

def reportFor (targets : Array Target) (closure : Closure) : String :=
  let roots :=
    targets.foldl (fun acc target => acc ++ target.roots) #[]
  let loadedLines :=
    closure.decls.map fun loaded =>
      s!"- `{loaded.decl.name}` from `{loaded.source}`"
  let externLines :=
    closure.externs.map fun ext =>
      s!"- `{ext.name}` -> `{ext.symbol}`"
  let missingDeclLines :=
    if closure.missingDecls.isEmpty then #["None."] else closure.missingDecls.map fun n => s!"- `{n}`"
  let missingExternLines :=
    if closure.missingExterns.isEmpty then #["None."] else closure.missingExterns.map fun n => s!"- `{n}`"
  "# Generated IR Package Report\n\n"
  ++ "Generated by `tools/GeneratePackage.lean` from typed `Lean.IR.Decl` values.\n\n"
  ++ s!"Loaded declarations: {closure.decls.size}\n\n"
  ++ s!"Native extern declarations: {closure.externs.size}\n\n"
  ++ "## Roots\n\n"
  ++ "\n".intercalate (roots.map (fun n => s!"- `{n}`")).toList ++ "\n\n"
  ++ "## Loaded IR Declarations\n\n"
  ++ "\n".intercalate loadedLines.toList ++ "\n\n"
  ++ "## Native Extern Declarations\n\n"
  ++ "\n".intercalate externLines.toList ++ "\n\n"
  ++ "## Missing IR Declarations\n\n"
  ++ "\n".intercalate missingDeclLines.toList ++ "\n\n"
  ++ "## Missing Native Extern Registrations\n\n"
  ++ "\n".intercalate missingExternLines.toList ++ "\n"

def readTextFile? (path : System.FilePath) : IO (Option String) := do
  try
    return some (← IO.FS.readFile path)
  catch _ =>
    return none

def readBinFile? (path : System.FilePath) : IO (Option ByteArray) := do
  try
    return some (← IO.FS.readBinFile path)
  catch _ =>
    return none

def writeTextFile (path : System.FilePath) (content : String) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readTextFile? path) != some content then
    IO.FS.writeFile path content

def writeBinFile (path : System.FilePath) (content : ByteArray) : IO Unit := do
  if let some parent := path.parent then
    IO.FS.createDirAll parent
  if (← readBinFile? path) != some content then
    IO.FS.writeBinFile path content

unsafe def run (targets : Array Target) (packagePath reportPath : System.FilePath) : IO UInt32 := do
  let index <- loadDeclIndex targets
  let closure := collectClosure targets index
  let report := reportFor targets closure
  writeTextFile reportPath report
  if !closure.missingDecls.isEmpty || !closure.missingExterns.isEmpty then
    if !closure.missingDecls.isEmpty then
      IO.eprintln "missing IR declarations:"
      for name in closure.missingDecls do
        IO.eprintln s!"  - {name}"
    if !closure.missingExterns.isEmpty then
      IO.eprintln "missing native extern registrations:"
      for name in closure.missingExterns do
        IO.eprintln s!"  - {name}"
    IO.eprintln s!"see {reportPath}"
    return 1
  match emitPackage closure with
  | .ok bytes =>
      writeBinFile packagePath bytes
      IO.println s!"wrote {packagePath}"
      IO.println s!"wrote {reportPath}"
      return 0
  | .error err =>
      IO.eprintln err
      return 1

end Vir.GeneratePackage

def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

partial def takeTargetRoots : List String -> List String -> List String × List String
  | [], roots => (roots.reverse, [])
  | "--target" :: rest, roots => (roots.reverse, "--target" :: rest)
  | root :: rest, roots => takeTargetRoots rest (root :: roots)

partial def parseTargets : List String -> Except String (Array Vir.GeneratePackage.Target)
  | [] => pure #[]
  | "--target" :: source :: rest => do
      let (roots, rest) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"target `{source}` has no roots"
      let target : Vir.GeneratePackage.Target :=
        { source := source, roots := roots.toArray.map nameFromDotted }
      return (#[target] ++ (← parseTargets rest))
  | arg :: _ => throw s!"expected `--target`, got `{arg}`"

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | [packagePath, reportPath] =>
      Vir.GeneratePackage.run Vir.GeneratePackage.defaultTargets packagePath reportPath
  | packagePath :: reportPath :: targetArgs =>
      match parseTargets targetArgs with
      | .ok targets => Vir.GeneratePackage.run targets packagePath reportPath
      | .error err =>
          IO.eprintln err
          return 2
  | _ =>
      IO.eprintln "usage: lean --run tools/GeneratePackage.lean <package.irpkg> <report.md> [--target <source.lean> <root>...]"
      return 2
