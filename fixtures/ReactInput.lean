/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace ReactInput

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

/-- Uses native IDs without converting them to Lean strings or constructing IDs locally. -/
def useIdField (caption : String) : ReactM (Js Node) := do
  let inputId ← Hooks.useId
  let hintId ← Hooks.useId
  let labelProps ← Props.empty
  Js.Object.set labelProps (← JsValue.ofString "htmlFor") inputId
  let label ← Node.createElement (← ElementType.tag (← JsValue.ofString "label")) labelProps
    (← Js.Array.ofArray #[← Node.text (← Lean.Vir.JsValue.ofString caption)])
  let inputProps ← Props.empty
  Js.Object.set inputProps (← JsValue.ofString "id") inputId
  Js.Object.set inputProps (← JsValue.ofString "aria-describedby") hintId
  let input ← Node.createElement (← ElementType.tag (← JsValue.ofString "input"))
    inputProps (← Js.Array.empty)
  let hintProps ← Props.empty
  Js.Object.set hintProps (← JsValue.ofString "id") hintId
  let hint ← Node.createElement (← ElementType.tag (← JsValue.ofString "p")) hintProps
    (← Js.Array.ofArray #[← Node.text (← Lean.Vir.JsValue.ofString "Enter a value")])
  Node.div #[label, input, hint]

def checkedLabel (checked : Bool) : String :=
  "checked:" ++ toString checked

def selectTextareaLabel (note flavor : String) : String :=
  "note:" ++ note ++ "; flavor:" ++ flavor

def inputComponent : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofString ""
    let name ← StateTuple.toState (← Hooks.useState initial)
    let nameValue ← JsValue.toString name.value
    let labelText ← Node.text (← Lean.Vir.JsValue.ofString "name:")
    let label ← Node.labelWith #[Props.htmlFor "react-name-input"] #[labelText]
    let input ←
      Node.input
        #[
          Props.id "react-name-input",
          Props.type "text",
          Props.inputValue nameValue,
          Props.placeholder "name",
          Props.onInput fun event => do
            match ← Lean.Vir.Browser.Event.inputElement? event with
            | none => pure ()
            | some input => do
                State.set name (← Lean.Vir.Browser.HTMLInputElement.getValue input)
        ]
    let outputText ← Node.text (← Lean.Vir.JsValue.ofString nameValue)
    let output ← Node.spanWith #[Props.id "react-name-output"] #[outputText]
    Node.divWith #[Props.id "react-input-widget"] #[label, input, output]

def changeInputComponent : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofString ""
    let value ← StateTuple.toState (← Hooks.useState initial)
    let currentValue ← JsValue.toString value.value
    let labelText ← Node.text (← Lean.Vir.JsValue.ofString "change:")
    let label ← Node.labelWith #[Props.htmlFor "react-change-input"] #[labelText]
    let input ←
      Node.input
        #[
          Props.id "react-change-input",
          Props.inputName "change",
          Props.type "text",
          Props.inputValue currentValue,
          Props.placeholder "change",
          Props.onChange fun event => do
            Lean.Vir.Browser.Event.preventDefault event
            Lean.Vir.Browser.Event.stopPropagation event
            match ← Lean.Vir.Browser.Event.inputElement? event with
            | none => pure ()
            | some input => do
                State.set value (← Lean.Vir.Browser.HTMLInputElement.getValue input)
        ]
    let outputText ← Node.text (← Lean.Vir.JsValue.ofString currentValue)
    let output ← Node.spanWith #[Props.id "react-change-output"] #[outputText]
    Node.formWith
      #[
        Props.id "react-change-widget",
        Props.onSubmitWith fun event => do
          Lean.Vir.Browser.Event.preventDefault event
          Lean.Vir.Browser.Event.stopPropagation event
      ]
      #[label, input, output]

def checkboxComponent : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofBool false
    let checked ← StateTuple.toState (← Hooks.useState initial)
    let checkedValue ← JsValue.toBool checked.value
    let input ←
      Node.input
        #[
          Props.id "react-checkbox-input",
          Props.type "checkbox",
          Props.checked checkedValue,
          Props.onChange fun event => do
            match ← Lean.Vir.Browser.Event.inputElement? event with
            | none => pure ()
            | some input => do
                State.set checked (← Lean.Vir.Browser.HTMLInputElement.getChecked input)
        ]
    let outputText ← Node.text (← Lean.Vir.JsValue.ofString (checkedLabel checkedValue))
    let output ←
      Node.labelWith
        #[Props.id "react-checkbox-output", Props.htmlFor "react-checkbox-input"]
        #[outputText]
    Node.divWith #[Props.id "react-checkbox-widget"] #[input, output]

