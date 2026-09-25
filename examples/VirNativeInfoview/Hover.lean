/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Infoview.Panel
public import Vir.ProofWidgets.Jsx

public section
namespace VirNativeInfoview.Hover
open Lean.Vir Lean.Vir.React Lean.Vir.Infoview
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

structure State where
  visible : Bool := false
  pinned : Bool := false
  highlighted : Bool := false
  deriving BEq

/-- A nested portal keeps its ancestor popup reachable; pinning pins the chain. -/
structure Parent where
  enter : Browser.DomM Unit := pure ()
  leave : Browser.DomM Unit := pure ()
  pin : Browser.DomM Unit := pure ()

structure Control where
  setter : Js (StateSetter (LeanRef.Handle State))
  value : RuntimeRef State
  timer : RuntimeRef (Option (Js Browser.Timeout))
  live : RuntimeRef Bool
  parent : Parent

def change (control : Control) (f : State → State) : RuntimeM Unit := do
  if !(← control.live.get) then return
  let previous ← control.value.get
  let next := f previous
  if previous != next then
    control.value.set next
    Js.Function.callVoid control.setter (React.SetStateAction.ofValue (← LeanRef.toJSL next))

def cancel (control : Control) : Browser.DomM Unit := do
  if let some timer ← control.timer.get then
    control.timer.set none
    Browser.Timer.clearTimeout timer

def later (control : Control) (delay : Float) (f : State → State) : Browser.DomM Unit := do
  cancel control
  let timer ← Browser.Timer.setTimeout (do
    control.timer.set none
    change control f) (← JsValue.ofFloat delay)
  control.timer.set (some timer)

def hideLater (control : Control) : Browser.DomM Unit :=
  later control 300 fun state => { state with visible := state.pinned }

def enterPopup (control : Control) : Browser.DomM Unit := do
  cancel control
  control.parent.enter

def leavePopup (control : Control) : Browser.DomM Unit := do
  hideLater control
  control.parent.leave

def pin (control : Control) : Browser.DomM Unit := do
  cancel control
  change control fun state => { state with visible := true, pinned := true }
  control.parent.pin

def asParent (control : Control) : Parent :=
  { enter := enterPopup control, leave := leavePopup control, pin := pin control }

def close (control : Control) : Browser.DomM Unit := do
  cancel control
  change control fun state => { state with visible := false, pinned := false }

def toggle (control : Control) : Browser.DomM Unit := do
  cancel control
  if (← control.value.get).pinned then close control else pin control

def over (control : Control) (event : Js Browser.Event) : Browser.DomM Unit := do
  Browser.Event.stopPropagation event
  cancel control
  control.parent.enter
  change control fun state => { state with highlighted := true }
  for key in #["Alt", "Control", "Shift", "Meta"] do
    if ← JsValue.toBool (← HoverDom.modifier event (← JsValue.ofString key)) then return
  later control 500 fun state => { state with visible := true }

def out (control : Control) (event : Js Browser.Event) : Browser.DomM Unit := do
  Browser.Event.stopPropagation event
  change control fun state => { state with highlighted := false }
  hideLater control

def focus (control : Control) (event : Js Browser.Event) : Browser.DomM Unit := do
  Browser.Event.stopPropagation event
  enterPopup control
  change control fun state => { state with visible := true, highlighted := true }

/-- Refs retain timer ownership and current state across renders; effect replay
re-enables the same control, and cleanup cancels pending work before unmount. -/
def useControl (parent : Parent) : ReactM (Control × State) := do
  js#let (state, setter) ← Hooks.useState (← LeanRef.toJSL ({} : State))
  let slot ← Hooks.useRef (← Js.UndefinedOr.undefined (α := LeanRef.Handle Control))
  let control ← match ← Js.UndefinedOr.toOption (← Ref.get slot) with
    | some value => LeanRef.fromJSL value
    | none => do
      let control : Control := {
        setter, parent
        value := ← RuntimeRef.new {}
        timer := ← RuntimeRef.new none
        live := ← RuntimeRef.new true }
      Ref.set slot (Js.UndefinedOr.ofJs (← LeanRef.toJSL control))
      pure control
  let lifetime ← Js.Function.ofLean0 <| Browser.DomM.toRuntime do
    control.live.set true
    let cleanup ← Js.Function.ofLean0Void <| Browser.DomM.toRuntime do
      control.live.set false
      cancel control
    pure (Js.UndefinedOr.ofJs cleanup)
  Hooks.useEffect lifetime (Js.UndefinedOr.ofJs (← Js.Array.empty))
  return (control, ← LeanRef.fromJSL state)

