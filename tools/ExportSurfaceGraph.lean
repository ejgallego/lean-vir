/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Compiler.InitAttr
import Lean.Compiler.IR.CompilerM
import Lean.DocString
import Lean.Elab.Frontend
import Lean.Meta

open Lean

namespace Vir.ExportSurfaceGraph

open Lean.IR

def graphFormat : String := "lean-ir-surface-graph"

def graphVersion : Nat := 3

structure Options where
  output : System.FilePath
  source : System.FilePath
  moduleName : Name
  roots : Array Name := #[]
  supportRoots : Array Name := #[]

private def parseName (text : String) : Except String Name := do
  let parts := text.splitOn "."
  if parts.isEmpty || parts.any (·.isEmpty) then
    throw s!"invalid dotted Lean name `{text}`"
  return parts.foldl (fun name part => .str name part) .anonymous

partial def parseOptions (args : List String) (options? : Option Options) :
    Except String Options := do
  match args, options? with
  | "--output" :: output :: "--source" :: source :: "--module" :: moduleName :: rest, none =>
      let moduleName ← parseName moduleName
      parseOptions rest (some { output, source, moduleName })
  | "--root" :: root :: rest, some options =>
      let root ← parseName root
      if options.roots.contains root then throw s!"duplicate --root `{root}`"
      parseOptions rest (some { options with roots := options.roots.push root })
  | "--support-root" :: root :: rest, some options =>
      let root ← parseName root
      if options.supportRoots.contains root then throw s!"duplicate --support-root `{root}`"
      parseOptions rest (some { options with supportRoots := options.supportRoots.push root })
  | [], some options =>
      if options.roots.isEmpty then throw "at least one --root is required"
      return options
  | arg :: _, _ => throw s!"unexpected argument `{arg}`"
  | [], none => throw "missing --output, --source, and --module"

private def addUnique (names : Array Name) (name : Name) : Array Name :=
  if names.contains name then names else names.push name

private def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap name _ | .pap name _ => addUnique refs name
  | _ => refs

private partial def refsOfBody : FnBody → Array Name → Array Name
  | .vdecl _ _ expr continuation, refs => refsOfBody continuation (refsOfExpr expr refs)
  | .jdecl _ _ body continuation, refs =>
      refsOfBody continuation (refsOfBody body refs)
  | .set _ _ _ continuation, refs
  | .setTag _ _ continuation, refs
  | .uset _ _ _ continuation, refs
  | .sset _ _ _ _ _ continuation, refs
  | .inc _ _ _ _ continuation, refs
  | .dec _ _ _ _ continuation, refs
  | .del _ continuation, refs => refsOfBody continuation refs
  | .case _ _ _ alternatives, refs =>
      alternatives.foldl (fun refs alternative =>
        match alternative with
        | .ctor _ body | .default body => refsOfBody body refs) refs
  | .ret _, refs | .jmp _ _, refs | .unreachable, refs => refs

private def refsOfDecl : Decl → Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

private def isUnsupportedInitGlobal : Decl → Bool
  | .fdecl _ params _ .unreachable _ => params.isEmpty
  | _ => false

private def boxedBaseName? : Name → Option Name
  | .str pre "_boxed" => some pre
  | _ => none

private def declarationClass (env : Environment) (name : Name) : String :=
  if (boxedBaseName? name).isSome then
    "boxed"
  else if isPrivateName name then
    "privateConstant"
  else if (env.find? name).isSome then
    "publicConstant"
  else
    "generated"

private def moduleFor (env : Environment) (fallback : Name) (name : Name) : Name :=
  match env.getModuleIdxFor? name with
  | some moduleIdx => env.header.moduleNames[moduleIdx]?.getD fallback
  | none => fallback

private def jsonNames (names : Array Name) : Json :=
  .arr (names.map fun name => .str name.toString)

private def externTargetJson : ExternEntry → Json
  | .standard backend value => Json.mkObj [
      ("kind", "standard"), ("backend", backend.toString), ("value", value)]
  | .inline backend value => Json.mkObj [
      ("kind", "inline"), ("backend", backend.toString), ("value", value)]
  | .adhoc backend => Json.mkObj [
      ("kind", "adhoc"), ("backend", backend.toString), ("value", Json.null)]
  | .opaque => Json.mkObj [
      ("kind", "opaque"), ("backend", Json.null), ("value", Json.null)]

private def externTargets : Decl → Array Json
  | .extern _ _ _ data => data.entries.toArray.map externTargetJson
  | _ => #[]

private def isHostExtern : Decl → Bool
  | .extern _ _ _ data => data.entries.any fun entry =>
      match entry with
      | .standard _ symbol =>
          symbol.startsWith "__vir_js:" ||
            symbol.startsWith "__vir_js_explicit_conversion:"
      | _ => false
  | _ => false

private structure GraphNode where
  name : Name
  moduleName : Name
  kind : String
  declarationClass : String
  deps : Array Name := #[]
  targets : Array Json := #[]
  host : Bool := false
  unsupportedInitGlobal : Bool := false
  abi : Option Json := none
  typeSignature : Option String := none
  docString : Option String := none

private def optionalStringJson : Option String → Json
  | some value => .str value
  | none => .null

private def irTypeLabel : IRType → String
  | .float => "float"
  | .uint8 => "uint8"
  | .uint16 => "uint16"
  | .uint32 => "uint32"
  | .uint64 => "uint64"
  | .usize => "usize"
  | .erased => "erased"
  | .object => "object"
  | .tobject => "tobject"
  | .float32 => "float32"
  | .struct name _ => s!"struct:{name}"
  | .union name _ => s!"union:{name}"
  | .tagged => "tagged"
  | .void => "void"

