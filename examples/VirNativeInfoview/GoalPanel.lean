/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import VirNativeInfoview.Goals
public import VirNativeInfoview.InteractiveCode
public import Vir.ProofWidgets.Jsx

public section

namespace VirNativeInfoview.GoalPanel

open Lean.Vir Lean.Vir.React Lean.Vir.Infoview Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

private structure HypProps where
  hypothesis : VisibleHypothesis
  showValue : Bool

private def Hypothesis (code : Js CodeWithInfos → Html) : RuntimeM (FunctionComponent (Props.WithData HypProps)) :=
  FunctionComponent.ofLean fun props => do
    let props : HypProps ← LeanRef.fromJSL (← Props.WithData.data props)
    let h := props.hypothesis
    let inserted ← nativeFlag (← InteractiveHypothesisBundle.isInserted h.source)
    let removed ← nativeFlag (← InteractiveHypothesisBundle.isRemoved h.source)
    let names ← Js.Array.empty (α := Node)
    let mut index := 0
    for name in h.names do
      let classes := "goal-hyp" ++ (if inserted then " inserted-text" else "") ++
        (if removed then " removed-text" else "") ++
        (if name.inaccessible then " goal-inaccessible" else "")
      let _ ← Js.Array.push names (← <strong key={(← JsValue.ofString (toString index))}
        className={(← JsValue.ofString classes)}>{Node.text name.value}{Html.text " "}</strong>)
      index := index + 1
    let value? ← Js.UndefinedOr.toOption (← InteractiveHypothesisBundle.val h.source)
    let values ← Js.Array.empty (α := Node)
    if props.showValue then
      if let some value := value? then
        let _ ← Js.Array.push values (← <span key="value" className="vir-native-infoview-hyp-value"> := {code value}</span>)
    return ← <div className="vir-native-infoview-hypothesis"
        data-source-index={(← JsValue.ofString (toString h.sourceIndex))}>
      <span className="vir-native-infoview-hyp-name">{names}</span>
      {Html.text ": "}<span className="vir-native-infoview-hyp-type">
        {code (← InteractiveHypothesisBundle.type h.source)}</span>{values}
    </div>

private structure GoalProps where
  hyps : Js.Array InteractiveHypothesisBundle
  target : Js CodeWithInfos
  name : String
  goalPrefix : Js String
  key : String
  index : Nat
  settings : GoalSettings
  inserted : Bool := false
  removed : Bool := false
  term : Bool := false

