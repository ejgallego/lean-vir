/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets.Jsx

public section

namespace ReactInput

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

/-- Uses native IDs without converting them to Lean strings or constructing IDs locally. -/
def useIdField (caption : String) : ReactM (Js Node) := do
  let inputId ← Hooks.useId
  let hintId ← Hooks.useId
  return ← <div>
    <label htmlFor={inputId}>{Node.text (← JsValue.ofString caption)}</label>
    <input id={inputId} aria-describedby={hintId} />
    <p id={hintId}>Enter a value</p>
  </div>

def checkedLabel (checked : Bool) : String :=
  "checked:" ++ toString checked

def selectTextareaLabel (note flavor : String) : String :=
  "note:" ++ note ++ "; flavor:" ++ flavor

def inputComponent : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let name ← Hooks.useState (Initial.ofValue (← js#""))
    let nameValue ← Js.Tuple2.first name
    let nameSetter ← Js.Tuple2.second name
    let change ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      match ← Browser.Event.inputElement? event with
      | none => pure ()
      | some input => do
        Js.Function.callVoid nameSetter
          (React.SetStateAction.ofValue (← Browser.HTMLInputElement.getValue input))
    return ← <div id="react-input-widget">
      <label htmlFor="react-name-input">name:</label>
      <input id="react-name-input" type="text" value={nameValue} placeholder="name" onInput={change} />
      <span id="react-name-output">{Node.text nameValue}</span>
    </div>

def changeInputComponent : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let value ← Hooks.useState (Initial.ofValue (← js#""))
    let valueValue ← Js.Tuple2.first value
    let valueSetter ← Js.Tuple2.second value
    let change ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      Browser.Event.preventDefault event
      Browser.Event.stopPropagation event
      match ← Browser.Event.inputElement? event with
      | none => pure ()
      | some input => do
        Js.Function.callVoid valueSetter
          (React.SetStateAction.ofValue (← Browser.HTMLInputElement.getValue input))
    let submit ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      Browser.Event.preventDefault event
      Browser.Event.stopPropagation event
    return ← <form id="react-change-widget" onSubmit={submit}>
      <label htmlFor="react-change-input">change:</label>
      <input id="react-change-input" name="change" type="text" value={valueValue}
        placeholder="change" onChange={change} />
      <span id="react-change-output">{Node.text valueValue}</span>
    </form>

def checkboxComponent : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let checked ← Hooks.useState (Initial.ofValue (← JsValue.ofBool false))
    let checkedValue ← Js.Tuple2.first checked
    let checkedSetter ← Js.Tuple2.second checked
    let checkedLabelValue ← JsValue.toBool checkedValue
    let change ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      match ← Browser.Event.inputElement? event with
      | none => pure ()
      | some input => do
        Js.Function.callVoid checkedSetter
          (React.SetStateAction.ofValue (← Browser.HTMLInputElement.getChecked input))
    return ← <div id="react-checkbox-widget">
      <input id="react-checkbox-input" type="checkbox" checked={checkedValue} onChange={change} />
      <label id="react-checkbox-output" htmlFor="react-checkbox-input">
        {Node.text (← JsValue.ofString (checkedLabel checkedLabelValue))}
      </label>
    </div>

def selectTextareaComponent : RuntimeM (FunctionComponent Props) :=
  FunctionComponent.ofLean fun _ => do
    let note ← Hooks.useState (Initial.ofValue (← js#"draft"))
    let noteValue ← Js.Tuple2.first note
    let noteSetter ← Js.Tuple2.second note
    let flavor ← Hooks.useState (Initial.ofValue (← js#"vanilla"))
    let flavorValue ← Js.Tuple2.first flavor
    let flavorSetter ← Js.Tuple2.second flavor
    let noteChange ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      match ← Js.Nullable.toOption (← Browser.Event.formValueNullable event) with
      | none => pure ()
      | some next => Js.Function.callVoid noteSetter (React.SetStateAction.ofValue next)
    let flavorChange ← Js.Function.ofLeanVoid fun event => Browser.DomM.toRuntime do
      match ← Js.Nullable.toOption (← Browser.Event.formValueNullable event) with
      | none => pure ()
      | some next => Js.Function.callVoid flavorSetter (React.SetStateAction.ofValue next)
    let label := selectTextareaLabel (← JsValue.toString noteValue) (← JsValue.toString flavorValue)
    return ← <main id="react-select-textarea-widget">
      <nav id="react-select-textarea-nav" aria-label="React textarea fixture">
        <span className="react-select-textarea-section">fields</span>
        <span className="react-select-textarea-choice">{Node.text flavorValue}</span>
      </nav>
      <label htmlFor="react-note-input">note:</label>
      <textarea id="react-note-input" name="note" value={noteValue}
        rows={← JsValue.ofFloat 3} cols={← JsValue.ofFloat 24}
        placeholder="note" onChange={noteChange} />
      <label htmlFor="react-flavor-select">flavor:</label>
      <select id="react-flavor-select" name="flavor" value={flavorValue} onChange={flavorChange}>
        <option key="vanilla" value="vanilla">vanilla</option>
        <option key="chocolate" value="chocolate">chocolate</option>
        <option key="strawberry" value="strawberry">strawberry</option>
      </select>
      <span id="react-select-textarea-output">{Node.text (← JsValue.ofString label)}</span>
    </main>

def renderAttributesInto (root : Js Root) : DomM Unit := do
  let node ← ReactM.run do
    let style ← js%{ "color" := (← js#"rgb(1, 2, 3)"), "marginTop" := (← js#"4px") }
    return ← <div id="react-attributes-widget" role="group" aria-label="React attribute fixture"
      data-case="attributes" data-testid="react-attributes" tabIndex={← JsValue.ofFloat 3}
      className="react-attributes is-mounted" style={style}>
      <label key="attributes-label" id="react-attributes-label" htmlFor="react-attributes-input">attrs:</label>
      <input key="attributes-input" id="react-attributes-input" name="attributes"
        type="checkbox" checked={← JsValue.ofBool true} disabled={← JsValue.ofBool true} />
      <span key="attributes-output" id="react-attributes-output" title="attribute output">attrs</span>
    </div>
  Root.render root node

def mountInput (selector : String) : DomM Bool := do
  let component ← inputComponent
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountChangeInput (selector : String) : DomM Bool := do
  let component ← changeInputComponent
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountSelectTextarea (selector : String) : DomM Bool := do
  let component ← selectTextareaComponent
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountCheckbox (selector : String) : DomM Bool := do
  let component ← checkboxComponent
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

def mountAttributes (selector : String) : DomM Bool := do
  let container ← Browser.Document.querySelector
    (← Browser.Document.current) (← JsValue.ofString selector)
  match ← Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Root.create container
      renderAttributesInto root
      pure true

end ReactInput