private def declarationAbiJson (decl : Decl) : Json := Json.mkObj [
  ("params", .arr (decl.params.map fun param => Json.mkObj [
    ("borrow", param.borrow),
    ("type", irTypeLabel param.ty)
  ])),
  ("resultType", irTypeLabel decl.resultType)
]

private def GraphNode.toJson (node : GraphNode) : Json := Json.mkObj [
  ("name", node.name.toString),
  ("module", node.moduleName.toString),
  ("kind", node.kind),
  ("class", node.declarationClass),
  ("deps", jsonNames node.deps),
  ("targets", .arr node.targets),
  ("host", node.host),
  ("unsupportedInitGlobal", node.unsupportedInitGlobal),
  ("abi", node.abi.getD .null),
  ("type", optionalStringJson node.typeSignature),
  ("doc", optionalStringJson node.docString)
]

private def compactWhitespace (text : String) : String :=
  (" ".toSlice.intercalate <|
    (text.split Char.isWhitespace).filter (!·.isEmpty) |>.toList)

private def declarationMetadata
    (env : Environment) (name : Name) : CoreM (Option String × Option String) := do
  let typeSignature ← match env.find? name with
    | some info => Meta.MetaM.run' do
        return some (compactWhitespace (toString (← Meta.ppExpr info.type)))
    | none => pure none
  let docString := (← findDocString? env name).map fun doc => doc.trimAscii.toString
  return (typeSignature, docString)

private def baseNodeFor (env : Environment) (fallback : Name) (name : Name) : GraphNode :=
  match findEnvDecl env name with
  | some decl@(.fdecl ..) =>
      let unsupported := isUnsupportedInitGlobal decl
      let deps :=
        if unsupported then
          match getInitFnNameFor? env name with
          | some initName => #[initName]
          | none => #[]
        else
          refsOfDecl decl
      {
        name
        moduleName := moduleFor env fallback name
        kind := "function"
        declarationClass := declarationClass env name
        deps
        unsupportedInitGlobal := unsupported && deps.isEmpty
        abi := some (declarationAbiJson decl)
      }
  | some decl@(.extern ..) => {
      name
      moduleName := moduleFor env fallback name
      kind := "extern"
      declarationClass := "extern"
      targets := externTargets decl
      host := isHostExtern decl
      abi := some (declarationAbiJson decl)
    }
  | none => {
      name
      moduleName := moduleFor env fallback name
      kind := "missing"
      declarationClass := "generated"
    }

private def nodeFor
    (env : Environment) (fallback : Name) (name : Name) (selected : Bool) : CoreM GraphNode := do
  let node := baseNodeFor env fallback name
  if selected || node.kind == "extern" then
    let (typeSignature, docString) ← declarationMetadata env name
    return { node with typeSignature, docString }
  return node

private def captureGraph (env : Environment) (options : Options) : CoreM (Array GraphNode) := do
  let seeds := options.roots.foldl addUnique options.supportRoots
  let mut pending := seeds
  let mut scheduled : NameSet := seeds.foldl (fun names name => names.insert name) {}
  let mut nodes : Array GraphNode := #[]
  let mut cursor := 0
  while cursor < pending.size do
    let name := pending[cursor]!
    cursor := cursor + 1
    let node ← nodeFor env options.moduleName name (options.roots.contains name)
    nodes := nodes.push node
    for dep in node.deps do
      unless scheduled.contains dep do
        scheduled := scheduled.insert dep
        pending := pending.push dep
  return nodes.qsort fun lhs rhs => lhs.name.toString < rhs.name.toString

private unsafe def loadEnvironment (options : Options) : IO Environment := do
  enableInitializersExecution
  initSearchPath (← findSysroot)
  let contents ← IO.FS.readFile options.source
  let opts := maxHeartbeats.set (Elab.async.set (default : Lean.Options) false) 0
  match ← Elab.runFrontend contents opts options.source.toString options.moduleName with
  | some env => return env
  | none => throw <| IO.userError s!"Lean frontend failed for `{options.source}`"

private def graphJson (options : Options) (env : Environment) (nodes : Array GraphNode) : Json :=
  Json.mkObj [
    ("format", graphFormat),
    ("version", graphVersion),
    ("lean", Json.mkObj [
      ("version", Lean.versionString),
      ("toolchain", Lean.toolchain),
      ("githash", Lean.githash)
    ]),
    ("capture", Json.mkObj [
      ("source", options.source.toString),
      ("module", options.moduleName.toString),
      ("roots", jsonNames options.roots),
      ("supportRoots", jsonNames options.supportRoots),
      ("loadedModules", env.header.moduleNames.size)
    ]),
    ("nodes", .arr (nodes.map GraphNode.toJson))
  ]

unsafe def run (options : Options) : IO UInt32 := do
  let env ← loadEnvironment options
  let nodes ← (captureGraph env options).toIO'
    { fileName := options.source.toString, fileMap := default }
    { env }
  if let some parent := options.output.parent then IO.FS.createDirAll parent
  IO.FS.writeFile options.output (graphJson options env nodes).pretty
  IO.eprintln s!"surface graph: captured {nodes.size} node(s) with Lean {Lean.versionString}"
  return 0

end Vir.ExportSurfaceGraph

unsafe def main (args : List String) : IO UInt32 := do
  match Vir.ExportSurfaceGraph.parseOptions args none with
  | .ok options =>
      try Vir.ExportSurfaceGraph.run options
      catch error =>
        IO.eprintln s!"surface graph failed: {error}"
        return 1
  | .error error =>
      IO.eprintln error
      IO.eprintln <|
        "usage: ExportSurfaceGraph.lean --output <graph.json> --source <file.lean> " ++
        "--module <Lean.Module> --root <Lean.Name>... [--support-root <Lean.Name>]..."
      return 2
