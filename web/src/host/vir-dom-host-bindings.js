/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createDOMTokenListHostBindings() {
  return {
    "browser.domTokenList.add": (tokenList, className) => {
      tokenList.add(className);
      return undefined;
    },
    "browser.domTokenList.remove": (tokenList, className) => {
      tokenList.remove(className);
      return undefined;
    },
    "browser.domTokenList.toggle": (tokenList, className) =>
      tokenList.toggle(className),
  };
}

export function createElementHostBindings(operations) {
  return {
    "browser.element.querySelector": (element, selector) =>
      operations.querySelector(element, selector),
    "browser.element.querySelectorAll": (element, selector) =>
      operations.querySelectorAll(element, selector),
    "browser.element.getInnerHTML": (element) =>
      operations.getInnerHTML(element),
    "browser.element.setInnerHTML": (element, html) => {
      operations.setInnerHTML(element, html);
      return undefined;
    },
    "browser.element.getTextContent": (element) =>
      operations.getTextContent(element),
    "browser.element.setTextContent": (element, text) => {
      operations.setTextContent(element, text);
      return undefined;
    },
    "browser.element.getClassList": (element) =>
      operations.getClassList(element),
    "browser.element.setClassList": (element, classList) => {
      operations.setClassList(element, classList);
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      operations.getAttribute(element, name),
    "browser.element.setAttribute": (element, name, value) => {
      operations.setAttribute(element, name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, listener) => {
      operations.addEventListener(element, eventName, listener);
      return undefined;
    },
    "browser.element.removeEventListener": (element, eventName, listener) => {
      operations.removeEventListener(element, eventName, listener);
      return undefined;
    },
  };
}

export function createEventListenerValueHostBindings() {
  return {
    "js.value.browser.eventListener": (callback) => {
      if (typeof callback !== "function") {
        throw new Error("browser event listener must be a JavaScript function");
      }
      return callback;
    },
  };
}

export function createCSSStyleDeclarationHostBindings({ fromElement }) {
  return {
    "browser.elementCSSInlineStyle.fromElement": (element) =>
      fromElement(element),
    "browser.elementCSSInlineStyle.getStyle": (element) => element.style,
    "browser.elementCSSInlineStyle.setStyle": (element, style) => {
      element.style = style;
      return undefined;
    },
    "browser.cssStyleDeclaration.setProperty": (
      declaration,
      property,
      value,
    ) => {
      declaration.setProperty(property, value);
      return undefined;
    },
  };
}

export function createKeyboardEventHostBindings({ fromEvent }) {
  return {
    "browser.keyboardEvent.fromEvent": (event) => fromEvent(event),
    "browser.keyboardEvent.getKey": (event) => event.key,
  };
}

export function createHtmlInputElementHostBindings({ fromElement }) {
  return {
    "browser.htmlInputElement.fromElement": (element) => fromElement(element),
    "browser.htmlInputElement.getChecked": (input) => input.checked,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      input.checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) => input.value,
    "browser.htmlInputElement.setValue": (input, value) => {
      input.value = value;
      return undefined;
    },
  };
}
