/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactInput

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

def checkedLabel (checked : Bool) : String :=
  "checked:" ++ toString checked

def selectTextareaLabel (note flavor : String) : String :=
  "note:" ++ note ++ "; flavor:" ++ flavor

def inputComponent : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofString ""
    let name ← Hooks.useState initial
    let nameValue ← JsValue.toString name.value
    let labelText ← Node.text "name:"
    let label ← Node.labelWith #[Props.htmlFor "react-name-input"] #[labelText]
    let input ←
      Node.input
        #[
          Props.id "react-name-input",
          Props.type "text",
          Props.inputValue nameValue,
          Props.placeholder "name",
          Props.onInput fun event => do
            match ← Lean.Vir.Browser.Event.inputValue? event with
            | none => pure ()
            | some next => do
                let nextValue ← JsValue.ofString next
                State.set name nextValue
        ]
    let outputText ← Node.text nameValue
    let output ← Node.spanWith #[Props.id "react-name-output"] #[outputText]
    Node.divWith #[Props.id "react-input-widget"] #[label, input, output]

def changeInputComponent : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofString ""
    let value ← Hooks.useState initial
    let currentValue ← JsValue.toString value.value
    let labelText ← Node.text "change:"
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
            match ← Lean.Vir.Browser.Event.inputValue? event with
            | none => pure ()
            | some next => do
                let nextValue ← JsValue.ofString next
                State.set value nextValue
        ]
    let outputText ← Node.text currentValue
    let output ← Node.spanWith #[Props.id "react-change-output"] #[outputText]
    Node.formWith
      #[
        Props.id "react-change-widget",
        Props.onSubmitWith fun event => do
          Lean.Vir.Browser.Event.preventDefault event
          Lean.Vir.Browser.Event.stopPropagation event
      ]
      #[label, input, output]

def checkboxComponent : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofBool false
    let checked ← Hooks.useState initial
    let checkedValue ← JsValue.toBool checked.value
    let input ←
      Node.input
        #[
          Props.id "react-checkbox-input",
          Props.type "checkbox",
          Props.checked checkedValue,
          Props.onChange fun event => do
            match ← Lean.Vir.Browser.Event.inputChecked? event with
            | none => pure ()
            | some next => do
                let nextValue ← JsValue.ofBool next
                State.set checked nextValue
        ]
    let outputText ← Node.text (checkedLabel checkedValue)
    let output ←
      Node.labelWith
        #[Props.id "react-checkbox-output", Props.htmlFor "react-checkbox-input"]
        #[outputText]
    Node.divWith #[Props.id "react-checkbox-widget"] #[input, output]

def selectTextareaComponent : Component Unit :=
  fun _ => do
    let initialNote ← JsValue.ofString "draft"
    let note ← Hooks.useState initialNote
    let noteValue ← JsValue.toString note.value
    let initialFlavor ← JsValue.ofString "vanilla"
    let flavor ← Hooks.useState initialFlavor
    let flavorValue ← JsValue.toString flavor.value
    let sectionText ← Node.text "fields"
    let sectionNode ← Node.spanWith #[Props.classList #["react-select-textarea-section"]] #[sectionText]
    let choiceText ← Node.text flavorValue
    let choice ← Node.spanWith #[Props.classList #["react-select-textarea-choice"]] #[choiceText]
    let nav ← Node.navWith
      #[Props.id "react-select-textarea-nav", Props.ariaLabel "React textarea fixture"]
      #[sectionNode, choice]
    let noteLabelText ← Node.text "note:"
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
            match ← Lean.Vir.Browser.Event.formValue? event with
            | none => pure ()
            | some next => do
                let nextValue ← JsValue.ofString next
                State.set note nextValue
        ]
    let flavorLabelText ← Node.text "flavor:"
    let flavorLabel ← Node.labelWith #[Props.htmlFor "react-flavor-select"] #[flavorLabelText]
    let vanillaText ← Node.text "vanilla"
    let vanilla ← Node.keyedOptionWith "vanilla" #[Props.inputValue "vanilla"] #[vanillaText]
    let chocolateText ← Node.text "chocolate"
    let chocolate ← Node.keyedOptionWith "chocolate" #[Props.inputValue "chocolate"] #[chocolateText]
    let strawberryText ← Node.text "strawberry"
    let strawberry ← Node.keyedOptionWith "strawberry" #[Props.inputValue "strawberry"] #[strawberryText]
    let select ←
      Node.selectWith
        #[
          Props.id "react-flavor-select",
          Props.inputName "flavor",
          Props.inputValue flavorValue,
          Props.onChange fun event => do
            match ← Lean.Vir.Browser.Event.formValue? event with
            | none => pure ()
            | some next => do
                let nextValue ← JsValue.ofString next
                State.set flavor nextValue
        ]
        #[vanilla, chocolate, strawberry]
    let outputText ← Node.text (selectTextareaLabel noteValue flavorValue)
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
  Root.render root do
    let labelText ← Node.text "attrs:"
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
    let outputText ← Node.text "attrs"
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

def mountInput (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root inputComponent ()

def mountChangeInput (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root changeInputComponent ()

def mountSelectTextarea (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root selectTextareaComponent ()

def mountCheckbox (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root checkboxComponent ()

def mountAttributes (selector : String) : DomM Bool :=
  Root.mountFromSelector selector renderAttributesInto

end ReactInput
