/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createBrowserDocumentHostBindings,
  createCommonHostBindings,
  createHostResourceState,
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  ensureVirtualElementStates,
} from "../../web/src/vir-host-bindings.js";
import { createStaticNodeList } from "../../web/src/host/vir-js-collection-bindings.js";
import { VirHostState } from "../../web/src/runtime/host-state.js";
import {
  abandonHostResource,
  commitHostResource,
  createHostResource,
  ExternrefResourceRoots,
  hostResourceValue,
  registerHostResourcePayloadLifetime,
  releaseHostResource,
  releaseHostResourcePayload,
  retainHostResource,
  VIR_HOST_DISPOSE,
} from "../../web/src/host-resource.js";

const emptyResourceCounts = {
  scoped: 0,
  temporaryScopes: 0,
  owners: 0,
};

{
  const roots = new ExternrefResourceRoots();
  let borrowedDisposals = 0;
  const borrowed = createHostResource({ kind: "borrowed" }, "borrowed root", {
    dispose: () => {
      borrowedDisposals++;
    },
  });
  const borrowedRoot = roots.root(borrowed);
  roots.release(borrowedRoot);
  assert.equal(borrowedDisposals, 0, "dropping a borrowed Lean root must not consume its JS owner");
  assert.notEqual(hostResourceValue(borrowed), null);
  releaseHostResource(borrowed);
  assert.equal(borrowedDisposals, 1);

  let droppedDisposals = 0;
  const dropped = createHostResource({ kind: "dropped" }, "owned root", {
    dispose: () => {
      droppedDisposals++;
    },
  });
  const droppedRoot = roots.root(dropped, { owned: true });
  roots.release(droppedRoot);
  assert.equal(droppedDisposals, 1, "dropping an owned Lean root must dispose its resource");
  assert.equal(hostResourceValue(dropped), null);

  let transferredDisposals = 0;
  const transferred = createHostResource({ kind: "transferred" }, "transferred root", {
    dispose: () => {
      transferredDisposals++;
    },
  });
  const transferredRoot = roots.root(transferred, { owned: true });
  assert.equal(roots.get(transferredRoot, { take: true }), transferred);
  roots.release(transferredRoot);
  assert.equal(
    transferredDisposals,
    0,
    "dropping a taken Lean root must leave the transferred JavaScript resource live",
  );
  assert.equal(transferred.release(), true);
  assert.equal(transferredDisposals, 1);
  assert.equal(transferred.dispose(), false, "HostResource disposal must be idempotent");
  assert.equal(transferred[VIR_HOST_DISPOSE](), false);
}

{
  const transitions = [];
  const abandoned = createHostResource({ kind: "staged active result" }, "staged active result", {
    onAbandon: () => {
      transitions.push("abandon");
      throw new Error("active rollback boom");
    },
    dispose: () => {
      transitions.push("release");
      throw new Error("wrapper release boom");
    },
  });
  assert.throws(
    () => abandonHostResource(abandoned),
    (error) => error instanceof AggregateError &&
      error.errors.some((item) => /active rollback boom/.test(item.message)) &&
      error.errors.some((item) => /wrapper release boom/.test(item.message)),
  );
  assert.deepEqual(transitions, ["abandon", "release"]);
  assert.equal(hostResourceValue(abandoned), null);
  assert.equal(abandonHostResource(abandoned), false, "resource abandonment must be idempotent");

  let committedRollbacks = 0;
  const committed = createHostResource({ kind: "committed active result" }, "committed active result", {
    onAbandon: () => {
      committedRollbacks++;
    },
  });
  assert.equal(commitHostResource(committed), true);
  assert.equal(abandonHostResource(committed), true);
  assert.equal(committedRollbacks, 0, "committing a result must disarm its provisional rollback");
}

