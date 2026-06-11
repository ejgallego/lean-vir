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
  createBrowserHostBindings,
  createBrowserReactHostBindings,
} from "../../web/src/vir-host-bindings.js";
import {
  assert,
  reactHtmlElement,
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
  smokeVirtualReactInput,
  smokeVirtualReactTamagotchi,
} from "../virtual-react-smoke-scenarios.mjs";

const { wasmBytes, hostPackageBytes, irPackageBytes } = await readRuntimeArtifacts();

const browserBindingsWithReact = createBrowserHostBindings({
  reactHostBindings: {
    "react.root.create": () => ({ handle: 1 }),
  },
});
assert.equal(typeof browserBindingsWithReact["browser.document.getTitle"], "function");
assert.equal(typeof browserBindingsWithReact["react.root.create"], "function");
assert.throws(
  () => createBrowserHostBindings({ reactHostBindings: "react.root.create" }),
  /reactHostBindings must be a host binding object/,
);
assert.throws(
  () => createBrowserReactHostBindings(),
  /Browser React host bindings moved to lean-vir\/react-host-bindings/,
);

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
  "#react-input",
  "#react-change",
  "#react-checkbox",
  "#react-attributes",
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
smokeVirtualReactInput(reactRuntime, reactDocumentState, "#react-input");
smokeVirtualReactChangeInput(reactRuntime, reactDocumentState, "#react-change");
smokeVirtualReactCheckbox(reactRuntime, reactDocumentState, "#react-checkbox");
smokeVirtualReactAttributes(reactRuntime, reactDocumentState, "#react-attributes", { assertKeys: true });
smokeVirtualReactTamagotchi(reactRuntime, reactDocumentState, "#react-pet", { extended: true });
assert.equal(reactRuntime.call("ReactCounter.mountAndUnmount", "#react-unmount"), true);
assert.equal(reactRuntime.liveCallbacks.size, 0);
assert.equal(reactDocumentState.elements.get("#react-unmount").reactRoot, undefined);
assert.throws(
  () => reactRuntime.call("ReactCounter.renderAfterUnmount", "#react-stale-root"),
  /ReactRoot resource handle \d+ is not live/,
);
assert.equal(reactRuntime.liveCallbacks.size, 0);
assert.throws(
  () => reactRuntime.call("ReactCounter.renderTooDeep", "#react-too-deep"),
  /React Html exceeds maximum depth 128/,
);
assert.equal(reactRuntime.liveCallbacks.size, 0);

const malformedReactDocumentState = createVirtualDocumentState();
ensureVirtualElementState(malformedReactDocumentState, "#react-malformed");
const malformedReactHost = createVirtualDocumentHostBindings(malformedReactDocumentState);
const malformedReactContainer = malformedReactHost["browser.document.querySelector"]("#react-malformed");
const malformedReactRoot = malformedReactHost["react.root.create"](malformedReactContainer);
const renderMalformedReactHtml = (html) => malformedReactHost["react.root.render"](malformedReactRoot, html);
renderMalformedReactHtml(reactHtmlElement({
  props: [
    { name: "tabIndex", value: { kind: "int", value: "4" } },
    { name: "data-ratio", value: { kind: "float", value: 1.5 } },
    { name: "className", value: { kind: "classList", value: ["alpha", "beta", "alpha"] } },
    { name: "style", value: { kind: "style", value: [{ name: "marginTop", value: "1px" }] } },
  ],
}));
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.tabIndex, 4);
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props["data-ratio"], 1.5);
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.className, "alpha beta");
assert.equal(malformedReactDocumentState.elements.get("#react-malformed").reactRoot.current.props.style.marginTop, "1px");
assert.throws(
  () => renderMalformedReactHtml({ kind: "text", value: 1 }),
  /React Html text value must be a string/,
);
assert.throws(
  () => renderMalformedReactHtml({ kind: "element", fields: null }),
  /React Html element fields must be an object/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({ tag: "" })),
  /React Html element tag must be a non-empty string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({ "key?": 7 })),
  /React Html element key must be a string or null/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: 1, value: { kind: "string", value: "bad" } }],
  })),
  /React Html property name must be a non-empty string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "data-", value: { kind: "string", value: "bad" } }],
  })),
  /React Html data-\* property name must include a suffix/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "__proto__", value: { kind: "string", value: "bad" } }],
  })),
  /React Html property name is not supported/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "title", value: { kind: "string", value: false } }],
  })),
  /React PropValue\.string value must be a string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "hidden", value: { kind: "bool", value: "false" } }],
  })),
  /React PropValue\.bool value must be a boolean/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "tabIndex", value: { kind: "int", value: "7.5" } }],
  })),
  /React PropValue\.int value must be a safe integer/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "tabIndex", value: { kind: "int", value: "9007199254740992" } }],
  })),
  /React PropValue\.int value must be a safe integer/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "value", value: { kind: "float", value: "1.5" } }],
  })),
  /React PropValue\.float value must be a finite number/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "title", value: { kind: "style", value: [] } }],
  })),
  /React PropValue\.style is only supported for the style prop/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "style", value: { kind: "style", value: "margin-top: 1px" } }],
  })),
  /React PropValue\.style value must be an array/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "style", value: { kind: "style", value: ["marginTop"] } }],
  })),
  /React PropValue\.style\[0\] must be an object/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "", value: "1px" }] } }],
  })),
  /React PropValue\.style\[0\]\.name must be a non-empty string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "__proto__", value: "1px" }] } }],
  })),
  /React PropValue\.style\[0\]\.name is not supported/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "style", value: { kind: "style", value: [{ name: "marginTop", value: 1 }] } }],
  })),
  /React PropValue\.style\[0\]\.value must be a string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "title", value: { kind: "classList", value: [] } }],
  })),
  /React PropValue\.classList is only supported for the className prop/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "className", value: { kind: "classList", value: "alpha beta" } }],
  })),
  /React PropValue\.classList value must be an array/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "className", value: { kind: "classList", value: ["ok", ""] } }],
  })),
  /React PropValue\.classList\[1\] must be a non-empty token without whitespace/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "className", value: { kind: "classList", value: ["ok", "bad token"] } }],
  })),
  /React PropValue\.classList\[1\] must be a non-empty token without whitespace/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    props: [{ name: "data-x", value: { kind: "number", value: 1 } }],
  })),
  /React PropValue must be string, bool, int, float, style, or classList/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    handlers: [{ name: 1, callback: Object.assign(() => undefined, { release: () => undefined }) }],
  })),
  /React Html event handler name must be a non-empty string/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    handlers: [{ name: "__proto__", callback: Object.assign(() => undefined, { release: () => undefined }) }],
  })),
  /React Html event handler name is not supported/,
);
assert.throws(
  () => renderMalformedReactHtml(reactHtmlElement({
    handlers: [{ name: "onClick" }],
  })),
  /React Html event handler callback must be a releasable function/,
);

assert.equal(reactRuntime.call("ReactCounter.mount", "#react-dispose"), true);
assert.equal(reactRuntime.liveCallbacks.size, 1);
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
assert.equal(reactReloadRuntime.liveCallbacks.size, 1);
reactReloadRuntime.loadIrPackageBytes(irPackageBytes);
assert.equal(reactReloadRuntime.liveCallbacks.size, 0);
assert.equal(reactReloadDocumentState.elements.get("#react-reload").reactRoot, undefined);
reactReloadRuntime.dispose();

console.log("vir runtime React host bindings smoke ok");
