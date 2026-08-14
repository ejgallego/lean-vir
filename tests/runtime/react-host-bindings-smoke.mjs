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
  createReactHostHooks,
  createReactRootResourceHostBindings,
} from "../../web/src/host/vir-host-resources.js";
import {
  abandonHostResource,
  commitHostResource,
  createHostResource,
  hostResourceValue,
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
  createBrowserReactNodeElementResource,
  createBrowserReactRootResource,
  createReactNodeResource,
  createVirtualReactRootResource,
  disposeReactNode,
} from "../../web/src/react/vir-react-node.js";
import {
  assert,
  readRuntimeArtifacts,
  spawnSync,
} from "./shared.mjs";
import {
  ensureVirtualElements,
} from "../support/virtual-fixtures.mjs";
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
} from "../support/virtual-react-smoke-scenarios.mjs";

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

for (const missingCapability of ["FinalizationRegistry", "WeakRef"]) {
  const missingFinalizationSupport = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      globalThis[${JSON.stringify(missingCapability)}] = undefined;
      const { createBrowserReactHostBindings } = await import("./web/src/vir-react-host-bindings.js");
      try {
        createBrowserReactHostBindings();
        process.stdout.write("created");
      } catch (error) {
        process.stdout.write(error instanceof Error ? error.message : String(error));
      }
    `,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(missingFinalizationSupport.status, 0, missingFinalizationSupport.stderr);
  assert.match(
    missingFinalizationSupport.stdout,
    /browser React host bindings require FinalizationRegistry and WeakRef support/,
  );
}

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
    scoped: 0,
    temporaryScopes: 0,
    owners: 0,
  });
  state.resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createReactHostHooks({ resources });
  const bindings = {
    ...createReactJsValueHostBindings(resources),
    ...createReactRootResourceHostBindings(resources, () => {
      throw new Error("React root creation must not run");
    }, {
      createNodeElementResource: (elementType, props, children) =>
        createBrowserReactNodeElementResource(
          resources,
          () => { throw new Error("React.createElement boom"); },
          hooks,
          elementType,
          props,
          children,
        ),
    }),
  };
  const cell = { active: 0 };
  const handler = bindings["js.value.react.eventHandler"]({
    name: "onClick",
    callback: callbackLease(cell),
  });
  const props = bindings["react.props.empty"]();
  bindings["react.props.setEventHandler"](props, handler);
  resources.releaseResource(handler);
  assert.equal(cell.active, 1);
  const elementType = bindings["react.elementType.tag"](resources.resourceForValue("button"));
  const children = bindings["react.node.children.empty"]();
  assert.throws(
    () => bindings["react.node.createElement"](elementType, props, children),
    /React\.createElement boom/,
  );
  assert.equal(cell.active, 1, "React.createElement failure must release its newly acquired callback lease");
  resources.releaseResource(props);
  assert.equal(cell.active, 0);
  resources.releaseResource(elementType);
  resources.releaseResource(children);
  resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  const cell = { active: 0 };
  const childValue = createReactNodeResource(state.resources, {
    node: { kind: "text", value: "parent-first reusable child" },
    callbacks: [callbackLease(cell)],
  });
  const child = state.resources.adoptResourceForValue(childValue, { tracked: false });
  const elementType = bindings["react.elementType.tag"](state.resources.resourceForValue("div"));
  const props = bindings["react.props.empty"]();

  const firstChildren = bindings["react.node.children.empty"]();
  bindings["react.node.children.push"](firstChildren, child);
  const firstParent = bindings["react.node.createElement"](elementType, props, firstChildren);
  state.resources.releaseResource(firstParent);
  assert.equal(childValue.finalized, false, "a parent must not consume its borrowed child wrapper");
  assert.equal(state.resources.resolveResource(child, "ReactNode"), childValue);

  const secondChildren = bindings["react.node.children.empty"]();
  bindings["react.node.children.push"](secondChildren, child);
  const secondParent = bindings["react.node.createElement"](elementType, props, secondChildren);
  state.resources.releaseResource(child);
  assert.equal(childValue.finalized, false, "the second parent must retain the child independently");
  state.resources.releaseResource(secondParent);
  assert.equal(childValue.finalized, true);
  assert.equal(cell.active, 0);

  state.resources.releaseResource(firstChildren);
  state.resources.releaseResource(secondChildren);
  state.resources.releaseResource(props);
  state.resources.releaseResource(elementType);
  state.resources.dispose();
}

{
  const resources = createHostResourceState();
  let unmounts = 0;
  const bindings = createReactRootResourceHostBindings(resources, () => ({
    unmount() {
      unmounts++;
    },
  }));
  const container = resources.resourceForValue({ kind: "staged root alias container" });
  const committedRoot = bindings["react.root.create"](container);
  commitHostResource(committedRoot);
  const stagedAlias = bindings["react.root.create"](container);
  abandonHostResource(stagedAlias);
  assert.equal(unmounts, 0, "abandoning a new alias must not unmount an existing committed root");
  assert.doesNotThrow(() => resources.resolveResource(committedRoot, "ReactRoot"));
  bindings["react.root.unmount"](committedRoot);
  assert.equal(unmounts, 1);

  const stagedRoot = bindings["react.root.create"](container);
  abandonHostResource(stagedRoot);
  assert.equal(unmounts, 2, "abandoning a newly created root must roll back that root");
  assert.throws(() => resources.resolveResource(stagedRoot, "ReactRoot"), /resource is not live/);
  resources.releaseResource(container);
  resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  const callbackCell = { active: 0 };
  const handler = bindings["js.value.react.eventHandler"]({
    name: "onClick",
    callback: callbackLease(callbackCell),
  });
  const props = bindings["react.props.empty"]();
  bindings["react.props.setEventHandler"](props, handler);
  state.resources.releaseResource(handler);
  assert.equal(callbackCell.active, 1, "the reusable props builder must own one callback lease");

  const elementType = bindings["react.elementType.tag"](state.resources.resourceForValue("button"));
  const firstChildren = bindings["react.node.children.empty"]();
  const secondChildren = bindings["react.node.children.empty"]();
  const first = bindings["react.node.createElement"](elementType, props, firstChildren);
  const second = bindings["react.node.createElement"](elementType, props, secondChildren);
  assert.equal(callbackCell.active, 3, "two nodes and their reusable props must own independent callback leases");

  state.resources.releaseResource(props);
  assert.equal(callbackCell.active, 2, "releasing props must preserve both node callback leases");
  state.resources.releaseResource(second);
  assert.equal(callbackCell.active, 1, "releasing one node must preserve its sibling callback lease");
  state.resources.releaseResource(first);
  assert.equal(callbackCell.active, 0);
  state.resources.releaseResource(firstChildren);
  state.resources.releaseResource(secondChildren);
  state.resources.releaseResource(elementType);
  state.resources.dispose();
}

{
  const resources = createHostResourceState();
  const selector = resources.resourceForValue("[invalid");
  const selectorCell = { active: 0 };
  const throwingSelectorBindings = createReactRootResourceHostBindings(
    resources,
    () => { throw new Error("root factory must not run"); },
    { querySelector: () => { throw new Error("selector parse boom"); } },
  );
  assert.throws(
    () => throwingSelectorBindings["react.root.renderComponentIntoSelector"](
      selector,
      callbackLease(selectorCell),
    ),
    /selector parse boom/,
  );
  assert.equal(selectorCell.active, 0, "selector parsing failure must release the transferred component callback");

  const creationCell = { active: 0 };
  const throwingRootBindings = createReactRootResourceHostBindings(
    resources,
    () => { throw new Error("root creation boom"); },
    { querySelector: () => ({}) },
  );
  assert.throws(
    () => throwingRootBindings["react.root.renderComponentIntoSelector"](
      selector,
      callbackLease(creationCell),
    ),
    /root creation boom/,
  );
  assert.equal(creationCell.active, 0, "root creation failure must release the transferred component callback");

  const staleRootCell = { active: 0 };
  assert.throws(
    () => throwingSelectorBindings["react.root.renderComponent"](
      {},
      callbackLease(staleRootCell),
    ),
    /ReactRoot resource is not live/,
  );
  assert.equal(staleRootCell.active, 0, "stale direct roots must release the transferred component callback");
  resources.releaseResource(selector);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const newContainer = { kind: "new selector render container" };
  const existingContainer = { kind: "existing selector render container" };
  let unmounts = 0;
  const bindings = createReactRootResourceHostBindings(
    resources,
    (container) => {
      let mounted = true;
      const root = {
        render() {
          throw new Error(`selector render boom: ${container.kind}`);
        },
        unmount() {
          if (!mounted) return undefined;
          mounted = false;
          unmounts++;
          resources.removeDisposable(root);
          return undefined;
        },
      };
      resources.addDisposable(root);
      return root;
    },
    {
      querySelector: (selector) => selector === "#new" ? newContainer : existingContainer,
    },
  );
  const node = resources.resourceForValue({ kind: "borrowed selector render node" });
  const newSelector = resources.resourceForValue("#new");
  assert.throws(
    () => bindings["react.root.renderIntoSelector"](newSelector, node),
    /selector render boom: new selector render container/,
  );
  assert.equal(unmounts, 1, "a failed first render must unmount its newly created root");
  assert.equal(resources.debugResourceCounts().owners, 0);
  assert.doesNotThrow(() => resources.resolveResource(node, "ReactNode"));

  const existingContainerResource = resources.resourceForValue(existingContainer);
  const existingRoot = bindings["react.root.create"](existingContainerResource);
  commitHostResource(existingRoot);
  const existingSelector = resources.resourceForValue("#existing");
  assert.throws(
    () => bindings["react.root.renderIntoSelector"](existingSelector, node),
    /selector render boom: existing selector render container/,
  );
  assert.equal(unmounts, 1, "a failed render must not roll back a pre-existing root");
  assert.equal(resources.debugResourceCounts().owners, 1);
  bindings["react.root.unmount"](existingRoot);
  assert.equal(unmounts, 2);
  assert.equal(resources.debugResourceCounts().owners, 0);
  resources.releaseResource(existingContainerResource);
  resources.releaseResource(existingSelector);
  resources.releaseResource(newSelector);
  resources.releaseResource(node);
  resources.dispose();
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
  assert.equal(
    resources.debugResourceCounts().owners,
    1,
    "an untracked wrapper must leave one wrapper-independent release ticket",
  );
  resources.releaseResource(node);
  assert.equal(cell.active, 0, "dropping an unrendered node wrapper must release its callbacks");
  assert.equal(nodeValue.finalized, true);
  assert.equal(resources.debugResourceCounts().owners, 0);
  resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  const cell = { active: 0 };
  const childValue = createReactNodeResource(state.resources, {
    node: { kind: "text", value: "retained child" },
    callbacks: [callbackLease(cell)],
  });
  const child = state.resources.adoptResourceForValue(childValue, { tracked: false });
  const children = bindings["react.node.children.empty"]();
  bindings["react.node.children.push"](children, child);
  state.resources.releaseResource(child);
  assert.equal(childValue.finalized, false);
  assert.equal(cell.active, 1, "a child builder must retain a pushed node independently of its wrapper");

  const elementType = bindings["react.elementType.tag"](state.resources.resourceForValue("div"));
  const props = bindings["react.props.empty"]();
  const parent = bindings["react.node.createElement"](elementType, props, children);
  state.resources.releaseResource(parent);
  assert.equal(childValue.finalized, true);
  assert.equal(cell.active, 0, "successful node creation must transfer and eventually release builder-owned children");
  state.resources.releaseResource(children);
  state.resources.releaseResource(props);
  state.resources.releaseResource(elementType);
  state.resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  const cell = { active: 0 };
  const childValue = createReactNodeResource(state.resources, {
    node: { kind: "text", value: "reusable child" },
    callbacks: [callbackLease(cell)],
  });
  const child = state.resources.adoptResourceForValue(childValue, { tracked: false });
  const elementType = bindings["react.elementType.tag"](state.resources.resourceForValue("div"));
  const props = bindings["react.props.empty"]();

  const firstChildren = bindings["react.node.children.empty"]();
  bindings["react.node.children.push"](firstChildren, child);
  const firstParent = bindings["react.node.createElement"](elementType, props, firstChildren);
  assert.equal(
    state.resources.resolveResource(child, "ReactNode"),
    childValue,
    "successful parent creation must preserve the borrowed child wrapper",
  );

  const secondChildren = bindings["react.node.children.empty"]();
  bindings["react.node.children.push"](secondChildren, child);
  const secondParent = bindings["react.node.createElement"](elementType, props, secondChildren);

  const missingSelector = state.resources.resourceForValue("#missing-reusable-child-root");
  const rendered = bindings["react.root.renderIntoSelector"](missingSelector, child);
  assert.equal(state.resources.resolveResource(rendered, "JsBool"), false);
  assert.equal(
    state.resources.resolveResource(child, "ReactNode"),
    childValue,
    "a missing selector must not consume its borrowed node argument",
  );
  state.resources.releaseResource(rendered);
  state.resources.releaseResource(missingSelector);

  disposeReactNode(state.resources, child);
  assert.throws(() => state.resources.resolveResource(child, "ReactNode"), /resource is not live/);
  assert.equal(childValue.finalized, false, "releasing a borrowed alias must not revoke parent-owned payloads");
  state.resources.releaseResource(firstParent);
  assert.equal(childValue.finalized, false, "a sibling parent must retain its shared child");
  state.resources.releaseResource(secondParent);
  assert.equal(childValue.finalized, true);
  assert.equal(cell.active, 0);

  state.resources.releaseResource(firstChildren);
  state.resources.releaseResource(secondChildren);
  state.resources.releaseResource(props);
  state.resources.releaseResource(elementType);
  state.resources.dispose();
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
    scoped: 0,
    temporaryScopes: 0,
    owners: 0,
  });
  assert.doesNotThrow(() => disposeReactNode(resources, parent));
  resources.dispose();
}

{
  const calls = [];
  const reported = [];
  const resources = createHostResourceState();
  const hooks = createReactHostHooks({
    resources,
    reportError: (error) => reported.push(error),
  });
  hooks.beginReactNodeEventCallback();
  hooks.deferReactNodeDispose(() => {
    calls.push("first");
    throw new Error("first deferred cleanup boom");
  });
  hooks.deferReactNodeDispose(() => calls.push("second"));
  hooks.endReactNodeEventCallback();
  assert.throws(() => hooks.flushReactNodeDisposals(), /first deferred cleanup boom/);
  assert.deepEqual(calls, ["first", "second"], "a throwing disposer must not skip its siblings");

  hooks.deferReactNodeDispose(() => {
    calls.push("microtask-first");
    throw new Error("microtask deferred cleanup boom");
  });
  hooks.deferReactNodeDispose(() => calls.push("microtask-second"));
  await Promise.resolve();
  assert.deepEqual(calls, ["first", "second", "microtask-first", "microtask-second"]);
  assert.equal(reported.length, 1);
  assert.match(reported[0].message, /microtask deferred cleanup boom/);
  resources.dispose();
}

{
  const calls = [];
  const reported = [];
  const resources = createHostResourceState();
  const hooks = createReactHostHooks({
    resources,
    reportError: (error) => reported.push(error),
  });
  hooks.deferReactNodeDispose(() => {
    calls.push("dispose-first");
    throw new Error("dispose deferred cleanup boom");
  });
  hooks.deferReactNodeDispose(() => calls.push("dispose-second"));
  assert.equal(resources.debugResourceCounts().owners, 1, "pending cleanup must be teardown-owned");
  assert.throws(() => resources.dispose(), /dispose deferred cleanup boom/);
  assert.deepEqual(calls, ["dispose-first", "dispose-second"]);
  assert.equal(resources.debugResourceCounts().owners, 0);
  await Promise.resolve();
  assert.deepEqual(calls, ["dispose-first", "dispose-second"], "the scheduled microtask must not rerun cleanup");
  assert.deepEqual(reported, [], "runtime disposal must aggregate cleanup errors synchronously");
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

  const third = bindings["react.root.create"](container);
  const fourth = bindings["react.root.create"](container);
  const directRootValue = state.resources.resolveResource(third, "ReactRoot");
  directRootValue.unmount();
  assert.throws(() => state.resources.resolveResource(third, "ReactRoot"), /resource is not live/);
  assert.throws(() => state.resources.resolveResource(fourth, "ReactRoot"), /resource is not live/);
  state.resources.releaseResource(container);
  state.resources.dispose();
}

{
  const resources = createHostResourceState();
  const target = {};
  const hookRuntime = createVirtualReactHookRuntime(resources);
  const root = createVirtualReactRootResource(resources, target, {
    ...createReactHostHooks({ resources }),
    hookRuntime,
  });
  const renderCell = { active: 0 };
  const nodeReleases = [];
  const render = callbackLease(renderCell, () => resources.adoptResourceForValue(
    createReactNodeResource(resources, {
      node: { kind: "text", value: "throwing cleanup" },
      callbacks: [Object.assign(() => undefined, {
        release() {
          nodeReleases.push("node");
          throw new Error("node cleanup boom");
        },
      })],
    }),
    { tracked: false },
  ));
  root.renderComponent(render);
  assert.equal(renderCell.active, 1);
  assert.throws(() => root.unmount(), /node cleanup boom/);
  assert.deepEqual(nodeReleases, ["node"]);
  assert.equal(renderCell.active, 0, "component teardown must release its render callback after a node cleanup throws");
  assert.equal(target.reactRoot, undefined);
  assert.throws(() => root.render(null), /React root has been unmounted/);
  assert.doesNotThrow(() => root.unmount());
  assert.deepEqual(resources.debugResourceCounts(), {
    scoped: 0,
    temporaryScopes: 0,
    owners: 0,
  });
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const layoutEffects = [];
  let pendingTree = null;
  let visibleTree = null;
  const React = {
    createElement(type, props = null, ...children) {
      return { type, props: { ...(props ?? {}), children } };
    },
    useLayoutEffect(effect) {
      layoutEffects.push(effect);
    },
  };
  const browserRoot = {
    render(tree) {
      pendingTree = tree;
    },
    unmount() {
      pendingTree = null;
      visibleTree = null;
    },
  };
  const hookRuntime = createBrowserReactHookRuntime(resources, React);
  const root = createBrowserReactRootResource(resources, browserRoot, React, {
    ...createReactHostHooks({ resources }),
    hookRuntime,
  });
  const renderTree = (tree) => {
    while (typeof tree?.type === "function") {
      tree = tree.type(tree.props ?? {});
    }
    return tree;
  };
  const flushLayoutEffects = () => {
    for (const setup of layoutEffects.splice(0).reverse()) {
      setup();
      setup();
    }
  };

  const renderCell = { active: 0 };
  const eventCell = { active: 0 };
  const render = callbackLease(renderCell, () => resources.adoptResourceForValue(
    createReactNodeResource(resources, {
      node: { kind: "text", value: "committed browser component" },
      callbacks: [callbackLease(eventCell)],
    }),
    { tracked: false },
  ));
  root.renderComponent(render);
  visibleTree = renderTree(pendingTree);
  pendingTree = null;
  flushLayoutEffects();
  assert.equal(visibleTree.value, "committed browser component");
  assert.equal(renderCell.active, 1);
  assert.equal(eventCell.active, 1);

  const supersededRenderCell = { active: 0 };
  const supersededEventCell = { active: 0 };
  const supersededRender = callbackLease(supersededRenderCell, () => resources.adoptResourceForValue(
    createReactNodeResource(resources, {
      node: { kind: "text", value: "superseded browser component" },
      callbacks: [callbackLease(supersededEventCell)],
    }),
    { tracked: false },
  ));
  root.renderComponent(supersededRender);
  renderTree(pendingTree);
  pendingTree = null;
  const supersededLayoutEffects = layoutEffects.splice(0);
  assert.equal(supersededRenderCell.active, 1);
  assert.equal(supersededEventCell.active, 1);

  const nextRenderCell = { active: 0 };
  const nextEventCell = { active: 0 };
  const nextRender = callbackLease(nextRenderCell, () => resources.adoptResourceForValue(
    createReactNodeResource(resources, {
      node: { kind: "text", value: "updated browser component" },
      callbacks: [callbackLease(nextEventCell)],
    }),
    { tracked: false },
  ));
  root.renderComponent(nextRender);
  assert.equal(supersededRenderCell.active, 0, "component supersession must release its staged callback");
  assert.equal(supersededEventCell.active, 0, "component supersession must release its staged node");
  for (const setup of supersededLayoutEffects.reverse()) {
    setup();
    setup();
  }
  assert.equal(renderCell.active, 1, "a stale component generation must not replace committed ownership");
  assert.equal(eventCell.active, 1);
  assert.equal(renderCell.active, 1, "a proposed component callback must not replace the committed callback");
  const committedComponentTree = pendingTree;
  const updatedTree = renderTree(committedComponentTree);
  assert.equal(renderCell.active, 1, "rendering a component update must remain speculative");
  assert.equal(eventCell.active, 1, "the visible component node must remain owned until layout commit");
  assert.equal(nextRenderCell.active, 1);
  assert.equal(nextEventCell.active, 1);
  visibleTree = updatedTree;
  pendingTree = null;
  flushLayoutEffects();
  await Promise.resolve();
  assert.equal(visibleTree.value, "updated browser component");
  assert.equal(renderCell.active, 0, "the previous render callback must be released at component commit");
  assert.equal(eventCell.active, 0, "the previous component node must be released at component commit");
  assert.equal(nextRenderCell.active, 1);
  assert.equal(nextEventCell.active, 1);

  const stateRerenderedTree = renderTree(committedComponentTree);
  assert.equal(stateRerenderedTree.value, "updated browser component");
  assert.equal(nextRenderCell.active, 1, "the committed callback owner must survive later component renders");
  assert.equal(nextEventCell.active, 2);
  visibleTree = stateRerenderedTree;
  flushLayoutEffects();
  await Promise.resolve();
  assert.equal(nextEventCell.active, 1, "a later component commit must retire its previous node");

  const replacement = resources.adoptResourceForValue(createReactNodeResource(resources, {
    node: { kind: "text", value: "pending browser node" },
  }), { tracked: false });
  root.render(replacement);
  assert.equal(visibleTree.value, "updated browser component");
  assert.equal(nextRenderCell.active, 1, "a pending root render must retain the committed component");
  assert.equal(nextEventCell.active, 1, "a pending root render must retain visible node callbacks");
  const nextTree = renderTree(pendingTree);
  assert.equal(nextEventCell.active, 1, "rendering the ownership boundary must remain speculative");
  visibleTree = nextTree;
  pendingTree = null;
  flushLayoutEffects();
  await Promise.resolve();
  assert.equal(visibleTree.value, "pending browser node");
  assert.equal(nextRenderCell.active, 0, "the previous component may be released after root commit");
  assert.equal(nextEventCell.active, 0, "the previous node callbacks may be released after root commit");

  root.unmount();
  resources.releaseResource(replacement);
  resources.dispose();
}

{
  const createDeferredBrowserRoot = (resources) => {
    const layoutEffects = [];
    let pendingTree = null;
    let unmounts = 0;
    const React = {
      createElement(type, props = null, ...children) {
        return { type, props: { ...(props ?? {}), children } };
      },
      useLayoutEffect(effect) {
        layoutEffects.push(effect);
      },
    };
    const browserRoot = {
      render(tree) {
        pendingTree = tree;
      },
      unmount() {
        pendingTree = null;
        unmounts++;
      },
    };
    const hookRuntime = createBrowserReactHookRuntime(resources, React);
    const root = createBrowserReactRootResource(resources, browserRoot, React, {
      ...createReactHostHooks({ resources }),
      hookRuntime,
    });
    const renderPendingTree = () => {
      let tree = pendingTree;
      while (typeof tree?.type === "function") {
        tree = tree.type(tree.props ?? {});
      }
      pendingTree = null;
      return tree;
    };
    const enterPendingRoot = () => {
      const tree = pendingTree;
      pendingTree = null;
      return typeof tree?.type === "function" ? tree.type(tree.props ?? {}) : tree;
    };
    return {
      root,
      layoutEffects,
      enterPendingRoot,
      renderPendingTree,
      get pending() {
        return pendingTree !== null;
      },
      get unmounts() {
        return unmounts;
      },
    };
  };

  // React may invoke one component submission more than once before choosing
  // a commit. The root owns its staged callback until the winning component
  // generation commits; cancelling a replay sibling must not release it.
  for (const componentEffectOrder of [[0, 1], [1, 0]]) {
    const resources = createHostResourceState();
    const deferred = createDeferredBrowserRoot(resources);
    const oldRenderCell = { active: 0 };
    deferred.root.renderComponent(
      callbackLease(oldRenderCell, () =>
        resources.adoptResourceForValue(
          createReactNodeResource(resources, {
            node: { kind: "text", value: "initial replay component" },
          }),
          { tracked: false },
        ),
      ),
    );
    deferred.renderPendingTree();
    for (const setup of deferred.layoutEffects.splice(0).reverse()) setup();
    assert.equal(oldRenderCell.active, 1);

    const nextRenderCell = { active: 0 };
    const eventCell = { active: 0 };
    deferred.root.renderComponent(
      callbackLease(nextRenderCell, () =>
        resources.adoptResourceForValue(
          createReactNodeResource(resources, {
            node: { kind: "text", value: "replayed replacement component" },
            callbacks: [callbackLease(eventCell)],
          }),
          { tracked: false },
        ),
      ),
    );
    const componentTree = deferred.enterPendingRoot();
    componentTree.type(componentTree.props ?? {});
    componentTree.type(componentTree.props ?? {});
    const [rootEffect, ...componentEffects] = deferred.layoutEffects.splice(0);
    assert.equal(componentEffects.length, 2);
    assert.equal(nextRenderCell.active, 1);
    assert.equal(eventCell.active, 2);

    for (const index of componentEffectOrder) componentEffects[index]();
    rootEffect();
    assert.equal(oldRenderCell.active, 0);
    assert.equal(nextRenderCell.active, 1, "replay cancellation must preserve the winning callback owner");
    assert.equal(eventCell.active, 1, "replay cancellation must release only its generation-local node");

    assert.doesNotThrow(() => componentTree.type(componentTree.props ?? {}));
    const rerenderEffect = deferred.layoutEffects.shift();
    rerenderEffect();
    await Promise.resolve();
    assert.equal(nextRenderCell.active, 1, "the winning callback must remain usable on a later render");
    assert.equal(eventCell.active, 1);

    deferred.root.unmount();
    assert.equal(nextRenderCell.active, 0);
    assert.equal(eventCell.active, 0);
    assert.equal(resources.debugResourceCounts().owners, 0);
    assert.doesNotThrow(() => deferred.root.unmount());
    resources.dispose();
  }

  // Direct unmount must see node ownership before React enters the tree.
  {
    const resources = createHostResourceState();
    const deferred = createDeferredBrowserRoot(resources);
    const callbackCell = { active: 0 };
    const node = resources.adoptResourceForValue(
      createReactNodeResource(resources, {
        node: { kind: "text", value: "deferred direct node" },
        callbacks: [callbackLease(callbackCell)],
      }),
      { tracked: false },
    );
    deferred.root.render(node);
    resources.releaseResource(node);
    assert.equal(callbackCell.active, 1);
    assert.equal(resources.debugResourceCounts().owners, 2);
    deferred.root.unmount();
    assert.equal(callbackCell.active, 0, "direct unmount must release a queued browser node owner");
    assert.equal(resources.debugResourceCounts().owners, 0);
    assert.doesNotThrow(() => deferred.root.unmount());
    assert.equal(deferred.unmounts, 1);
    resources.dispose();
  }

  // Exercise the public direct-unmount binding with a component queued before
  // React invokes it on an already-created root.
  {
    const resources = createHostResourceState();
    let deferred = null;
    const bindings = createReactRootResourceHostBindings(resources, () => {
      deferred = createDeferredBrowserRoot(resources);
      return deferred.root;
    });
    const container = resources.resourceForValue({
      kind: "direct deferred component container",
    });
    const root = bindings["react.root.create"](container);
    commitHostResource(root);
    const callbackCell = { active: 0 };
    bindings["react.root.renderComponent"](
      root,
      callbackLease(callbackCell, () => {
        throw new Error("the directly unmounted deferred component must not run");
      }),
    );
    assert.equal(callbackCell.active, 1);
    bindings["react.root.unmount"](root);
    assert.equal(callbackCell.active, 0, "direct root unmount must release a queued component owner");
    assert.equal(deferred.unmounts, 1);
    assert.equal(resources.debugResourceCounts().owners, 0);
    assert.throws(() => resources.resolveResource(root, "ReactRoot"), /resource is not live/);
    resources.releaseResource(container);
    resources.dispose();
  }

  // A component may have run and staged hook/node ownership before the root's
  // layout boundary commits. Root teardown must still own that whole record.
  {
    const resources = createHostResourceState();
    const deferred = createDeferredBrowserRoot(resources);
    const renderCell = { active: 0 };
    const eventCell = { active: 0 };
    deferred.root.renderComponent(
      callbackLease(renderCell, () =>
        resources.adoptResourceForValue(
          createReactNodeResource(resources, {
            node: { kind: "text", value: "invoked deferred component" },
            callbacks: [callbackLease(eventCell)],
          }),
          { tracked: false },
        ),
      ),
    );
    deferred.renderPendingTree();
    assert.equal(renderCell.active, 1);
    assert.equal(eventCell.active, 1);
    deferred.root.unmount();
    assert.equal(renderCell.active, 0);
    assert.equal(eventCell.active, 0, "unmount before root layout commit must release the staged component node");
    assert.equal(resources.debugResourceCounts().owners, 0);
    for (const setup of deferred.layoutEffects.splice(0)) setup();
    assert.equal(resources.debugResourceCounts().owners, 0, "stale layout commits must not reacquire cancelled ownership");
    resources.dispose();
  }

  // Supersession must cancel the old generation, and its stale layout commit
  // must not replace the newer pending owner.
  {
    const resources = createHostResourceState();
    const deferred = createDeferredBrowserRoot(resources);
    const firstCell = { active: 0 };
    const secondCell = { active: 0 };
    const first = resources.adoptResourceForValue(
      createReactNodeResource(resources, {
        node: { kind: "text", value: "first deferred node" },
        callbacks: [callbackLease(firstCell)],
      }),
      { tracked: false },
    );
    const second = resources.adoptResourceForValue(
      createReactNodeResource(resources, {
        node: { kind: "text", value: "second deferred node" },
        callbacks: [callbackLease(secondCell)],
      }),
      { tracked: false },
    );
    deferred.root.render(first);
    deferred.renderPendingTree();
    const staleCommit = deferred.layoutEffects.shift();
    deferred.root.render(second);
    resources.releaseResource(first);
    resources.releaseResource(second);
    assert.equal(firstCell.active, 0, "a superseded browser generation must release its node owner");
    assert.equal(secondCell.active, 1);
    staleCommit();
    deferred.root.unmount();
    assert.equal(secondCell.active, 0);
    assert.equal(resources.debugResourceCounts().owners, 0);
    resources.dispose();
  }

  // Failed scalar publication and direct unmount share the same pending-root
  // teardown path. Cover node/component work for both new and existing roots.
  for (const kind of ["node", "component"]) {
    for (const existingRoot of [false, true]) {
      const resources = createHostResourceState();
      const container = {
        kind: `${kind} ${existingRoot ? "existing" : "new"} deferred selector`,
      };
      let deferred = null;
      const bindings = createReactRootResourceHostBindings(
        resources,
        () => {
          deferred = createDeferredBrowserRoot(resources);
          return deferred.root;
        },
        { querySelector: () => container },
      );
      let rootAlias = null;
      let containerResource = null;
      if (existingRoot) {
        containerResource = resources.resourceForValue(container);
        rootAlias = bindings["react.root.create"](containerResource);
        commitHostResource(rootAlias);
      }
      const selector = resources.resourceForValue(`#deferred-${kind}`);
      const callbackCell = { active: 0 };
      let publication;
      if (kind === "node") {
        const node = resources.adoptResourceForValue(
          createReactNodeResource(resources, {
            node: { kind: "text", value: "deferred selector node" },
            callbacks: [callbackLease(callbackCell)],
          }),
          { tracked: false },
        );
        publication = bindings["react.root.renderIntoSelector"](selector, node);
        resources.releaseResource(node);
      } else {
        publication = bindings["react.root.renderComponentIntoSelector"](
          selector,
          callbackLease(callbackCell, () => {
            throw new Error("the deferred component must not run before selector rollback");
          }),
        );
      }
      assert.equal(callbackCell.active, 1);
      abandonHostResource(publication);
      assert.equal(callbackCell.active, 0, `${kind} selector rollback must release queued browser ownership`);
      assert.equal(deferred.unmounts, 1);
      assert.equal(deferred.pending, false);
      assert.equal(resources.debugResourceCounts().owners, 0);
      if (rootAlias !== null) {
        assert.equal(hostResourceValue(rootAlias), null);
      }
      if (containerResource !== null) resources.releaseResource(containerResource);
      resources.releaseResource(selector);
      resources.dispose();
    }
  }

  // Throwing pending cleanup detaches the record first and remains idempotent.
  {
    const resources = createHostResourceState();
    const deferred = createDeferredBrowserRoot(resources);
    const callbackCell = { active: 0, releases: 0 };
    let released = false;
    const callback = Object.assign(() => undefined, {
      retain() {
        if (released) throw new Error("throwing callback lease has been released");
        return this;
      },
      release() {
        if (released) return false;
        released = true;
        callbackCell.active--;
        callbackCell.releases++;
        throw new Error("pending node release boom");
      },
    });
    callbackCell.active++;
    const node = resources.adoptResourceForValue(
      createReactNodeResource(resources, {
        node: { kind: "text", value: "throwing pending node" },
        callbacks: [callback],
      }),
      { tracked: false },
    );
    deferred.root.render(node);
    resources.releaseResource(node);
    assert.throws(() => deferred.root.unmount(), /pending node release boom/);
    assert.equal(callbackCell.active, 0);
    assert.equal(callbackCell.releases, 1);
    assert.equal(resources.debugResourceCounts().owners, 0);
    assert.doesNotThrow(() => deferred.root.unmount());
    assert.equal(callbackCell.releases, 1);
    resources.dispose();
  }
}

