/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntime,
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import {
  createHostResourceState,
} from "../../web/src/host/vir-host-resources.js";
import {
  createHostResource,
  registerHostResourcePayloadLifetime,
  releaseHostResource,
  releaseHostResourcePayload,
} from "../../web/src/host-resource.js";
import {
  createBrowserHostBindings,
  createCommonHostBindings,
} from "../../web/src/vir-host-bindings.js";
import {
  createBrowserReactHookRuntime,
  createReactJsValueHostBindings,
  createReactStateHostBindings,
  createVirtualReactHookRuntime,
} from "../../web/src/react/vir-react-hooks.js";
import {
  createReactNodeResource,
  disposeReactNode,
} from "../../web/src/react/vir-react-node.js";
import {
  assert,
  readRuntimeArtifacts,
} from "./shared.mjs";
import {
  ensureVirtualElements,
} from "../virtual-fixtures.mjs";
import {
  smokeVirtualReactAttributes,
  smokeVirtualReactChangeInput,
  smokeVirtualReactCheckbox,
  smokeVirtualReactCounter,
  smokeVirtualReactEffect,
  smokeVirtualReactMemo,
  smokeVirtualReactMemoStable,
  smokeVirtualReactRefFragment,
  smokeVirtualReactInput,
  smokeVirtualProofWidgetsHtml,
  smokeVirtualProofWidgetsJsxSubset,
  smokeVirtualReactProofWidget,
  smokeVirtualReactProofWidgetHello,
  smokeVirtualReactSelectTextarea,
  smokeVirtualReactTamagotchi,
} from "../virtual-react-smoke-scenarios.mjs";

const { wasmBytes, hostPackageBytes, defaultPackageBytes } = await readRuntimeArtifacts();

const browserBindingsWithReact = createBrowserHostBindings({
  reactHostBindings: {
    "react.root.create": () => undefined,
  },
});
assert.equal(typeof browserBindingsWithReact["browser.document.getTitle"], "function");
assert.equal(typeof browserBindingsWithReact["react.root.create"], "function");
assert.throws(
  () => createBrowserHostBindings({ reactHostBindings: "react.root.create" }),
  /reactHostBindings must be a host binding object/,
);

function createReactStateSmokeBindings() {
  const resources = createHostResourceState();
  return {
    resources,
    jsBindings: createReactJsValueHostBindings(resources),
    stateBindings: createReactStateHostBindings(resources, {
      useState() {
        throw new Error("useState should not be called by this smoke");
      },
    }),
  };
}

function assertNatResourceReleased(jsBindings, resource) {
  assert.throws(() => jsBindings["js.nat.value"](resource), /Js resource is not live/);
}

function createTestLeanRefCell(label) {
  const cell = { label, aliases: new Set(), released: false };
  const createAlias = () => {
    if (cell.released) {
      throw new Error(`${label} has been released`);
    }
    let live = true;
    const alias = Object.freeze({ cell });
    cell.aliases.add(alias);
    registerHostResourcePayloadLifetime(alias, {
      retain: () => {
        if (!live) throw new Error(`${label} alias has been released`);
        return createAlias();
      },
      release: () => {
        if (!live) return false;
        live = false;
        cell.aliases.delete(alias);
        if (cell.aliases.size === 0) cell.released = true;
        return true;
      },
    });
    return alias;
  };
  return { cell, alias: createAlias() };
}

function testLeanRefResource(alias, label) {
  return createHostResource(alias, label, {
    dispose: () => releaseHostResourcePayload(alias),
  });
}

function releasableCallback(callback) {
  let released = false;
  return Object.assign(callback, {
    release() {
      if (released) return false;
      released = true;
      return true;
    },
    get released() {
      return released;
    },
  });
}

