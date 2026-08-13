import Vir.Json

namespace Vir.Fixtures.JsonLanes

def ownedRoundTrip (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  Lean.Vir.Json.Handle.ofJson (← Lean.Vir.Json.Handle.toJson value)

def ownedWrap (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  Lean.Vir.Json.Handle.ofJson (.object #[
    ("before", .bool true),
    ("payload", ← Lean.Vir.Json.Handle.toJson value),
    ("after", .number (-0.0))
  ])

def ownedDuplicate : Lean.Vir.RuntimeM Lean.Vir.Json.Handle :=
  Lean.Vir.Json.Handle.ofJson (.object #[("same", .null), ("same", .bool true)])

def ownedIntegerKeys : Lean.Vir.RuntimeM Lean.Vir.Json.Handle :=
  Lean.Vir.Json.Handle.ofJson
    (.object #[("10", .string "ten"), ("2", .string "two"), ("alpha", .string "letter")])

private partial def materialize (value : Lean.Vir.Json.Handle) : Lean.Vir.RuntimeM Lean.Vir.Json := do
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
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  let result ← match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries =>
      match Lean.Vir.Json.objectFind? entries "wanted" with
      | some item => materialize item
      | none => pure .null
  | _ => pure .null
  Lean.Vir.Json.Handle.ofJson result

def borrowedPickWantedHandle (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries =>
      match Lean.Vir.Json.objectFind? entries "wanted" with
      | some item => pure item
      | none => Lean.Vir.Json.Handle.ofJson .null
  | _ => Lean.Vir.Json.Handle.ofJson .null

def borrowedToOwned (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  Lean.Vir.Json.Handle.ofJson (← Lean.Vir.Json.Handle.toJson value)

def borrowedDuplicateObject : Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  let first ← Lean.Vir.Json.Handle.ofJson .null
  let second ← Lean.Vir.Json.Handle.ofJson (.bool true)
  Lean.Vir.Json.Handle.object #[("same", first), ("same", second)]

def borrowedEmbedWanted (value : Lean.Vir.Json.Handle) :
    Lean.Vir.RuntimeM Lean.Vir.Json.Handle := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries =>
      match Lean.Vir.Json.objectFind? entries "wanted" with
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
