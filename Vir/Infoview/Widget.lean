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

namespace WidgetProps

/-- Default repo-local WASM path used by the live examples. -/
def defaultWasmPath : String :=
  "web/public/vir-upstream.wasm"

/-- Default setup hint shown by the JavaScript shell when loading fails. -/
def defaultSetupHint : String :=
  "Run `npm run build:demo` to refresh the embedded infoview shell and web/public/vir-upstream.wasm. If this file was already open in VS Code, restart the Lean server or reopen the file."

end WidgetProps

private meta def expandReactWidgetCommand
    (component : TSyntax `term) : MacroM (TSyntax `command) := do
  let ns ← Macro.getCurrNamespace
  if ns.isAnonymous then
    Macro.throwError "`vir_proof_widget` must be used inside a namespace"
  let componentIdent := mkIdent `createComponent
  let irPackageIdent := mkIdent `irPackage
  let propsIdent := mkIdent `widgetProps
  let componentName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `createComponent).toString)⟩
  `(
      def $componentIdent : Lean.Vir.RuntimeM
          (Lean.Vir.React.FunctionComponent Lean.Vir.Infoview.PanelWidgetProps) :=
        $component

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        { roots := #[$componentName] }

      def $propsIdent : Lean.Vir.Infoview.WidgetProps where
        wasmPath := Lean.Vir.Infoview.WidgetProps.defaultWasmPath
        irPackage := $irPackageIdent
        componentEntry := $componentName
        autoReloadMs := 1000
        setupHint := Lean.Vir.Infoview.WidgetProps.defaultSetupHint
    )

/--
Declare a panel widget from a `RuntimeM (React.FunctionComponent PanelWidgetProps)`
factory. Creates `createComponent`, `irPackage`, and `widgetProps`
in the current namespace. The package exports only the factory.
-/
macro "vir_proof_widget " component:term : command =>
  expandReactWidgetCommand component

@[widget_module]
def widget : Widget.Module where
  javascript := include_str ".." / ".." / "build" / "generated" / "infoview" / "vir-infoview-widget.js"

end Lean.Vir.Infoview
