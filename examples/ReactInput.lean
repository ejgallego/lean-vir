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

def inputComponent : Component Unit :=
  fun _ => do
    let name ← Hooks.useState ""
    let labelText ← Html.text "name:"
    let label ← Html.labelWith #[Property.htmlFor "react-name-input"] #[] #[labelText]
    let input ←
      Html.input
        #[
          Property.id "react-name-input",
          Property.type "text",
          Property.inputValue name.value,
          Property.placeholder "name"
        ]
        #[EventHandler.onInput fun event => do
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => pure ()
          | some next => (State.set name next).run]
    let outputText ← Html.text name.value
    let output ← Html.spanWith #[Property.id "react-name-output"] #[] #[outputText]
    Html.divWith #[Property.id "react-input-widget"] #[] #[label, input, output]

def changeInputComponent : Component Unit :=
  fun _ => do
    let value ← Hooks.useState ""
    let labelText ← Html.text "change:"
    let label ← Html.labelWith #[Property.htmlFor "react-change-input"] #[] #[labelText]
    let input ←
      Html.input
        #[
          Property.id "react-change-input",
          Property.inputName "change",
          Property.type "text",
          Property.inputValue value.value,
          Property.placeholder "change"
        ]
        #[EventHandler.onChange fun event => do
          Lean.Vir.Browser.Event.preventDefault event
          Lean.Vir.Browser.Event.stopPropagation event
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => pure ()
          | some next => (State.set value next).run]
    let outputText ← Html.text value.value
    let output ← Html.spanWith #[Property.id "react-change-output"] #[] #[outputText]
    Html.formWith
      #[Property.id "react-change-widget"]
      #[EventHandler.onSubmitWith fun event => do
        Lean.Vir.Browser.Event.preventDefault event
        Lean.Vir.Browser.Event.stopPropagation event]
      #[label, input, output]

def checkboxComponent : Component Unit :=
  fun _ => do
    let checked ← Hooks.useState false
    let input ←
      Html.input
        #[
          Property.id "react-checkbox-input",
          Property.type "checkbox",
          Property.checked checked.value
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.inputChecked? event with
          | none => pure ()
          | some next => (State.set checked next).run]
    let outputText ← Html.text (checkedLabel checked.value)
    let output ←
      Html.labelWith
        #[Property.id "react-checkbox-output", Property.htmlFor "react-checkbox-input"]
        #[]
        #[outputText]
    Html.divWith #[Property.id "react-checkbox-widget"] #[] #[input, output]

def renderAttributesInto (root : Lean.Vir.Js Root) : DomM Unit := do
  let labelText ← Html.text "attrs:"
  let label ←
    Html.keyedLabelWith
      "attributes-label"
      #[
        Property.id "react-attributes-label",
        Property.htmlFor "react-attributes-input"
      ]
      #[]
      #[labelText]
  let input ←
    Html.keyedInput
      "attributes-input"
      #[
        Property.id "react-attributes-input",
        Property.inputName "attributes",
        Property.type "checkbox",
        Property.checked true,
        Property.disabled true
      ]
      #[]
  let outputText ← Html.text "attrs"
  let output ←
    Html.keyedSpanWith
      "attributes-output"
      #[
        Property.id "react-attributes-output",
        Property.title "attribute output"
      ]
      #[]
      #[outputText]
  let html ←
    Html.divWith
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
  Root.render root html

def mountInput (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root inputComponent ()

def mountChangeInput (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root changeInputComponent ()

def mountCheckbox (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root checkboxComponent ()

def mountAttributes (selector : String) : DomM Bool :=
  Root.mountFromSelector selector renderAttributesInto

end ReactInput