{
  const resources = createHostResourceState();
  const value = { kind: "committed move-only resource" };
  let rollbacks = 0;
  const resource = resources.revocableResourceForValue(value, {
    onAbandon: () => {
      rollbacks++;
    },
  });
  assert.equal(commitHostResource(resource), true);
  assert.throws(
    () => retainHostResource(resource),
    /does not support independent retain/,
    "commit must not turn a move-only revocable capability into a generic alias",
  );
  resources.releaseValueResource(value);
  assert.equal(rollbacks, 0);
  assert.equal(hostResourceValue(resource), null);
  resources.dispose();
}

{
  const roots = new ExternrefResourceRoots({ initial: 4 });
  assert.deepEqual(roots.debugCounts(), { active: 0, capacity: 3, reusable: 3 });
  for (let rootId = 1; rootId < roots.table.length; rootId++) {
    assert.equal(roots.table.get(rootId), null, "every preallocated free externref slot must be null");
  }
  roots.clear();
  assert.deepEqual(roots.debugCounts(), { active: 0, capacity: 3, reusable: 3 });

  const first = roots.root(createHostResource({ kind: "first preallocated slot" }));
  const second = roots.root(createHostResource({ kind: "second preallocated slot" }));
  assert.deepEqual([first, second], [1, 2]);
  roots.release(first);
  roots.release(first);
  assert.deepEqual(roots.debugCounts(), { active: 1, capacity: 3, reusable: 2 });
  roots.clear();
  assert.deepEqual(roots.debugCounts(), { active: 0, capacity: 3, reusable: 3 });
  for (let rootId = 1; rootId < roots.table.length; rootId++) {
    assert.equal(roots.table.get(rootId), null);
  }
}

{
  const roots = new ExternrefResourceRoots();
  let takeAttempts = 0;
  let disposals = 0;
  const resource = createHostResource({ kind: "failure-atomic take" }, "failure-atomic take", {
    onTake: () => {
      takeAttempts++;
      if (takeAttempts === 1) throw new Error("injected take failure");
    },
    dispose: () => {
      disposals++;
    },
  });
  const root = roots.root(resource, { owned: true });
  assert.throws(() => roots.get(root, { take: true }), /injected take failure/);
  assert.equal(roots.debugCounts().active, 1);
  assert.equal(roots.get(root, { take: true }), resource, "a failed take must leave the source retryable");
  assert.equal(takeAttempts, 2);
  roots.release(root);
  assert.equal(disposals, 0, "a successful retry must transfer the source lease exactly once");
  releaseHostResource(resource);
  assert.equal(disposals, 1);
}

{
  let disposals = 0;
  const active = createHostResource({ kind: "move-only" }, "move-only resource", {
    dispose: () => {
      disposals++;
    },
  });
  assert.throws(
    () => retainHostResource(active),
    /does not support independent retain/,
    "generic retain must reject a resource whose underlying capability cannot be cloned",
  );
  releaseHostResource(active);
  assert.equal(disposals, 1);
}

{
  const cell = { aliases: 0 };
  const createAlias = () => {
    let live = true;
    const alias = {};
    cell.aliases++;
    registerHostResourcePayloadLifetime(alias, {
      retain: createAlias,
      release: () => {
        if (!live) return false;
        live = false;
        cell.aliases--;
        return true;
      },
    });
    return alias;
  };
  const resources = createHostResourceState();
  const roots = new ExternrefResourceRoots();
  const result = resources.adoptResourceForValue(createAlias());
  const root = roots.root(result, { owned: true });
  assert.equal(resources.debugResourceCounts().owners, 1);
  assert.equal(roots.get(root, { take: true }), result);
  assert.equal(
    resources.debugResourceCounts().owners,
    1,
    "taking an owned WASM result must retain an authoritative ticket but not its JS wrapper",
  );
  roots.release(root);
  assert.equal(cell.aliases, 1);
  assert.equal(result.release(), true);
  assert.equal(cell.aliases, 0, "the JavaScript result owner must be able to release its payload lease");
  assert.equal(resources.debugResourceCounts().owners, 0);
  assert.equal(result.release(), false);
  resources.dispose();
}

