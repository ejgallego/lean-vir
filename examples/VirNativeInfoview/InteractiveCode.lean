/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview.Client
public import Vir.Infoview.Panel
public import Vir.ProofWidgets.Jsx
public import VirNativeInfoview.Hover

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
  parent : Hover.Parent
  render : Hover.Parent → Js CodeWithInfos → Html

private structure PopupState where
  reply : Option (Js InfoPopup) := none
  status : String := "Loading…"

private def separator : Html := do
  <hr style={(← js%{ "margin" := (← js#"4px 0"), "border" := (← js#"0"),
    "borderTop" := (← js#"1px solid var(--vscode-editorHoverWidget-border, #888)") })}/>

private def Tag : RuntimeM (FunctionComponent (Props.WithData TagProps)) :=
  FunctionComponent.ofLean fun nativeProps => do
    let props : TagProps ← LeanRef.fromJSL (← Props.WithData.data nativeProps)
    let (hover, current) ← Hover.useControl props.parent
    let response ← StateTuple.toState (← Hooks.useState (← LeanRef.toJSL ({} : PopupState)))
    let popupId ← Hooks.useId
    let anchorId ← Hooks.useId
    Hover.usePosition current.visible anchorId popupId
    let over ← Callback.ofUnary (Hover.over hover)
    let leave ← Callback.ofUnary (Hover.out hover)
    let focus ← Callback.ofUnary (Hover.focus hover)
    let toggle ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      Browser.Event.preventDefault event
      Hover.toggle hover
    let close ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      Hover.close hover
    let popupEnter ← Callback.ofUnary fun (_ : Js Browser.Event) => Hover.enterPopup hover
    let popupLeave ← Callback.ofUnary fun (_ : Js Browser.Event) => Hover.leavePopup hover
    let popupOver ← Callback.ofUnary fun (event : Js Browser.Event) => Browser.Event.stopPropagation event
    -- Portal keys must not reach the term's activation handler. Let native
    -- buttons handle Enter/Space themselves; Escape dismisses the popup.
    let popupKeyboard ← Callback.ofUnary fun (event : Js Browser.Event) => do
      Browser.Event.stopPropagation event
      if (← optionalString (← Js.Object.get event (← js#"key"))) == "Escape" then
        Hover.close hover
    let keyboard ← Callback.ofUnary fun (event : Js Browser.Event) => do
      let key ← optionalString (← Js.Object.get event (← js#"key"))
      if key == "Escape" then
        Browser.Event.stopPropagation event
        Hover.close hover
      else if key == "Enter" || key == " " then
        Browser.Event.preventDefault event
        Browser.Event.stopPropagation event
        Hover.toggle hover
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
    -- Keep two child slots even while hidden. Switching a sole unkeyed fragment
    -- to an array when its popup opens would remount the nested term components.
    let mut popup : Html := Node.text (← js#"")
    if current.visible then
      let mut contents : Array Html := #[]
      if let some reply := state.reply then
        if let some expr ← popupField (← InfoPopup.exprExplicit reply) then
          contents := contents.push (props.render (Hover.asParent hover) expr)
        contents := contents.push (Html.text " : ")
        if let some type ← popupField (← InfoPopup.type reply) then
          contents := contents.push (props.render (Hover.asParent hover) type)
        let code := contents
        contents := #[(do
          <div className="font-code tl pre-wrap" style={(← js%{
            "whiteSpace" := (← js#"pre-wrap"),
            "fontFamily" := (← js#"var(--vscode-editor-font-family, monospace)") })}>{...code}</div>)]
        if let some value ← popupField (Js.UndefinedOr.ofJs (← Js.Object.get reply (← js#"doc"))) then
          let doc ← Js.String.fromAny value
          if (← JsValue.toFloat (← Js.String.length doc)) != 0 then
            contents := contents.push separator
            contents := contents.push (do
              <span className="vir-native-infoview-doc" style={(← js%{
                "display" := (← js#"block"), "whiteSpace" := (← js#"pre-wrap") })}>{Node.text doc}</span>)
        if !props.diff.isEmpty then
          contents := contents.push separator
          contents := contents.push (do
            <div className="vir-native-infoview-diff-description">{Html.text (diffDescription props.diff)}</div>)
      else contents := #[Html.text state.status]
      popup := do
        let node ← <div id={popupId} role="tooltip" className="vir-native-infoview-type-popup tooltip"
            onPointerEnter={popupEnter} onPointerLeave={popupLeave}
            onPointerOver={popupOver} onPointerOut={popupOver} onKeyDown={popupKeyboard}
            data-pinned={(← JsValue.ofBool current.pinned)}
            style={(← js%{ "position" := (← js#"fixed"), "display" := (← js#"block"),
              "visibility" := (← js#"hidden"), "padding" := (← js#"4px 48px 4px 8px"),
              "zIndex" := (← js#"1000"), "maxWidth" := (← js#"min(70vw, calc(100vw - 20px))"),
              "maxHeight" := (← js#"min(300px, calc(100vh - 20px))"),
              "boxSizing" := (← js#"border-box"), "overflow" := (← js#"auto"),
              "overscrollBehavior" := (← js#"contain"), "whiteSpace" := (← js#"normal"),
              "fontFamily" := (← js#"var(--vscode-font-family, system-ui)"),
              "fontSize" := (← js#"var(--vscode-font-size, 13px)"),
              "lineHeight" := (← js#"var(--vscode-editor-line-height, 1.5)"),
              "color" := (← js#"var(--vscode-editorHoverWidget-foreground, #333)"),
              "borderRadius" := (← js#"4px"),
              "boxShadow" := (← js#"1px 1px 5px var(--vscode-widget-shadow, #0003)"),
              "border" := (← js#"1px solid var(--vscode-editorHoverWidget-border, #888)"),
              "background" := (← js#"var(--vscode-editorHoverWidget-background, #eee)") })}>
          <div className="tooltip-code-content">{...contents}</div>
          <button type="button" className="vir-native-infoview-pin link pointer dim"
            aria-label="Pin type information" aria-pressed={(← JsValue.ofBool current.pinned)}
            title={(← JsValue.ofString (if current.pinned then "Pinned — click to unpin and close" else "Pin type information"))}
            onClick={toggle}
            style={(← js%{ "position" := (← js#"absolute"), "top" := (← js#"4px"),
              "right" := (← js#"24px"), "padding" := (← js#"0"), "margin" := (← js#"0"),
              "border" := (← js#"0"), "background" := (← js#"transparent"),
              "color" := (← js#"inherit"), "lineHeight" := (← js#"1") })}>
            <span aria-hidden={(← JsValue.ofBool true)} className={(← JsValue.ofString
              (if current.pinned then "codicon codicon-pinned" else "codicon codicon-pin"))}/>
          </button>
          <button type="button" aria-label="Close type information" title="Close type information" onClick={close}
            style={(← js%{ "position" := (← js#"absolute"), "top" := (← js#"4px"),
              "right" := (← js#"4px"), "padding" := (← js#"0 2px"), "margin" := (← js#"0"),
              "border" := (← js#"0"), "background" := (← js#"transparent"),
              "color" := (← js#"inherit"), "font" := (← js#"inherit"),
              "lineHeight" := (← js#"1"), "cursor" := (← js#"pointer") })}>×</button>
          </div>
        HoverDom.portal node
    return ← <span id={anchorId} className={(← JsValue.ofString ("vir-native-infoview-code-tag " ++
        diffClass props.diff ++ (if current.highlighted then " highlight" else "")))}
        role="button" tabIndex={(← JsValue.ofFloat 0)} aria-expanded={(← JsValue.ofBool current.visible)}
        aria-pressed={(← JsValue.ofBool current.pinned)}
        aria-controls={popupId} onPointerOver={over} onPointerOut={leave} onClick={toggle}
        onFocus={focus} onBlur={leave} onKeyDown={keyboard}>
      {props.render props.parent props.fmt}{popup}
    </span>

private partial def renderTaggedText (TagComponent : FunctionComponent (Props.WithData TagProps))
    (session : Js RpcSession) (parent : Hover.Parent) (fmt : Js CodeWithInfos) : Html := do
  if let some text ← Js.UndefinedOr.toOption (← CodeWithInfos.text fmt) then
    return ← Node.text text
  if let some append ← Js.UndefinedOr.toOption (← CodeWithInfos.append fmt) then
    let children ← Js.Array.empty
    let size := (← JsValue.toFloat (← Js.Array.length append)).toUInt64.toNat
    for index in [:size] do
      let child ← Js.Array.get append (← JsValue.ofFloat index.toFloat)
      let _ ← Js.Array.push children (← renderTaggedText TagComponent session parent child)
    return ← Node.fragment (← Js.Object.empty) children
  if let some tag ← Js.UndefinedOr.toOption (← CodeWithInfos.tag fmt) then
    let data ← Js.Tuple2.first tag
    let body ← Js.Tuple2.second tag
    let info ← Js.Object.get data (← js#"info")
    if ← JsValue.toBool (← Js.UndefinedOr.isUndefined (Js.UndefinedOr.ofJs info)) then
      if (← JsValue.toString (← Js.String.fromAny data)) == "highlighted" then
        return ← <span className="highlighted-text">{renderTaggedText TagComponent session parent body}</span>
      else return ← malformed
    let diff ← optionalString (← Js.Object.get data (← js#"diffStatus"))
    let props ← Props.WithData.make (← LeanRef.toJSL ({
      info, fmt := body, diff, session, parent, render := renderTaggedText TagComponent session } : TagProps))
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
    return ← <span className="font-code">{renderTaggedText tag session {} fmt}</span>

end VirNativeInfoview.InteractiveCode
