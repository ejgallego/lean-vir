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
public import Vir.Infoview.Surface
public import Vir.React

public section

namespace Lean.Vir.Infoview

/--
Props for the minimal VIR infoview shell.

The component entry must return the exact JavaScript component function. The
mount entry receives the shell's exact React root, that function, and a
JavaScript-built surface structure from the real infoview panel props. The
shell owns and unmounts the root before disposing the VIR runtime.
-/
structure WidgetProps where
  wasmPath : String := ""
  irPackage : IRPackage
  componentEntry : String
  entry : String
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
React mount entry and widget props. Cursor movement
updates the `Surface` props and rerenders through React; the runtime service is
kept stable across cursor updates and replaced when widget configuration or the
IR package revision changes.
-/
structure ReactWidget where
  component : Lean.Vir.RuntimeM (Lean.Vir.Js (Lean.Vir.React.Component Surface))
  componentName : String
  mountName : String
  mountId : String := "vir-infoview-widget"
  wasmPath : String := ReactWidget.defaultWasmPath
  autoReloadMs : Nat := 1000
  setupHint : String := ReactWidget.defaultSetupHint

namespace ReactWidget

/-- `.irpkg` roots for the standard live React widget entries. -/
def irPackage (widget : ReactWidget) : IRPackage :=
  { roots := #[widget.componentName, widget.mountName] }

/-- `show_panel_widgets` props for a repo-local live React widget. -/
def props (widget : ReactWidget) : WidgetProps where
  wasmPath := widget.wasmPath
  irPackage := irPackage widget
  componentEntry := widget.componentName
  entry := widget.mountName
  mountId := widget.mountId
  autoReloadMs := widget.autoReloadMs
  setupHint := widget.setupHint

end ReactWidget

private meta def expandReactWidgetCommand
    (component : TSyntax `term)
    (mountId : TSyntax `str) : MacroM (TSyntax `command) := do
  let ns ← Macro.getCurrNamespace
  if ns.isAnonymous then
    Macro.throwError "`vir_proof_widget` must be used inside a namespace"
  let widgetSpecIdent := mkIdent `widgetSpec
  let componentIdent := mkIdent `createComponent
  let mountIdent := mkIdent `mount
  let irPackageIdent := mkIdent `irPackage
  let propsIdent := mkIdent `widgetProps
  let componentName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `createComponent).toString)⟩
  let mountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `mount).toString)⟩
  `(
      def $widgetSpecIdent : Lean.Vir.Infoview.ReactWidget where
        component := $component
        componentName := $componentName
        mountName := $mountName
        mountId := $mountId

      def $componentIdent : Lean.Vir.RuntimeM
          (Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface)) :=
        ($widgetSpecIdent).component

      def $mountIdent : Lean.Vir.Js Lean.Vir.React.Root →
          Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface) →
          Lean.Vir.Infoview.Surface → Lean.Vir.Browser.DomM Unit :=
        Lean.Vir.React.Root.renderComponent

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        Lean.Vir.Infoview.ReactWidget.irPackage $widgetSpecIdent

      def $propsIdent : Lean.Vir.Infoview.WidgetProps :=
        Lean.Vir.Infoview.ReactWidget.props $widgetSpecIdent
    )

/--
Declare the standard VIR proof-widget entry points for a React component.

The command must be used inside the widget namespace, after defining a
`RuntimeM (Js (Lean.Vir.React.Component Lean.Vir.Infoview.Surface))`. It creates
the usual `widgetSpec`, `createComponent`, `mount`, `irPackage`, and
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
