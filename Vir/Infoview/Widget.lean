/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Widget
import Vir.Infoview.Package
import Vir.Infoview.Surface
import Vir.React

namespace Lean.Vir.Infoview

/--
Props for the minimal VIR infoview shell.

The `.irpkg` entry must have signature `String -> Surface -> DomM Bool`; the
shell passes a fresh DOM selector for its nested mount element and a
JavaScript-built surface structure from the real infoview panel props.
If `unmountEntry` is set, it must have signature `String -> DomM Bool` and is
called when the shell unmounts its nested element while keeping the runtime
service alive for later remounts.
-/
structure WidgetProps where
  runtimeUrl : String := ""
  wasmUrl : String := ""
  packageUrl : String := ""
  wasmPath : String := ""
  packagePath : String := ""
  irPackage : Option IRPackage := none
  entry : String
  unmountEntry : String := ""
  mountId : String := "vir-infoview-widget"
  autoReloadMs : Nat := 0
  setupHint : String := ""
  deriving Server.RpcEncodable

namespace ReactWidget

/-- Default repo-local WASM path used by the live examples. -/
def defaultWasmPath : String :=
  "web/public/vir-upstream.wasm"

/-- Default setup hint shown by the JavaScript shell when loading fails. -/
def defaultSetupHint : String :=
  "Run `npm run build:demo` to refresh the embedded infoview shell and web/public/vir-upstream.wasm. If this file was already open in VS Code, restart the Lean server or reopen the file."

end ReactWidget

/--
Narrow live React widget specification for the VIR infoview shell.

Users provide the real Lean-authored React component plus the exported entry
names that the generated `.irpkg` should keep. The helper supplies the standard
selector-owned React mount/unmount entries and widget props. Cursor movement
updates the `Surface` props and rerenders through React; the runtime service is
reloaded only when the widget IR package revision changes.
-/
structure ReactWidget where
  component : Lean.Vir.React.Component Surface
  mountName : String
  unmountName : String := ""
  mountId : String := "vir-infoview-widget"
  wasmPath : String := ReactWidget.defaultWasmPath
  autoReloadMs : Nat := 1000
  setupHint : String := ReactWidget.defaultSetupHint

namespace ReactWidget

/-- Standard mount entry for a live React infoview widget component. -/
def mount (widget : ReactWidget) (selector : String) (surface : Surface) :
    Lean.Vir.Browser.DomM Bool :=
  Lean.Vir.React.Root.renderComponentIntoSelector selector widget.component surface

/-- Standard unmount entry for a live React infoview widget component. -/
def unmount (_widget : ReactWidget) (selector : String) : Lean.Vir.Browser.DomM Bool :=
  Lean.Vir.React.Root.unmountSelector selector

/-- `.irpkg` roots for the standard live React widget entries. -/
def irPackage (widget : ReactWidget) : IRPackage :=
  let roots :=
    if widget.unmountName.isEmpty then
      #[widget.mountName]
    else
      #[widget.mountName, widget.unmountName]
  { roots }

/-- `show_panel_widgets` props for a repo-local live React widget. -/
def props (widget : ReactWidget) : WidgetProps where
  wasmPath := widget.wasmPath
  irPackage := some (irPackage widget)
  entry := widget.mountName
  unmountEntry := widget.unmountName
  mountId := widget.mountId
  autoReloadMs := widget.autoReloadMs
  setupHint := widget.setupHint

end ReactWidget

private def expandReactWidgetCommand
    (component : TSyntax `term)
    (mountId : TSyntax `str) : MacroM (TSyntax `command) := do
  let ns ← Macro.getCurrNamespace
  if ns.isAnonymous then
    Macro.throwError "`vir_proof_widget` must be used inside a namespace"
  let widgetSpecIdent := mkIdent `widgetSpec
  let mountIdent := mkIdent `mount
  let unmountIdent := mkIdent `unmount
  let irPackageIdent := mkIdent `irPackage
  let propsIdent := mkIdent `widgetProps
  let mountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `mount).toString)⟩
  let unmountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `unmount).toString)⟩
  `(
      def $widgetSpecIdent : Lean.Vir.Infoview.ReactWidget where
        component := $component
        mountName := $mountName
        unmountName := $unmountName
        mountId := $mountId

      def $mountIdent : String → Lean.Vir.Infoview.Surface → Lean.Vir.Browser.DomM Bool :=
        Lean.Vir.Infoview.ReactWidget.mount $widgetSpecIdent

      def $unmountIdent : String → Lean.Vir.Browser.DomM Bool :=
        Lean.Vir.Infoview.ReactWidget.unmount $widgetSpecIdent

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        Lean.Vir.Infoview.ReactWidget.irPackage $widgetSpecIdent

      def $propsIdent : Lean.Vir.Infoview.WidgetProps :=
        Lean.Vir.Infoview.ReactWidget.props $widgetSpecIdent
    )

/--
Declare the standard VIR proof-widget entry points for a React component.

The command must be used inside the widget namespace, after defining a
`Lean.Vir.React.Component Lean.Vir.Infoview.Surface`. It creates the usual
`widgetSpec`, `mount`, `unmount`, `irPackage`, and `widgetProps` declarations in
that namespace. Cursor movement is delivered as new `Surface` props to the same
React root; only IR package revision changes reload the VIR runtime service.
-/
macro "vir_proof_widget " component:term : command =>
  expandReactWidgetCommand component ⟨Syntax.mkStrLit "vir-infoview-widget"⟩

/--
Declare the standard VIR proof-widget entry points and set a mount-id prefix.
-/
macro "vir_proof_widget " component:term " with " "mountId" " := " mountId:str : command =>
  expandReactWidgetCommand component mountId

@[widget_module]
def widget : Widget.Module where
  javascript := include_str ".." / ".." / "web" / "src" / "generated" / "vir-infoview-widget.js"

end Lean.Vir.Infoview