{
  const resources = createHostResourceState();
  const payloads = { active: 0, releases: 0 };
  const hooks = createBrowserReactHookRuntime(resources, {
    useRef(initial) {
      return { current: initial };
    },
    // An abandoned render never commits, so React discards this callback.
    useLayoutEffect() {},
  });
  const component = hooks.createComponentState();
  let released = false;
  const payload = {};
  payloads.active++;
  registerHostResourcePayloadLifetime(payload, {
    retain: () => {
      throw new Error("abandoned render payload must not be retained again");
    },
    release: () => {
      if (released) return false;
      released = true;
      payloads.active--;
      payloads.releases++;
      return true;
    },
  });
  hooks.withComponentRender(component, () => {
    const ref = hooks.useRef(payload);
    resources.releaseResource(ref);
    hooks.commitComponentRender(component);
  });
  assert.deepEqual(payloads, { active: 1, releases: 0 });
  resources.dispose();
  assert.deepEqual(
    payloads,
    { active: 0, releases: 1 },
    "runtime disposal must synchronously drain an abandoned browser render generation",
  );
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
  let released = false;
  let previousResource = null;
  let nextResource = null;
  let escapedResource = null;
  const updater = Object.assign((previous) => {
    previousResource = previous;
    assert.equal(jsBindings["js.nat.value"](previous), 0n);
    escapedResource = jsBindings["js.nat"](99n);
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
  assert.equal(jsBindings["js.nat.value"](nextResource), 1n);
  assert.equal(
    jsBindings["js.nat.value"](escapedResource),
    99n,
    "an unrelated resource created by RuntimeM must outlive the updater callback",
  );
  assert.equal(resources.resolveResource(retainedZero, "Js"), 0n);
  assert.notEqual(resources.resourceForValue(0n), retainedZero);
  resources.releaseResource(nextResource);
  resources.releaseResource(escapedResource);
  resources.releaseResource(setter);
  resources.releaseResource(retainedZero);
}

{
  const { resources, stateBindings } = createReactStateSmokeBindings();
  let stateValue = "old";
  const setter = resources.resourceForValue({
    set(next) {
      stateValue = typeof next === "function" ? next(stateValue) : next;
    },
  });
  const next = createTestLeanRefCell("throwing updater result");
  let incomingReleases = 0;
  let ownedReleases = 0;
  const ownedUpdate = Object.assign(
    () => testLeanRefResource(next.alias, next.cell.label),
    {
      release() {
        ownedReleases++;
        throw new Error("updater release boom");
      },
    },
  );
  const update = Object.assign(() => undefined, {
    retain() {
      return ownedUpdate;
    },
    release() {
      incomingReleases++;
      return true;
    },
  });

  assert.throws(
    () => stateBindings["react.state.modify"](setter, update),
    /updater release boom/,
  );
  assert.equal(stateValue, "old");
  assert.equal(incomingReleases, 1);
  assert.equal(ownedReleases, 1);
  assert.equal(next.cell.aliases.size, 0, "throwing updater cleanup must roll back its acquired result");
  assert.equal(resources.debugResourceCounts().owners, 0, "throwing callback release must detach its disposable owner");
  resources.releaseResource(setter);
  resources.dispose();
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
  assert.equal(
    jsBindings["js.nat.value"](nextResource),
    3n,
    "an externally retained RuntimeM allocation must survive an updater failure",
  );
  resources.releaseResource(nextResource);
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
  const nodeValue = createReactNodeResource(resources, {
    node: { kind: "text", value: "virtual same-identity payload" },
  });
  const node = resources.adoptResourceForValue(nodeValue, { tracked: false });
  let state;
  let ref;
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](node);
    ref = bindings["react.useRef"](node);
  });
  hooks.commitComponentRender(component);
  assert.equal(nodeValue.refCount, 3);
  const setter = bindings["react.state.setter"](state);
  bindings["react.state.set"](setter, node);
  bindings["react.ref.set"](ref, node);
  assert.equal(nodeValue.refCount, 3, "virtual same-identity writes must release redundant leases");
  resources.releaseResource(node);
  hooks.disposeComponent(component);
  assert.equal(nodeValue.refCount, 0);
  assert.equal(nodeValue.finalized, true);
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
  const deps = bindings["react.deps.empty"]();
  const memo = createTestLeanRefCell("throwing memo callback result");
  let releaseCalls = 0;
  const calculate = Object.assign(
    () => testLeanRefResource(memo.alias, memo.cell.label),
    {
      release() {
        releaseCalls++;
        throw new Error("memo callback release boom");
      },
    },
  );

  assert.throws(
    () => hooks.withComponentRender(component, () => bindings["react.useMemo"](calculate, deps)),
    /memo callback release boom/,
  );
  assert.equal(releaseCalls, 1);
  assert.equal(memo.cell.aliases.size, 0, "throwing memo callback cleanup must roll back its acquired result");
  assert.equal(resources.debugResourceCounts().owners, 0);
  hooks.disposeComponent(component);
  resources.releaseResource(deps);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const deps = bindings["react.deps.empty"]();
  const payload = {};
  let live = true;
  let releases = 0;
  registerHostResourcePayloadLifetime(payload, {
    retain() {
      throw new Error("state result retain boom");
    },
    release() {
      if (!live) return false;
      live = false;
      releases++;
      return true;
    },
  });
  const transferredResult = resources.adoptResourceForValue(payload);
  let calculateReleased = false;
  const calculate = Object.assign(() => transferredResult, {
    release() {
      if (calculateReleased) return false;
      calculateReleased = true;
      return true;
    },
  });
  assert.throws(
    () => hooks.withComponentRender(component, () => bindings["react.useMemo"](calculate, deps)),
    /state result retain boom/,
  );
  assert.equal(calculateReleased, true);
  assert.equal(releases, 1, "retain failure must consume the transferred callback-result wrapper");
  assert.equal(resources.debugResourceCounts().owners, 0);
  assert.throws(
    () => resources.resolveResource(transferredResult, "Js"),
    /resource is not live/,
  );
  hooks.disposeComponent(component);
  resources.releaseResource(deps);
  resources.dispose();
  assert.equal(releases, 1);
}

