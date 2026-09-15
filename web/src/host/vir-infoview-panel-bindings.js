/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createPortal } from "react-dom";

/**
 * Upstream infoview panel-widget bindings. The supplied functions are the
 * actual React hook and tagged-text utility from `@leanprover/infoview`.
 */
export function createInfoviewPanelBindings({
  useRpcSession = null,
  stripTags = null,
  editorContext = null,
  positionToTdpp = null,
  interactiveCode = null,
} = {}) {
  return {
    "infoview.hover.modifier": (event, key) => event.getModifierState(key),
    "infoview.hover.rect": element => element.getBoundingClientRect(),
    "infoview.hover.portal": node => createPortal(node, document.body),
    "infoview.hover.observe": (reference, popup, callback) => {
      const view = reference.ownerDocument.defaultView;
      const observer = new view.ResizeObserver(() => callback(undefined));
      const update = () => callback(undefined);
      observer.observe(reference);
      observer.observe(popup);
      view.addEventListener("resize", update);
      view.addEventListener("scroll", update, true);
      return () => {
        observer.disconnect();
        view.removeEventListener("resize", update);
        view.removeEventListener("scroll", update, true);
      };
    },
    "infoview.interactiveCode": () => requireUpstream(interactiveCode, "InteractiveCode"),
    "infoview.editorContext": () => {
      if (editorContext === null) {
        throw new Error("EditorContext requires the upstream infoview host");
      }
      return editorContext;
    },
    "infoview.editorConnection.api": (connection) => connection.api,
    "infoview.editorConnection.revealPosition": (connection, position) =>
      connection.revealPosition(position),
    "infoview.editorApi.copyToClipboard": (api, text) => api.copyToClipboard(text),
    "infoview.editorApi.insertText": (api, text, kind, position) =>
      api.insertText(text, kind, position),
    "infoview.panelPosition.toTdpp": (position) =>
      requireUpstream(positionToTdpp, "DocumentPosition.toTdpp")(position),
    "infoview.textInsertKind.here": () => "here",
    "infoview.textInsertKind.above": () => "above",
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
    "infoview.interactiveGoal.goalPrefix": (goal) => goal.goalPrefix,
    "infoview.interactiveTermGoal.hyps": (goal) => goal.hyps,
    "infoview.interactiveTermGoal.type": (goal) => goal.type,
    "infoview.interactiveHypothesisBundle.names": (hypothesis) => hypothesis.names,
    "infoview.interactiveHypothesisBundle.type": (hypothesis) => hypothesis.type,
    "infoview.interactiveHypothesisBundle.val": (hypothesis) => hypothesis.val,
    "infoview.interactiveHypothesisBundle.isType": (hypothesis) => hypothesis.isType,
    "infoview.interactiveHypothesisBundle.isInstance": (hypothesis) => hypothesis.isInstance,
    "infoview.interactiveHypothesisBundle.isInserted": (hypothesis) => hypothesis.isInserted,
    "infoview.interactiveHypothesisBundle.isRemoved": (hypothesis) => hypothesis.isRemoved,
    "infoview.codeWithInfos.stripTags": (code) => requireUpstream(
      stripTags,
      "TaggedText_stripTags",
    )(code),
    "infoview.codeWithInfos.text": (code) => code.text,
    "infoview.codeWithInfos.append": (code) => code.append,
    "infoview.codeWithInfos.tag": (code) => code.tag,
    "infoview.infoPopup.type": (popup) => popup.type,
    "infoview.infoPopup.exprExplicit": (popup) => popup.exprExplicit,
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