{
  let live = true;
  let releases = 0;
  const payload = {};
  registerHostResourcePayloadLifetime(payload, {
    retain: () => {
      throw new Error("the adopted payload should not be retained");
    },
    release: () => {
      if (!live) return false;
      live = false;
      releases++;
      return true;
    },
  });
  const resources = createHostResourceState();
  const roots = new ExternrefResourceRoots();
  const result = resources.adoptResourceForValue(payload);
  const root = roots.root(result, { owned: true });
  assert.equal(roots.get(root, { take: true }), result);
  roots.release(root);
  assert.equal(resources.debugResourceCounts().owners, 1);
  resources.dispose();
  assert.equal(releases, 1, "runtime teardown must release transferred payloads without consulting wrappers");
  assert.equal(hostResourceValue(result), null);
  assert.equal(result.release(), false);
}

{
  let live = true;
  let releases = 0;
  const payload = {};
  registerHostResourcePayloadLifetime(payload, {
    retain: () => {
      throw new Error("the adopted transfer payload should not be retained");
    },
    release: () => {
      if (!live) return false;
      live = false;
      releases++;
      return true;
    },
  });
  const resources = createHostResourceState();
  const roots = new ExternrefResourceRoots();
  const result = resources.adoptResourceForValue(payload);
  const root = roots.root(result, { owned: true });
  const tickets = resources.transferredPayloadTickets;
  resources.transferredPayloadTickets = {
    add() {
      throw new Error("injected destination registration failure");
    },
  };
  assert.throws(
    () => roots.get(root, { take: true }),
    /injected destination registration failure/,
  );
  resources.transferredPayloadTickets = tickets;
  assert.equal(resources.ownedPayloadResources.has(result), true);
  assert.equal(roots.get(root, { take: true }), result, "the internal transfer must remain retryable");
  roots.release(root);
  assert.equal(releases, 0);
  resources.releaseResource(result);
  assert.equal(releases, 1);
  resources.dispose();
}

{
  const roots = new ExternrefResourceRoots();
  const releases = [];
  const first = createHostResource({ kind: "first" }, "throwing owned root", {
    dispose: () => {
      releases.push("first");
      throw new Error("first owned root cleanup boom");
    },
  });
  const second = createHostResource({ kind: "second" }, "later owned root", {
    dispose: () => {
      releases.push("second");
    },
  });
  roots.root(first, { owned: true });
  roots.root(second, { owned: true });
  assert.throws(() => roots.clear(), /first owned root cleanup boom/);
  assert.deepEqual(releases, ["first", "second"]);
  assert.equal(hostResourceValue(first), null);
  assert.equal(hostResourceValue(second), null);
  assert.equal(roots.debugCounts().active, 0);
}

{
  const state = new VirHostState({ defaultHostBindings: null });
  const retainedPayload = { shouldNotBeRetained: true };
  const finalizerError = Object.assign(new Error("owned finalizer boom"), { payload: retainedPayload });
  const resource = createHostResource({ kind: "finalizer error" }, "finalizer error", {
    dispose: () => {
      throw finalizerError;
    },
  });
  const root = state.rootResource(resource, 1);
  assert.doesNotThrow(() => state.releaseRootedResourceFromFinalizer(root));
  for (let index = 0; index < 20; index++) {
    state.recordFinalizerError(new Error(`extra finalizer error ${index}`));
  }
  assert.equal(state.finalizerErrorMessages.length, 16);
  assert.equal(state.finalizerErrorMessages.every((message) => typeof message === "string"), true);
  const errors = state.takeFinalizerErrors();
  assert.equal(errors.length, 17);
  assert.equal(errors.some((error) => Object.hasOwn(error, "payload")), false);
  assert.match(errors[0].message, /owned finalizer boom/);
  state.dispose({ disposeBindings: false });
}

