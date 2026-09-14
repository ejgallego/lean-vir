/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Client
public import Vir.Infoview.Panel
public import Vir.ProofWidgets.Jsx

public section

namespace VirNativeInfoview.InteractiveCode

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

private def optionalString (value : Js.Any) : RuntimeM String := do
  match ← Js.UndefinedOr.toOption (Js.UndefinedOr.ofJs value) with
  | none => pure ""
  | some value => JsValue.toString (← Js.String.fromAny value)

/-- Popup wire policy: missing/undefined and null mean absent. Present values retain
their native identity; this does not coerce or validate a present field's shape.
Documentation is separately checked by `Js.String.fromAny` before display. -/
private def popupField {α : Type} (value : Js.UndefinedOr α) : RuntimeM (Option (Js α)) := do
  match ← Js.UndefinedOr.toOption value with
  | none => pure none
  | some value => Js.Nullable.toOption (← Js.Nullable.ofJs value)

private def malformed : RuntimeM (Js Node) := by
  unfold RuntimeM
  exact throw (IO.userError "Malformed tagged code")

private def diffClass : String → String
  | "wasChanged" | "wasInserted" | "willInsert" => "inserted-text"
  | "willChange" | "wasDeleted" | "willDelete" => "removed-text"
  | _ => ""

private def diffDescription : String → String
  | "wasChanged" => "This subexpression has been modified."
  | "willChange" => "This subexpression will be modified."
  | "wasInserted" => "This subexpression has been inserted."
  | "willInsert" => "This subexpression will be inserted."
  | "wasDeleted" => "This subexpression has been removed."
  | "willDelete" => "This subexpression will be deleted."
  | _ => ""

private structure TagProps where
  info : Js.Any
  fmt : Js CodeWithInfos
  diff : String
  session : Js RpcSession
  render : Js CodeWithInfos → Html

private structure HoverState where
  visible : Bool := false
  pinned : Bool := false

private structure PopupState where
  reply : Option (Js InfoPopup) := none
  status : String := "Loading…"

