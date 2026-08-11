import Vir.Json

namespace Vir.Fixtures.JsonLanes

def ownedRoundTrip (value : Lean.Vir.Json) : Lean.Vir.Json :=
  value

def ownedWrap (value : Lean.Vir.Json) : Lean.Vir.Json :=
  .object #[
    ("before", .bool true),
    ("payload", value),
    ("after", .number (-0.0))
  ]

def ownedDuplicate : Lean.Vir.Json :=
  .object #[("same", .null), ("same", .bool true)]

partial def materialize (value : Lean.Vir.Json.Handle) : Lean.Vir.RuntimeM Lean.Vir.Json := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .null => pure .null
  | .bool value => pure (.bool value)
  | .number value => pure (.number value)
  | .string value => pure (.string value)
  | .array items =>
      let mut values := #[]
      for item in items do
        values := values.push (← materialize item)
      pure (.array values)
  | .object entries =>
      let mut values := #[]
      for (key, item) in entries do
        values := values.push (key, ← materialize item)
      pure (.object values)

def borrowedRoundTrip (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  Lean.Vir.Json.Handle.ofJson (← materialize value)

def borrowedPickWanted (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries =>
      match entries.findSome? fun (key, item) => if key == "wanted" then some item else none with
      | some item => materialize item
      | none => pure .null
  | _ => pure .null

def borrowedToOwned (value : Lean.Vir.Json.Handle) : Lean.Vir.RuntimeM Lean.Vir.Json :=
  Lean.Vir.Json.Handle.toJson value

def borrowedEmbedWanted (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries =>
      match entries.findSome? fun (key, item) => if key == "wanted" then some item else none with
      | some wanted =>
          let kind ← Lean.Vir.Json.Handle.ofJson (.string "passthrough")
          let values ← Lean.Vir.Json.Handle.array #[wanted, kind]
          Lean.Vir.Json.Handle.object #[
            ("ref", wanted),
            ("values", values)
          ]
      | none => Lean.Vir.Json.Handle.ofJson .null
  | _ => Lean.Vir.Json.Handle.ofJson .null

end Vir.Fixtures.JsonLanes