{
  const resources = createHostResourceState();
  const value = { kind: "passive" };
  const first = resources.resourceForValue(value);
  const second = resources.resourceForValue(value);
  assert.notEqual(first, second, "passive values should receive independent wrappers");
  assert.equal(resources.resolveResource(first, "passive"), value);
  assert.equal(resources.resolveResource(second, "passive"), value);
  assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);

  resources.releaseResource(first);
  assert.throws(() => resources.resolveResource(first, "passive"), /resource is not live/);
  assert.equal(resources.resolveResource(second, "passive"), value);

  const otherResources = createHostResourceState();
  assert.throws(() => otherResources.resolveResource(second, "passive"), /resource is not live/);
  otherResources.dispose();

  resources.dispose();
  assert.throws(() => resources.resolveResource(second, "passive"), /resource is not live/);
  assert.throws(() => resources.resourceForValue(value), /disposed/);
  assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);
}

{
  const state = createVirtualDocumentState();
  const [element] = ensureVirtualElementStates(state, "#inner-html-borrow", [
    createVirtualElementState(),
  ]);
  const bindings = createVirtualDocumentHostBindings(state);
  const common = createCommonHostBindings(state.resources);
  const elementResource = state.resources.resourceForValue(element);
  const htmlResource = state.resources.resourceForValue("<strong>borrowed</strong>");
  bindings["browser.element.setInnerHTML"](elementResource, htmlResource);
  assert.equal(
    state.resources.resolveResource(htmlResource, "JsString"),
    "<strong>borrowed</strong>",
    "Element.innerHTML must borrow rather than consume its string argument",
  );
  const result = bindings["browser.element.getInnerHTML"](elementResource);
  assert.equal(state.resources.resolveResource(result, "JsString"), "<strong>borrowed</strong>");

  const textResource = state.resources.resourceForValue("borrowed text");
  const nullableText = common["js.nullable.of"](textResource);
  bindings["browser.element.setTextContent"](elementResource, nullableText);
  assert.doesNotThrow(
    () => state.resources.resolveResource(nullableText, "JsNullable"),
    "Element.textContent must borrow rather than consume its nullable string argument",
  );
  const textResult = bindings["browser.element.getTextContent"](elementResource);
  assert.equal(state.resources.resolveResource(textResult, "JsString"), "borrowed text");

  const nullText = common["js.nullable.null"]();
  bindings["browser.element.setTextContent"](elementResource, nullText);
  assert.equal(element.textContent, "", "assigning null to Element.textContent should clear its text");
  const emptyResult = bindings["browser.element.getTextContent"](elementResource);
  assert.equal(state.resources.resolveResource(emptyResult, "JsString"), "");

  state.resources.releaseResource(emptyResult);
  state.resources.releaseResource(nullText);
  state.resources.releaseResource(textResult);
  state.resources.releaseResource(nullableText);
  state.resources.releaseResource(textResource);
  state.resources.releaseResource(result);
  state.resources.releaseResource(htmlResource);
  state.resources.releaseResource(elementResource);
  state.resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const [element] = ensureVirtualElementStates(state, "#weakref-preflight", [
    createVirtualElementState(),
  ]);
  const bindings = createVirtualDocumentHostBindings(state);
  const elementResource = state.resources.resourceForValue(element);
  const eventName = state.resources.resourceForValue("click");
  let callbackReleases = 0;
  const callback = Object.assign(() => undefined, {
    release() {
      callbackReleases++;
      return true;
    },
  });
  const previousWeakRef = globalThis.WeakRef;
  globalThis.WeakRef = undefined;
  try {
    assert.throws(
      () => bindings["browser.element.addEventListener"](elementResource, eventName, callback),
      /revocable host resources require WeakRef support/,
    );
  } finally {
    globalThis.WeakRef = previousWeakRef;
  }
  assert.equal(element.listeners.has("click"), false, "WeakRef preflight must run before listener installation");
  assert.equal(callbackReleases, 0, "a rejected direct binding call must leave its incoming callback untouched");
  assert.deepEqual(state.resources.debugResourceCounts(), emptyResourceCounts);
  state.resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const [element] = ensureVirtualElementStates(state, "#throwing-listener-release", [
    createVirtualElementState(),
  ]);
  const bindings = createVirtualDocumentHostBindings(state);
  const elementResource = state.resources.resourceForValue(element);
  const eventName = state.resources.resourceForValue("click");
  let callbackReleases = 0;
  const callback = Object.assign(() => undefined, {
    release() {
      if (callbackReleases !== 0) return false;
      callbackReleases++;
      throw new Error("listener release boom");
    },
  });
  const listener = bindings["browser.element.addEventListener"](
    elementResource,
    eventName,
    callback,
  );
  commitHostResource(listener);
  assert.equal(state.resources.debugResourceCounts().owners, 1);
  assert.throws(
    () => bindings["browser.element.removeEventListener"](listener),
    /listener release boom/,
  );
  assert.equal(callbackReleases, 1);
  assert.equal(element.listeners.get("click")?.length ?? 0, 0);
  assert.equal(
    state.resources.debugResourceCounts().owners,
    0,
    "throwing listener cleanup must still detach its runtime owner",
  );
  assert.throws(
    () => state.resources.resolveResource(listener, "EventListener"),
    /resource is not live/,
    "throwing listener cleanup must still invalidate every public alias",
  );
  state.resources.dispose();
}