def selectTextareaComponent : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initialNote ← JsValue.ofString "draft"
    let note ← StateTuple.toState (← Hooks.useState initialNote)
    let noteValue ← JsValue.toString note.value
    let initialFlavor ← JsValue.ofString "vanilla"
    let flavor ← StateTuple.toState (← Hooks.useState initialFlavor)
    let flavorValue ← JsValue.toString flavor.value
    let sectionText ← Node.text (← Lean.Vir.JsValue.ofString "fields")
    let sectionNode ← Node.spanWith #[Props.classList #["react-select-textarea-section"]] #[sectionText]
    let choiceText ← Node.text (← Lean.Vir.JsValue.ofString flavorValue)
    let choice ← Node.spanWith #[Props.classList #["react-select-textarea-choice"]] #[choiceText]
    let nav ← Node.navWith
      #[Props.id "react-select-textarea-nav", Props.ariaLabel "React textarea fixture"]
      #[sectionNode, choice]
    let noteLabelText ← Node.text (← Lean.Vir.JsValue.ofString "note:")
    let noteLabel ← Node.labelWith #[Props.htmlFor "react-note-input"] #[noteLabelText]
    let noteInput ←
      Node.textarea
        #[
          Props.id "react-note-input",
          Props.inputName "note",
          Props.inputValue noteValue,
          Props.rows 3,
          Props.cols 24,
          Props.placeholder "note",
          Props.onChange fun event => do
            match ← Js.Nullable.toOption (← Lean.Vir.Browser.Event.formValueNullable event) with
            | none => pure ()
            | some next => State.set note next
        ]
    let flavorLabelText ← Node.text (← Lean.Vir.JsValue.ofString "flavor:")
    let flavorLabel ← Node.labelWith #[Props.htmlFor "react-flavor-select"] #[flavorLabelText]
    let vanillaText ← Node.text (← Lean.Vir.JsValue.ofString "vanilla")
    let vanilla ← Node.keyedOptionWith "vanilla" #[Props.inputValue "vanilla"] #[vanillaText]
    let chocolateText ← Node.text (← Lean.Vir.JsValue.ofString "chocolate")
    let chocolate ← Node.keyedOptionWith "chocolate" #[Props.inputValue "chocolate"] #[chocolateText]
    let strawberryText ← Node.text (← Lean.Vir.JsValue.ofString "strawberry")
    let strawberry ← Node.keyedOptionWith "strawberry" #[Props.inputValue "strawberry"] #[strawberryText]
    let select ←
      Node.selectWith
        #[
          Props.id "react-flavor-select",
          Props.inputName "flavor",
          Props.inputValue flavorValue,
          Props.onChange fun event => do
            match ← Js.Nullable.toOption (← Lean.Vir.Browser.Event.formValueNullable event) with
            | none => pure ()
            | some next => State.set flavor next
        ]
        #[vanilla, chocolate, strawberry]
    let outputText ← Node.text (← Lean.Vir.JsValue.ofString (selectTextareaLabel noteValue flavorValue))
    let output ← Node.spanWith
      #[Props.id "react-select-textarea-output"]
      #[outputText]
    Node.mainWith #[Props.id "react-select-textarea-widget"] #[
      nav,
      noteLabel,
      noteInput,
      flavorLabel,
      select,
      output
    ]

def renderAttributesInto (root : Lean.Vir.Js Root) : DomM Unit := do
  let node ← ReactM.run do
    let labelText ← Node.text (← Lean.Vir.JsValue.ofString "attrs:")
    let label ←
      Node.keyedLabelWith
        "attributes-label"
        #[
          Props.id "react-attributes-label",
          Props.htmlFor "react-attributes-input"
        ]
        #[labelText]
    let input ←
      Node.keyedInput
        "attributes-input"
        #[
          Props.id "react-attributes-input",
          Props.inputName "attributes",
          Props.type "checkbox",
          Props.checked true,
          Props.disabled true
        ]
    let outputText ← Node.text (← Lean.Vir.JsValue.ofString "attrs")
    let output ←
      Node.keyedSpanWith
        "attributes-output"
        #[
          Props.id "react-attributes-output",
          Props.title "attribute output"
        ]
        #[outputText]
    Node.divWith
      #[
        Props.id "react-attributes-widget",
        Props.role "group",
        Props.ariaLabel "React attribute fixture",
        Props.data "case" "attributes",
        Props.dataTestId "react-attributes",
        Props.tabIndex 3,
        Props.classList #["react-attributes", "is-mounted"],
        Props.style #[
          StyleProperty.mk "color" "rgb(1, 2, 3)",
          StyleProperty.mk "marginTop" "4px"
        ]
      ]
      #[label, input, output]
  Root.render root node

def mountInput (selector : String) : DomM Bool := do
  let component ← inputComponent
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
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
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
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
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
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
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
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
