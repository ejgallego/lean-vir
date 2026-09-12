import Vir.Infoview
import Vir.React

namespace SmokeInfoviewLean

/--
error: failed to synthesize
  MonadLift IO Lean.Vir.React.ReactM

Hint: Additional diagnostic information may be available using the `set_option diagnostics true` command.
-/
#guard_msgs in
#synth MonadLift IO Lean.Vir.React.ReactM

/--
error: failed to synthesize
  MonadLift IO Lean.Vir.Browser.DomM

Hint: Additional diagnostic information may be available using the `set_option diagnostics true` command.
-/
#guard_msgs in
#synth MonadLift IO Lean.Vir.Browser.DomM

example : MonadLift Lean.Vir.React.ReactM Lean.Vir.Browser.DomM := inferInstance

def expect (label : String) (ok : Bool) : IO Unit := do
  unless ok do
    throw <| IO.userError s!"infoview smoke failed: {label}"

def expectPathOk (path expected : String) : IO Unit := do
  match Lean.Vir.Infoview.validateAssetPath path with
  | .ok got => expect s!"{path} validates as {expected}" (got.toString == expected)
  | .error message =>
      throw <| IO.userError s!"infoview smoke failed: {path} rejected: {message}"

def expectPathError (path : String) : IO Unit := do
  match Lean.Vir.Infoview.validateAssetPath path with
  | .ok got =>
      throw <| IO.userError s!"infoview smoke failed: {path} unexpectedly accepted as {got}"
  | .error _ => pure ()

def expectRootsOk (roots : Array String) (expected : Array Lean.Name) : IO Unit := do
  match Lean.Vir.Infoview.irPackageRoots { roots := roots } with
  | .ok got => expect s!"roots {roots} validate" (got == expected)
  | .error message =>
      throw <| IO.userError s!"infoview smoke failed: roots {roots} rejected: {message}"

def expectRootsError (roots : Array String) : IO Unit := do
  match Lean.Vir.Infoview.irPackageRoots { roots := roots } with
  | .ok got =>
      throw <| IO.userError s!"infoview smoke failed: roots {roots} unexpectedly accepted as {got}"
  | .error _ => pure ()

def AuthoringComponent : Lean.Vir.RuntimeM
    (Lean.Vir.React.FunctionComponent Lean.Vir.Infoview.PanelWidgetProps) :=
  Lean.Vir.React.FunctionComponent.ofLean fun _props => do
    Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString "authoring smoke")

vir_proof_widget AuthoringComponent

example : Lean.Vir.RuntimeM
    (Lean.Vir.React.FunctionComponent Lean.Vir.Infoview.PanelWidgetProps) :=
  createComponent

def expectAuthoringPackage (package : Lean.Vir.Infoview.IRPackage) : IO Unit := do
  expect "authoring package roots" <|
    package.roots == #[
      "SmokeInfoviewLean.createComponent"
    ]

def smokeVar : Lean.IR.VarId :=
  { idx := 0 }

