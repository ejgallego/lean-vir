/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview
public import Vir.ProofWidgets.Jsx

public section

namespace VirNativeInfoview

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.Infoview
open Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

namespace Style

def vscodeColor (name fallback : String) : String :=
  "var(--vscode-" ++ name ++ ", " ++ fallback ++ ")"

def border (color : String) : String :=
  "1px solid " ++ color

def foreground : String := vscodeColor "editor-foreground" "#24292f"
def muted : String := vscodeColor "descriptionForeground" "#57606a"
def background : String := vscodeColor "editor-background" "#ffffff"
def codeBackground : String := vscodeColor "textCodeBlock-background" "#f6f8fa"
def borderColor : String := vscodeColor "panel-border" "#d0d7de"
def accent : String := vscodeColor "textLink-foreground" "#0969da"
def goalAccent : String := vscodeColor "symbolIcon-keywordForeground" "#8250df"

def shell : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gap" := (← js#"10px"), "minWidth" := (← js#"0"),
  "padding" := (← js#"8px 10px 12px"), "background" := (← JsValue.ofString background),
  "color" := (← JsValue.ofString foreground), "colorScheme" := (← js#"light dark"),
  "fontFamily" := (← js#"Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif")
}

def toolbar : RuntimeM Js.Object := js%{
  "display" := (← js#"flex"), "alignItems" := (← js#"baseline"),
  "justifyContent" := (← js#"space-between"), "gap" := (← js#"8px"),
  "flexWrap" := (← js#"wrap"), "paddingBottom" := (← js#"7px"),
  "borderBottom" := (← JsValue.ofString (border borderColor))
}

def title : RuntimeM Js.Object := js%{
  "margin" := (← js#"0"), "fontSize" := (← js#"0.82rem"), "fontWeight" := (← js#"760")
}

def summary : RuntimeM Js.Object := js%{
  "margin" := (← js#"0"), "color" := (← JsValue.ofString muted),
  "fontSize" := (← js#"0.68rem"), "fontWeight" := (← js#"620")
}

def goalList : RuntimeM Js.Object := js%{ "display" := (← js#"grid"), "gap" := (← js#"10px") }

def goalCard : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gap" := (← js#"8px"), "minWidth" := (← js#"0"),
  "padding" := (← js#"9px"), "border" := (← JsValue.ofString (border borderColor)),
  "borderLeft" := (← JsValue.ofString ("3px solid " ++ goalAccent)), "borderRadius" := (← js#"5px"),
  "background" := (← JsValue.ofString background)
}

def goalHeader : RuntimeM Js.Object := js%{
  "display" := (← js#"flex"), "alignItems" := (← js#"center"),
  "justifyContent" := (← js#"space-between"), "gap" := (← js#"8px")
}

def goalHeading : RuntimeM Js.Object := js%{
  "margin" := (← js#"0"), "minWidth" := (← js#"0"), "fontSize" := (← js#"0.76rem"),
  "fontWeight" := (← js#"760"), "overflowWrap" := (← js#"anywhere")
}

def collapseButton : RuntimeM Js.Object := js%{
  "flex" := (← js#"0 0 auto"), "minWidth" := (← js#"25px"), "height" := (← js#"24px"),
  "padding" := (← js#"0 6px"), "border" := (← JsValue.ofString (border borderColor)),
  "borderRadius" := (← js#"4px"), "background" := (← JsValue.ofString codeBackground),
  "color" := (← JsValue.ofString foreground), "font" := (← js#"inherit"),
  "fontSize" := (← js#"0.7rem"), "cursor" := (← js#"pointer")
}

def context : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gap" := (← js#"4px"), "margin" := (← js#"0"),
  "padding" := (← js#"0"), "listStyle" := (← js#"none")
}

def hypothesis : RuntimeM Js.Object := js%{
  "display" := (← js#"flex"), "alignItems" := (← js#"baseline"), "gap" := (← js#"5px"),
  "minWidth" := (← js#"0"), "padding" := (← js#"2px 4px"),
  "fontFamily" := (← js#"ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  "fontSize" := (← js#"0.73rem"), "lineHeight" := (← js#"1.4")
}

def binder : RuntimeM Js.Object := js%{
  "flex" := (← js#"0 0 auto"), "color" := (← JsValue.ofString accent), "fontWeight" := (← js#"700")
}

def hypothesisType : RuntimeM Js.Object := js%{
  "minWidth" := (← js#"0"), "overflowWrap" := (← js#"anywhere")
}

def value : RuntimeM Js.Object := js%{
  "minWidth" := (← js#"0"), "color" := (← JsValue.ofString muted), "overflowWrap" := (← js#"anywhere")
}

def target : RuntimeM Js.Object := js%{
  "display" := (← js#"grid"), "gridTemplateColumns" := (← js#"auto minmax(0, 1fr)"),
  "alignItems" := (← js#"baseline"), "gap" := (← js#"7px"), "padding" := (← js#"7px 8px"),
  "borderRadius" := (← js#"4px"), "background" := (← JsValue.ofString codeBackground),
  "fontFamily" := (← js#"ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"),
  "fontSize" := (← js#"0.75rem"), "lineHeight" := (← js#"1.42")
}

def turnstile : RuntimeM Js.Object := js%{
  "color" := (← JsValue.ofString goalAccent), "fontWeight" := (← js#"800")
}

def targetCode : RuntimeM Js.Object := js%{
  "minWidth" := (← js#"0"), "overflowWrap" := (← js#"anywhere"), "whiteSpace" := (← js#"pre-wrap")
}

def empty : RuntimeM Js.Object := js%{
  "margin" := (← js#"0"), "padding" := (← js#"12px"),
  "border" := (← JsValue.ofString ("1px dashed " ++ borderColor)), "borderRadius" := (← js#"5px"),
  "color" := (← JsValue.ofString muted), "fontSize" := (← js#"0.76rem")
}

end Style

def plural (count : Nat) (one many : String) : String :=
  if count == 1 then one else many

/-- Plain text is intentional in this compact demonstration; tags stay native until this call. -/
def plainCode (code : Js CodeWithInfos) : ReactM (Js String) := do
  CodeWithInfos.stripTags code

structure HypothesisProps where
  hypothesis : Js InteractiveHypothesisBundle
  goalIndex : Nat
  index : Nat

def hypothesisNames (hypothesis : Js InteractiveHypothesisBundle) (fallback : String) : ReactM String := do
  let names ← Js.Array.toLeanArray (← InteractiveHypothesisBundle.names hypothesis)
  let names ← names.mapM fun name => do JsValue.toString name
  pure <| if names.isEmpty then fallback else " ".intercalate names.toList

def HypothesisRow : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData HypothesisProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
    let data ← Lean.Vir.React.Props.WithData.data nativeProps
    let props ← Lean.Vir.LeanRef.fromJSL data
    let hypothesis := props.hypothesis
    let id := s!"{props.goalIndex}-{props.index}"
    let names ← hypothesisNames hypothesis s!"hypothesis {props.index + 1}"
    let hypothesisType ← plainCode (← InteractiveHypothesisBundle.type hypothesis)
    let value? ← Js.UndefinedOr.toOption (← InteractiveHypothesisBundle.val hypothesis)
    let value ← value?.mapM plainCode
    let valueNodes : Array Html := (value.map fun value => #[do
      <span className="vir-native-infoview-hyp-value" style={(← Style.value)}> := {Lean.Vir.React.Node.text value}</span>
    ]).getD #[]
    return ← <li id={(← JsValue.ofString ("vir-native-infoview-hyp-" ++ id))}
        className="vir-native-infoview-hypothesis" role="listitem" style={(← Style.hypothesis)}><span
          className="vir-native-infoview-hyp-name" style={(← Style.binder)}>{Lean.Vir.React.Node.text
            (← JsValue.ofString names)}</span><span aria-hidden={(← JsValue.ofBool true)}>:</span><code
          className="vir-native-infoview-hyp-type" style={(← Style.hypothesisType)}>{Lean.Vir.React.Node.text
            hypothesisType}</code>{...valueNodes}</li>

structure TacticGoalCardProps where
  goal : Js InteractiveGoal
  index : Nat
  key : String

structure TermGoalCardProps where
  goal : Js InteractiveTermGoal
  index : Nat

def tacticGoalName (goal : Js InteractiveGoal) (index : Nat) : ReactM String := do
  let userName? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
  match userName? with
  | none => pure s!"goal {index + 1}"
  | some userName => pure ("case " ++ (← JsValue.toString userName))

def tacticGoalKey (goal : Js InteractiveGoal) (index : Nat) : ReactM String := do
  let mvarId? ← Js.UndefinedOr.toOption (← InteractiveGoal.mvarId goal)
  match mvarId? with
  | some mvarId => JsValue.toString mvarId
  | none =>
    let userName? ← Js.UndefinedOr.toOption (← InteractiveGoal.userName goal)
    match userName? with
    | some userName => JsValue.toString userName
    | none => pure s!"goal-{index}"

def optionalFlag (flag : Js.UndefinedOr Bool) : ReactM Bool := do
  match ← Js.UndefinedOr.toOption flag with
  | none => pure false
  | some flag => JsValue.toBool flag

def tacticGoalStatus (goal : Js InteractiveGoal) : ReactM String := do
  if ← optionalFlag (← InteractiveGoal.isRemoved goal) then
    pure "removed"
  else if ← optionalFlag (← InteractiveGoal.isInserted goal) then
    pure "inserted"
  else
    pure "active"

def positionLabel (position : Js PanelPosition) : ReactM String := do
  let uri ← JsValue.toString (← PanelPosition.uri position)
  let line ← JsValue.toFloat (← PanelPosition.line position)
  let character ← JsValue.toFloat (← PanelPosition.character position)
  pure s!"{uri}:{line.toUInt64.toNat + 1}:{character.toUInt64.toNat + 1}"

def GoalCardBody
    (goalId goalKey title status : String)
    (index : Nat)
    (hypotheses : Array (Js InteractiveHypothesisBundle))
    (target : Js CodeWithInfos)
    (HypothesisRowComponent : Lean.Vir.React.FunctionComponent
      (Lean.Vir.React.Props.WithData HypothesisProps)) : ReactM (Js Lean.Vir.React.Node) := do
  let initialCollapsed ← JsValue.ofBool false
  let collapsedState ← Lean.Vir.React.StateTuple.toState
    (← Lean.Vir.React.Hooks.useState initialCollapsed)
  let collapsed ← JsValue.toBool collapsedState.value
  let detailsId := s!"vir-native-infoview-goal-{goalId}-details"
  let toggle ← Lean.Vir.React.Callback.ofUnary fun (_ : Js Lean.Vir.Browser.Event) => do
    let next ← JsValue.ofBool (!collapsed)
    Lean.Vir.React.State.set collapsedState next
  let hypothesisNodes ← hypotheses.mapIdxM fun hypothesisIndex hypothesis => do
    let props ← Lean.Vir.React.Props.WithData.make
      (← Lean.Vir.LeanRef.toJSL { hypothesis, goalIndex := index, index := hypothesisIndex })
    Lean.Vir.Js.Object.set (Lean.Vir.React.Props.WithData.asProps props) (← js#"key")
      (← JsValue.ofString s!"{goalId}-{hypothesisIndex}")
    return ← <HypothesisRowComponent @props={props}/>
  let context : Html := if hypothesisNodes.isEmpty then
    <p className="vir-native-infoview-no-hypotheses" style={(← Style.empty)}>No local hypotheses.</p>
  else
    <ul id={(← JsValue.ofString detailsId)} className="vir-native-infoview-context" role="list"
        aria-label="Local hypotheses" style={(← Style.context)}>{...hypothesisNodes.map pure}</ul>
  let targetText ← plainCode target
  let target : Html := <div className="vir-native-infoview-target" style={(← Style.target)}><span
      className="vir-native-infoview-turnstile" aria-hidden={(← JsValue.ofBool true)}
      style={(← Style.turnstile)}>⊢</span><code id={(← JsValue.ofString s!"vir-native-infoview-goal-{goalId}-target")}
      className="vir-native-infoview-target-code" style={(← Style.targetCode)}>{Lean.Vir.React.Node.text targetText}</code></div>
  let details : Array Html := if collapsed then #[] else #[context, target]
  let heading : Html := <h3 className="vir-native-infoview-goal-heading" style={(← Style.goalHeading)}>
    {Lean.Vir.React.Node.text (← JsValue.ofString title)}
  </h3>
  let collapseButton : Html := <button id={(← JsValue.ofString s!"vir-native-infoview-goal-{goalId}-collapse")}
      className="vir-native-infoview-collapse" type="button"
      title={(← JsValue.ofString (if collapsed then "Expand goal" else "Collapse goal"))}
      aria-label={(← JsValue.ofString (if collapsed then "Expand goal" else "Collapse goal"))}
      aria-expanded={(← JsValue.ofBool (!collapsed))} aria-controls={(← JsValue.ofString detailsId)}
      onClick={toggle} style={(← Style.collapseButton)}>
    {Lean.Vir.React.Node.text (← JsValue.ofString (if collapsed then "+" else "−"))}
  </button>
  let header : Html := <header className="vir-native-infoview-goal-header" style={(← Style.goalHeader)}>
    {heading}{collapseButton}
  </header>
  return ← <article id={(← JsValue.ofString s!"vir-native-infoview-goal-{goalId}")}
      className="vir-native-infoview-goal" data-goal-id={(← JsValue.ofString goalId)}
      data-goal-key={(← JsValue.ofString goalKey)} data-goal-status={(← JsValue.ofString status)}
      style={(← Style.goalCard)}>{header}{...details}</article>

def TacticGoalCard : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData TacticGoalCardProps)) := do
  let HypothesisRowComponent ← HypothesisRow
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
    let data ← Lean.Vir.React.Props.WithData.data nativeProps
    let props ← Lean.Vir.LeanRef.fromJSL data
    let title ← tacticGoalName props.goal props.index
    let status ← tacticGoalStatus props.goal
    let hypotheses ← Js.Array.toLeanArray (← InteractiveGoal.hyps props.goal)
    let target ← InteractiveGoal.type props.goal
    GoalCardBody s!"goal-{props.index}" props.key title status props.index hypotheses target HypothesisRowComponent

def TermGoalCard : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData TermGoalCardProps)) := do
  let HypothesisRowComponent ← HypothesisRow
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
    let data ← Lean.Vir.React.Props.WithData.data nativeProps
    let props ← Lean.Vir.LeanRef.fromJSL data
    let hypotheses ← Js.Array.toLeanArray (← InteractiveTermGoal.hyps props.goal)
    let target ← InteractiveTermGoal.type props.goal
    GoalCardBody s!"term-{props.index}" "term" "Term goal" "term" props.index hypotheses target HypothesisRowComponent

def View : RuntimeM (Lean.Vir.React.FunctionComponent PanelWidgetProps) := do
  let TacticGoalCardComponent ← TacticGoalCard
  let TermGoalCardComponent ← TermGoalCard
  Lean.Vir.React.FunctionComponent.ofLean fun props => do
    let position ← PanelWidgetProps.pos props
    let captionPosition ← positionLabel position
    let tacticGoals ← Js.Array.toLeanArray (← PanelWidgetProps.goals props)
    let termGoal? ← Js.UndefinedOr.toOption (← PanelWidgetProps.termGoal props)
    let tacticNodes ← tacticGoals.mapIdxM fun index goal => do
      let key ← tacticGoalKey goal index
      let cardProps ← Lean.Vir.React.Props.WithData.make
        (← Lean.Vir.LeanRef.toJSL { goal, index, key })
      Lean.Vir.Js.Object.set (Lean.Vir.React.Props.WithData.asProps cardProps) (← js#"key")
        (← JsValue.ofString key)
      return ← <TacticGoalCardComponent @props={cardProps}/>
    let termNodes : Array Html := (termGoal?.map fun goal => #[
      (do
        let cardProps ← Lean.Vir.React.Props.WithData.make
          (← Lean.Vir.LeanRef.toJSL { goal, index := tacticGoals.size })
        Lean.Vir.Js.Object.set (Lean.Vir.React.Props.WithData.asProps cardProps) (← js#"key")
          (← JsValue.ofString s!"term-{tacticGoals.size}")
        return ← <TermGoalCardComponent @props={cardProps}/>)
    ]).getD #[]
    let goals := tacticNodes.map pure ++ termNodes
    let goalCount := goals.size
    let body : Html := if goals.isEmpty then
      <p id="vir-native-infoview-empty" className="vir-native-infoview-empty" style={(← Style.empty)}>
        {Lean.Vir.React.Node.text (← JsValue.ofString ("No goals at " ++ captionPosition ++ "."))}
      </p>
    else
      <div id="vir-native-infoview-goals" className="vir-native-infoview-goals" style={(← Style.goalList)}>
        {...goals}
      </div>
    let heading : Html := <h2 className="vir-native-infoview-title" style={(← Style.title)}>Goals</h2>
    let summary : Html := <p id="vir-native-infoview-summary" className="vir-native-infoview-summary"
        style={(← Style.summary)}>
      {Lean.Vir.React.Node.text (← JsValue.ofString
        (s!"{goalCount} " ++ plural goalCount "goal" "goals" ++ " · " ++ captionPosition))}
    </p>
    let toolbar : Html := <header className="vir-native-infoview-toolbar" style={(← Style.toolbar)}>
      {heading}{summary}
    </header>
    return ← <section id="vir-native-infoview" className="vir-native-infoview" role="region"
        aria-label="VIR native Lean goals" style={(← Style.shell)}>{toolbar}{body}</section>

vir_proof_widget View

end VirNativeInfoview

/-!
This is a VIR-native React implementation of the goal and local-context part
of Lean's infoview. It receives the real panel props, keeps the upstream goal,
hypothesis, and tagged-code objects as JavaScript values, and converts tagged
code to text only at the explicit display boundary.
-/

show_panel_widgets [local Lean.Vir.Infoview.widget with VirNativeInfoview.widgetProps]

section Playground

theorem virNativeInfoview_and_comm (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq

end Playground