function callbackLease(cell, body = () => undefined) {
  let released = false;
  const callback = Object.assign((...args) => body(...args), {
    retain() {
      if (released) throw new Error("callback lease has been released");
      return callbackLease(cell, body);
    },
    release() {
      if (released) return false;
      released = true;
      cell.active--;
      return true;
    },
    get released() {
      return released;
    },
  });
  cell.active++;
  return callback;
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);

  const conversionCell = { active: 0 };
  const conversionSource = callbackLease(conversionCell);
  const abandonedHandler = bindings["js.value.react.eventHandler"]({
    name: "onClick",
    callback: conversionSource,
  });
  assert.equal(conversionSource.release(), false);
  assert.equal(conversionCell.active, 1);
  state.resources.releaseResource(abandonedHandler);
  assert.equal(conversionCell.active, 0, "an abandoned event-handler conversion must release its callback");

  const builderCell = { active: 0 };
  const handler = bindings["js.value.react.eventHandler"]({
    name: "onClick",
    callback: callbackLease(builderCell),
  });
  const props = bindings["react.props.empty"]();
  bindings["react.props.setEventHandler"](props, handler);
  assert.equal(builderCell.active, 2);
  state.resources.releaseResource(handler);
  assert.equal(builderCell.active, 1);
  state.resources.releaseResource(props);
  assert.equal(builderCell.active, 0, "an abandoned props builder must release retained callbacks");
  assert.deepEqual(state.resources.debugResourceCounts(), {
    passiveStrong: 0,
    scoped: 0,
    temporaryScopes: 0,
    owners: 0,
  });
  state.resources.dispose();
}

{
  const resources = createHostResourceState();
  const cell = { active: 0 };
  const nodeValue = createReactNodeResource(resources, {
    node: { kind: "text", value: "unrendered" },
    callbacks: [callbackLease(cell)],
  });
  const node = resources.adoptResourceForValue(nodeValue, { tracked: false });
  assert.equal(cell.active, 1);
  assert.equal(resources.debugResourceCounts().owners, 0);
  resources.releaseResource(node);
  assert.equal(cell.active, 0, "dropping an unrendered node wrapper must release its callbacks");
  assert.equal(nodeValue.finalized, true);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const releases = [];
  const callback = (label, shouldThrow = false) => Object.assign(() => undefined, {
    release() {
      releases.push(label);
      if (shouldThrow) throw new Error(`${label} release boom`);
      return true;
    },
  });
  const child = createReactNodeResource(resources, {
    node: { kind: "text", value: "child" },
    callbacks: [callback("child")],
  });
  const parent = createReactNodeResource(resources, {
    node: { kind: "element" },
    childEntries: [{ value: child }],
    callbacks: [callback("first", true), callback("second")],
  });
  releaseHostResourcePayload(child);
  assert.throws(() => disposeReactNode(resources, parent), /first release boom/);
  assert.deepEqual(releases, ["first", "second", "child"]);
  assert.deepEqual(resources.debugResourceCounts(), {
    passiveStrong: 0,
    scoped: 0,
    temporaryScopes: 0,
    owners: 0,
  });
  assert.doesNotThrow(() => disposeReactNode(resources, parent));
  resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  const container = state.resources.resourceForValue({ kind: "root alias container" });
  const first = bindings["react.root.create"](container);
  const second = bindings["react.root.create"](container);
  const rootValue = state.resources.resolveResource(first, "ReactRoot");
  assert.equal(state.resources.resolveResource(second, "ReactRoot"), rootValue);
  bindings["react.root.unmount"](first);
  assert.throws(() => state.resources.resolveResource(first, "ReactRoot"), /resource is not live/);
  assert.throws(() => state.resources.resolveResource(second, "ReactRoot"), /resource is not live/);
  assert.throws(() => rootValue.render(null), /React root has been unmounted/);
  state.resources.releaseResource(container);
  state.resources.dispose();
}

{
  const { resources, jsBindings, stateBindings } = createReactStateSmokeBindings();
  const retainedZero = resources.resourceForValue(0n);
  let stateValue = 0n;
  const setter = resources.resourceForValue({
    set(next) {
      stateValue = typeof next === "function" ? next(stateValue) : next;
    },
  });
  const scopedBeforeModify = resources.debugResourceCounts().scoped;
  let released = false;
  let previousResource = null;
  let nextResource = null;
  const updater = Object.assign((previous) => {
    previousResource = previous;
    assert.equal(jsBindings["js.nat.value"](previous), 0n);
    nextResource = jsBindings["js.nat"](1n);
    return nextResource;
  }, {
    release() {
      released = true;
    },
  });
  stateBindings["react.state.modify"](setter, updater);
  assert.equal(stateValue, 1n);
  assert.equal(released, true);
  assertNatResourceReleased(jsBindings, previousResource);
  assertNatResourceReleased(jsBindings, nextResource);
  assert.equal(resources.resolveResource(retainedZero, "Js"), 0n);
  assert.notEqual(resources.resourceForValue(0n), retainedZero);
  assert.equal(resources.debugResourceCounts().scoped, scopedBeforeModify);
  resources.releaseResource(setter);
  resources.releaseResource(retainedZero);
}

