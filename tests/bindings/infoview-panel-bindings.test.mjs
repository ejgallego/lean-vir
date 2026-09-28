/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

import { createInfoviewPanelBindings } from "../../web/src/host/vir-infoview-panel-bindings.js";
import { createHostLifecycle } from "../../web/src/host/vir-active-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import { HOST_IMPORT_BOUNDARY } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";

function hoverEnvironment({
  failObserve = null,
  failAdd = null,
  failDisconnect = null,
  failRemove = new Map(),
} = {}) {
  const observations = [];
  const listeners = [];
  const calls = [];
  const view = {
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        calls.push(["construct"]);
      }

      observe(element) {
        calls.push(["observe", element]);
        const failedElement = failObserve === "reference"
          ? reference
          : failObserve === "popup"
            ? popup
            : failObserve;
        if (failedElement === element) throw new Error("observe failed");
        observations.push(element);
      }

      disconnect() {
        calls.push(["disconnect"]);
        if (failDisconnect !== null) throw failDisconnect;
        observations.length = 0;
      }
    },

    addEventListener(type, listener, capture) {
      calls.push(["add", type, listener, capture]);
      if (failAdd === type) throw new Error(`${type} listener failed`);
      if (failAdd?.type === type) throw failAdd.error;
      listeners.push([type, listener, capture]);
    },

    removeEventListener(type, listener, capture) {
      calls.push(["remove", type, listener, capture]);
      const failure = failRemove.get(type);
      if (failure !== undefined) throw failure;
      const index = listeners.findIndex(entry =>
        entry[0] === type && entry[1] === listener && entry[2] === capture,
      );
      assert.notEqual(index, -1, `missing ${type} listener`);
      listeners.splice(index, 1);
    },
  };
  const reference = { ownerDocument: { defaultView: view } };
  const popup = {};
  return {
    reference,
    popup,
    view,
    observations,
    listeners,
    calls,
    state() {
      return { observations: observations.length, listeners: listeners.length };
    },
  };
}

function assertAggregateWithErrors(error, expected) {
  assert.equal(error instanceof AggregateError, true);
  for (const failure of expected) assert.ok(error.errors.includes(failure));
}

function callHoverThroughHostState({ environment, loweringError, captured, lifecycle = null }) {
  const bindings = createInfoviewPanelBindings({ lifecycle });
  const resourceType = {
    interfaceTag: INTERFACE_TAG.RESOURCE,
    kind: "resource",
    name: "Lean.Vir.Js",
  };
  const values = new Map([
    [1, environment.reference],
    [2, environment.popup],
    [3, () => undefined],
  ]);
  const hostState = new VirHostState({
    hostBindings: {
      "infoview.hover.observe": bindings["infoview.hover.observe"],
    },
    defaultHostBindings: {},
  });
  hostState.attach({ memory: new WebAssembly.Memory({ initial: 1 }) });
  hostState.attachRuntime({
    liftJsObjectValue: (_type, pointer) => values.get(pointer),
    makeJsObjectValue: (_type, value) => {
      if (captured !== undefined) captured.value = value;
      if (loweringError !== null) throw loweringError;
      return value;
    },
  });
  hostState.setManifest({
    hostImports: [{
      target: "infoview.hover.observe",
      boundary: HOST_IMPORT_BOUNDARY.HOST_RESOURCE,
      args: [
        { name: "reference", type: resourceType },
        { name: "popup", type: resourceType },
        { name: "callback", type: resourceType },
      ],
      result: resourceType,
    }],
  });
  const view = new DataView(hostState.exports.memory.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, 2, true);
  view.setUint32(12, 3, true);
  return hostState.callObjectsImpl(0, 4, 3);
}

