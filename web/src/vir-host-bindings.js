/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  callLeanEventCallback,
  createAnimationResourceHostBindings,
  createElementResourceHostBindings,
  createHostResourceState,
  createHtmlInputElementResourceHostBindings,
  createTimerResourceHostBindings,
  disposeDomResourceState,
  once,
  performanceNow,
  preventDefaultOnEvent,
  removeDisposable,
  resolveResource,
  resourceForValue,
  stopPropagationOnEvent,
} from "./host/vir-host-resources.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
} from "./host/vir-virtual-host-bindings.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./host-resource.js";
export {
  createHostResourceState,
} from "./host/vir-host-resources.js";
export {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  ensureVirtualElementState,
  findVirtualReactElementById,
  createVirtualEventState,
  createVirtualEventHostBindings,
  virtualReactElementById,
} from "./host/vir-virtual-host-bindings.js";

const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

export function createCommonHostBindings() {
  return {
    "common.echoString": (value) => value,
    "common.addNat": (lhs, rhs) => (BigInt(lhs) + BigInt(rhs)).toString(),
  };
}

export function createConsoleHostBindings() {
  return {
    "browser.console.log": (message) => {
      console.log(message);
      return undefined;
    },
  };
}

export function createBrowserDocumentHostBindings(state = createHostResourceState()) {
  return {
    "browser.document.getTitle": () => browserDocument().title,
    "browser.document.setTitle": (title) => {
      browserDocument().title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state, queryDocumentElement(selector)),
  };
}

export function createBrowserEventHostBindings(state = createHostResourceState()) {
  return {
    "browser.event.target": (event) =>
      resourceForElementTarget(state, resolveResource(state, event, "Event").target),
    "browser.event.currentTarget": (event) =>
      resourceForElementTarget(state, resolveResource(state, event, "Event").currentTarget),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(resolveResource(state, event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(resolveResource(state, event, "Event"));
      return undefined;
    },
  };
}

export function createBrowserElementHostBindings(state = createHostResourceState()) {
  return createElementResourceHostBindings(state, {
    getTextContent: (target) => target.textContent ?? "",
    setTextContent: (target, text) => {
      target.textContent = text;
    },
    getAttribute: (target, name) => target.getAttribute(name) ?? null,
    setAttribute: (target, name, value) => target.setAttribute(name, value),
    createEventListener: (target, eventName, callback) =>
      createBrowserEventListenerResource(state, target, eventName, callback),
  });
}

export function createBrowserHtmlInputElementHostBindings(state = createHostResourceState()) {
  return createHtmlInputElementResourceHostBindings(state, {
    fromElement: (element) => isInputElement(element) ? resourceForValue(state, element) : null,
  });
}

export function createBrowserTimerHostBindings(state = createHostResourceState()) {
  return createTimerResourceHostBindings(state);
}

export function createBrowserAnimationHostBindings(state = createHostResourceState()) {
  const requestFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => globalThis.setTimeout(() => callback(performanceNow()), 16);
  const cancelFrame =
    typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : globalThis.clearTimeout.bind(globalThis);
  return createAnimationResourceHostBindings(state, { requestFrame, cancelFrame });
}

export function createBrowserHostBindings({
  resources = createHostResourceState(),
  reactHostBindings = null,
} = {}) {
  const state = resources;
  const reactBindingsSource =
    typeof reactHostBindings === "function"
      ? reactHostBindings(state)
      : reactHostBindings;
  const reactBindings = normalizeOptionalHostBindingMap(reactBindingsSource, "reactHostBindings");
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(state),
    ...createBrowserEventHostBindings(state),
    ...createBrowserElementHostBindings(state),
    ...createBrowserHtmlInputElementHostBindings(state),
    ...createBrowserTimerHostBindings(state),
    ...createBrowserAnimationHostBindings(state),
    ...reactBindings,
    [VIR_HOST_DISPOSE]: () => disposeDomResourceState(state),
  };
}

export function createNodeHostBindings(state = createVirtualDocumentState()) {
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createVirtualDocumentHostBindings(state),
  };
}

function normalizeOptionalHostBindingMap(value, label) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a host binding object`);
  }
  return value;
}

function browserDocument() {
  if (!globalThis.document) {
    throw new Error(
      "browser.document host binding requires globalThis.document; use vir-runtime-node.js or pass hostBindings in non-browser runtimes",
    );
  }
  return globalThis.document;
}

function queryDocumentElement(selector) {
  return browserDocument().querySelector(selector);
}

function createBrowserEventListenerResource(resources, target, eventName, callback) {
  const handler = (event) => callLeanEventCallback(resources, event, callback);
  target.addEventListener(eventName, handler);
  const listener = {
    remove: once(() => {
      target.removeEventListener(eventName, handler);
      callback.release();
      removeDisposable(resources, listener);
    }),
  };
  return listener;
}

function isInputElement(value) {
  return typeof globalThis.HTMLInputElement === "function" && value instanceof globalThis.HTMLInputElement;
}

function isElement(value) {
  return typeof globalThis.Element === "function" && value instanceof globalThis.Element;
}

function resourceForElementTarget(state, value) {
  return isElement(value) ? resourceForValue(state, value) : null;
}