private def byId (id : Js String) : Browser.DomM (Option (Js Browser.Element)) := do
  let document ← Browser.Document.current
  Js.Nullable.toOption (← Browser.Document.querySelector document
    (← JsValue.ofString ("[id=\"" ++ (← JsValue.toString id) ++ "\"]")))

/-- Fixed portal placement avoids reflow. Prefer above, flip below if needed,
then clamp to the viewport. Observe geometry only while a popup is mounted. -/
def position (anchorId popupId : Js String) : Browser.DomM Unit := do
  if let some anchor ← byId anchorId then
    if let some popup ← byId popupId then
      let bounds ← HoverDom.rect anchor
      let size ← HoverDom.rect popup
      let anchorWidth ← JsValue.toFloat (← js_field% bounds "width")
      let anchorHeight ← JsValue.toFloat (← js_field% bounds "height")
      let left ← JsValue.toFloat (← js_field% bounds "left")
      let top ← JsValue.toFloat (← js_field% bounds "top")
      let bottom ← JsValue.toFloat (← js_field% bounds "bottom")
      let width ← JsValue.toFloat (← js_field% size "width")
      let height ← JsValue.toFloat (← js_field% size "height")
      if let some inlineStyle ← Browser.ElementCSSInlineStyle.fromElement popup then
        let style ← Browser.ElementCSSInlineStyle.getStyle inlineStyle
        -- A collapsed goal keeps its React subtree mounted, including portals.
        -- Hide the popup until its anchor has a rendered rectangle again.
        if anchorWidth <= 0 || anchorHeight <= 0 then
          Browser.CSSStyleDeclaration.setProperty style (← js#"visibility") (← Js.Nullable.ofJs (← js#"hidden"))
          return
        let above := top - height - 8
        let y := if above < (10 : Float) then bottom + 8 else above
        Browser.CSSStyleDeclaration.setProperty style (← js#"left")
          (← Js.Nullable.ofJs (← JsValue.ofString s!"clamp(10px, {left}px, calc(100vw - {width}px - 10px))"))
        Browser.CSSStyleDeclaration.setProperty style (← js#"top")
          (← Js.Nullable.ofJs (← JsValue.ofString s!"clamp(10px, {y}px, calc(100vh - {height}px - 10px))"))
        Browser.CSSStyleDeclaration.setProperty style (← js#"visibility") (← Js.Nullable.ofJs (← js#"visible"))

def usePosition (visible : Bool) (anchorId popupId : Js String) : ReactM Unit := do
  let effect ← Js.Function.ofLean0 <| Browser.DomM.toRuntime do
    let mut cleanup : Option (Js.Function1 Js.Any Unit) := none
    if visible then
      if let some anchor ← byId anchorId then
        if let some popup ← byId popupId then
          position anchorId popupId
          let callback ← Js.Function.ofLeanVoid fun (_ : Js.Any) => Browser.DomM.toRuntime do
            position anchorId popupId
          cleanup := some (← HoverDom.observe anchor popup callback)
    let dispose ← Js.Function.ofLean0Void <| Browser.DomM.toRuntime do
      if let some cleanup := cleanup then
        Js.Function.callVoid cleanup (Js.erase (← Js.UndefinedOr.undefined (α := Unit)))
    pure (Js.UndefinedOr.ofJs dispose)
  Hooks.useEffect effect (← Js.UndefinedOr.undefined)

end VirNativeInfoview.Hover