def smokeDecl (value : String) : Lean.IR.Decl :=
  .fdecl `SmokeInfoviewLean.helper #[] .object
    (.vdecl smokeVar .object (.lit (.str value)) (.ret (.var smokeVar)))
    {}

def smokeHostDecl (marker : Vir.HostMetadata.HostImportMarker) : Lean.IR.Decl :=
  .extern `SmokeInfoviewLean.host #[] .object {
    entries := [.standard `all (marker.externSymbol "smoke.sameTarget")]
  }

def importedHelperTargetSource : System.FilePath :=
  "fixtures/infoview/ImportedHelperTarget.lean"

/-- Only the serial batch test creates a frontend; production RPC uses the
environment already prepared by the file worker. -/
unsafe def snapshotEnvironment (source contents : String) : IO Lean.Environment := do
  Lean.enableInitializersExecution
  let some env ← Lean.Elab.runFrontend contents
      (Lean.Elab.inServer.set (Lean.Elab.async.set ({} : Lean.Options) false) true)
      source `InfoviewSnapshotTest
    | throw <| IO.userError "snapshot frontend failed"
  return env

unsafe def importedHelperClosure (root : Lean.Name) : IO Vir.GeneratePackage.Closure := do
  let env ← snapshotEnvironment importedHelperTargetSource.toString
    (← IO.FS.readFile importedHelperTargetSource)
  let input ← IO.ofExcept <|
    Vir.GeneratePackage.prepareSnapshotInput importedHelperTargetSource.toString env #[root]
  return Lean.Vir.Infoview.packageClosure input

def loadedDecl? (closure : Vir.GeneratePackage.Closure) (name : Lean.Name) :
    Option Vir.GeneratePackage.LoadedDecl :=
  closure.decls.find? fun loaded => loaded.decl.name == name

def expectImportedDecl
    (label : String)
    (closure : Vir.GeneratePackage.Closure)
    (name : Lean.Name) : IO Lean.IR.Decl := do
  match loadedDecl? closure name with
  | none =>
      throw <| IO.userError s!"infoview smoke failed: missing imported helper `{name}`"
  | some loaded =>
      expect s!"{label} is loaded through an imported module" <|
        loaded.module? == some `InfoviewFixtures.ImportedHelper
      return loaded.decl

/-- Exercise the same environment adapter as the RPC handler, without a disk
source to fall back to. Local edits must survive imported-owner resolution. -/
unsafe def snapshotPackage (suffix : String) : IO (String × ByteArray) := do
  let source := "untitled:ModuleSnapshot.lean"
  let contents := "module\npublic import InfoviewFixtures.ImportedHelper\n" ++
    "private initialize snapshotPrefix : String ← pure \"snapshot:\"\n" ++
    "@[noinline] private def snapshotSuffix (_ : Unit) : String := " ++
    s!"{Lean.Json.compress (.str suffix)}\n" ++
    "public def snapshotValue : String := InfoviewFixtures.ImportedHelper.labelBefore () ++ snapshotPrefix ++ snapshotSuffix ()\n"
  let env ← snapshotEnvironment source contents
  let roots := #[`snapshotValue]
  let input ← IO.ofExcept <| Vir.GeneratePackage.prepareSnapshotInput source env roots
  let target := input.target
  let index := input.index
  let closure := Lean.Vir.Infoview.packageClosure input
  expect "snapshot target preserves document provenance and module identity" <|
    match target.origin with
    | .snapshot document name => document == source && name == env.mainModule
    | _ => false
  expect "snapshot root records its current module" <|
    (index.find? `snapshotValue).bind (·.module?) == some env.mainModule
  expect "snapshot locals retain document provenance and module ownership" <|
    index.localDecls.all fun _ loaded =>
      loaded.source == source && loaded.module? == some env.mainModule
  expect "snapshot closure includes a private current-module helper" <|
    closure.decls.any fun loaded =>
      Lean.isPrivateName loaded.decl.name && loaded.module? == some env.mainModule
  let retained ← index.loadImportedModule env.mainModule
  expect "snapshot current module is already loaded without disk artifacts" <|
    retained.sources.size == index.sources.size
  expect "module snapshot resolves opaque imports" closure.missingDecls.isEmpty
  expect "module snapshot resolves externs" closure.missingExterns.isEmpty
  expect s!"module snapshot resolves initializer globals: {closure.unsupportedInitGlobals.map Vir.GeneratePackage.ClosureDependency.name}"
    closure.unsupportedInitGlobals.isEmpty
  expect "module snapshot includes private transitive owner" <|
    closure.decls.any (fun loaded => loaded.module? ==
      some `InfoviewFixtures.ImportedHelper.Internal)
  let order ← IO.ofExcept <| closure.moduleInitializationOrder index target env.mainModule
  expect "live module root is last in its explicit dependency graph" <|
    order.back? == some env.mainModule
  expect "live module order includes private imported owner" <|
    order.contains `InfoviewFixtures.ImportedHelper.Internal
  expect "every closure declaration has a module owner" <|
    closure.decls.all (·.module?.isSome)
  let partitioned := order.flatMap fun name =>
    (closure.forModule name env.mainModule).decls.map (·.decl.name)
  expect "module partitioning preserves every declaration exactly once" <|
    Lean.Vir.Infoview.sortedNames partitioned ==
      Lean.Vir.Infoview.sortedNames (closure.decls.map (·.decl.name))
  expect "every initializer global has a declaration owner" <|
    closure.initGlobals.all fun entry =>
      closure.decls.any (fun loaded => loaded.decl.name == entry.name && loaded.module?.isSome)
  expect "live root owns a private initialized global" <|
    (closure.forModule env.mainModule env.mainModule).initGlobals.any fun entry =>
      Lean.isPrivateName entry.name
  let initializerPartitions := order.map fun name =>
    (name, (closure.forModule name env.mainModule).initGlobals)
  let initializerPairs := fun (entries : Array Vir.GeneratePackage.InitGlobal) =>
    (entries.map fun entry => (entry.name, entry.initName)).qsort fun a b =>
      if a.1 == b.1 then Lean.Name.quickLt a.2 b.2 else Lean.Name.quickLt a.1 b.1
  expect "module partitioning preserves initializer pairs with exact multiplicity" <|
    initializerPairs (initializerPartitions.flatMap (·.2)) ==
      initializerPairs closure.initGlobals
  expect "each initializer is in its original declaration owner's partition" <|
    initializerPartitions.all fun (moduleName, entries) =>
      entries.all fun entry =>
        closure.decls.any fun loaded =>
          loaded.decl.name == entry.name && loaded.module? == some moduleName
  let text := Lean.FileMap.ofString contents
  let token ← Lean.Vir.Infoview.packageClosureToken text source input env
  let revision := Lean.Vir.Infoview.irPackageRevision roots token
  let buildInput ← IO.ofExcept <| Vir.GeneratePackage.prepareSnapshotInput source env roots
  let buildToken ← Lean.Vir.Infoview.packageClosureToken text source buildInput env
  expect "stat/build preparation gives the same revision for the same snapshot" <|
    revision == Lean.Vir.Infoview.irPackageRevision roots buildToken
  let some rangeToken ← Lean.Vir.Infoview.packageRangeToken? text source closure env
    | throw <| IO.userError "infoview smoke failed: snapshot has no source range token"
  expect "snapshot revision includes the computed source range token" <|
    token.endsWith s!":{rangeToken}"
  match ← Vir.GeneratePackage.buildPackageFromIndex revision #[target] index with
  | .error message => throw <| IO.userError message
  | .ok pkg =>
      let repeated ← IO.ofExcept <| ← Vir.GeneratePackage.buildPackageFromIndex revision
        #[buildInput.target] buildInput.index
      expect "same snapshot and revision emit identical bytes" (pkg.bytes == repeated.bytes)
      IO.FS.writeBinFile s!"build/infoview-smoke/snapshot-{suffix}.irpkg" pkg.bytes
      return (revision, pkg.bytes)

unsafe def privateEffectSnapshot : IO Unit := do
  let source := "untitled:PrivateEffectSnapshot.lean"
  let env ← snapshotEnvironment source <|
    "module\npublic import InfoviewFixtures.PrivateHost\nopen Lean.Vir Lean.Vir.React\n" ++
    "public def effectCalls (setup : Js EffectCallback) (deps : Js DependencyList) : Browser.DomM Unit := ReactM.run do\n" ++
    "  InfoviewFixtures.PrivateHost.call setup deps\n"
  let input ← IO.ofExcept <| Vir.GeneratePackage.prepareSnapshotInput source env #[`effectCalls]
  let pkg ← IO.ofExcept <| ← Vir.GeneratePackage.buildPackageFromIndex
    "private-effects" #[input.target] input.index
  for target in #["react.useEffect"] do
    expect s!"live snapshot retains private effect import {target}" <|
      pkg.manifest.hostImports.any fun entry =>
        entry.target == target && Lean.isPrivateName entry.name
  for loaded in (Lean.Vir.Infoview.packageClosure input).decls do
    unless Vir.GeneratePackage.isVirJsDecl loaded.decl && Lean.isPrivateName loaded.decl.name do
      continue
    expect "private effect uses captured metadata, not a visible ConstantInfo" <|
      (env.find? loaded.decl.name).isNone
    let .extern name params result info := loaded.decl
      | throw <| IO.userError "expected a private host extern"
    let invalidTarget : Lean.IR.Decl := .extern name params result {
      entries := [.standard `all "__vir_js:smoke.changedTarget"]
    }
    let invalidMarker : Lean.IR.Decl := .extern name params result {
      entries := [.standard `all "__vir_js_explicit_conversion:react.useEffect"]
    }
    for (decl, reason) in #[
      (invalidTarget, "JavaScript import target differs"),
      (invalidMarker, "missing elaborated Lean declaration or validated attribute"),
      (.extern name params.pop result info, "JavaScript import IR arity mismatch")
    ] do
      let checked ← Vir.GeneratePackage.runCoreForSource source env <|
        Vir.GeneratePackage.hostImportFor 0 { loaded with decl }
      match checked with
      | .error diagnostic => expect reason (diagnostic.reason.startsWith reason)
      | .ok _ => throw <| IO.userError s!"private host mutation was accepted: {reason}"

