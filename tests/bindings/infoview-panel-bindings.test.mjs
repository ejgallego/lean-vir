/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

import { createInfoviewPanelBindings } from "../../web/src/host/vir-infoview-panel-bindings.js";

test("panel projections match the pinned upstream TypeScript shapes", () => {
  const diagnostics = typeScriptDiagnostics(`
    import { PanelWidgetProps } from '../../node_modules/@leanprover/infoview/dist/infoview/userWidget';
    import { useRpcSession } from '../../node_modules/@leanprover/infoview/dist/infoview/rpcSessions';
    import { InteractiveCode, InteractiveCodeProps } from '../../node_modules/@leanprover/infoview/dist/infoview/interactiveCode';
    // The pinned infoview declarations predate React 19's namespaced JSX types.
    declare global { namespace JSX { type Element = import('react').ReactElement; } }
    import { CodeWithInfos, InfoPopup, SubexprInfo, InteractiveGoal, InteractiveTermGoal,
      InteractiveHypothesisBundle } from '@leanprover/infoview-api';
    import { TaggedText_stripTags } from '@leanprover/infoview-api';
    export function panel(p: PanelWidgetProps):
        [string, number, number, InteractiveGoal[], InteractiveTermGoal | undefined] {
      return [p.pos.uri, p.pos.line, p.pos.character, p.goals, p.termGoal];
    }
    export function goal(g: InteractiveGoal):
        [InteractiveHypothesisBundle[], CodeWithInfos, string | undefined,
         string | undefined, boolean | undefined, boolean | undefined, string | undefined] {
      return [g.hyps, g.type, g.userName, g.mvarId, g.isInserted, g.isRemoved, g.goalPrefix];
    }
    export function term(g: InteractiveTermGoal): [InteractiveHypothesisBundle[], CodeWithInfos] {
      return [g.hyps, g.type];
    }
    export function hyp(h: InteractiveHypothesisBundle):
        [string[], CodeWithInfos, CodeWithInfos | undefined,
         boolean | undefined, boolean | undefined, boolean | undefined, boolean | undefined] {
      return [h.names, h.type, h.val, h.isType, h.isInstance, h.isInserted, h.isRemoved];
    }
    export const text = (code: CodeWithInfos): string => TaggedText_stripTags(code);
    export function tagged(code: CodeWithInfos):
      [string | undefined, CodeWithInfos[] | undefined, [SubexprInfo, CodeWithInfos] | undefined] {
      return ['text' in code ? code.text : undefined,
        'append' in code ? code.append : undefined, 'tag' in code ? code.tag : undefined];
    }
    export function popup(p: InfoPopup): [CodeWithInfos | undefined, CodeWithInfos | undefined] {
      return [p.type, p.exprExplicit];
    }
    export const session = () => useRpcSession();
    export const component: (props: InteractiveCodeProps) => JSX.Element = InteractiveCode;
    export const codeProps = (fmt: CodeWithInfos): InteractiveCodeProps => ({ fmt });
  `);
  assert.deepEqual(diagnostics.map(d => String(d.messageText)), []);
});

