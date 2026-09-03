/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createBrowserDocumentHostBindings,
  createBrowserElementHostBindings,
  createBrowserEventHostBindings,
  createConsoleHostBindings,
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  createVirtualEventState,
  ensureVirtualElementState,
} from "../../web/src/vir-host-bindings.js";
import { createDOMTokenListHostBindings } from "../../web/src/host/vir-dom-host-bindings.js";

const calls = [];
const consoleCalls = [];
const consoleBindings = createConsoleHostBindings();
const consoleValue = { log: (message) => consoleCalls.push(message) };
consoleBindings["browser.console.log"](consoleValue, "exact receiver");
assert.deepEqual(consoleCalls, ["exact receiver"]);
assert.equal(
  consoleBindings["browser.console.current"](),
  globalThis.console,
);

const documentCalls = [];
const documentValue = {
  title: "initial",
  querySelector: (selector) => {
    documentCalls.push(["querySelector", selector]);
    return null;
  },
  querySelectorAll: (selector) => {
    documentCalls.push(["querySelectorAll", selector]);
    return [];
  },
  createElement: (tagName) => {
    documentCalls.push(["createElement", tagName]);
    return { tagName };
  },
};
const documentBindings = createBrowserDocumentHostBindings();
assert.equal(
  documentBindings["browser.document.getTitle"](documentValue),
  "initial",
);
documentBindings["browser.document.setTitle"](documentValue, "updated");
assert.equal(documentValue.title, "updated");
assert.equal(
  documentBindings["browser.document.querySelector"](documentValue, "#x"),
  null,
);
assert.deepEqual(
  documentBindings["browser.document.querySelectorAll"](
    documentValue,
    ".row",
  ),
  [],
);
assert.deepEqual(
  documentBindings["browser.document.createElement"](documentValue, "p"),
  { tagName: "p" },
);
assert.deepEqual(documentCalls, [
  ["querySelector", "#x"],
  ["querySelectorAll", ".row"],
  ["createElement", "p"],
]);

const child = { id: "child" };
const element = {
  textContent: "",
  attributes: new Map(),
  _classList: {
    add: (name) => calls.push(["class.add", name]),
    remove: (name) => calls.push(["class.remove", name]),
    toggle: (name) => {
      calls.push(["class.toggle", name]);
      return true;
    },
  },
  get classList() {
    return this._classList;
  },
  set classList(value) {
    calls.push(["class.set", value]);
  },
  _style: {
    setProperty: (name, value) => calls.push(["style.property", name, value]),
  },
  get style() {
    return this._style;
  },
  set style(value) {
    calls.push(["style.text", value]);
  },
  appendChild: (value) => calls.push(["append", value]),
  remove: () => calls.push(["remove"]),
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  },
  setAttribute(name, value) {
    this.attributes.set(name, value);
  },
  addEventListener: (name, listener) =>
    calls.push(["listener.add", name, listener]),
  removeEventListener: (name, listener) =>
    calls.push(["listener.remove", name, listener]),
};
const elementBindings = createBrowserElementHostBindings();
const eventBindings = createBrowserEventHostBindings();
const tokenBindings = createDOMTokenListHostBindings();
const listener = () => undefined;

const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
class TestElement {}
Object.defineProperty(globalThis, "Element", {
  configurable: true,
  writable: true,
  value: TestElement,
});
try {
  const elementTarget = new TestElement();
  const nonElementTarget = {};
  assert.equal(
    eventBindings["browser.event.target"]({ target: elementTarget }),
    elementTarget,
  );
  assert.equal(
    eventBindings["browser.event.currentTarget"]({
      currentTarget: nonElementTarget,
    }),
    nonElementTarget,
  );
  assert.equal(
    eventBindings["browser.eventTarget.asElement"](elementTarget),
    elementTarget,
  );
  assert.equal(
    eventBindings["browser.eventTarget.asElement"](nonElementTarget),
    null,
  );
} finally {
  if (previousElement) {
    Object.defineProperty(globalThis, "Element", previousElement);
  } else {
    delete globalThis.Element;
  }
}

assert.equal(
  eventBindings["js.value.browser.eventListener"](listener),
  listener,
);
elementBindings["browser.element.addEventListener"](element, "click", listener);
elementBindings["browser.element.removeEventListener"](
  element,
  "click",
  listener,
);

