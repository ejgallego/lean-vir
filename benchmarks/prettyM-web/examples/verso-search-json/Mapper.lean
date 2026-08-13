import Vir.Json

namespace Vir.Benchmarks.VersoSearchJson

abbrev JSON := Lean.Vir.Json
abbrev Handle := Lean.Vir.Json.Handle

structure ExampleItem where
  context : Array String
  name : String
  address : String

private def objectGet? {α : Type u} (entries : Array (String × α)) (key : String) : Option α :=
  Lean.Vir.Json.objectFind? entries key

private def asObject? : JSON → Option (Array (String × JSON))
  | .object entries => some entries
  | _ => none

private def asArray? : JSON → Option (Array JSON)
  | .array items => some items
  | _ => none

private def asString? : JSON → Option String
  | .string value => some value
  | _ => none

private def stringArray? (value : JSON) : Option (Array String) := do
  let values ← asArray? value
  let mut out := #[]
  for value in values do
    out := out.push (← asString? value)
  return out

private def ownedItem? (target : JSON) : Option ExampleItem := do
  let target ← asObject? target
  let address ← objectGet? target "address" >>= asString?
  let id ← objectGet? target "id" >>= asString?
  let destination := s!"{address}#{id}"
  let data ← objectGet? target "data" >>= asObject?
  let item ← objectGet? data destination >>= asObject?
  let context ← objectGet? item "context" >>= stringArray?
  let name ← objectGet? item "display" >>= asString?
  return { context, name, address := destination }

private def addExample
    (groups : Array (String × Array ExampleItem)) (item : ExampleItem) :
    Array (String × Array ExampleItem) := Id.run do
  let mut groups := groups
  for index in [:groups.size] do
    if groups[index]!.1 == item.name then
      groups := groups.set! index (item.name, groups[index]!.2.push item)
      return groups
  return groups.push (item.name, #[item])

private def commonContextPrefix (items : Array ExampleItem) : Nat := Id.run do
  let some first := items[0]? | return 0
  let mut prefixLen := 0
  for index in [:first.context.size] do
    let part := first.context[index]!
    if items.all fun item => item.context[index]? == some part then
      prefixLen := prefixLen + 1
    else
      break
  return prefixLen

private def itemJson (item : ExampleItem) : JSON :=
  .object #[
    ("context", .array (item.context.map Lean.Vir.Json.string)),
    ("name", .string item.name),
    ("address", .string item.address)
  ]

private def mappedExamples (groups : Array (String × Array ExampleItem)) : JSON := Id.run do
  let mut out := #[]
  for (_, items) in groups do
    if items.isEmpty then continue
    let prefixLen := commonContextPrefix items
    let ref := Lean.Vir.Json.array (items.map itemJson)
    for item in items do
      let parts := (item.context.extract prefixLen).push item.name
      out := out.push <| Lean.Vir.Json.object #[
        ("searchKey", .string (String.intercalate " › " parts.toList)),
        ("address", .string item.address),
        ("domainId", .string "Verso.Genre.Manual.example"),
        ("ref", ref)
      ]
  return .array out

private def mapOwnedExamples (domainData : JSON) : JSON := Id.run do
  let some root := asObject? domainData | return .null
  let some contents := objectGet? root "contents" >>= asObject? | return .null
  let mut groups := #[]
  for (_, values) in contents do
    let some values := asArray? values | return .null
    for target in values do
      let some item := ownedItem? target | return .null
      groups := addExample groups item
  return mappedExamples groups

private def supportedDomain (domainId : String) : Bool :=
  domainId == "VersoHtml.module" ||
  domainId == "VersoHtml.constant" ||
  domainId == "Verso.Genre.Manual.doc.suggestion" ||
  domainId == "Verso.Genre.Manual.doc" ||
  domainId == "Verso.Genre.Manual.doc.option" ||
  domainId == "Verso.Genre.Manual.doc.tactic.conv" ||
  domainId == "Verso.Genre.Manual.doc.tech" ||
  domainId == "Verso.Genre.Manual.section" ||
  domainId == "Verso.Genre.Manual.example" ||
  domainId == "Verso.Genre.Manual.doc.tactic"

