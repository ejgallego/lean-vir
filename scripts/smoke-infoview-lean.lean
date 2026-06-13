import Vir.Infoview

namespace SmokeInfoviewLean

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

#eval do
  expect "base64 vir" (Lean.Vir.Infoview.base64Encode "vir".toUTF8 == "dmly")
  expect "base64 Lean" (Lean.Vir.Infoview.base64Encode "Lean".toUTF8 == "TGVhbg==")
  expect "embedded widget bundle has cursor surface" <|
    1 < (Lean.Vir.Infoview.widget.javascript.splitOn "documentPositionFromInfoviewPosition").length
  expectPathOk "web/public/demo-host.irpkg" "web/public/demo-host.irpkg"
  expectPathError ""
  expectPathError "/tmp/demo-host.irpkg"
  expectPathError "web/../lakefile.lean"
  expectRootsOk #["ReactProofWidget.mount", "ReactProofWidget.unmount"] #[
    `ReactProofWidget.mount,
    `ReactProofWidget.unmount
  ]
  expectRootsOk #["ReactProofWidgetHello.mount", "ReactProofWidgetHello.unmount"] #[
    `ReactProofWidgetHello.mount,
    `ReactProofWidgetHello.unmount
  ]
  expectRootsOk #["ReactProofWidget.mount", "ReactProofWidget.mount"] #[
    `ReactProofWidget.mount
  ]
  expectRootsError #[]
  expectRootsError #["ReactProofWidget."]

end SmokeInfoviewLean
