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
  createHostResource,
  ExternrefResourceRoots,
  hostResourceValue,
  registerHostResourcePayloadLifetime,
  releaseHostResource,
  releaseHostResourcePayload,
} from "../../web/src/host-resource.js";

const emptyResourceCounts = {
  passiveStrong: 0,
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
  releaseHostResource(transferred);
  assert.equal(transferredDisposals, 1);
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