private def mapOwnedSimple (domainId : String) (domainData : JSON) : JSON := Id.run do
  let some root := asObject? domainData | return .null
  let some contents := objectGet? root "contents" >>= asObject? | return .null
  let mut output := #[]
  for (key, value) in contents do
    let some values := asArray? value | return .null
    let some first := values[0]? | return .null
    let some target := asObject? first | return .null
    let some address := objectGet? target "address" >>= asString? | return .null
    let some id := objectGet? target "id" >>= asString? | return .null
    let destination := s!"{address}#{id}"
    let data? := objectGet? target "data" >>= asObject?
    let mut searchKey := key
    let mut ref := value
    let mut priority? : Option JSON := none
    if domainId == "VersoHtml.constant" then
      let some data := data? | return .null
      let some name := objectGet? data "userName" >>= asString? | return .null
      searchKey := name
    else if domainId == "Verso.Genre.Manual.doc.suggestion" then
      let some data := data? | return .null
      let some term := objectGet? data "searchTerm" >>= asString? | return .null
      let some redirect := objectGet? data "suggestedRedirect" | return .null
      searchKey := term
      ref := redirect
    else if domainId == "Verso.Genre.Manual.doc.tech" then
      let some data := data? | return .null
      let some term := objectGet? data "term" >>= asString? | return .null
      searchKey := term
    else if domainId == "Verso.Genre.Manual.doc.tactic" ||
        domainId == "Verso.Genre.Manual.doc.tactic.conv" then
      let some data := data? | return .null
      let some name := objectGet? data "userName" >>= asString? | return .null
      searchKey := name
    else if domainId == "Verso.Genre.Manual.section" then
      let some data := data? | return .null
      let some title := objectGet? data "title" >>= asString? | return .null
      let some sectionNum := (match objectGet? data "sectionNum" with
        | some (.string value) => some value
        | some .null | none => some ""
        | _ => none) | return .null
      searchKey := s!"{sectionNum} {title}"
      let some priority := (match objectGet? data "searchPriority" with
        | some (.number value) => some (.number value)
        | some .null | none => some (.number 50.0)
        | _ => none) | return .null
      priority? := some priority
    let mut fields := #[
      ("searchKey", Lean.Vir.Json.string searchKey),
      ("address", Lean.Vir.Json.string destination),
      ("domainId", Lean.Vir.Json.string domainId),
      ("ref", ref)
    ]
    if let some priority := priority? then
      fields := fields.push ("priority", priority)
    output := output.push (.object fields)
  return .array output

private def mapOwnedValue (xref : JSON) : JSON := Id.run do
  let some domains := asObject? xref | return .null
  let mut output := #[]
  for (domainId, domainData) in domains do
    if !supportedDomain domainId then continue
    let mapped := if domainId == "Verso.Genre.Manual.example" then
      mapOwnedExamples domainData
    else
      mapOwnedSimple domainId domainData
    output := output.push (domainId, mapped)
  return .object output

def mapOwnedAll (xref : Handle) : Lean.Vir.RuntimeM Handle := do
  let owned ← Lean.Vir.Json.Handle.toJson xref
  Lean.Vir.Json.Handle.ofJson (mapOwnedValue owned)

private def borrowedObject? (value : Handle) : Lean.Vir.RuntimeM (Option (Array (String × Handle))) := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .object entries => pure (some entries)
  | _ => pure none

private def borrowedArray? (value : Handle) : Lean.Vir.RuntimeM (Option (Array Handle)) := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .array items => pure (some items)
  | _ => pure none

