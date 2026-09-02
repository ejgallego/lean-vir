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

The component entry must return the exact JavaScript component function. The
mount entry receives that function, a fresh DOM selector for the nested mount
element, and a JavaScript-built surface structure from the real infoview panel
props.
If `unmountEntry` is set, it must have signature `String -> DomM Bool` and is
called before the shell disposes its nested React root and VIR runtime.
-/
structure WidgetProps where
  wasmPath : String := ""
  irPackage : IRPackage
  componentEntry : String
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
kept stable across cursor updates and replaced when widget configuration or the
IR package revision changes.
-/
structure ReactWidget where
  component : Lean.Vir.RuntimeM (Lean.Vir.Js (Lean.Vir.React.Component Surface))
  componentName : String
  mountName : String
  unmountName : String := ""
  mountId : String := "vir-infoview-widget"
  wasmPath : String := ReactWidget.defaultWasmPath
  autoReloadMs : Nat := 1000
  setupHint : String := ReactWidget.defaultSetupHint

namespace ReactWidget

/-- `.irpkg` roots for the standard live React widget entries. -/
def irPackage (widget : ReactWidget) : IRPackage :=
  let roots :=
    if widget.unmountName.isEmpty then
      #[widget.componentName, widget.mountName]
    else
      #[widget.componentName, widget.mountName, widget.unmountName]
  { roots }

/-- `show_panel_widgets` props for a repo-local live React widget. -/
def props (widget : ReactWidget) : WidgetProps where
  wasmPath := widget.wasmPath
  irPackage := irPackage widget
  componentEntry := widget.componentName
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
  let componentIdent := mkIdent `createComponent
  let mountIdent := mkIdent `mount
  let unmountIdent := mkIdent `unmount
  let irPackageIdent := mkIdent `irPackage
  let propsIdent := mkIdent `widgetProps
  let componentName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `createComponent).toString)⟩
  let mountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `mount).toString)⟩
  let unmountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `unmount).toString)⟩
  `(
      def $widgetSpecIdent : Lean.Vir.Infoview.ReactWidget where
        component := $component
        componentName := $componentName
        mountName := $mountName
        unmountName := $unmountName
        mountId := $mountId

      def $componentIdent : Lean.Vir.RuntimeM
          (Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface)) :=
        ($widgetSpecIdent).component

      def $mountIdent : String →
          Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface) →
          Lean.Vir.Infoview.Surface → Lean.Vir.Browser.DomM Bool :=
        Lean.Vir.React.Root.renderComponentIntoSelector

      def $unmountIdent : String → Lean.Vir.Browser.DomM Bool :=
        Lean.Vir.React.Root.unmountSelector

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        Lean.Vir.Infoview.ReactWidget.irPackage $widgetSpecIdent

      def $propsIdent : Lean.Vir.Infoview.WidgetProps :=
        Lean.Vir.Infoview.ReactWidget.props $widgetSpecIdent
    )

/--
Declare the standard VIR proof-widget entry points for a React component.

The command must be used inside the widget namespace, after defining a
`RuntimeM (Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface))`. It creates
the usual `widgetSpec`, `createComponent`, `mount`, `unmount`, `irPackage`, and
`widgetProps` declarations in that namespace. The shell creates the JavaScript
component function once per runtime service and reuses its exact identity while
cursor movement supplies new `Surface` props.
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
  javascript := include_str ".." / ".." / "build" / "generated" / "infoview" / "vir-infoview-widget.js"

end Lean.Vir.Infoview