private def Tag : RuntimeM (FunctionComponent (Props.WithData TagProps)) :=
  FunctionComponent.ofLean fun nativeProps => do
    let props : TagProps ← LeanRef.fromJSL (← Props.WithData.data nativeProps)
    let hover ← StateTuple.toState (← Hooks.useState (← LeanRef.toJSL ({} : HoverState)))
    let current : HoverState ← LeanRef.fromJSL hover.value
    let response ← StateTuple.toState (← Hooks.useState (← LeanRef.toJSL ({} : PopupState)))
    let popupId ← Hooks.useId
    let over ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      State.modify hover fun previous => do
        let previous : HoverState ← LeanRef.fromJSL previous
        LeanRef.toJSL { previous with visible := true }
    let leave ← Callback.ofUnary fun (_ : Js Browser.Event) => do
      State.modify hover fun previous => do
        let previous : HoverState ← LeanRef.fromJSL previous
        LeanRef.toJSL { previous with visible := previous.pinned }
    let toggle ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      State.modify hover fun previous => do
        let previous : HoverState ← LeanRef.fromJSL previous
        LeanRef.toJSL ({ visible := !previous.pinned, pinned := !previous.pinned } : HoverState)
    let close ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      State.set hover (← LeanRef.toJSL ({} : HoverState))
    let keyboard ← Callback.ofUnary fun (event : Js Browser.Event) => do
      let key ← optionalString (← Js.Object.get event (← js#"key"))
      if key == "Escape" then
        Browser.Event.stopPropagation event
        State.set hover (← LeanRef.toJSL ({} : HoverState))
      else if key == "Enter" || key == " " then
        Browser.Event.preventDefault event
        Browser.Event.stopPropagation event
        State.modify hover fun previous => do
          let previous : HoverState ← LeanRef.fromJSL previous
          LeanRef.toJSL ({ visible := !previous.pinned, pinned := !previous.pinned } : HoverState)
    let effect ← EffectCallback.ofLean {
      setup := do
        let active ← RuntimeRef.new true
        let abort ← Browser.AbortController.create
        if current.visible then
          State.set response (← LeanRef.toJSL ({} : PopupState))
          let options ← ClientRequestOptions.empty
          ClientRequestOptions.setAbortSignal options (← Browser.AbortController.getSignal abort)
          let pending : Js.Promise InfoPopup ← RpcSession.callWithOptions props.session
            (← js#"Lean.Widget.InteractiveDiagnostics.infoToInteractive") props.info options
          let succeed ← Js.Function.ofLeanVoid fun (reply : Js InfoPopup) => do
            if ← active.get then
              State.set response (← LeanRef.toJSL ({ reply := some reply, status := "" } : PopupState))
          let fail ← Js.Function.ofLeanVoid fun (_ : Js.Any) => do
            if ← active.get then
              State.set response (← LeanRef.toJSL ({ status := "Unable to load type information" } : PopupState))
          let handled ← Js.Promise.thenVoid pending succeed
          let ignore ← Js.Function.ofLeanVoid fun (_ : Js.Undefined) => pure ()
          let _ ← Js.Promise.thenVoidWithRejection handled ignore fail
          pure ()
        LeanRef.toJSL (active, abort)
      cleanup := fun resource => do
        let (active, abort) : RuntimeRef Bool × Js Browser.AbortController ← LeanRef.fromJSL resource
        active.set false
        Browser.AbortController.abort abort
    }
    Hooks.useEffect effect (Js.UndefinedOr.ofJs (← js#[Js.erase props.session, props.info,
      Js.erase (← JsValue.ofBool current.visible)]))
    let state : PopupState ← LeanRef.fromJSL response.value
    let mut popup : Array Html := #[]
    if current.visible then
      let mut contents : Array Html := #[]
      if let some reply := state.reply then
        if let some expr ← popupField (← InfoPopup.exprExplicit reply) then
          contents := contents.push (props.render expr)
        contents := contents.push (Html.text " : ")
        if let some type ← popupField (← InfoPopup.type reply) then
          contents := contents.push (props.render type)
        if let some value ← popupField (Js.UndefinedOr.ofJs (← Js.Object.get reply (← js#"doc"))) then
          let doc ← Js.String.fromAny value
          if (← JsValue.toFloat (← Js.String.length doc)) != 0 then
            contents := contents.push (do
              <span className="vir-native-infoview-doc" style={(← js%{
                "display" := (← js#"block"), "whiteSpace" := (← js#"pre-wrap") })}>{Node.text doc}</span>)
        if !props.diff.isEmpty then contents := contents.push (do
          <span className="vir-native-infoview-diff-description">{Html.text (diffDescription props.diff)}</span>)
      else contents := #[Html.text state.status]
      popup := #[do
        <span id={popupId} role="tooltip" className="vir-native-infoview-type-popup"
            style={(← js%{ "display" := (← js#"inline-block"), "padding" := (← js#"0.5em"),
              "border" := (← js#"1px solid var(--vscode-editorHoverWidget-border, #888)"),
              "background" := (← js#"var(--vscode-editorHoverWidget-background, #eee)") })}>
          {...contents}<button type="button" aria-label="Close type information" onClick={close}>×</button>
        </span>]
    return ← <span className={(← JsValue.ofString ("vir-native-infoview-code-tag " ++ diffClass props.diff))}
        role="button" tabIndex={(← JsValue.ofFloat 0)} aria-expanded={(← JsValue.ofBool current.visible)}
        aria-controls={popupId} onPointerOver={over} onPointerLeave={leave} onClick={toggle}
        onFocus={over} onBlur={leave} onKeyDown={keyboard}>
      {props.render props.fmt}{...popup}
    </span>

private partial def renderTaggedText (TagComponent : FunctionComponent (Props.WithData TagProps))
    (session : Js RpcSession) (fmt : Js CodeWithInfos) : Html := do
  if let some text ← Js.UndefinedOr.toOption (← CodeWithInfos.text fmt) then
    return ← Node.text text
  if let some append ← Js.UndefinedOr.toOption (← CodeWithInfos.append fmt) then
    let children ← Js.Array.empty
    let size := (← JsValue.toFloat (← Js.Array.length append)).toUInt64.toNat
    for index in [:size] do
      let child ← Js.Array.get append (← JsValue.ofFloat index.toFloat)
      let _ ← Js.Array.push children (← renderTaggedText TagComponent session child)
    return ← Node.fragment (← Js.Object.empty) children
  if let some tag ← Js.UndefinedOr.toOption (← CodeWithInfos.tag fmt) then
    let data ← Js.Tuple2.first tag
    let body ← Js.Tuple2.second tag
    let info ← Js.Object.get data (← js#"info")
    if ← JsValue.toBool (← Js.UndefinedOr.isUndefined (Js.UndefinedOr.ofJs info)) then
      if (← JsValue.toString (← Js.String.fromAny data)) == "highlighted" then
        return ← <span className="highlighted-text">{renderTaggedText TagComponent session body}</span>
      else return ← malformed
    let diff ← optionalString (← Js.Object.get data (← js#"diffStatus"))
    let props ← Props.WithData.make (← LeanRef.toJSL ({
      info, fmt := body, diff, session, render := renderTaggedText TagComponent session } : TagProps))
    return ← <TagComponent @props={props}/>
  malformed

/-- Compile-time schema only: JSX carries the exact native tagged text, not a Lean record. -/
structure CodeProps where
  fmt : Js CodeWithInfos

/-- Native tagged-text traversal and popup lifecycle; the upstream session owns RPC transport. -/
def View : RuntimeM (FunctionComponent CodeProps) := do
  let tag ← Tag
  FunctionComponent.ofLean fun props => do
    let fmt ← js_field% props "fmt"
    let session ← useRpcSession
    return ← <span className="font-code">{renderTaggedText tag session fmt}</span>

end VirNativeInfoview.InteractiveCode
