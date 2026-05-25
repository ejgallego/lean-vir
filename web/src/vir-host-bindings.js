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

export function createBrowserDocumentHostBindings() {
  return {
    "browser.document.getTitle": () => browserDocument().title,
    "browser.document.setTitle": (title) => {
      browserDocument().title = title;
      return undefined;
    },
    "browser.document.getTextContent": (selector) => queryDocumentElement(selector)?.textContent ?? "",
    "browser.document.setTextContent": (selector, text) => {
      const element = queryDocumentElement(selector);
      if (element) {
        element.textContent = text;
      }
      return undefined;
    },
    "browser.document.getAttribute": (selector, name) => queryDocumentElement(selector)?.getAttribute(name) ?? null,
    "browser.document.setAttribute": (selector, name, value) => {
      const element = queryDocumentElement(selector);
      if (element) {
        element.setAttribute(name, value);
      }
      return undefined;
    },
    "browser.document.getChecked": (selector) => queryDocumentElement(selector)?.checked === true,
    "browser.document.setChecked": (selector, checked) => {
      const element = queryDocumentElement(selector);
      if (element) {
        element.checked = checked;
      }
      return undefined;
    },
  };
}

export function createBrowserHostBindings() {
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(),
  };
}

export function createVirtualDocumentState({ title = "", elements = new Map() } = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return { title, elements };
}

export function createVirtualDocumentHostBindings(state = createVirtualDocumentState()) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  return {
    "browser.document.getTitle": () => state.title,
    "browser.document.setTitle": (title) => {
      state.title = title;
      return undefined;
    },
    "browser.document.getTextContent": (selector) => virtualElementState(state, selector).textContent,
    "browser.document.setTextContent": (selector, text) => {
      virtualElementState(state, selector).textContent = text;
      return undefined;
    },
    "browser.document.getAttribute": (selector, name) => virtualElementState(state, selector).attributes.get(name) ?? null,
    "browser.document.setAttribute": (selector, name, value) => {
      virtualElementState(state, selector).attributes.set(name, value);
      return undefined;
    },
    "browser.document.getChecked": (selector) => virtualElementState(state, selector).checked === true,
    "browser.document.setChecked": (selector, checked) => {
      virtualElementState(state, selector).checked = checked;
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

function virtualElementState(state, selector) {
  let element = state.elements.get(selector);
  if (element === undefined) {
    element = { textContent: "", attributes: new Map(), checked: false };
    state.elements.set(selector, element);
  }
  return element;
}