{
  const state = createVirtualDocumentState();
  const bindings = createVirtualDocumentHostBindings(state);
  let callbackReleases = 0;
  const callback = Object.assign(() => undefined, {
    release() {
      if (callbackReleases !== 0) return false;
      callbackReleases++;
      throw new Error("timeout release boom");
    },
  });
  const timeout = bindings["browser.timer.setTimeout"](
    state.resources.resourceForValue(60_000n),
    callback,
  );
  commitHostResource(timeout);
  assert.equal(state.resources.debugResourceCounts().owners, 1);
  assert.throws(
    () => bindings["browser.timer.clearTimeout"](timeout),
    /timeout release boom/,
  );
  assert.equal(callbackReleases, 1);
  assert.equal(state.resources.debugResourceCounts().owners, 0);
  assert.throws(
    () => state.resources.resolveResource(timeout, "Timeout"),
    /resource is not live/,
  );
  state.resources.dispose();
}

{
  const cell = { aliases: 0 };
  const createAlias = () => {
    let live = true;
    const alias = {};
    cell.aliases++;
    registerHostResourcePayloadLifetime(alias, {
      retain: createAlias,
      release: () => {
        if (!live) return false;
        live = false;
        cell.aliases--;
        return true;
      },
    });
    return alias;
  };
  const source = createAlias();
  const resources = createHostResourceState();
  resources.resourceForValue(source);
  assert.equal(cell.aliases, 2);
  assert.equal(resources.debugResourceCounts().owners, 1);
  releaseHostResourcePayload(source);
  assert.equal(cell.aliases, 1);
  resources.dispose();
  assert.equal(cell.aliases, 0, "resource-store disposal should release owned payload aliases");
  assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);
}

{
  const cell = { aliases: 0 };
  const createAlias = () => {
    let live = true;
    const alias = {};
    cell.aliases++;
    registerHostResourcePayloadLifetime(alias, {
      retain: createAlias,
      release: () => {
        if (!live) return false;
        live = false;
        cell.aliases--;
        return true;
      },
    });
    return alias;
  };
  const resources = createHostResourceState();
  const common = createCommonHostBindings(resources);
  const input = resources.adoptResourceForValue(createAlias());
  const nullable = common["js.nullable.of"](input);
  assert.equal(cell.aliases, 2, "Js.Nullable must retain its retainable child payload");
  resources.releaseResource(input);
  assert.equal(cell.aliases, 1);

  const extracted = common["js.nullable.value"](nullable);
  assert.equal(cell.aliases, 2);
  resources.releaseResource(nullable);
  assert.equal(cell.aliases, 1, "the extracted alias must survive its nullable container");
  resources.releaseResource(extracted);
  assert.equal(cell.aliases, 0);
  assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);
  resources.dispose();
}

