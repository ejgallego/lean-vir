/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createHostResource,
  ExternrefResourceRoots,
  registerHostResourcePayloadLifetime,
} from "../../web/src/host-resource.js";
import {
  createHostResourceState,
  createReactHostHooks,
} from "../../web/src/host/vir-host-resources.js";
import { createBrowserReactHookRuntime } from "../../web/src/react/vir-react-hooks.js";
import {
  createBrowserReactRootResource,
  createReactNodeResource,
} from "../../web/src/react/vir-react-node.js";

assert.equal(typeof globalThis.gc, "function", "host resource GC smoke requires --expose-gc");

let directReleases = 0;
(() => {
  createHostResource({}, "direct GC resource", {
    dispose: () => {
      directReleases++;
    },
  });
})();

let transferredReleases = 0;
let throwingReleases = 0;
let unrenderedNodeCallbacks = 0;
const abandonedComponentCallbacks = { active: 0 };
const resources = createHostResourceState();
const roots = new ExternrefResourceRoots();
(() => {
  let live = true;
  const payload = {};
  registerHostResourcePayloadLifetime(payload, {
    retain: () => payload,
    release: () => {
      if (!live) return false;
      live = false;
      transferredReleases++;
      return true;
    },
  });
  const result = resources.adoptResourceForValue(payload);
  const root = roots.root(result, { owned: true });
  assert.equal(roots.get(root, { take: true }), result);
  assert.equal(resources.debugResourceCounts().owners, 0);
  roots.release(root);
})();
(() => {
  const payload = {};
  registerHostResourcePayloadLifetime(payload, {
    retain: () => payload,
    release: () => {
      throwingReleases++;
      throw new Error("GC payload cleanup boom");
    },
  });
  const result = resources.adoptResourceForValue(payload);
  const root = roots.root(result, { owned: true });
  assert.equal(roots.get(root, { take: true }), result);
  roots.release(root);
})();
(() => {
  let released = false;
  const callback = Object.assign(() => undefined, {
    release() {
      if (released) return false;
      released = true;
      unrenderedNodeCallbacks--;
      return true;
    },
  });
  unrenderedNodeCallbacks++;
  resources.adoptResourceForValue(createReactNodeResource(resources, {
    node: { kind: "text", value: "unrendered" },
    callbacks: [callback],
  }), { tracked: false });
})();

const React = {
  createElement(type, props = null, ...children) {
    return { type, props: { ...(props ?? {}), children } };
  },
  useLayoutEffect() {},
};
let pendingReactTree = null;
const reactRoot = createBrowserReactRootResource(resources, {
  render(tree) {
    pendingReactTree = tree;
  },
  unmount() {
    pendingReactTree = null;
  },
}, React, {
  ...createReactHostHooks(),
  hookRuntime: createBrowserReactHookRuntime(resources, React),
});
function callbackLease(cell) {
  let released = false;
  const callback = Object.assign(() => undefined, {
    retain() {
      if (released) throw new Error("abandoned callback lease has been released");
      return callbackLease(cell);
    },
    release() {
      if (released) return false;
      released = true;
      cell.active--;
      return true;
    },
  });
  cell.active++;
  return callback;
}
function stageAbandonedComponent() {
  reactRoot.renderComponent(callbackLease(abandonedComponentCallbacks));
}
stageAbandonedComponent();
const replacement = resources.adoptResourceForValue(createReactNodeResource(resources, {
  node: { kind: "text", value: "replacement" },
}), { tracked: false });
reactRoot.render(replacement);

for (let attempt = 0; attempt < 200 && (
  directReleases !== 1 ||
  transferredReleases !== 1 ||
  throwingReleases !== 1 ||
  unrenderedNodeCallbacks !== 0 ||
  abandonedComponentCallbacks.active !== 0 ||
  resources.gcFinalizerErrorMessages.length !== 1
); attempt++) {
  globalThis.gc();
  await new Promise((resolve) => setImmediate(resolve));
}

assert.equal(directReleases, 1, "an unreachable disposable HostResource must be finalized exactly once");
assert.equal(
  transferredReleases,
  1,
  "an unreachable resource taken from an owned WASM root must release its payload lease",
);
assert.equal(throwingReleases, 1);
assert.equal(unrenderedNodeCallbacks, 0, "an unreachable unrendered node must release its callbacks");
assert.equal(
  abandonedComponentCallbacks.active,
  0,
  "an abandoned component render generation must not remain rooted by the runtime",
);
assert.deepEqual(resources.gcFinalizerErrorMessages, ["Error: GC payload cleanup boom"]);
reactRoot.unmount();
resources.releaseResource(replacement);
assert.throws(() => resources.dispose(), /GC payload cleanup boom/);

console.log("host resource GC smoke ok");