assert.equal(
  elementBindings["browser.element.appendChild"](element, child),
  child,
);
const tokenList = elementBindings["browser.element.getClassList"](element);
assert.equal(tokenList, element.classList);
tokenBindings["browser.domTokenList.add"](tokenList, "active");
tokenBindings["browser.domTokenList.remove"](tokenList, "hidden");
assert.equal(
  tokenBindings["browser.domTokenList.toggle"](tokenList, "ready"),
  true,
);
elementBindings["browser.element.setClassList"](element, "ready selected");
assert.equal(
  elementBindings["browser.elementCSSInlineStyle.fromElement"](element),
  element,
);
assert.equal(
  elementBindings["browser.elementCSSInlineStyle.fromElement"]({}),
  null,
);
const declaration =
  elementBindings["browser.elementCSSInlineStyle.getStyle"](element);
assert.equal(declaration, element.style);
elementBindings["browser.cssStyleDeclaration.setProperty"](
  declaration,
  "color",
  "red",
);
elementBindings["browser.cssStyleDeclaration.setProperty"](
  declaration,
  "display",
  null,
);
elementBindings["browser.elementCSSInlineStyle.setStyle"](
  element,
  "color: blue",
);
elementBindings["browser.element.remove"](element);
assert.deepEqual(calls, [
  ["listener.add", "click", listener],
  ["listener.remove", "click", listener],
  ["append", child],
  ["class.add", "active"],
  ["class.remove", "hidden"],
  ["class.toggle", "ready"],
  ["class.set", "ready selected"],
  ["style.property", "color", "red"],
  ["style.property", "display", null],
  ["style.text", "color: blue"],
  ["remove"],
]);

const virtualState = createVirtualDocumentState();
const virtualBindings = createVirtualDocumentHostBindings(virtualState);
const virtualDocument = virtualBindings["browser.document.current"]();
assert.equal(virtualDocument, virtualState);
assert.equal(
  virtualBindings["browser.document.createElement"](virtualDocument, "p")
    .textContent,
  "",
);
const virtualElement = ensureVirtualElementState(virtualState, "#present");
const virtualEvent = createVirtualEventState({
  target: virtualElement,
  currentTarget: virtualElement,
});
assert.equal(
  virtualBindings["browser.event.target"](virtualEvent),
  virtualElement,
);
assert.equal(
  virtualBindings["browser.event.currentTarget"](virtualEvent),
  virtualElement,
);
assert.equal(
  virtualBindings["browser.eventTarget.asElement"](virtualElement),
  virtualElement,
);
const virtualPlainEvent = createVirtualEventState();
assert.equal(
  virtualBindings["browser.keyboardEvent.fromEvent"](virtualPlainEvent),
  null,
);
const virtualKeyboardEvent = createVirtualEventState({ key: "Enter" });
assert.equal(
  virtualBindings["browser.keyboardEvent.fromEvent"](virtualKeyboardEvent),
  virtualKeyboardEvent,
);
assert.equal(
  virtualBindings["browser.keyboardEvent.getKey"](virtualKeyboardEvent),
  "Enter",
);
const virtualTokenList =
  virtualBindings["browser.element.getClassList"](virtualElement);
assert.equal(
  virtualBindings["browser.element.getClassList"](virtualElement),
  virtualTokenList,
);
virtualBindings["browser.domTokenList.add"](virtualTokenList, "active");
virtualBindings["browser.domTokenList.add"](virtualTokenList, "selected");
virtualBindings["browser.domTokenList.remove"](virtualTokenList, "active");
assert.equal(
  virtualBindings["browser.domTokenList.toggle"](virtualTokenList, "ready"),
  true,
);
assert.equal(virtualElement.attributes.get("class"), "selected ready");
virtualBindings["browser.element.setClassList"](virtualElement, "reset");
assert.equal(virtualElement.attributes.get("class"), "reset");
assert.equal(
  virtualBindings["browser.elementCSSInlineStyle.fromElement"](virtualElement),
  virtualElement,
);
const virtualStyle =
  virtualBindings["browser.elementCSSInlineStyle.getStyle"](virtualElement);
virtualBindings["browser.cssStyleDeclaration.setProperty"](
  virtualStyle,
  "color",
  "red",
);
assert.equal(virtualStyle.properties.get("color"), "red");
virtualBindings["browser.elementCSSInlineStyle.setStyle"](
  virtualElement,
  "color: blue",
);
assert.equal(virtualStyle.cssText, "color: blue");
assert.equal(
  virtualBindings["browser.elementCSSInlineStyle.fromElement"](
    createVirtualElementState({ inlineStyle: null }),
  ),
  null,
);

console.log("vir browser DOM bindings smoke ok");
