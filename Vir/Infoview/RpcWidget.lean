/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Widget
public meta import Vir.Infoview.Widget
public import Vir.React

public section

namespace Lean.Vir.Infoview

/--
Recursive JSON value used as the stable VIR object-ABI boundary for RPC-backed
widgets. The JavaScript shell maps an ordinary RPC JSON response to this shape;
Lean then decodes it to the component's actual props type.
-/
inductive RpcJson where
  | null
  | bool (value : Bool)
  | number (mantissa : Int) (exponent : Nat)
  | string (value : String)
  | array (items : List RpcJson)
  | object (entries : List (String × RpcJson))

namespace RpcJson

/-- Convert the VIR-friendly recursive representation to Lean's JSON tree. -/
partial def toJson : RpcJson → Lean.Json
  | .null => .null
  | .bool value => .bool value
  | .number mantissa exponent => .num { mantissa, exponent }
  | .string value => .str value
  | .array items => .arr (items.map toJson).toArray
  | .object entries => .mkObj (entries.map fun (key, value) => (key, toJson value))

/-- Decode a VIR-friendly JSON value as typed React props. -/
def decode [Lean.FromJson α] (value : RpcJson) : Except String α :=
  Lean.fromJson? value.toJson

end RpcJson

/--
Typed React widget specification backed by a cursor-position RPC.

The shell creates the component once per runtime service. Cursor movement calls
the named RPC and passes its result through `RpcJson`; the bridge decodes that
value before invoking the user's typed component.
-/
structure ReactRpcWidget (α : Type) where
  component : Lean.Vir.RuntimeM (Lean.Vir.Js (Lean.Vir.React.Component α))
  componentName : String
  mountName : String
  «mountId» : String := "vir-infoview-widget"
  wasmPath : String := ReactWidget.defaultWasmPath
  autoReloadMs : Nat := 1000
  setupHint : String := ReactWidget.defaultSetupHint

namespace ReactRpcWidget

/-- Build the JavaScript component that decodes RPC JSON into typed props. -/
def createComponent [Lean.FromJson α]
    (widget : ReactRpcWidget α) :
    Lean.Vir.RuntimeM (Lean.Vir.Js (Lean.Vir.React.Component RpcJson)) := do
  let component ← widget.component
  Lean.Vir.React.Component.ofLean fun input =>
    match (input.decode : Except String α) with
    | .ok props => Lean.Vir.React.Node.component component props
    | .error error => do
        let message ← Lean.Vir.React.Node.text s!"VIR widget input decode failed: {error}"
        Lean.Vir.React.Node.elementWith "pre" #[] #[message]

/-- Standard mount entry for a typed RPC widget in the current React root. -/
def mount
    (root : Lean.Vir.Js Lean.Vir.React.Root)
    (component : Lean.Vir.Js (Lean.Vir.React.Component RpcJson))
    (input : RpcJson) : Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.renderComponent root component input

/-- `.irpkg` roots for the typed RPC component factory and mount entries. -/
def irPackage (widget : ReactRpcWidget α) : IRPackage :=
  { roots := #[widget.componentName, widget.mountName] }

/-- `show_panel_widgets` props whose typed input is resolved at the cursor. -/
def rpcProps (widget : ReactRpcWidget α) (method : String) : WidgetProps where
  wasmPath := widget.wasmPath
  irPackage := irPackage widget
  componentEntry := widget.componentName
  entry := widget.mountName
  «mountId» := widget.mountId
  autoReloadMs := widget.autoReloadMs
  setupHint := widget.setupHint
  rpcMethod := method

end ReactRpcWidget

private meta def expandReactRpcWidgetCommand
    (component : TSyntax `term)
    (mountIdStx : TSyntax `str) : MacroM (TSyntax `command) := do
  let ns ← Macro.getCurrNamespace
  if ns.isAnonymous then
    Macro.throwError "`vir_rpc_widget` must be used inside a namespace"
  let widgetSpecIdent := mkIdent `widgetSpec
  let componentIdent := mkIdent `createComponent
  let mountIdent := mkIdent `mount
  let irPackageIdent := mkIdent `irPackage
  let componentName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `createComponent).toString)⟩
  let mountName : TSyntax `str := ⟨Syntax.mkStrLit ((ns ++ `mount).toString)⟩
  `(
      def $widgetSpecIdent := {
        component := $component
        componentName := $componentName
        mountName := $mountName
        «mountId» := $mountIdStx
      : Lean.Vir.Infoview.ReactRpcWidget _ }

      def $componentIdent :=
        Lean.Vir.Infoview.ReactRpcWidget.createComponent $widgetSpecIdent

      def $mountIdent :
          Lean.Vir.Js Lean.Vir.React.Root →
          Lean.Vir.Js (Lean.Vir.React.Component Lean.Vir.Infoview.RpcJson) →
          Lean.Vir.Infoview.RpcJson → Lean.Vir.Browser.DomM Unit :=
        Lean.Vir.Infoview.ReactRpcWidget.mount

      def $irPackageIdent : Lean.Vir.Infoview.IRPackage :=
        Lean.Vir.Infoview.ReactRpcWidget.irPackage $widgetSpecIdent
    )

/--
Declare the standard entry points for a typed React component whose props are
supplied by a cursor-position RPC.
-/
macro "vir_rpc_widget " component:term : command =>
  expandReactRpcWidgetCommand component ⟨Syntax.mkStrLit "vir-infoview-widget"⟩

/-- Declare a typed RPC VIR widget and set a mount-id prefix. -/
macro "vir_rpc_widget " component:term " with " "mountId" " := " mountIdValue:str : command =>
  expandReactRpcWidgetCommand component mountIdValue

end Lean.Vir.Infoview
