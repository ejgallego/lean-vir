/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

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

function createDomResourceState() {
  return {
    nextHandle: 1,
    values: new Map(),
    handles: new WeakMap(),
  };
}

export function createBrowserDocumentHostBindings(state = createDomResourceState()) {
  return {
    "browser.document.getTitle": () => browserDocument().title,
    "browser.document.setTitle": (title) => {
      browserDocument().title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state, queryDocumentElement(selector)),
  };
}

export function createBrowserElementHostBindings(state = createDomResourceState()) {
  return {
    "browser.element.getTextContent": (element) => resolveResource(state, element, "Element").textContent ?? "",
    "browser.element.setTextContent": (element, text) => {
      resolveResource(state, element, "Element").textContent = text;
      return undefined;
    },
    "browser.element.getAttribute": (element, name) => resolveResource(state, element, "Element").getAttribute(name) ?? null,
    "browser.element.setAttribute": (element, name, value) => {
      resolveResource(state, element, "Element").setAttribute(name, value);
      return undefined;
    },
  };
}

export function createBrowserHtmlInputElementHostBindings(state = createDomResourceState()) {
  return {
    "browser.htmlInputElement.fromElement": (element) => {
      const value = resolveResource(state, element, "Element");
      return isInputElement(value) ? resourceForValue(state, value) : null;
    },
    "browser.htmlInputElement.getChecked": (input) => resolveResource(state, input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resolveResource(state, input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) => resolveResource(state, input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resolveResource(state, input, "HTMLInputElement").value = value;
      return undefined;
    },
  };
}

export function createBrowserHostBindings() {
  const state = createDomResourceState();
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(state),
    ...createBrowserElementHostBindings(state),
    ...createBrowserHtmlInputElementHostBindings(state),
  };
}

export function createVirtualDocumentState({ title = "", elements = new Map(), resources = createDomResourceState() } = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return { title, elements, resources };
}

export function createVirtualDocumentHostBindings(state = createVirtualDocumentState()) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources ??= createDomResourceState();
  return {
    "browser.document.getTitle": () => state.title,
    "browser.document.setTitle": (title) => {
      state.title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state.resources, virtualElementState(state, selector)),
    "browser.element.getTextContent": (element) => resolveResource(state.resources, element, "Element").textContent,
    "browser.element.setTextContent": (element, text) => {
      resolveResource(state.resources, element, "Element").textContent = text;
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      resolveResource(state.resources, element, "Element").attributes.get(name) ?? null,
    "browser.element.setAttribute": (element, name, value) => {
      resolveResource(state.resources, element, "Element").attributes.set(name, value);
      return undefined;
    },
    "browser.htmlInputElement.fromElement": (element) =>
      resourceForValue(state.resources, resolveResource(state.resources, element, "Element")),
    "browser.htmlInputElement.getChecked": (input) =>
      resolveResource(state.resources, input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resolveResource(state.resources, input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) =>
      resolveResource(state.resources, input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resolveResource(state.resources, input, "HTMLInputElement").value = value;
      return undefined;
    },
  };
}

export function createNodeHostBindings(state = createVirtualDocumentState()) {
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createVirtualDocumentHostBindings(state),
  };
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

function resourceForValue(state, value) {
  if (value === null || value === undefined) return null;
  let handle = state.handles.get(value);
  if (handle === undefined) {
    handle = state.nextHandle++;
    state.handles.set(value, handle);
    state.values.set(handle, value);
  }
  return { handle };
}

function resolveResource(state, resource, label) {
  const handle = resourceHandle(resource, label);
  const value = state.values.get(handle);
  if (value === undefined) {
    throw new Error(`${label} resource handle ${handle} is not live`);
  }
  return value;
}

function resourceHandle(resource, label) {
  const handle = resource?.handle;
  if (!Number.isInteger(handle) || handle <= 0 || handle > 0xffffffff) {
    throw new Error(`${label} resource must be a live DOM resource handle`);
  }
  return handle;
}

function isInputElement(value) {
  return typeof globalThis.HTMLInputElement === "function" && value instanceof globalThis.HTMLInputElement;
}

function virtualElementState(state, selector) {
  let element = state.elements.get(selector);
  if (element === undefined) {
    element = { textContent: "", attributes: new Map(), checked: false, value: "" };
    state.elements.set(selector, element);
  } else {
    element.textContent ??= "";
    element.attributes ??= new Map();
    element.checked ??= false;
    element.value ??= "";
  }
  return element;
}