private def borrowedString? (value : Handle) : Lean.Vir.RuntimeM (Option String) := do
  match ← Lean.Vir.Json.Handle.inspect value with
  | .string value => pure (some value)
  | _ => pure none

private def borrowedStringField?
    (entries : Array (String × Handle)) (key : String) :
    Lean.Vir.RuntimeM (Option String) := do
  let some value := objectGet? entries key | return none
  borrowedString? value

private def borrowedObjectField?
    (entries : Array (String × Handle)) (key : String) :
    Lean.Vir.RuntimeM (Option (Array (String × Handle))) := do
  let some value := objectGet? entries key | return none
  borrowedObject? value

private def borrowedStringArray? (value : Handle) : Lean.Vir.RuntimeM (Option (Array String)) := do
  let some values ← borrowedArray? value | return none
  let mut out := #[]
  for value in values do
    let some value ← borrowedString? value | return none
    out := out.push value
  return some out

private def borrowedPriority?
    (data : Array (String × Handle)) : Lean.Vir.RuntimeM (Option Handle) := do
  match objectGet? data "searchPriority" with
  | none => some <$> Lean.Vir.Json.Handle.ofJson (.number 50.0)
  | some value =>
    match ← Lean.Vir.Json.Handle.inspect value with
    | Lean.Vir.Json.View.null => some <$> Lean.Vir.Json.Handle.ofJson (.number 50.0)
    | .number _ => pure (some value)
    | _ => pure none

private def borrowedItem? (target : Handle) : Lean.Vir.RuntimeM (Option ExampleItem) := do
  let some target ← borrowedObject? target | return none
  let some address ← borrowedStringField? target "address" | return none
  let some id ← borrowedStringField? target "id" | return none
  let destination := s!"{address}#{id}"
  let some data ← borrowedObjectField? target "data" | return none
  let some item ← borrowedObjectField? data destination | return none
  let some contextValue := objectGet? item "context" | return none
  let some context ← borrowedStringArray? contextValue | return none
  let some name ← borrowedStringField? item "display" | return none
  return some { context, name, address := destination }

private def stringHandle (value : String) : Lean.Vir.RuntimeM Handle :=
  Lean.Vir.Json.Handle.ofJson (.string value)

private def itemHandle (item : ExampleItem) : Lean.Vir.RuntimeM Handle := do
  let mut context := #[]
  for part in item.context do
    context := context.push (← stringHandle part)
  let contextHandle ← Lean.Vir.Json.Handle.array context
  let name ← stringHandle item.name
  let address ← stringHandle item.address
  Lean.Vir.Json.Handle.object #[
    ("context", contextHandle),
    ("name", name),
    ("address", address)
  ]

private def mapBorrowedExamples (domainData : Handle) : Lean.Vir.RuntimeM Handle := do
  let some domainData ← borrowedObject? domainData
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let some contentsValue := objectGet? domainData "contents"
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let some contents ← borrowedObject? contentsValue
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let mut groups := #[]
  for (_, values) in contents do
    let some values ← borrowedArray? values
      | return ← Lean.Vir.Json.Handle.ofJson .null
    for target in values do
      let some item ← borrowedItem? target
        | return ← Lean.Vir.Json.Handle.ofJson .null
      groups := addExample groups item
  let mut output := #[]
  for (_, items) in groups do
    if items.isEmpty then continue
    let prefixLen := commonContextPrefix items
    let mut itemHandles := #[]
    for item in items do
      itemHandles := itemHandles.push (← itemHandle item)
    let ref ← Lean.Vir.Json.Handle.array itemHandles
    for item in items do
      let parts := (item.context.extract prefixLen).push item.name
      let searchKey ← stringHandle (String.intercalate " › " parts.toList)
      let address ← stringHandle item.address
      let domainId ← stringHandle "Verso.Genre.Manual.example"
      output := output.push (← Lean.Vir.Json.Handle.object #[
        ("searchKey", searchKey),
        ("address", address),
        ("domainId", domainId),
        ("ref", ref)
      ])
  Lean.Vir.Json.Handle.array output

