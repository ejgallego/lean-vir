/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactInput

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
    let label ← Node.labelWith #[Property.htmlFor "react-name-input"] #[] #[labelText]
    let input ←
      Node.input
        #[
          Property.id "react-name-input",
          Property.type "text",
          Property.inputValue nameValue,
          Property.placeholder "name"
        ]
        #[EventHandler.onInput fun event => do
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => pure ()
          | some next => do
              let nextValue ← (JsValue.ofString next).run
              (State.set name nextValue).run]
    let outputText ← Node.text nameValue
    let output ← Node.spanWith #[Property.id "react-name-output"] #[] #[outputText]
    Node.divWith #[Property.id "react-input-widget"] #[] #[label, input, output]

def changeInputComponent : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofString ""
    let value ← Hooks.useState initial
    let currentValue ← JsValue.toString value.value
    let labelText ← Node.text "change:"
    let label ← Node.labelWith #[Property.htmlFor "react-change-input"] #[] #[labelText]
    let input ←
      Node.input
        #[
          Property.id "react-change-input",
          Property.inputName "change",
          Property.type "text",
          Property.inputValue currentValue,
          Property.placeholder "change"
        ]
        #[EventHandler.onChange fun event => do
          Lean.Vir.Browser.Event.preventDefault event
          Lean.Vir.Browser.Event.stopPropagation event
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => pure ()
          | some next => do
              let nextValue ← (JsValue.ofString next).run
              (State.set value nextValue).run]
    let outputText ← Node.text currentValue
    let output ← Node.spanWith #[Property.id "react-change-output"] #[] #[outputText]
    Node.formWith
      #[Property.id "react-change-widget"]
      #[EventHandler.onSubmitWith fun event => do
        Lean.Vir.Browser.Event.preventDefault event
        Lean.Vir.Browser.Event.stopPropagation event]
      #[label, input, output]

def checkboxComponent : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofBool false
    let checked ← Hooks.useState initial
    let checkedValue ← JsValue.toBool checked.value
    let input ←
      Node.input
        #[
          Property.id "react-checkbox-input",
          Property.type "checkbox",
          Property.checked checkedValue
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.inputChecked? event with
          | none => pure ()
          | some next => do
              let nextValue ← (JsValue.ofBool next).run
              (State.set checked nextValue).run]
    let outputText ← Node.text (checkedLabel checkedValue)
    let output ←
      Node.labelWith
        #[Property.id "react-checkbox-output", Property.htmlFor "react-checkbox-input"]
        #[]
        #[outputText]
    Node.divWith #[Property.id "react-checkbox-widget"] #[] #[input, output]

def selectTextareaComponent : Component Unit :=
  fun _ => do
    let initialNote ← JsValue.ofString "draft"
    let note ← Hooks.useState initialNote
    let noteValue ← JsValue.toString note.value
    let initialFlavor ← JsValue.ofString "vanilla"
    let flavor ← Hooks.useState initialFlavor
    let flavorValue ← JsValue.toString flavor.value
    let sectionText ← Node.text "fields"
    let sectionNode ← Node.spanWith #[Property.classList #["react-select-textarea-section"]] #[] #[sectionText]
    let choiceText ← Node.text flavorValue
    let choice ← Node.spanWith #[Property.classList #["react-select-textarea-choice"]] #[] #[choiceText]
    let nav ← Node.navWith
      #[Property.id "react-select-textarea-nav", Property.ariaLabel "React textarea fixture"]
      #[]
      #[sectionNode, choice]
    let noteLabelText ← Node.text "note:"
    let noteLabel ← Node.labelWith #[Property.htmlFor "react-note-input"] #[] #[noteLabelText]
    let noteInput ←
      Node.textarea
        #[
          Property.id "react-note-input",
          Property.inputName "note",
          Property.inputValue noteValue,
          Property.rows 3,
          Property.cols 24,
          Property.placeholder "note"
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.formValue? event with
          | none => pure ()
          | some next => do
              let nextValue ← (JsValue.ofString next).run
              (State.set note nextValue).run]
    let flavorLabelText ← Node.text "flavor:"
    let flavorLabel ← Node.labelWith #[Property.htmlFor "react-flavor-select"] #[] #[flavorLabelText]
    let vanillaText ← Node.text "vanilla"
    let vanilla ← Node.keyedOptionWith "vanilla" #[Property.inputValue "vanilla"] #[] #[vanillaText]
    let chocolateText ← Node.text "chocolate"
    let chocolate ← Node.keyedOptionWith "chocolate" #[Property.inputValue "chocolate"] #[] #[chocolateText]
    let strawberryText ← Node.text "strawberry"
    let strawberry ← Node.keyedOptionWith "strawberry" #[Property.inputValue "strawberry"] #[] #[strawberryText]
    let select ←
      Node.selectWith
        #[
          Property.id "react-flavor-select",
          Property.inputName "flavor",
          Property.inputValue flavorValue
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.formValue? event with
          | none => pure ()
          | some next => do
              let nextValue ← (JsValue.ofString next).run
              (State.set flavor nextValue).run]
        #[vanilla, chocolate, strawberry]
    let outputText ← Node.text (selectTextareaLabel noteValue flavorValue)
    let output ← Node.spanWith
      #[Property.id "react-select-textarea-output"]
      #[]
      #[outputText]
    Node.mainWith #[Property.id "react-select-textarea-widget"] #[] #[
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
          Property.id "react-attributes-label",
          Property.htmlFor "react-attributes-input"
        ]
        #[]
        #[labelText]
    let input ←
      Node.keyedInput
        "attributes-input"
        #[
          Property.id "react-attributes-input",
          Property.inputName "attributes",
          Property.type "checkbox",
          Property.checked true,
          Property.disabled true
        ]
        #[]
    let outputText ← Node.text "attrs"
    let output ←
      Node.keyedSpanWith
        "attributes-output"
        #[
          Property.id "react-attributes-output",
          Property.title "attribute output"
        ]
        #[]
        #[outputText]
    Node.divWith
      #[
        Property.id "react-attributes-widget",
        Property.role "group",
        Property.ariaLabel "React attribute fixture",
        Property.data "case" "attributes",
        Property.dataTestId "react-attributes",
        Property.tabIndex 3,
        Property.classList #["react-attributes", "is-mounted"],
        Property.style #[
          StyleProperty.mk "color" "rgb(1, 2, 3)",
          StyleProperty.mk "marginTop" "4px"
        ]
      ]
      #[]
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
