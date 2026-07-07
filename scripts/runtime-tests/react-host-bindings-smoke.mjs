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
  createBrowserHostBindings,
  createCommonHostBindings,
} from "../../web/src/vir-host-bindings.js";
import {
  createReactJsValueHostBindings,
  createReactStateHostBindings,
} from "../../web/src/react/vir-react-hooks.js";
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
  smokeVirtualReactExternalComponent,
  smokeVirtualReactMemo,
  smokeVirtualReactRefFragment,
  smokeVirtualReactInput,
  smokeVirtualProofWidgetsHtml,
  smokeVirtualProofWidgetsJsxSubset,
  smokeVirtualReactProofWidget,
  smokeVirtualReactProofWidgetHello,
  smokeVirtualReactSelectTextarea,
  smokeVirtualReactTamagotchi,
} from "../virtual-react-smoke-scenarios.mjs";

const { wasmBytes, hostPackageBytes, irPackageBytes } = await readRuntimeArtifacts();

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

{
  const { resources, jsBindings, stateBindings } = createReactStateSmokeBindings();
  const retainedZero = resources.resourceForValue(0n);
  let stateValue = 0n;
  const setter = resources.resourceForValue({
    set(next) {
      stateValue = typeof next === "function" ? next(stateValue) : next;
    },
  });
  const liveBeforeModify = resources.debugResourceCounts().live;
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
  assert.equal(resources.resourceForValue(0n), retainedZero);
  assert.equal(resources.debugResourceCounts().live, liveBeforeModify);
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
  const liveBeforeModify = resources.debugResourceCounts().live;
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
  assert.equal(resources.debugResourceCounts().live, liveBeforeModify);
  resources.releaseResource(setter);
}

const reactDocumentState = createVirtualDocumentState();
const reactRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
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
  "#react-ref-fragment",
  "#react-external-component",
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
  irPackageBytes: hostPackageBytes,
  virtualDocumentState: missingSelectorDocumentState,
});
assert.equal(missingSelectorRuntime.call("ReactCounter.mount", "#missing-react-root"), false);
assert.equal(missingSelectorRuntime.liveCallbacks.size, 0);
missingSelectorRuntime.dispose();
smokeVirtualReactCounter(reactRuntime, reactDocumentState, "#react-counter");
smokeVirtualReactEffect(reactRuntime, reactDocumentState, "#react-effect");
smokeVirtualReactMemo(reactRuntime, reactDocumentState, "#react-memo");
smokeVirtualReactRefFragment(reactRuntime, reactDocumentState, "#react-ref-fragment");
smokeVirtualReactExternalComponent(reactRuntime, reactDocumentState, "#react-external-component");
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
  irPackageBytes: hostPackageBytes,
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
reactReloadRuntime.loadIrPackageBytes(irPackageBytes);
assert.equal(reactReloadRuntime.liveCallbacks.size, 0);
assert.equal(reactReloadDocumentState.elements.get("#react-reload").reactRoot, undefined);
reactReloadRuntime.dispose();

console.log("vir runtime React host bindings smoke ok");
