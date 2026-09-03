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

unsafe def importedHelperClosure (root : Lean.Name) : IO Vir.GeneratePackage.Closure := do
  let target : Vir.GeneratePackage.Target := {
    source := importedHelperTargetSource
    roots := #[root]
  }
  let index ← Vir.GeneratePackage.loadDeclIndex #[target]
  return Vir.GeneratePackage.collectClosure #[target] index

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
        loaded.source.startsWith s!"imported by {importedHelperTargetSource}"
      return loaded.decl

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

end SmokeInfoviewLean
