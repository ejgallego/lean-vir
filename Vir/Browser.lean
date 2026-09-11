/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Common
public import Vir.Js
public import Vir.Browser.Generated

public section

namespace Lean.Vir.Browser

namespace KeyboardEvent

/-- Checks whether an event is a keyboard event without changing its JavaScript identity. -/
def fromEvent
    (event : @& Lean.Vir.Js Event) :
    DomM (Option (Lean.Vir.Js KeyboardEvent)) := do
  Lean.Vir.Js.Nullable.toOption (← fromEventNullable event)

end KeyboardEvent

namespace EventTarget

/-- Narrows an exact `EventTarget` to `Element` without changing its JavaScript identity. -/
def asElement
    (target : @& Lean.Vir.Js EventTarget) :
    DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← asElementNullable target)

end EventTarget

namespace Event

/--
Returns the event target as a DOM element when the target is an element.

The returned element follows ordinary JavaScript reachability. VIR likewise
does not invalidate the event after callback return; its practical validity
follows browser semantics.

Reference: [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target).
-/
def targetOption (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  match ← Lean.Vir.Js.Nullable.toOption (← getTarget event) with
  | none => pure none
  | some target => EventTarget.asElement target

/--
Returns the current event target as a DOM element when the current target is an
element.

The returned element follows ordinary JavaScript reachability. The browser
normally exposes `currentTarget` only while its handler runs; VIR adds no
stronger event lifetime.

Reference: [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget).
-/
def currentTargetOption (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  match ← Lean.Vir.Js.Nullable.toOption (← getCurrentTarget event) with
  | none => pure none
  | some target => EventTarget.asElement target

end Event

namespace ElementCSSInlineStyle

/--
Checks whether an element implements `ElementCSSInlineStyle` without changing
its JavaScript identity.
-/
def fromElement
    (element : @& Lean.Vir.Js Element) :
    DomM (Option (Lean.Vir.Js ElementCSSInlineStyle)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

end ElementCSSInlineStyle

namespace Element

/-- Checks whether an erased JavaScript value is a browser `Element`. -/
def fromAny (value : @& Lean.Vir.Js.Any) : DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← fromAnyNullable value)

instance : Lean.Vir.Js.Cast DomM Element where
  expected := "Element"
  check := fromAny

end Element

namespace HTMLInputElement

/--
Narrows a generic DOM element to an `HTMLInputElement` when possible.

In a browser this returns `some` exactly when the element is an
`HTMLInputElement`. Non-browser runtimes must supply an explicit DOM host.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
def fromElement (element : @& Lean.Vir.Js Element) : DomM (Option (Lean.Vir.Js HTMLInputElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

end HTMLInputElement

namespace HTMLCanvasElement

/-- Narrows a generic DOM element to an `HTMLCanvasElement`. -/
def fromElement
    (element : @& Lean.Vir.Js Element) :
    DomM (Option (Lean.Vir.Js HTMLCanvasElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

end HTMLCanvasElement

namespace Event

/--
Returns the current input element for an input-like event.

This checks `currentTarget` first, then falls back to `target`, and narrows the
element with `HTMLInputElement.fromElement`.
-/
def inputElement? (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js HTMLInputElement)) := do
  match ← currentTargetOption event with
  | some element => HTMLInputElement.fromElement element
  | none =>
      match ← targetOption event with
      | none => pure none
      | some element => HTMLInputElement.fromElement element

end Event

end Lean.Vir.Browser