{
  const resources = createHostResourceState();
  const jsBindings = createReactJsValueHostBindings(resources);
  const hooks = createVirtualReactHookRuntime(resources);
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState(() => undefined);
  const initial = createTestLeanRefCell("virtual reducer initial");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let reduced = null;
  let escapedResource = null;
  const reducer = releasableCallback(() => {
    escapedResource = jsBindings["js.nat"](77n);
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
  assert.equal(
    jsBindings["js.nat.value"](escapedResource),
    77n,
    "an unrelated resource created by RuntimeM must outlive the reducer callback",
  );
  resources.releaseResource(escapedResource);
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
  assert.equal(replacement.cell.aliases.size, 2, "the queued action must own its source and eager result separately");

  const ignoredInitial = createTestLeanRefCell("browser ignored initial");
  const ignoredInitialResource = testLeanRefResource(ignoredInitial.alias, ignoredInitial.cell.label);
  hooks.withComponentRender(component, () => {
    state = bindings["react.useState"](ignoredInitialResource);
    hooks.commitComponentRender(component);
  });
  releaseHostResource(ignoredInitialResource);
  assert.equal(ignoredInitial.cell.aliases.size, 0);
  assert.equal(initial.cell.aliases.size, 0);
  assert.equal(replacement.cell.aliases.size, 2, "the committed state and queued action must own distinct leases");
  hooks.disposeComponent(component);
  assert.equal(replacement.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const refs = [];
  let refIndex = 0;
  const hooks = createBrowserReactHookRuntime(resources, {
    useState(initial) {
      return [initial, () => undefined];
    },
    useRef(initial) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useMemo(calculate) {
      return calculate();
    },
    useLayoutEffect(effect) {
      effect();
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const callbackCell = { active: 0 };
  const nodeValue = createReactNodeResource(resources, {
    node: { kind: "text", value: "same-identity React payload" },
    callbacks: [callbackLease(callbackCell)],
  });
  const node = resources.adoptResourceForValue(nodeValue, { tracked: false });
  const deps = bindings["react.deps.empty"]();
  let stateSetter = null;
  let refHandle = null;

  const render = () => {
    refIndex = 0;
    const results = [];
    hooks.withComponentRender(component, () => {
      results.push(bindings["react.useState"](node));
      results.push(bindings["react.useState"](node));
      results.push(bindings["react.useRef"](node));
      results.push(bindings["react.useRef"](node));
      results.push(bindings["react.useMemo"](
        releasableCallback(() => resources.ownedResourceForValue(nodeValue)),
        deps,
      ));
      hooks.commitComponentRender(component);
    });
    stateSetter ??= bindings["react.state.setter"](results[0]);
    refHandle ??= results[2];
    for (const result of results) {
      if (result !== refHandle) resources.releaseResource(result);
    }
  };

  render();
  assert.equal(nodeValue.refCount, 6, "five React hooks must retain five independent leases");
  bindings["react.state.set"](stateSetter, node);
  bindings["react.state.set"](stateSetter, node);
  bindings["react.ref.set"](refHandle, node);
  bindings["react.ref.set"](refHandle, node);
  assert.equal(nodeValue.refCount, 8, "same-identity queued writes must keep distinct action leases");
  render();
  assert.equal(
    nodeValue.refCount,
    8,
    "rerendering the same payload must preserve queued actions without collapsing hook owners",
  );
  resources.releaseResource(node);
  assert.equal(nodeValue.refCount, 7);
  hooks.disposeComponent(component);
  assert.equal(nodeValue.refCount, 0);
  assert.equal(nodeValue.finalized, true);
  assert.equal(callbackCell.active, 0);
  resources.releaseResource(deps);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const layoutEffects = [];
  const hooks = createBrowserReactHookRuntime(resources, {
    useState(initial) {
      return [initial, () => undefined];
    },
    useLayoutEffect(effect) {
      layoutEffects.push(effect);
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const nodeValue = createReactNodeResource(resources, {
    node: { kind: "text", value: "overlapping same-identity generations" },
  });
  const node = resources.adoptResourceForValue(nodeValue, { tracked: false });
  const render = () => {
    const results = [];
    hooks.withComponentRender(component, () => {
      results.push(bindings["react.useState"](node));
      results.push(bindings["react.useState"](node));
      hooks.commitComponentRender(component);
    });
    for (const result of results) resources.releaseResource(result);
  };

  render();
  render();
  assert.equal(nodeValue.refCount, 5);
  layoutEffects[1]();
  assert.equal(nodeValue.refCount, 5, "committing one generation must not steal sibling leases");
  layoutEffects[0]();
  assert.equal(nodeValue.refCount, 3, "the superseded generation must release both of its leases");
  resources.releaseResource(node);
  hooks.disposeComponent(component);
  assert.equal(nodeValue.refCount, 0);
  assert.equal(nodeValue.finalized, true);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  let reactRef = null;
  const hooks = createBrowserReactHookRuntime(resources, {
    useRef(initial) {
      reactRef ??= { current: initial };
      return reactRef;
    },
    useLayoutEffect(effect) {
      effect();
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const initial = createTestLeanRefCell("browser ref committed value");
  const initialResource = testLeanRefResource(initial.alias, initial.cell.label);
  let ref;
  hooks.withComponentRender(component, () => {
    ref = bindings["react.useRef"](initialResource);
    hooks.commitComponentRender(component);
  });
  releaseHostResource(initialResource);
  assert.equal(initial.cell.aliases.size, 1);

  const ignored = createTestLeanRefCell("browser ref ignored initial");
  const ignoredResource = testLeanRefResource(ignored.alias, ignored.cell.label);
  assert.throws(
    () => hooks.withComponentRender(component, () => {
      bindings["react.useRef"](ignoredResource);
      throw new Error("abandon browser ref render");
    }),
    /abandon browser ref render/,
  );
  releaseHostResource(ignoredResource);
  assert.equal(ignored.cell.aliases.size, 0);
  assert.equal(
    initial.cell.aliases.size,
    1,
    "rolling back a speculative render must not release the committed ref payload",
  );
  const exposed = bindings["react.ref.get"](ref);
  releaseHostResource(exposed);
  assert.equal(initial.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(initial.cell.aliases.size, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  let reactRef = null;
  const hooks = createBrowserReactHookRuntime(resources, {
    useRef(initial) {
      reactRef ??= { current: initial };
      return reactRef;
    },
    useLayoutEffect(effect) {
      effect();
    },
  });
  const bindings = createReactStateHostBindings(resources, hooks);
  const component = hooks.createComponentState();
  const nodeValue = createReactNodeResource(resources, {
    node: { kind: "text", value: "React-overwritten ref payload" },
  });
  const node = resources.adoptResourceForValue(nodeValue, { tracked: false });
  hooks.withComponentRender(component, () => {
    bindings["react.useRef"](node);
    hooks.commitComponentRender(component);
  });
  resources.releaseResource(node);
  assert.equal(nodeValue.refCount, 1);
  reactRef.current = { nodeType: 1 };
  hooks.disposeComponent(component);
  assert.equal(nodeValue.refCount, 0, "React overwriting ref.current must not orphan the committed payload lease");
  assert.equal(nodeValue.finalized, true);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const component = hooks.createComponentState(() => undefined);
  const setupCell = { active: 0 };
  const cleanupCell = { active: 0 };
  let effectResult = null;
  let cleanupCalls = 0;
  hooks.withComponentRender(component, () => {
    hooks.useEffect(
      callbackLease(setupCell, () => {
        effectResult = createTestLeanRefCell("virtual effect result");
        return testLeanRefResource(effectResult.alias, effectResult.cell.label);
      }),
      callbackLease(cleanupCell, (resource) => {
        assert.equal(hostResourceValue(resource), effectResult.alias);
        cleanupCalls++;
      }),
    );
  });
  hooks.commitComponentRender(component);
  assert.equal(effectResult.cell.aliases.size, 1);
  hooks.disposeComponent(component);
  assert.equal(cleanupCalls, 1);
  assert.equal(effectResult.cell.aliases.size, 0, "virtual effect cleanup must release its setup result");
  assert.equal(setupCell.active, 0);
  assert.equal(cleanupCell.active, 0);
  resources.dispose();
}

{
  const resources = createHostResourceState();
  const hooks = createVirtualReactHookRuntime(resources);
  const component = hooks.createComponentState(() => undefined);
  let reducerReleased = false;
  const oldReducer = Object.assign((_state, _action) => 0, {
    release() {
      if (reducerReleased) return false;
      reducerReleased = true;
      throw new Error("old reducer release boom");
    },
  });
  const oldSetupCell = { active: 0 };
  const oldCleanupCell = { active: 0 };
  let oldCleanups = 0;
  hooks.withComponentRender(component, () => {
    hooks.useReducer(oldReducer, 0);
    hooks.useEffect(
      callbackLease(oldSetupCell, () => null),
      callbackLease(oldCleanupCell, () => { oldCleanups++; }),
    );
  });
  hooks.commitComponentRender(component);

  const nextReducerCell = { active: 0 };
  const nextSetupCell = { active: 0 };
  const nextCleanupCell = { active: 0 };
  let nextSetups = 0;
  let nodeCommits = 0;
  hooks.withComponentRender(component, () => {
    hooks.useReducer(callbackLease(nextReducerCell, (_state, _action) => 1), 0);
    hooks.useEffect(
      callbackLease(nextSetupCell, () => { nextSetups++; return null; }),
      callbackLease(nextCleanupCell),
    );
  });
  assert.throws(
    () => hooks.commitComponentRender(component, () => { nodeCommits++; }),
    /old reducer release boom/,
  );
  assert.equal(oldCleanups, 0, "a failed reducer commit must not tear down the committed effect");
  assert.equal(nextSetups, 0, "a failed reducer commit must not activate speculative effects");
  assert.equal(nodeCommits, 0);
  assert.equal(nextSetupCell.active, 0);
  assert.equal(nextCleanupCell.active, 0);
  assert.equal(oldSetupCell.active, 1);
  assert.equal(oldCleanupCell.active, 1);
  hooks.disposeComponent(component);
  assert.equal(oldCleanups, 1);
  assert.equal(oldSetupCell.active, 0);
  assert.equal(oldCleanupCell.active, 0);
  assert.equal(nextReducerCell.active, 0);
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
  const effectResources = [];
  let setups = 0;
  let cleanups = 0;
  hooks.withComponentRender(component, () => {
    hooks.useEffect(
      callbackLease(setupCell, () => {
        const owned = createTestLeanRefCell(`browser effect result ${++setups}`);
        const resource = testLeanRefResource(owned.alias, owned.cell.label);
        effectResources.push(owned);
        return resource;
      }),
      callbackLease(cleanupCell, (resource) => {
        assert.equal(hostResourceValue(resource), effectResources.at(-1).alias);
        cleanups++;
        if (cleanups === 2) throw new Error("browser effect cleanup boom");
      }),
    );
    hooks.commitComponentRender(component);
  });
  assert.equal(layoutEffects.length, 1);
  layoutEffects[0]();
  layoutEffects[0]();
  assert.equal(passiveEffects.length, 1);
  const firstCleanup = passiveEffects[0]();
  assert.equal(effectResources[0].cell.aliases.size, 1);
  firstCleanup();
  assert.equal(effectResources[0].cell.aliases.size, 0);
  const secondCleanup = passiveEffects[0]();
  assert.equal(effectResources[1].cell.aliases.size, 1);
  assert.throws(() => secondCleanup(), /browser effect cleanup boom/);
  assert.equal(effectResources[1].cell.aliases.size, 0);
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
  let pureStateActionPassedToReact = false;
  const setState = (next) => {
    if (typeof next === "function") pureStateActionPassedToReact = true;
    stateValue = typeof next === "function" ? next(stateValue) : next;
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
  assert.equal(pureStateActionPassedToReact, true);
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
  let pureStateActionPassedToReact = false;
  const hooks = createBrowserReactHookRuntime(resources, {
    useState() {
      return [stateValue, (next) => {
        if (typeof next === "function") pureStateActionPassedToReact = true;
        stateValue = typeof next === "function" ? next(stateValue) : next;
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
  assert.equal(pureStateActionPassedToReact, true);
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
const rootsBeforeBorrowedArraySmoke = reactRuntime.hostState.resourceRoots.debugCounts().active;
smokeVirtualReactRefFragment(reactRuntime, reactDocumentState, "#react-ref-fragment");
assert.equal(
  reactRuntime.hostState.resourceRoots.debugCounts().active,
  rootsBeforeBorrowedArraySmoke,
  "dropping borrowed Array elements must restore the externref-root baseline",
);
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
