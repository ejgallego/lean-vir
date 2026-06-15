/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactInput

open Lean.Vir.React

def checkedLabel (checked : Bool) : String :=
  "checked:" ++ toString checked

partial def renderInputInto (root : Root) (value : String) : IO Unit := do
  Root.render root <|
    Html.divWith #[Property.id "react-input-widget"] #[] #[
      Html.labelWith #[Property.htmlFor "react-name-input"] #[] #[.text "name:"],
      Html.input
        #[
          Property.id "react-name-input",
          Property.type "text",
          Property.inputValue value,
          Property.placeholder "name"
        ]
        #[EventHandler.onInput fun event => do
          match ← Lean.Vir.Browser.Event.inputValue? event with
          | none => renderInputInto root value
          | some next => renderInputInto root next],
      Html.spanWith #[Property.id "react-name-output"] #[] #[.text value]
    ]

partial def renderChangeInputInto (root : Root) (value : String) : IO Unit := do
  Root.render root <|
    Html.formWith
      #[Property.id "react-change-widget"]
      #[EventHandler.onSubmitWith fun event => do
        Lean.Vir.Browser.Event.preventDefault event
        Lean.Vir.Browser.Event.stopPropagation event]
      #[
        Html.labelWith #[Property.htmlFor "react-change-input"] #[] #[.text "change:"],
        Html.input
          #[
            Property.id "react-change-input",
            Property.inputName "change",
            Property.type "text",
            Property.inputValue value,
            Property.placeholder "change"
          ]
          #[EventHandler.onChange fun event => do
            Lean.Vir.Browser.Event.preventDefault event
            Lean.Vir.Browser.Event.stopPropagation event
            match ← Lean.Vir.Browser.Event.inputValue? event with
            | none => renderChangeInputInto root value
            | some next => renderChangeInputInto root next],
        Html.spanWith #[Property.id "react-change-output"] #[] #[.text value]
      ]

partial def renderCheckboxInto (root : Root) (checked : Bool) : IO Unit := do
  Root.render root <|
    Html.divWith #[Property.id "react-checkbox-widget"] #[] #[
      Html.input
        #[
          Property.id "react-checkbox-input",
          Property.type "checkbox",
          Property.checked checked
        ]
        #[EventHandler.onChange fun event => do
          match ← Lean.Vir.Browser.Event.inputChecked? event with
          | none => renderCheckboxInto root checked
          | some next => renderCheckboxInto root next],
      Html.labelWith
        #[Property.id "react-checkbox-output", Property.htmlFor "react-checkbox-input"]
        #[]
        #[.text (checkedLabel checked)]
    ]

def renderAttributesInto (root : Root) : IO Unit := do
  Root.render root <|
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
      #[
        Html.keyedLabelWith
          "attributes-label"
          #[
            Property.id "react-attributes-label",
            Property.htmlFor "react-attributes-input"
          ]
          #[]
          #[.text "attrs:"],
        Html.keyedInput
          "attributes-input"
          #[
            Property.id "react-attributes-input",
            Property.inputName "attributes",
            Property.type "checkbox",
            Property.checked true,
            Property.disabled true
          ]
          #[],
        Html.keyedSpanWith
          "attributes-output"
          #[
            Property.id "react-attributes-output",
            Property.title "attribute output"
          ]
          #[]
          #[.text "attrs"]
      ]

def mountInput (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderInputInto root ""

def mountChangeInput (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderChangeInputInto root ""

def mountCheckbox (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderCheckboxInto root false

def mountAttributes (selector : String) : IO Bool :=
  Root.mountFromSelector selector renderAttributesInto

end ReactInput
