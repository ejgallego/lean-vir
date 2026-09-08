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
    (Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface)) :=
  Lean.Vir.React.Component.ofLean fun _surface =>
    Lean.Vir.React.Node.text "authoring smoke"

vir_proof_widget AuthoringComponent with mountId := "vir-smoke-widget"

example : Lean.Vir.RuntimeM
    (Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface)) :=
  createComponent

example : Lean.Vir.Js Lean.Vir.React.Root →
    Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface) →
    Lean.Vir.Infoview.Surface → Lean.Vir.Browser.DomM Unit :=
  mount

def expectAuthoringPackage (package : Lean.Vir.Infoview.IRPackage) : IO Unit := do
  expect "authoring package roots" <|
    package.roots == #[
      "SmokeInfoviewLean.createComponent",
      "SmokeInfoviewLean.mount"
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
    "@[noinline] private def snapshotSuffix (_ : Unit) : String := " ++
    s!"{Lean.Json.compress (.str suffix)}\n" ++
    "public def snapshotValue : String := InfoviewFixtures.ImportedHelper.labelBefore () ++ snapshotSuffix ()\n"
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
  let text := Lean.FileMap.ofString contents
  let token ← Lean.Vir.Infoview.packageClosureToken text source input env
  let revision := Lean.Vir.Infoview.irPackageRevision roots token
  let buildInput ← IO.ofExcept <| Vir.GeneratePackage.prepareSnapshotInput source env roots
  let buildToken ← Lean.Vir.Infoview.packageClosureToken text source buildInput env
  expect "stat/build preparation gives the same revision for the same snapshot" <|
    revision == Lean.Vir.Infoview.irPackageRevision roots buildToken
  expect "snapshot revision includes actual source ranges" <|
    (token.splitOn "source-ranges:none").length == 1
  match ← Vir.GeneratePackage.buildPackageFromIndex revision #[target] index with
  | .error message => throw <| IO.userError message
  | .ok pkg =>
      let repeated ← IO.ofExcept <| ← Vir.GeneratePackage.buildPackageFromIndex revision
        #[buildInput.target] buildInput.index
      expect "same snapshot and revision emit identical bytes" (pkg.bytes == repeated.bytes)
      IO.FS.writeBinFile s!"build/infoview-smoke/snapshot-{suffix}.irpkg" pkg.bytes
      return (revision, pkg.bytes)

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
  expect "embedded widget bundle has cursor surface" <|
    1 < (Lean.Vir.Infoview.widget.javascript.splitOn "documentPositionFromInfoviewPosition").length
  expect "embedded widget bundle uses infoview react-dom external" <|
    1 < (Lean.Vir.Infoview.widget.javascript.splitOn "from \"react-dom\"").length
  expect "embedded widget bundle avoids react-dom/client" <|
    (Lean.Vir.Infoview.widget.javascript.splitOn "react-dom/client").length == 1
  expectPathOk "web/public/demo-host.irpkg" "web/public/demo-host.irpkg"
  expectPathError ""
  expectPathError "/tmp/demo-host.irpkg"
  expectPathError "web/../lakefile.lean"
  expectRootsOk #["ReactProofWidget.createComponent", "ReactProofWidget.mount"] #[
    `ReactProofWidget.createComponent,
    `ReactProofWidget.mount
  ]
  expectRootsOk #["ReactProofWidgetHello.createComponent", "ReactProofWidgetHello.mount"] #[
    `ReactProofWidgetHello.createComponent,
    `ReactProofWidgetHello.mount
  ]
  expectRootsOk #["ReactTamagotchiWidget.createComponent", "ReactTamagotchiWidget.mount"] #[
    `ReactTamagotchiWidget.createComponent,
    `ReactTamagotchiWidget.mount
  ]
  expectRootsOk #["ReactProofWidget.mount", "ReactProofWidget.mount"] #[
    `ReactProofWidget.mount
  ]
  expectRootsError #[]
  expectRootsError #["ReactProofWidget."]
  expect "authoring widget component entry"
    (widgetProps.componentEntry == "SmokeInfoviewLean.createComponent")
  expect "authoring widget entry" (widgetProps.entry == "SmokeInfoviewLean.mount")
  expect "authoring widget mount id" (widgetProps.mountId == "vir-smoke-widget")
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
  let firstSnapshot ← snapshotPackage "first"
  let editedSnapshot ← snapshotPackage "edited"
  expect "unsaved module edits change the package revision" <|
    firstSnapshot.1 != editedSnapshot.1
  expect "unsaved module edits change the package bytes" <|
    firstSnapshot.2 != editedSnapshot.2

end SmokeInfoviewLean
