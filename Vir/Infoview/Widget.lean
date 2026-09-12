/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Widget
public meta import Lean.Widget
public import Vir.Infoview.Package
public meta import Vir.Infoview.Package
public import Vir.Infoview.Panel
public import Vir.React

public section

namespace Lean.Vir.Infoview

/--
Props for the minimal VIR infoview shell.

The component entry returns a native function component. React passes its native
panel props directly and supplies the surrounding infoview contexts. Removing UI
does not dispose the VIR runtime; surviving callbacks and JSL retain their
original generation.
-/
structure WidgetProps where
  wasmPath : String := ""
  irPackage : IRPackage
  componentEntry : String
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

The factory creates a native function component once per runtime generation.
React supplies updated panel props without recreating the component. Widget
configuration or package revision changes create a new generation.
-/
structure ReactWidget where
  component : Lean.Vir.RuntimeM (Lean.Vir.React.FunctionComponent PanelWidgetProps)
  componentName : String
  wasmPath : String := ReactWidget.defaultWasmPath
  autoReloadMs : Nat := 1000
  setupHint : String := ReactWidget.defaultSetupHint

namespace ReactWidget

/-- `.irpkg` roots for the standard live React widget entries. -/
def irPackage (widget : ReactWidget) : IRPackage :=
  { roots := #[widget.componentName] }

/-- `show_panel_widgets` props for a repo-local live React widget. -/
def props (widget : ReactWidget) : WidgetProps where
  wasmPath := widget.wasmPath
  irPackage := irPackage widget
  componentEntry := widget.componentName
  autoReloadMs := widget.autoReloadMs
  setupHint := widget.setupHint

end ReactWidget

private meta def expandReactWidgetCommand
    (component : TSyntax `term) : MacroM (TSyntax `command) := do
  let ns ← Macro.getCurrNamespace
  if ns.isAnonymous then
    Macro.throwError "`vir_proof_widget` must be used inside a namespace"
  let widgetSpecIdent := mkIdent `widgetSpec
  let componentIdent := mkIdent `createComponent
  let irPackageIdent := mkIdent `irPackage
  let propsIdent := mkIdent `widgetProps
  let componentName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `createComponent).toString)⟩
  `(
      def $widgetSpecIdent : Lean.Vir.Infoview.ReactWidget where
        component := $component
        componentName := $componentName

      def $componentIdent : Lean.Vir.RuntimeM
          (Lean.Vir.React.FunctionComponent Lean.Vir.Infoview.PanelWidgetProps) :=
        ($widgetSpecIdent).component

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        Lean.Vir.Infoview.ReactWidget.irPackage $widgetSpecIdent

      def $propsIdent : Lean.Vir.Infoview.WidgetProps :=
        Lean.Vir.Infoview.ReactWidget.props $widgetSpecIdent
    )

/--
Declare a panel widget from a `RuntimeM (React.FunctionComponent PanelWidgetProps)`
factory. Creates `widgetSpec`, `createComponent`, `irPackage`, and `widgetProps`
in the current namespace. The package exports only the factory.
-/
macro "vir_proof_widget " component:term : command =>
  expandReactWidgetCommand component

@[widget_module]
def widget : Widget.Module where
  javascript := include_str ".." / ".." / "build" / "generated" / "infoview" / "vir-infoview-widget.js"

end Lean.Vir.Infoview