unsafe def rejectNonModuleSnapshot : IO Unit := do
  let source := "untitled:PlainSnapshot.lean"
  let env ← snapshotEnvironment source
    "import InfoviewFixtures.ImportedHelper\ndef localValue : String := \"plain\"\n"
  for roots in #[#[`localValue], #[`InfoviewFixtures.ImportedHelper.labelBefore]] do
    match Lean.Vir.Infoview.prepareIRPackageInput source roots env with
    | .ok _ => throw <| IO.userError "non-module live snapshot was accepted"
    | .error error =>
        expect "non-module snapshot has invalidParams RPC error" (error.code == .invalidParams)
        expect "non-module snapshot explains required header and no-save policy" <|
          error.message == "VIR IR package failed:\nVIR live packages require a `module` header; add `module` to the document (no save is required)"

#eval do
  let generatedWidget ←
    IO.FS.readFile "build/generated/infoview/vir-infoview-widget.js"
  expect "embedded widget bundle matches generated output" <|
    Lean.Vir.Infoview.widget.javascript == generatedWidget
  expect "base64 vir" (Lean.Vir.Infoview.base64Encode "vir".toUTF8 == "dmly")
  expect "base64 Lean" (Lean.Vir.Infoview.base64Encode "Lean".toUTF8 == "TGVhbg==")
  expect "embedded widget bundle does not normalize panel props" <|
    (Lean.Vir.Infoview.widget.javascript.splitOn "surfaceFromInfoviewProps").length == 1
  expect "embedded widget bundle uses infoview react-dom external" <|
    1 < (Lean.Vir.Infoview.widget.javascript.splitOn "from \"react-dom\"").length
  expect "embedded widget bundle avoids react-dom/client" <|
    (Lean.Vir.Infoview.widget.javascript.splitOn "react-dom/client").length == 1
  expectPathOk "web/public/demo-host.irpkg" "web/public/demo-host.irpkg"
  expectPathError ""
  expectPathError "/tmp/demo-host.irpkg"
  expectPathError "web/../lakefile.lean"
  expectRootsOk #["VirNativeInfoview.createComponent"] #[
    `VirNativeInfoview.createComponent
  ]
  expectRootsOk #["ReactProofWidgetHello.createComponent"] #[
    `ReactProofWidgetHello.createComponent
  ]
  expectRootsOk #["ReactTamagotchiWidget.createComponent"] #[
    `ReactTamagotchiWidget.createComponent
  ]
  expectRootsOk #["VirNativeInfoview.createComponent", "VirNativeInfoview.createComponent"] #[
    `VirNativeInfoview.createComponent
  ]
  expectRootsError #[]
  expectRootsError #["VirNativeInfoview."]
  expect "authoring widget component entry"
    (widgetProps.componentEntry == "SmokeInfoviewLean.createComponent")
  expect "authoring widget reload interval" (widgetProps.autoReloadMs == 1000)
  expect "authoring widget wasm path" (widgetProps.wasmPath == Lean.Vir.Infoview.ReactWidget.defaultWasmPath)
  expectAuthoringPackage widgetProps.irPackage
  expect "IR decl hash tracks body literals" <|
    Lean.Vir.Infoview.irDeclHash (smokeDecl "before") !=
      Lean.Vir.Infoview.irDeclHash (smokeDecl "after")
  expect "IR decl hash tracks host import markers" <|
    Lean.Vir.Infoview.irDeclHash (smokeHostDecl .hostImport) !=
      Lean.Vir.Infoview.irDeclHash (smokeHostDecl .explicitConversion)
  let beforeClosure ← importedHelperClosure `SmokeInfoviewImportedHelperTarget.before
  let afterClosure ← importedHelperClosure `SmokeInfoviewImportedHelperTarget.after
  let beforeDecl ←
    expectImportedDecl
      "before helper"
      beforeClosure
      `InfoviewFixtures.ImportedHelper.labelBefore
  let afterDecl ←
    expectImportedDecl
      "after helper"
      afterClosure
      `InfoviewFixtures.ImportedHelper.labelAfter
  expect "real imported helper IR hash tracks helper bodies" <|
    Lean.Vir.Infoview.irDeclHash beforeDecl !=
      Lean.Vir.Infoview.irDeclHash afterDecl
  expect "real imported helper closure hash participates in reload token" <|
    Lean.Vir.Infoview.closureIRHash beforeClosure !=
      Lean.Vir.Infoview.closureIRHash afterClosure
  IO.FS.createDirAll "build/infoview-smoke"
  rejectNonModuleSnapshot
  privateEffectSnapshot
  let firstSnapshot ← snapshotPackage "first"
  let editedSnapshot ← snapshotPackage "edited"
  expect "unsaved module edits change the package revision" <|
    firstSnapshot.1 != editedSnapshot.1
  expect "unsaved module edits change the package bytes" <|
    firstSnapshot.2 != editedSnapshot.2

end SmokeInfoviewLean
