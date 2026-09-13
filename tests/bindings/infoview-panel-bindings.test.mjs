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
    // The pinned infoview declarations predate React 19's namespaced JSX types.
    declare global { namespace JSX { type Element = import('react').ReactElement; } }
    import { CodeWithInfos, InteractiveGoal, InteractiveTermGoal,
      InteractiveHypothesisBundle } from '@leanprover/infoview-api';
    import { TaggedText_stripTags } from '@leanprover/infoview-api';
    export function panel(p: PanelWidgetProps):
        [string, number, number, InteractiveGoal[], InteractiveTermGoal | undefined] {
      return [p.pos.uri, p.pos.line, p.pos.character, p.goals, p.termGoal];
    }
    export function goal(g: InteractiveGoal):
        [InteractiveHypothesisBundle[], CodeWithInfos, string | undefined,
         string | undefined, boolean | undefined, boolean | undefined] {
      return [g.hyps, g.type, g.userName, g.mvarId, g.isInserted, g.isRemoved];
    }
    export function term(g: InteractiveTermGoal): [InteractiveHypothesisBundle[], CodeWithInfos] {
      return [g.hyps, g.type];
    }
    export function hyp(h: InteractiveHypothesisBundle):
        [string[], CodeWithInfos, CodeWithInfos | undefined] {
      return [h.names, h.type, h.val];
    }
    export const text = (code: CodeWithInfos): string => TaggedText_stripTags(code);
    export const session = () => useRpcSession();
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
});