private def Goal (code : Js CodeWithInfos → Html) : RuntimeM (FunctionComponent (Props.WithData GoalProps)) := do
  let Hyp ← Hypothesis code
  FunctionComponent.ofLean fun props => do
    let props : GoalProps ← LeanRef.fromJSL (← Props.WithData.data props)
    js#let (collapsed, setCollapsed) ← Hooks.useState (← JsValue.ofBool false)
    let isCollapsed ← JsValue.toBool collapsed
    let detailsId ← Hooks.useId
    let toggle ← Js.Function.ofLeanVoid fun (event : Js Browser.Event) => Browser.DomM.toRuntime do
      -- React owns open state; suppress the summary's second, native toggle.
      Browser.Event.preventDefault event
      let update ← Js.Function.ofLean fun (previous : Js Bool) => do
        JsValue.ofBool (!(← JsValue.toBool previous))
      Js.Function.callVoid setCollapsed (SetStateAction.ofUpdater update)
    let visible ← visibleHypotheses props.hyps props.settings
    let hypotheses ← Js.Array.empty (α := Node)
    for hypothesis in visible do
      let hypProps ← Props.WithData.make (← LeanRef.toJSL
        ({ hypothesis, showValue := props.settings.showLetValue } : HypProps))
      Js.Object.set (Props.WithData.asProps hypProps) (← js#"key")
        (← JsValue.ofString (toString hypothesis.sourceIndex))
      let _ ← Js.Array.push hypotheses (← <Hyp @props={hypProps}/>)
    let target : Html := <div key="target" className="vir-native-infoview-target" data-is-goal={(← JsValue.ofBool true)}>
      <strong className="goal-vdash">{Node.text props.goalPrefix}</strong>
      <span className="vir-native-infoview-target-code">{code props.target}</span>
    </div>
    let context : Html := <div key="context" className="vir-native-infoview-context">{hypotheses}</div>
    let body ← if props.settings.reverse then js#[← target, ← context] else js#[← context, ← target]
    let classes := "vir-native-infoview-goal font-code pre-wrap" ++
      (if props.inserted then " b--inserted" else "") ++
      (if props.removed then " b--removed" else "")
    let opacity := if props.settings.emphasizeFirstGoal && props.index != 0 && !props.term
      then "0.7" else "1"
    let style ← js%{ "marginBottom" := (← js#"0.8em"), "whiteSpace" := (← js#"pre-wrap"),
      "opacity" := (← JsValue.ofString opacity), "fontFamily" := (← js#"var(--vscode-editor-font-family, monospace)") }
    let hideHeader := props.settings.hideGoalNames || (!props.term && props.name.isEmpty)
    let title : Html := if props.term then Html.text "Expected type" else do
      <span><strong className="goal-case">case </strong>{Html.text props.name}</span>
    let header : Html := do
      <summary className="vir-native-infoview-collapse pointer non-selectable"
          hidden={(← JsValue.ofBool hideHeader)}
          aria-expanded={(← JsValue.ofBool (!isCollapsed))} aria-controls={detailsId}
          style={(← js%{ "margin" := (← JsValue.ofString (if props.term then "0.5rem 0" else "0.25rem 0")),
            "cursor" := (← js#"pointer"), "userSelect" := (← js#"none"),
            "fontFamily" := (← JsValue.ofString (if props.term then "var(--vscode-font-family, system-ui)" else "inherit")),
            "fontSize" := (← JsValue.ofString (if props.term then "var(--vscode-font-size, 13px)" else "inherit")),
            "lineHeight" := (← JsValue.ofString (if props.term then "normal" else "inherit")) })}
          onClick={toggle}>
        {title}
      </summary>
    -- Hiding the case heading shows the goal, without erasing its collapse state.
    let hidden := isCollapsed && !hideHeader
    return ← <article className={(← JsValue.ofString classes)} data-goal-key={(← JsValue.ofString props.key)}
        data-goal-kind={(← JsValue.ofString (if props.term then "term" else "tactic"))} style={style}>
      <details open={(← JsValue.ofBool (!hidden))}>
        {header}<div id={detailsId} hidden={(← JsValue.ofBool hidden)}>{body}</div>
      </details>
    </article>

private def setting (currentValue : JSL GoalSettings)
    (setter : Js (StateSetter (LeanRef.Handle GoalSettings)))
    (label : String) (get : GoalSettings → Bool) (change : GoalSettings → GoalSettings) : Html := do
  let current : GoalSettings ← LeanRef.fromJSL currentValue
  let onChange ← Js.Function.ofLeanVoid fun (_ : Js Browser.Event) => do
    let update ← Js.Function.ofLean fun (previous : JSL GoalSettings) => do
      LeanRef.toJSL (change (← LeanRef.fromJSL previous))
    Js.Function.callVoid setter (SetStateAction.ofUpdater update)
  return ← <label key={(← JsValue.ofString label)} style={(← js%{ "display" := (← js#"block") })}>
    <input type="checkbox" checked={(← JsValue.ofBool (get current))} onChange={onChange}/>
    {Html.text (" " ++ label)}
  </label>

/-- Shared Lean goal presentation with an explicit code-rendering boundary. -/
def withCode (code : Js CodeWithInfos → Html) : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let GoalCard ← Goal code
  FunctionComponent.ofLean fun panel => do
    let editor ← Hooks.useContext (← editorContext)
    js#let (settingsValue, settingsSetter) ← Hooks.useState (← LeanRef.toJSL ({} : GoalSettings))
    js#let (copyValue, copySetter) ← Hooks.useState (← js#"")
    let settings : GoalSettings ← LeanRef.fromJSL settingsValue
    let goals ← PanelWidgetProps.goals panel
    let goalCount := (← JsValue.toFloat (← Js.Array.length goals)).toUInt64.toNat
    let term? ← Js.UndefinedOr.toOption (← PanelWidgetProps.termGoal panel)
    let copy ← Js.Function.ofLeanVoid fun (_ : Js Browser.Event) => do
      let pending ← EditorApi.copyToClipboard (← EditorConnection.api editor)
        (← JsValue.ofString (← goalsToString goals))
      let copied ← Js.Function.ofLeanVoid fun (_ : Js Unit) => do
        Js.Function.callVoid copySetter (SetStateAction.ofValue (← js#"Copied"))
      let failed ← Js.Function.ofLeanVoid fun (_ : Js.Any) => do
        Js.Function.callVoid copySetter (SetStateAction.ofValue (← js#"Copy failed"))
      let _ ← Js.Promise.thenVoidWithRejection pending copied failed
      pure ()
    let cards ← Js.Array.empty (α := Node)
    for index in [:goalCount] do
      let goal ← Js.Array.get goals (← JsValue.ofFloat index.toFloat)
      let name? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
      let name ← match name? with | none => pure "" | some n => JsValue.toString n
      let id? ← Js.UndefinedOr.toOption (← InteractiveGoal.mvarId goal)
      let key ← match id? with
        | some id => JsValue.toString id
        | none => pure (if name.isEmpty then s!"goal-{index}" else name)
      let prefix? ← Js.UndefinedOr.toOption (← InteractiveGoal.goalPrefix goal)
      let goalPrefix ← match prefix? with | none => js#"⊢ " | some p => pure p
      let data : GoalProps := {
        hyps := ← InteractiveGoal.hyps goal
        target := ← InteractiveGoal.type goal
        inserted := ← nativeFlag (← InteractiveGoal.isInserted goal)
        removed := ← nativeFlag (← InteractiveGoal.isRemoved goal)
        name, goalPrefix, key, index, settings }
      let props ← Props.WithData.make (← LeanRef.toJSL data)
      Js.Object.set (Props.WithData.asProps props) (← js#"key") (← JsValue.ofString ("tactic:" ++ key))
      let _ ← Js.Array.push cards (← <GoalCard @props={props}/>)
    if let some term := term? then
      let data : GoalProps := {
        hyps := ← InteractiveTermGoal.hyps term
        target := ← InteractiveTermGoal.type term
        name := "", goalPrefix := ← js#"⊢ ", key := "term", index := 0, settings, term := true }
      let props ← Props.WithData.make (← LeanRef.toJSL data)
      Js.Object.set (Props.WithData.asProps props) (← js#"key") (← js#"term")
      let _ ← Js.Array.push cards (← <GoalCard @props={props}/>)
    let controls ← js#[
      ← setting settingsValue settingsSetter "Display target before assumptions" (·.reverse) fun s => { s with reverse := !s.reverse },
      ← setting settingsValue settingsSetter "Hide type assumptions" (! ·.showType) fun s => { s with showType := !s.showType },
      ← setting settingsValue settingsSetter "Hide instance assumptions" (! ·.showInstance) fun s => { s with showInstance := !s.showInstance },
      ← setting settingsValue settingsSetter "Hide inaccessible assumptions" (! ·.showHiddenAssumption) fun s => { s with showHiddenAssumption := !s.showHiddenAssumption },
      ← setting settingsValue settingsSetter "Hide let-values" (! ·.showLetValue) fun s => { s with showLetValue := !s.showLetValue },
      ← setting settingsValue settingsSetter "Hide goal names" (·.hideGoalNames) fun s => { s with hideGoalNames := !s.hideGoalNames },
      ← setting settingsValue settingsSetter "Emphasize first goal" (·.emphasizeFirstGoal) fun s => { s with emphasizeFirstGoal := !s.emphasizeFirstGoal }
    ]
    let summary := if goalCount == 0 then "No goals" else
      s!"{goalCount} " ++ (if goalCount == 1 then "goal" else "goals")
    return ← <section className="vir-native-infoview" aria-label="VIR native Lean goals">
      <header><strong className="vir-native-infoview-summary">{Html.text summary}</strong>
        <button type="button" className="vir-native-infoview-copy link pointer dim"
            title="Copy goals" aria-label="Copy goals" onClick={copy}
            style={(← js%{ "display" := (← js#"inline-flex"), "alignItems" := (← js#"center"),
              "gap" := (← js#"4px"), "marginLeft" := (← js#"8px"), "padding" := (← js#"2px 4px"),
              "border" := (← js#"0"), "borderRadius" := (← js#"3px"),
              "background" := (← js#"transparent"),
              "color" := (← js#"var(--vscode-textLink-foreground, currentColor)"),
              "font" := (← js#"inherit"), "cursor" := (← js#"pointer") })}>
          <span className="codicon codicon-copy" aria-hidden={(← JsValue.ofBool true)}/>Copy
        </button>
        <span role="status">{Node.text copyValue}</span>
        <details className="vir-native-infoview-settings">
          <summary className="mv2 pointer non-selectable">Goal settings</summary>{controls}
        </details>
      </header>
      {cards}
    </section>

/-- The main port owns both goal presentation and interactive code in Lean. -/
def View : RuntimeM (FunctionComponent PanelWidgetProps) := do
  let Code ← InteractiveCode.View
  withCode fun value => do
    <Code fmt={value}/>

end VirNativeInfoview.GoalPanel