{
  const first = {};
  const second = {};
  registerHostResourcePayloadLifetime(first, {
    children: [second],
    retain: () => first,
    release: () => false,
  });
  assert.throws(
    () => registerHostResourcePayloadLifetime(second, {
      children: [first],
      retain: () => second,
      release: () => false,
    }),
    /ownership cycle is not supported/,
  );
}

{
  const resources = createHostResourceState();
  let rejectedRegistrationDisposed = false;
  resources.addDisposable({
    dispose() {
      resources.addDisposable({
        dispose() {
          rejectedRegistrationDisposed = true;
        },
      });
    },
  });
  assert.throws(() => resources.dispose(), /cannot register active resources/);
  assert.equal(
    rejectedRegistrationDisposed,
    true,
    "an active resource created during teardown should be rolled back immediately",
  );
  assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);
}

{
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const elements = [
    { textContent: "first" },
    { textContent: "second" },
  ];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelectorAll(selector) {
        return createStaticNodeList(selector === ".match" ? elements : []);
      },
    },
  });
  try {
    const resources = createHostResourceState();
    const common = createCommonHostBindings(resources);
    const documentBindings = createBrowserDocumentHostBindings(resources);
    const selector = resources.resourceForValue(".match");
    const nodes = documentBindings["browser.document.querySelectorAll"](selector);

    assert.equal(jsNat(common, resources, "js.nodeList.length", nodes), 2n);
    const firstNullable = common["js.nodeList.item"](
      nodes,
      resources.resourceForValue(0n),
    );
    const first = common["js.nullable.value"](firstNullable);
    assert.equal(resources.resolveResource(first, "Element"), elements[0]);

    const missing = common["js.nodeList.item"](
      nodes,
      resources.resourceForValue(10n),
    );
    assert.equal(
      resources.resolveResource(common["js.nullable.isNull"](missing), "JsBool"),
      true,
    );

    const array = common["js.nodeList.toArray"](nodes);
    assert.equal(jsNat(common, resources, "js.array.length", array), 2n);
    const second = common["js.nullable.value"](
      common["js.array.item"](array, resources.resourceForValue(1n)),
    );
    assert.equal(resources.resolveResource(second, "Element"), elements[1]);

    resources.releaseResource(nodes);
    resources.releaseResource(array);
    assert.equal(resources.resolveResource(first, "Element"), elements[0]);
    assert.equal(resources.resolveResource(second, "Element"), elements[1]);
    assert.deepEqual(resources.debugResourceCounts(), emptyResourceCounts);
    resources.dispose();
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, "document", previousDocument);
    }
  }
}

{
  const state = createVirtualDocumentState();
  const elements = ensureVirtualElementStates(state, ".virtual", [
    createVirtualElementState({ textContent: "one" }),
    createVirtualElementState({ textContent: "two" }),
  ]);
  const bindings = {
    ...createCommonHostBindings(state.resources),
    ...createVirtualDocumentHostBindings(state),
  };
  const nodes = bindings["browser.document.querySelectorAll"](
    state.resources.resourceForValue(".virtual"),
  );
  assert.equal(jsNat(bindings, state.resources, "js.nodeList.length", nodes), 2n);
  const second = bindings["js.nullable.value"](
    bindings["js.nodeList.item"](nodes, state.resources.resourceForValue(1n)),
  );
  assert.equal(state.resources.resolveResource(second, "Element"), elements[1]);
  state.resources.dispose();
}

function jsNat(bindings, resources, target, value) {
  return resources.resolveResource(bindings[target](value), "JsNat");
}

console.log("host resource lifecycle smoke ok");