test("panel bindings preserve native props, optional fields, and nested values", () => {
  const session = { call() {} };
  const position = { uri: "file:///Example.lean", line: 3.5, character: -1 };
  const type = { tag: [{ info: true }, { text: "Nat" }] };
  const value = { append: [{ text: "2" }] };
  const hypothesis = { names: ["n"], type, val: value };
  const goal = {
    hyps: [hypothesis], type, userName: undefined, mvarId: "goal",
    isInserted: false, isRemoved: undefined,
  };
  const termGoal = { hyps: [hypothesis], type };
  const props = { pos: position, goals: [goal], termGoal };
  const seen = [];
  const bindings = createInfoviewPanelBindings({
    useRpcSession: () => session,
    stripTags: (code) => { seen.push(code); return "Nat"; },
  });

  assert.equal(bindings["infoview.useRpcSession"](), session);
  assert.equal(bindings["infoview.panelWidgetProps.pos"](props), position);
  assert.equal(bindings["infoview.panelWidgetProps.goals"](props), props.goals);
  assert.equal(bindings["infoview.panelWidgetProps.termGoal"](props), termGoal);
  assert.equal(bindings["infoview.panelPosition.uri"](position), position.uri);
  assert.equal(bindings["infoview.panelPosition.line"](position), 3.5);
  assert.equal(bindings["infoview.panelPosition.character"](position), -1);
  assert.equal(bindings["infoview.interactiveGoal.hyps"](goal), goal.hyps);
  assert.equal(bindings["infoview.interactiveGoal.type"](goal), type);
  assert.equal(bindings["infoview.interactiveGoal.userName"](goal), undefined);
  assert.equal(bindings["infoview.interactiveGoal.mvarId"](goal), "goal");
  assert.equal(bindings["infoview.interactiveGoal.isInserted"](goal), false);
  assert.equal(bindings["infoview.interactiveGoal.isRemoved"](goal), undefined);
  assert.equal(bindings["infoview.interactiveTermGoal.hyps"](termGoal), termGoal.hyps);
  assert.equal(bindings["infoview.interactiveTermGoal.type"](termGoal), type);
  assert.equal(bindings["infoview.interactiveHypothesisBundle.names"](hypothesis), hypothesis.names);
  assert.equal(bindings["infoview.interactiveHypothesisBundle.type"](hypothesis), type);
  assert.equal(bindings["infoview.interactiveHypothesisBundle.val"](hypothesis), value);
  assert.equal(bindings["infoview.codeWithInfos.stripTags"](type), "Nat");
  assert.deepEqual(seen, [type]);
});

test("panel bindings report unavailable upstream hooks explicitly", () => {
  const bindings = createInfoviewPanelBindings();
  assert.throws(() => bindings["infoview.useRpcSession"](), /upstream infoview host/);
  assert.throws(() => bindings["infoview.codeWithInfos.stripTags"]({ text: "x" }), /upstream infoview host/);
  assert.throws(() => bindings["infoview.interactiveCode"](), /InteractiveCode.*upstream infoview host/);
});

test("external InteractiveCode retrieval preserves identity without invoking the component", () => {
  const component = () => { throw new Error("React alone must invoke this component"); };
  const bindings = createInfoviewPanelBindings({ interactiveCode: component });
  assert.equal(bindings["infoview.interactiveCode"](), component);
  assert.equal(bindings["infoview.interactiveCode"](), component);
  assert.throws(() => createInfoviewPanelBindings({ interactiveCode: {} })["infoview.interactiveCode"](),
    /upstream infoview host/);
});

test("goal presentation fields preserve absence, false, empty prefixes and host errors", () => {
  const bindings = createInfoviewPanelBindings();
  const prefix = bindings["infoview.interactiveGoal.goalPrefix"];
  assert.equal(prefix({}), undefined);
  assert.equal(prefix({ goalPrefix: "" }), "");
  assert.equal(prefix({ goalPrefix: "⊢? " }), "⊢? ");
  const failure = new Error("native field getter failed");
  for (const field of ["isType", "isInstance", "isInserted", "isRemoved"]) {
    const get = bindings[`infoview.interactiveHypothesisBundle.${field}`];
    for (const value of [undefined, false, true]) {
      assert.equal(get(Object.freeze({ [field]: value })), value);
    }
    assert.equal(get(Object.freeze({})), undefined);
    assert.throws(() => get({ get [field]() { throw failure; } }), error => error === failure);
  }
});

test("tagged-code projections retain exact union payloads and popup references", () => {
  const bindings = createInfoviewPanelBindings();
  const text = Object.freeze({ text: "" });
  const reference = Object.freeze({ p: "server-owned" });
  const tag = Object.freeze([{ info: reference }, text]);
  const tagged = Object.freeze({ tag });
  const append = Object.freeze([text, tagged]);
  const appended = Object.freeze({ append });
  for (const code of [text, tagged, appended]) {
    for (const field of ["text", "append", "tag"]) {
      assert.equal(bindings[`infoview.codeWithInfos.${field}`](code), code[field]);
    }
  }
  const popup = Object.freeze({ type: tagged, exprExplicit: appended });
  assert.equal(bindings["infoview.infoPopup.type"](popup), tagged);
  assert.equal(bindings["infoview.infoPopup.exprExplicit"](popup), appended);
  assert.equal(bindings["infoview.infoPopup.type"]({}), undefined);
});
