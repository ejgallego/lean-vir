/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/**
 * Upstream infoview panel-widget bindings. The supplied functions are the
 * actual React hook and tagged-text utility from `@leanprover/infoview`.
 */
export function createInfoviewPanelBindings({
  useRpcSession = null,
  stripTags = null,
} = {}) {
  return {
    "infoview.useRpcSession": () => requireUpstream(
      useRpcSession,
      "useRpcSession",
    )(),
    "infoview.panelWidgetProps.pos": (props) => props.pos,
    "infoview.panelWidgetProps.goals": (props) => props.goals,
    "infoview.panelWidgetProps.termGoal": (props) => props.termGoal,
    "infoview.panelPosition.uri": (position) => position.uri,
    "infoview.panelPosition.line": (position) => position.line,
    "infoview.panelPosition.character": (position) => position.character,
    "infoview.interactiveGoal.hyps": (goal) => goal.hyps,
    "infoview.interactiveGoal.type": (goal) => goal.type,
    "infoview.interactiveGoal.userName": (goal) => goal.userName,
    "infoview.interactiveGoal.mvarId": (goal) => goal.mvarId,
    "infoview.interactiveGoal.isInserted": (goal) => goal.isInserted,
    "infoview.interactiveGoal.isRemoved": (goal) => goal.isRemoved,
    "infoview.interactiveTermGoal.hyps": (goal) => goal.hyps,
    "infoview.interactiveTermGoal.type": (goal) => goal.type,
    "infoview.interactiveHypothesisBundle.names": (hypothesis) => hypothesis.names,
    "infoview.interactiveHypothesisBundle.type": (hypothesis) => hypothesis.type,
    "infoview.interactiveHypothesisBundle.val": (hypothesis) => hypothesis.val,
    "infoview.codeWithInfos.stripTags": (code) => requireUpstream(
      stripTags,
      "TaggedText_stripTags",
    )(code),
  };
}

function requireUpstream(value, name) {
  if (typeof value !== "function") {
    throw new Error(
      `infoview panel bindings do not support ${name} without the upstream infoview host`,
    );
  }
  return value;
}