test("hover primitives preserve DOM values and disconnect geometry observers", () => {
  const bindings = createInfoviewPanelBindings();
  const bounds = { left: 20, top: 30, width: 10, height: 12 };
  const reference = { getBoundingClientRect() { assert.equal(this, reference); return bounds; } };
  assert.equal(bindings["infoview.hover.rect"](reference), bounds);
  const event = { getModifierState(key) { assert.equal(this, event); return key === "Control"; } };
  assert.equal(bindings["infoview.hover.modifier"](event, "Control"), true);
  assert.equal(bindings["infoview.hover.modifier"](event, "Shift"), false);

  const listeners = [];
  const observed = [];
  let resize;
  let disconnected = false;
  let calls = 0;
  const view = {
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe(element) { observed.push(element); }
      disconnect() { disconnected = true; }
    },
    addEventListener(...args) { listeners.push(args); },
    removeEventListener(...args) {
      const index = listeners.findIndex(entry => entry.every((value, i) => value === args[i]));
      assert.notEqual(index, -1, "removal uses the original callback and capture flag");
      listeners.splice(index, 1);
    },
  };
  reference.ownerDocument = { defaultView: view };
  const popup = {};
  const cleanup = bindings["infoview.hover.observe"](reference, popup, value => {
    assert.equal(value, undefined);
    calls++;
  });
  assert.deepEqual(observed, [reference, popup]);
  assert.equal(listeners[1][2], true, "scroll observation includes nested scroll containers");
  resize();
  listeners[0][1]();
  assert.equal(calls, 2);
  cleanup();
  cleanup();
  assert.equal(disconnected, true);
  assert.deepEqual(listeners, []);

  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const body = { nodeType: 1 };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });
  try {
    const children = ["exact", " nodes"];
    const portal = createBrowserReactHostBindings({})["infoview.hover.portal"](children);
    assert.equal(portal.children, children);
    assert.equal(portal.containerInfo, body);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  }
});

test("hover activity follows the shared lifecycle and rejects setup during disposal", () => {
  const lifecycle = createHostLifecycle();
  const environment = hoverEnvironment();
  const bindings = createBrowserHostBindings({ lifecycle });
  const cleanup = bindings["infoview.hover.observe"](
    environment.reference,
    environment.popup,
    () => undefined,
  );
  assert.deepEqual(lifecycle.debugResourceCounts(), { active: 1 });
  cleanup();
  assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
  assert.deepEqual(environment.state(), { observations: 0, listeners: 0 });
  lifecycle.dispose();

  const disposalLifecycle = createHostLifecycle();
  const disposalEnvironment = hoverEnvironment();
  const disposalBindings = createBrowserHostBindings({
    lifecycle: disposalLifecycle,
  });
  const disposalCleanup = disposalBindings["infoview.hover.observe"](
    disposalEnvironment.reference,
    disposalEnvironment.popup,
    () => undefined,
  );
  assert.deepEqual(disposalLifecycle.debugResourceCounts(), { active: 1 });
  let reentrantError = null;
  const reentrantEnvironment = hoverEnvironment();
  disposalLifecycle.addDisposable({}, () => {
    try {
      disposalBindings["infoview.hover.observe"](
        reentrantEnvironment.reference,
        reentrantEnvironment.popup,
        () => undefined,
      );
    } catch (error) {
      reentrantError = error;
    }
  });
  disposalLifecycle.dispose();
  assert.deepEqual(disposalEnvironment.state(), { observations: 0, listeners: 0 });
  assert.deepEqual(disposalLifecycle.debugResourceCounts(), { active: 0 });
  assert.match(
    reentrantError?.message ?? "",
    /host lifecycle cannot register active resources/,
  );
  assert.deepEqual(reentrantEnvironment.calls, []);
  const callsAfterDispose = disposalEnvironment.calls.length;
  disposalCleanup();
  assert.equal(
    disposalEnvironment.calls.length,
    callsAfterDispose,
    "lifecycle disposal leaves the returned cleanup idempotent",
  );

  const rejectedEnvironment = hoverEnvironment();
  assert.throws(
    () => disposalBindings["infoview.hover.observe"](
      rejectedEnvironment.reference,
      rejectedEnvironment.popup,
      () => undefined,
    ),
    /host lifecycle cannot register active resources/,
  );
  assert.deepEqual(rejectedEnvironment.state(), { observations: 0, listeners: 0 });
  assert.deepEqual(rejectedEnvironment.calls, []);
});

