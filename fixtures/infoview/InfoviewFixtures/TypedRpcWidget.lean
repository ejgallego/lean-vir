/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.RpcWidget
public meta import Vir.Infoview.RpcWidget

public section

namespace InfoviewFixtures.TypedRpcWidget

open Lean.Vir
open Lean.Vir.React

/-- Small typed payload for the standalone RPC widget contract. -/
structure Payload where
  title : String
  count : Nat
  enabled : Bool
  tags : Array String
  deriving BEq, Lean.FromJson

def samplePayload : Payload := {
  title := "typed RPC"
  count := 42
  enabled := true
  tags := #["bridge", "fixture"]
}

def sampleInput : Lean.Vir.Infoview.RpcJson :=
  .object [
    ("title", .string "typed RPC"),
    ("count", .number 42 0),
    ("enabled", .bool true),
    ("tags", .array [.string "bridge", .string "fixture"])
  ]

def invalidInput : Lean.Vir.Infoview.RpcJson :=
  .object [("title", .string "missing required fields")]

def Component : RuntimeM (Js (Component Payload)) :=
  Component.ofLean fun payload =>
    Node.pTextWith #[Props.id "typed-rpc-widget-fixture"]
      s!"{payload.title}: {payload.count} ({payload.tags.size} tags)"

vir_rpc_widget Component with mountId := "typed-rpc-widget-fixture"

def dynamicProps : Lean.Vir.Infoview.WidgetProps :=
  Lean.Vir.Infoview.ReactRpcWidget.rpcProps widgetSpec
    "InfoviewFixtures.TypedRpcWidget.payload"

#guard match (sampleInput.decode : Except String Payload) with
  | .ok payload => payload == samplePayload
  | .error _ => false
#guard match (invalidInput.decode : Except String Payload) with
  | .error _ => true
  | .ok _ => false
#guard dynamicProps.componentEntry ==
  "InfoviewFixtures.TypedRpcWidget.createComponent"
#guard dynamicProps.rpcMethod == "InfoviewFixtures.TypedRpcWidget.payload"
#guard dynamicProps.mountId == "typed-rpc-widget-fixture"
#guard irPackage.roots == #[
  "InfoviewFixtures.TypedRpcWidget.createComponent",
  "InfoviewFixtures.TypedRpcWidget.mount"
]

end InfoviewFixtures.TypedRpcWidget