{
  const { resources, stateBindings } = createReactStateSmokeBindings();
  const deps = stateBindings["react.deps.empty"]();
  const objectDependency = { marker: "dependency" };
  stateBindings["react.deps.push"](deps, resources.resourceForValue(false));
  stateBindings["react.deps.push"](deps, resources.resourceForValue(objectDependency));
  assert.deepEqual(resources.resolveResource(deps, "ReactDependencyList").values, [false, objectDependency]);
  assert.throws(
    () => stateBindings["react.deps.push"](deps, resources.resourceForValue(null)),
    /React dependency\[2\] resource is not live/,
  );
  resources.dispose();
}

{
  const { resources, jsBindings, stateBindings } = createReactStateSmokeBindings();
  let stateValue = 2n;
  const setter = resources.resourceForValue({
    set(next) {
      stateValue = typeof next === "function" ? next(stateValue) : next;
    },
  });
  const scopedBeforeModify = resources.debugResourceCounts().scoped;
  let released = false;
  let previousResource = null;
  let nextResource = null;
  const updater = Object.assign((previous) => {
    previousResource = previous;
    assert.equal(jsBindings["js.nat.value"](previous), 2n);
    nextResource = jsBindings["js.nat"](3n);
    throw new Error("state updater failed");
  }, {
    release() {
      released = true;
    },
  });
  assert.throws(
    () => stateBindings["react.state.modify"](setter, updater),
    /state updater failed/,
  );
  assert.equal(stateValue, 2n);
  assert.equal(released, true);
  assertNatResourceReleased(jsBindings, previousResource);
  assertNatResourceReleased(jsBindings, nextResource);
  assert.equal(resources.debugResourceCounts().scoped, scopedBeforeModify);
  resources.releaseResource(setter);
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const initial = createTestLeanRefCell("virtual state initial");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let state;
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](initialResource);
  });
  hooks.commitComponentRender(component);
  assert.equal(initial.cell.aliases.size, 2);
  releaseHostResource(initialResource);
  assert.equal(initial.cell.aliases.size, 1);

  const exposed = bindings["react.state.value"](state);
  assert.equal(initial.cell.aliases.size, 2);
  releaseHostResource(exposed);
  assert.equal(initial.cell.aliases.size, 1);

  const setter = bindings["react.state.setter"](state);
  const replacement = createTestLeanRefCell("virtual state replacement");
  const replacementResource = testLeanRefResource(replacement.alias, replacement.cell.label);
  bindings["react.state.set"](setter, replacementResource);
  assert.equal(initial.cell.aliases.size, 0);
  assert.equal(replacement.cell.aliases.size, 2);
  releaseHostResource(replacementResource);
  assert.equal(replacement.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(replacement.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const initial = createTestLeanRefCell("virtual ref initial");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let ref;
  hooks.withComponentRender(component, () => {
    ref = bindings["react.useRef"](initialResource);
  });
  hooks.commitComponentRender(component);
  releaseHostResource(initialResource);
  assert.equal(initial.cell.aliases.size, 1);
  const exposed = bindings["react.ref.get"](ref);
  assert.equal(initial.cell.aliases.size, 2);
  releaseHostResource(exposed);

  const replacement = createTestLeanRefCell("virtual ref replacement");
  const replacementResource = testLeanRefResource(replacement.alias, replacement.cell.label);
  bindings["react.ref.set"](ref, replacementResource);
  assert.equal(initial.cell.aliases.size, 0);
  releaseHostResource(replacementResource);
  assert.equal(replacement.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(replacement.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const deps = bindings["react.deps.empty"]();
  const memo = createTestLeanRefCell("virtual memo result");
  const calculate = releasableCallback(() => testLeanRefResource(memo.alias, memo.cell.label));
  let result;
  hooks.withComponentRender(component, () => {
    result = bindings["react.useMemo"](calculate, deps);
  });
  hooks.commitComponentRender(component);
  assert.equal(memo.cell.aliases.size, 2);
  releaseHostResource(result);
  assert.equal(memo.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(memo.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const initial = createTestLeanRefCell("virtual reducer initial");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let reduced = null;
  const reducer = releasableCallback(() => {
    reduced = createTestLeanRefCell("virtual reducer result");
    return testLeanRefResource(reduced.alias, reduced.cell.label);
  });
  let state;
  hooks.withComponentRender(component, () => {
    state = bindings["react.useReducer"](reducer, initialResource);
  });
  hooks.commitComponentRender(component);
  releaseHostResource(initialResource);
  assert.equal(initial.cell.aliases.size, 1);
  const dispatch = bindings["react.reducerState.dispatch"](state);
  const action = createTestLeanRefCell("virtual reducer action");
  const actionResource = testLeanRefResource(action.alias, action.cell.label);
  bindings["react.reducer.dispatch"](dispatch, actionResource);
  assert.equal(initial.cell.aliases.size, 0);
  assert.equal(action.cell.aliases.size, 1);
  assert.equal(reduced.cell.aliases.size, 1);
  releaseHostResource(actionResource);
  assert.equal(action.cell.aliases.size, 0);
  hooks.disposeComponent(component);
  assert.equal(reduced.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const reactState = { initialized: false, value: undefined };
  const setState = (next) => {
    reactState.value = typeof next === "function" ? next(reactState.value) : next;
  };
  const hooks = createBrowserReactHookRuntime(resources, {
    useState(initial) {
      if (!reactState.initialized) {
        reactState.initialized = true;
        reactState.value = initial;
      }
      return [reactState.value, setState];
    },
    useLayoutEffect(effect) {
      effect();
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const initial = createTestLeanRefCell("browser state initial");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let state;
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](initialResource);
    hooks.commitComponentRender(component);
  });
  releaseHostResource(initialResource);
  assert.equal(initial.cell.aliases.size, 1);

  const setter = bindings["react.state.setter"](state);
  const replacement = createTestLeanRefCell("browser state replacement");
  const replacementResource = testLeanRefResource(replacement.alias, replacement.cell.label);
  bindings["react.state.set"](setter, replacementResource);
  releaseHostResource(replacementResource);
  assert.equal(initial.cell.aliases.size, 1);
  assert.equal(replacement.cell.aliases.size, 1);

  const ignoredInitial = createTestLeanRefCell("browser ignored initial");
  const ignoredInitialResource = testLeanRefResource(ignoredInitial.alias, ignoredInitial.cell.label);
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](ignoredInitialResource);
    hooks.commitComponentRender(component);
  });
  releaseHostResource(ignoredInitialResource);
  assert.equal(ignoredInitial.cell.aliases.size, 0);
  assert.equal(initial.cell.aliases.size, 0);
  assert.equal(replacement.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(replacement.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const passiveEffects = [];
  const layoutEffects = [];
  const hooks = createBrowserReactHookRuntime(resources, {
    useEffect(effect) {
      passiveEffects.push(effect);
    },
    useLayoutEffect(effect) {
      layoutEffects.push(effect);
    },
  });
  const component = hooks.createComponentState();
  const setupCell = { active: 0 };
  const cleanupCell = { active: 0 };
  let setups = 0;
  let cleanups = 0;
  hooks.withComponentRender(component, () => {
    hooks.useEffect(
      callbackLease(setupCell, () => ({ generation: ++setups })),
      callbackLease(cleanupCell, () => {
        cleanups++;
      }),
    );
    hooks.commitComponentRender(component);
  });
  assert.equal(layoutEffects.length, 1);
  layoutEffects[0]();
  layoutEffects[0]();
  assert.equal(passiveEffects.length, 1);
  const firstCleanup = passiveEffects[0]();
  firstCleanup();
  const secondCleanup = passiveEffects[0]();
  secondCleanup();
  assert.equal(setups, 2, "Strict Mode effect setup replay must use a fresh callback lease");
  assert.equal(cleanups, 2);
  assert.equal(setupCell.active, 1);
  assert.equal(cleanupCell.active, 1);
  hooks.disposeComponent(component);
  assert.equal(setupCell.active, 0);
  assert.equal(cleanupCell.active, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const jsBindings = createReactJsValueHostBindings(resources);
  let stateValue = 0n;
  let functionalUpdaterPassedToReact = false;
  const setState = (next) => {
    if (typeof next === "function") functionalUpdaterPassedToReact = true;
    stateValue = next;
  };
  const hooks = createBrowserReactHookRuntime(resources, {
    useState(initial) {
      if (stateValue === undefined) stateValue = initial;
      return [stateValue, setState];
    },
    useLayoutEffect(effect) {
      effect();
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  let state;
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](resources.resourceForValue(0n));
    hooks.commitComponentRender(component);
  });
  const setter = bindings["react.state.setter"](state);
  const updaterCell = { active: 0 };
  let updaterCalls = 0;
  const updater = callbackLease(updaterCell, (previous) => {
    updaterCalls++;
    return jsBindings["js.nat"](jsBindings["js.nat.value"](previous) + 1n);
  });
  bindings["react.state.modify"](setter, updater);
  assert.equal(updaterCalls, 1);
  assert.equal(functionalUpdaterPassedToReact, false);
  assert.equal(stateValue, 1n);
  assert.equal(updaterCell.active, 0);
  hooks.disposeComponent(component);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const jsBindings = createReactJsValueHostBindings(resources);
  const layoutEffects = [];
  let stateValue = 2n;
  let functionalUpdaterPassedToReact = false;
  const hooks = createBrowserReactHookRuntime(resources, {
    useState() {
      return [stateValue, (next) => {
        if (typeof next === "function") functionalUpdaterPassedToReact = true;
        stateValue = next;
      }];
    },
    useLayoutEffect(effect) {
      layoutEffects.push(effect);
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const reducerCell = { active: 0 };
  let reducerCalls = 0;
  let reducerState;
  hooks.withComponentRender(component, () => {
    reducerState = bindings["react.useReducer"](
      callbackLease(reducerCell, (previous, action) => {
        reducerCalls++;
        return jsBindings["js.nat"](
          jsBindings["js.nat.value"](previous) + jsBindings["js.nat.value"](action),
        );
      }),
      resources.resourceForValue(2n),
    );
    hooks.commitComponentRender(component);
  });
  const dispatch = bindings["react.reducerState.dispatch"](reducerState);
  assert.throws(
    () => bindings["react.reducer.dispatch"](dispatch, resources.resourceForValue(3n)),
    /dispatch is not available/,
  );
  assert.equal(reducerCalls, 0, "a reducer must remain inert before commit");
  layoutEffects[0]();
  bindings["react.reducer.dispatch"](dispatch, resources.resourceForValue(3n));
  assert.equal(reducerCalls, 1);
  assert.equal(functionalUpdaterPassedToReact, false);
  assert.equal(stateValue, 5n);
  hooks.disposeComponent(component);
  assert.equal(reducerCell.active, 0);
  resources.dispose();
}

const reactDocumentState = createVirtualDocumentState();
const reactRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: reactDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": () => undefined,
  },
});
ensureVirtualElements(reactDocumentState, [
  "#react-static",
  "#react-counter",
  "#react-effect",
  "#react-memo",
  "#react-memo-stable",
  "#react-ref-fragment",
  "#react-input",
  "#react-change",
  "#react-select-textarea",
  "#react-checkbox",
  "#react-attributes",
  "#proofwidgets-html",
  "#proofwidgets-jsx-subset",
  "#react-proof-hello",
  "#react-proof",
  "#react-pet",
  "#react-unmount",
  "#react-stale-root",
  "#react-too-deep",
  "#react-dispose",
]);
assert.equal(reactRuntime.call("ReactCounter.renderStatic", "#react-static"), true);
assert.equal(reactDocumentState.elements.get("#react-static").textContent, "react:static");
assert.equal(reactRuntime.liveCallbacks.size, 0);
const missingSelectorDocumentState = createVirtualDocumentState();
const missingSelectorRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: missingSelectorDocumentState,
});
assert.equal(missingSelectorRuntime.call("ReactCounter.mount", "#missing-react-root"), false);
assert.equal(missingSelectorRuntime.liveCallbacks.size, 0);
missingSelectorRuntime.dispose();
smokeVirtualReactCounter(reactRuntime, reactDocumentState, "#react-counter");
smokeVirtualReactEffect(reactRuntime, reactDocumentState, "#react-effect");
smokeVirtualReactMemo(reactRuntime, reactDocumentState, "#react-memo");
smokeVirtualReactMemoStable(reactRuntime, reactDocumentState, "#react-memo-stable");
smokeVirtualReactRefFragment(reactRuntime, reactDocumentState, "#react-ref-fragment");
smokeVirtualReactInput(reactRuntime, reactDocumentState, "#react-input");
smokeVirtualReactChangeInput(reactRuntime, reactDocumentState, "#react-change");
smokeVirtualReactSelectTextarea(reactRuntime, reactDocumentState, "#react-select-textarea");
smokeVirtualReactCheckbox(reactRuntime, reactDocumentState, "#react-checkbox");
smokeVirtualReactAttributes(reactRuntime, reactDocumentState, "#react-attributes", { assertKeys: true });
smokeVirtualProofWidgetsHtml(reactRuntime, reactDocumentState, "#proofwidgets-html");
smokeVirtualProofWidgetsJsxSubset(reactRuntime, reactDocumentState, "#proofwidgets-jsx-subset");
await smokeVirtualReactProofWidgetHello(reactRuntime, reactDocumentState, "#react-proof-hello");
await smokeVirtualReactProofWidget(reactRuntime, reactDocumentState, "#react-proof");
await smokeVirtualReactTamagotchi(reactRuntime, reactDocumentState, "#react-pet", { extended: true });
assert.equal(reactRuntime.call("ReactCounter.mountAndUnmount", "#react-unmount"), true);
assert.equal(reactRuntime.liveCallbacks.size, 0);
assert.equal(reactDocumentState.elements.get("#react-unmount").reactRoot, undefined);
assert.throws(
  () => reactRuntime.call("ReactCounter.renderAfterUnmount", "#react-stale-root"),
  /react\.root\.render argument root did not lift to a live host resource/,
);
assert.equal(reactRuntime.liveCallbacks.size, 0);
assert.throws(
  () => reactRuntime.call("ReactCounter.renderTooDeep", "#react-too-deep"),
  /React Node exceeds maximum depth 128/,
);
assert.equal(reactRuntime.liveCallbacks.size, 0);

const malformedReactDocumentState = createVirtualDocumentState();
ensureVirtualElementState(malformedReactDocumentState, "#react-malformed");
const malformedReactHost = createVirtualDocumentHostBindings(malformedReactDocumentState);
const malformedReactCommonHost = createCommonHostBindings(malformedReactDocumentState.resources);
const malformedReactContainer = malformedReactCommonHost["js.nullable.value"](
  malformedReactHost["browser.document.querySelector"](
    malformedReactDocumentState.resources.resourceForValue("#react-malformed"),
  ),
);
const malformedReactRoot = malformedReactHost["react.root.create"](malformedReactContainer);
const malformedReactJsString = (value) => malformedReactDocumentState.resources.resourceForValue(value);
const reactElementTypeTag = (value) =>
  malformedReactHost["react.elementType.tag"](malformedReactJsString(value));
const renderMalformedReactNode = (node) => {
  let released = false;
  const render = Object.assign(() => node, {
    release: () => {
      released = true;
      return true;
    },
  });
  try {
    return malformedReactHost["react.root.render"](malformedReactRoot, render);
  } finally {
    assert.equal(released, true);
  }
};
{
  let called = false;
  let released = false;
  const render = Object.assign(() => {
    called = true;
    throw new Error("render callback should not be invoked for a stale root");
  }, {
    release: () => {
      released = true;
      return true;
    },
  });
  assert.throws(
    () => malformedReactHost["react.root.render"]({}, render),
    /ReactRoot resource is not live/,
  );
  assert.equal(called, false);
  assert.equal(released, true);
}
const reactNodeText = (value) => malformedReactHost["react.node.text"](malformedReactJsString(value));
const reactNodeProperty = (value) => malformedReactHost["js.value.react.property"](value);
const reactNodeEventHandler = (value) => malformedReactHost["js.value.react.eventHandler"](value);
const reactNodeProps = ({ key = null, ref = null, props = [], handlers = [] } = {}) => {
  const resource = malformedReactHost["react.props.empty"]();
  if (key !== null && key !== undefined) {
    malformedReactHost["react.props.setKey"](
      resource,
      typeof key === "string" ? malformedReactJsString(key) : key,
    );
  }
  if (ref !== null && ref !== undefined) {
    malformedReactHost["react.props.setRef"](resource, ref);
  }
  for (const prop of props) {
    malformedReactHost["react.props.setProperty"](resource, reactNodeProperty(prop));
  }
  for (const handler of handlers) {
    malformedReactHost["react.props.setEventHandler"](resource, reactNodeEventHandler(handler));
  }
  return resource;
};
const reactNodeChildren = (children = []) => {
  const resource = malformedReactHost["react.node.children.empty"]();
  for (const child of children) {
    malformedReactHost["react.node.children.push"](resource, child);
  }
  return resource;
};
const reactNodeElement = ({
  tag = "div",
  key = null,
  ref = null,
  props = [],
  handlers = [],
  children = [],
} = {}) => malformedReactHost["react.node.createElement"](
  typeof tag === "string" ? reactElementTypeTag(tag) : tag,
  reactNodeProps({ key, ref, props, handlers }),
  reactNodeChildren(children),
);
const renderReactNodeElement = (fields) => renderMalformedReactNode(reactNodeElement(fields));
const reactNodeRef = (current = null) => malformedReactDocumentState.resources.resourceForValue({ current });
renderReactNodeElement({
  ref: reactNodeRef("mounted"),
  props: [
    { name: "tabIndex", value: { kind: "int", value: "4" } },
    { name: "data-ratio", value: { kind: "float", value: 1.5 } },
    { name: "className", value: { kind: "classList", value: ["alpha", "beta", "alpha"] } },
    { name: "style", value: { kind: "style", value: [{ name: "marginTop", value: "1px" }] } },
  ],
});
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.tabIndex, 4);
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props["data-ratio"], 1.5);
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.className, "alpha beta");
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.style.marginTop, "1px");
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.ref.current, "mounted");
assert.throws(
  () => reactNodeText(1),
  /React Node text value must be a Js String/,
);
assert.throws(
  () => malformedReactHost["react.node.createElement"](
    malformedReactJsString("div"),
    reactNodeProps(),
    reactNodeChildren(),
  ),
  /React Node element type must be wrapped with react.elementType.tag/,
);
assert.throws(
  () => malformedReactHost["react.node.createElement"](
    malformedReactDocumentState.resources.resourceForValue({ component: true }),
    reactNodeProps(),
    reactNodeChildren(),
  ),
  /React Node element type must be a React element type/,
);
assert.throws(
  () => malformedReactHost["react.node.createElement"](
    reactElementTypeTag("div"),
    reactNodeProps(),
    malformedReactJsString("children"),
  ),
  /ReactNodeChildren resource has invalid value/,
);
assert.throws(
  () => renderReactNodeElement({ children: [{}] }),
  /React Node child\[0\] resource is not live/,
);
assert.throws(
  () => renderReactNodeElement({ tag: "" }),
  /React Node element type tag must be a non-empty string/,
);
assert.throws(
  () => renderReactNodeElement({ key: malformedReactDocumentState.resources.resourceForValue(7) }),
  /React Node element key must be a Js String/,
);
assert.throws(
  () => renderReactNodeElement({ ref: malformedReactJsString("not-a-ref") }),
  /React Node element ref must be a React ref object or null/,
);
assert.throws(
  () => renderMalformedReactNode(
    malformedReactHost["react.node.fragment"](
      reactNodeProps({ ref: reactNodeRef() }),
      reactNodeChildren(),
    ),
  ),
  /React Fragment props only support key/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: 1, value: { kind: "string", value: "bad" } }],
  }),
  /React Node property name must be a non-empty string/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "data-", value: { kind: "string", value: "bad" } }],
  }),
  /React Node data-\* property name must include a suffix/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "__proto__", value: { kind: "string", value: "bad" } }],
  }),
  /React Node property name is not supported/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "title", value: { kind: "string", value: false } }],
  }),
  /React PropValue\.string value must be a string/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "hidden", value: { kind: "bool", value: "false" } }],
  }),
  /React PropValue\.bool value must be a boolean/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "tabIndex", value: { kind: "int", value: "7.5" } }],
  }),
  /React PropValue\.int value must be a safe integer/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "tabIndex", value: { kind: "int", value: "9007199254740992" } }],
  }),
  /React PropValue\.int value must be a safe integer/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "value", value: { kind: "float", value: "1.5" } }],
  }),
  /React PropValue\.float value must be a finite number/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "title", value: { kind: "style", value: [] } }],
  }),
  /React PropValue\.style is only supported for the style prop/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "style", value: { kind: "style", value: "margin-top: 1px" } }],
  }),
  /React PropValue\.style value must be an array/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "style", value: { kind: "style", value: ["marginTop"] } }],
  }),
  /React PropValue\.style\[0\] must be an object/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "", value: "1px" }] } }],
  }),
  /React PropValue\.style\[0\]\.name must be a non-empty string/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "__proto__", value: "1px" }] } }],
  }),
  /React PropValue\.style\[0\]\.name is not supported/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "marginTop", value: 1 }] } }],
  }),
  /React PropValue\.style\[0\]\.value must be a string/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "title", value: { kind: "classList", value: [] } }],
  }),
  /React PropValue\.classList is only supported for the className prop/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "className", value: { kind: "classList", value: "alpha beta" } }],
  }),
  /React PropValue\.classList value must be an array/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "className", value: { kind: "classList", value: ["ok", ""] } }],
  }),
  /React PropValue\.classList\[1\] must be a non-empty token without whitespace/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "className", value: { kind: "classList", value: ["ok", "bad token"] } }],
  }),
  /React PropValue\.classList\[1\] must be a non-empty token without whitespace/,
);
assert.throws(
  () => renderReactNodeElement({
    props: [{ name: "data-x", value: { kind: "number", value: 1 } }],
  }),
  /React PropValue must be string, bool, int, float, style, or classList/,
);
assert.throws(
  () => renderReactNodeElement({
    handlers: [{ name: 1, callback: Object.assign(() => undefined, { release: () => undefined }) }],
  }),
  /React Node event handler name must be a non-empty string/,
);
assert.throws(
  () => renderReactNodeElement({
    handlers: [{ name: "__proto__", callback: Object.assign(() => undefined, { release: () => undefined }) }],
  }),
  /React Node event handler name is not supported/,
);
assert.throws(
  () => renderReactNodeElement({
    handlers: [{ name: "onClick" }],
  }),
  /React Node event handler callback must be a releasable function/,
);

assert.equal(reactRuntime.call("ReactCounter.mount", "#react-dispose"), true);
assert.equal(reactRuntime.liveCallbacks.size, 2);
reactRuntime.dispose();
assert.equal(reactRuntime.liveCallbacks.size, 0);
assert.throws(() => reactRuntime.call("ReactCounter.mount", "#react-disposed"), /disposed/);

const reactReloadDocumentState = createVirtualDocumentState();
const reactReloadRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState: reactReloadDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": () => undefined,
  },
});
ensureVirtualElementState(reactReloadDocumentState, "#react-reload");
assert.equal(reactReloadRuntime.call("ReactCounter.mount", "#react-reload"), true);
assert.equal(reactReloadRuntime.liveCallbacks.size, 2);
reactReloadRuntime.loadIrPackageSetBytes([defaultPackageBytes]);
assert.equal(reactReloadRuntime.liveCallbacks.size, 0);
assert.equal(reactReloadDocumentState.elements.get("#react-reload").reactRoot, undefined);
reactReloadRuntime.dispose();

console.log("vir runtime React host bindings smoke ok");