test("hover setup rolls back each partial observer and listener installation", () => {
  const bindings = createInfoviewPanelBindings();
  for (const [stage, options] of [
    ["reference observation", { failObserve: "reference" }],
    ["popup observation", { failObserve: "popup" }],
    ["resize listener", { failAdd: "resize" }],
    ["scroll listener", { failAdd: "scroll" }],
  ]) {
    const environment = hoverEnvironment(options);
    assert.throws(
      () => bindings["infoview.hover.observe"](
        environment.reference,
        environment.popup,
        () => undefined,
      ),
      /failed/,
    );
    assert.deepEqual(environment.state(), { observations: 0, listeners: 0 }, stage);
    assert.equal(
      environment.calls.filter(([kind]) => kind === "disconnect").length,
      1,
      `${stage} disconnects the allocated observer`,
    );
  }
});

test("hover cleanup attempts independent releases and is idempotent after failures", () => {
  const bindings = createInfoviewPanelBindings();
  const disconnectFailure = new Error("disconnect failed");
  const resizeFailure = new Error("resize removal failed");
  const scrollFailure = new Error("scroll removal failed");
  const environment = hoverEnvironment({
    failDisconnect: disconnectFailure,
    failRemove: new Map([
      ["resize", resizeFailure],
      ["scroll", scrollFailure],
    ]),
  });
  const cleanup = bindings["infoview.hover.observe"](
    environment.reference,
    environment.popup,
    () => undefined,
  );
  let firstFailure;
  try {
    cleanup();
  } catch (error) {
    firstFailure = error;
  }
  assert.ok(firstFailure);
  assertAggregateWithErrors(firstFailure, [
    disconnectFailure,
    resizeFailure,
    scrollFailure,
  ]);
  assert.deepEqual(
    environment.calls.filter(([kind]) => kind === "remove").map(([, type]) => type),
    ["resize", "scroll"],
  );
  const callsAfterFailure = environment.calls.length;
  cleanup();
  assert.equal(environment.calls.length, callsAfterFailure, "cleanup is idempotent after errors");
});

test("hover setup preserves its error together with independent cleanup errors", () => {
  const bindings = createInfoviewPanelBindings();
  const setupFailure = new Error("scroll listener setup failed");
  const disconnectFailure = new Error("disconnect failed");
  const resizeFailure = new Error("resize removal failed");
  const environment = hoverEnvironment({
    failAdd: { type: "scroll", error: setupFailure },
    failDisconnect: disconnectFailure,
    failRemove: new Map([["resize", resizeFailure]]),
  });
  let failure;
  try {
    bindings["infoview.hover.observe"](
      environment.reference,
      environment.popup,
      () => undefined,
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.errors[0], setupFailure);
  assert.ok(failure.errors[1] instanceof AggregateError);
  assertAggregateWithErrors(failure.errors[1], [disconnectFailure, resizeFailure]);
  assert.deepEqual(
    environment.calls.filter(([kind]) => kind === "remove").map(([, type]) => type),
    ["resize"],
  );
});

test("host result lowering rolls back hover effects and later cleanup does not repeat releases", () => {
  const environment = hoverEnvironment();
  const lifecycle = createHostLifecycle();
  const loweringFailure = new Error("returned cleanup lowering failed");
  const captured = {};
  assert.throws(() => callHoverThroughHostState({
    environment,
    loweringError: loweringFailure,
    captured,
    lifecycle,
  }), error => error === loweringFailure);
  assert.equal(typeof captured.value, "function");
  assert.deepEqual(environment.state(), { observations: 0, listeners: 0 });
  assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
  const callsAfterRollback = environment.calls.length;
  captured.value();
  assert.equal(environment.calls.length, callsAfterRollback, "rollback cleanup is idempotent");
});

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