private def mapBorrowedSimple
    (domainId : String) (domainData : Handle) : Lean.Vir.RuntimeM Handle := do
  let some domainData ← borrowedObject? domainData
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let some contentsValue := objectGet? domainData "contents"
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let some contents ← borrowedObject? contentsValue
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let mut output := #[]
  for (key, value) in contents do
    let some values ← borrowedArray? value
      | return ← Lean.Vir.Json.Handle.ofJson .null
    let some target := values[0]?
      | return ← Lean.Vir.Json.Handle.ofJson .null
    let some target ← borrowedObject? target
      | return ← Lean.Vir.Json.Handle.ofJson .null
    let some address ← borrowedStringField? target "address"
      | return ← Lean.Vir.Json.Handle.ofJson .null
    let some id ← borrowedStringField? target "id"
      | return ← Lean.Vir.Json.Handle.ofJson .null
    let destination := s!"{address}#{id}"
    let mut searchKey := key
    let mut ref := value
    let mut priority? : Option Handle := none
    if domainId == "VersoHtml.constant" then
      let some data ← borrowedObjectField? target "data"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some name ← borrowedStringField? data "userName"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      searchKey := name
    else if domainId == "Verso.Genre.Manual.doc.suggestion" then
      let some data ← borrowedObjectField? target "data"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some term ← borrowedStringField? data "searchTerm"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some redirect := objectGet? data "suggestedRedirect"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      searchKey := term
      ref := redirect
    else if domainId == "Verso.Genre.Manual.doc.tech" then
      let some data ← borrowedObjectField? target "data"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some term ← borrowedStringField? data "term"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      searchKey := term
    else if domainId == "Verso.Genre.Manual.doc.tactic" ||
        domainId == "Verso.Genre.Manual.doc.tactic.conv" then
      let some data ← borrowedObjectField? target "data"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some name ← borrowedStringField? data "userName"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      searchKey := name
    else if domainId == "Verso.Genre.Manual.section" then
      let some data ← borrowedObjectField? target "data"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some title ← borrowedStringField? data "title"
        | return ← Lean.Vir.Json.Handle.ofJson .null
      let some sectionNum ← (match objectGet? data "sectionNum" with
        | none => pure (some "")
        | some value => do
          match ← Lean.Vir.Json.Handle.inspect value with
          | .null => pure (some "")
          | .string value => pure (some value)
          | _ => pure none)
        | return ← Lean.Vir.Json.Handle.ofJson .null
      searchKey := s!"{sectionNum} {title}"
      let some priority ← borrowedPriority? data
        | return ← Lean.Vir.Json.Handle.ofJson .null
      priority? := some priority
    let searchKeyHandle ← stringHandle searchKey
    let address ← stringHandle destination
    let domain ← stringHandle domainId
    let mut fields := #[
      ("searchKey", searchKeyHandle),
      ("address", address),
      ("domainId", domain),
      ("ref", ref)
    ]
    if let some priority := priority? then
      fields := fields.push ("priority", priority)
    output := output.push (← Lean.Vir.Json.Handle.object fields)
  Lean.Vir.Json.Handle.array output

def mapBorrowedAll (xref : Handle) : Lean.Vir.RuntimeM Handle := do
  let some domains ← borrowedObject? xref
    | return ← Lean.Vir.Json.Handle.ofJson .null
  let mut output := #[]
  for (domainId, domainData) in domains do
    if !supportedDomain domainId then continue
    let mapped ← if domainId == "Verso.Genre.Manual.example" then
      mapBorrowedExamples domainData
    else
      mapBorrowedSimple domainId domainData
    output := output.push (domainId, mapped)
  Lean.Vir.Json.Handle.object output

end Vir.Benchmarks.VersoSearchJson
