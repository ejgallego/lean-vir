/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Meta
import Vir.GeneratePackage.Json
import Vir.GeneratePackage.Surface
import Vir.HostValidation

open Lean

namespace Vir.ExportVirJsInventory

open Vir.GeneratePackage

structure Options where
  output : System.FilePath
  modules : Array Name
  check : Bool := false

def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

def compact (text : String) : String :=
  (" ".toSlice.intercalate <|
    (text.split Char.isWhitespace).filter (!·.isEmpty) |>.toList)

def prettyType (info : ConstantInfo) : CoreM String :=
  Meta.MetaM.run' do
    return compact (toString (← Meta.ppExpr info.type))

def declarationSourceJson (name : Name) : CoreM String := do
  let moduleName := (← findModuleOf? name).getD .anonymous
  let range? ← findDeclarationRanges? name
  return match range? with
    | none => "null"
    | some ranges => jsonObject #[
        ("module", jsonName moduleName),
        ("path", jsonString s!"{moduleName.toString.replace "." "/"}.lean"),
        ("startLine", jsonNat ranges.range.pos.line),
        ("startColumn", jsonNat (ranges.range.pos.column + 1)),
        ("endLine", jsonNat ranges.range.endPos.line),
        ("endColumn", jsonNat (ranges.range.endPos.column + 1))
      ]

def markerLabel : Vir.HostMetadata.HostImportMarker → String
  | .hostImport => "vir_js"
  | .explicitConversion => "vir_js_explicit_conversion"

structure Binding where
  name : Name
  info : ConstantInfo
  moduleName : Name
  metadata : Vir.HostMetadata.HostImportMetadata
  boundary : Vir.Interface.HostImportBoundary

def bindingJson (binding : Binding) : CoreM String := do
  let type ← prettyType binding.info
  let source ← declarationSourceJson binding.name
  return jsonObject #[
    ("declaration", jsonName binding.name),
    ("module", jsonName binding.moduleName),
    ("private", jsonBool (isPrivateName binding.name)),
    ("marker", jsonString (markerLabel binding.metadata.marker)),
    ("boundary", jsonString binding.boundary.label),
    ("target", jsonString binding.metadata.target),
    ("type", jsonString type),
    ("source", source)
  ]

def collectBindings (env : Environment) : CoreM (Array Binding) := do
  let mut bindings : Array Binding := #[]
  for (name, info) in env.constants do
    if let some declaration := Lean.IR.findEnvDecl env name then
      if let some metadata := virJsMetadataFromDecl? declaration then
        let moduleName := (← findModuleOf? name).getD .anonymous
        let boundary ←
          match ← Vir.HostValidation.analyzeHostImport metadata.marker metadata.target info.type with
          | .ok analysis => pure analysis.boundary
          | .error error => throwError error.toMessageData
        bindings := bindings.push { name, info, moduleName, metadata, boundary }
  return bindings.qsort fun lhs rhs =>
    if lhs.metadata.target == rhs.metadata.target then
      lhs.name.toString < rhs.name.toString
    else
      lhs.metadata.target < rhs.metadata.target

def reportJson (options : Options) (env : Environment) : CoreM (String × Nat × Nat × Nat) := do
  let bindings ← collectBindings env
  let rows ← bindings.mapM bindingJson
  let hostImports := bindings.filter (·.metadata.marker == .hostImport) |>.size
  let explicitConversions := bindings.filter (·.metadata.marker == .explicitConversion) |>.size
  let targets := bindings.map (·.metadata.target) |>.toList.eraseDups.length
  let json := jsonObject #[
    ("format", jsonString "lean-vir-js-inventory"),
    ("version", jsonNat 1),
    ("generatedBy", jsonString "lake exe vir_js_inventory"),
    ("lean", jsonObject #[
      ("version", jsonString Lean.versionString),
      ("toolchain", jsonString Lean.toolchain),
      ("githash", jsonString Lean.githash)
    ]),
    ("modules", jsonArray (options.modules.map jsonName)),
    ("summary", jsonObject #[
      ("declarations", jsonNat bindings.size),
      ("virJs", jsonNat hostImports),
      ("explicitConversions", jsonNat explicitConversions),
      ("targets", jsonNat targets)
    ]),
    ("bindings", jsonArray rows)
  ]
  return (json, hostImports, explicitConversions, targets)

unsafe def run (options : Options) : IO UInt32 := do
  let env ← loadLibrarySurfaceEnvironment options.modules
  let (json, hostImports, explicitConversions, targets) ← (reportJson options env).toIO'
    { fileName := options.output.toString, fileMap := default }
    { env }
  let contents := json ++ "\n"
  if options.check then
    if !(← options.output.pathExists) || (← IO.FS.readFile options.output) != contents then
      IO.eprintln s!"`{options.output}` is stale; rerun vir_js_inventory without --check"
      return 1
  else
    if let some parent := options.output.parent then
      IO.FS.createDirAll parent
    IO.FS.writeFile options.output contents
  IO.println "\nVIR JavaScript boundary inventory"
  IO.println s!"  modules: {", ".intercalate (options.modules.map (·.toString) |>.toList)}"
  IO.println s!"  vir_js declarations: {hostImports}"
  IO.println s!"  explicit conversions: {explicitConversions}"
  IO.println s!"  distinct targets: {targets}"
  let action := if options.check then "validated" else "wrote"
  IO.println s!"  artifact: {action} {options.output}"
  return 0

end Vir.ExportVirJsInventory

unsafe def main (args : List String) : IO UInt32 := do
  let (check, args) :=
    match args with
    | "--check" :: rest => (true, rest)
    | rest => (false, rest)
  match args with
  | output :: moduleTexts =>
      let modules := moduleTexts.toArray.map Vir.ExportVirJsInventory.nameFromDotted
      if modules.isEmpty || modules.any (·.isAnonymous) then
        IO.eprintln "at least one non-empty dotted Lean module is required"
        return 2
      Vir.ExportVirJsInventory.run { output, modules, check }
  | _ =>
      IO.eprintln "usage: vir_js_inventory [--check] <output.json> <Lean.Module>..."
      return 2
