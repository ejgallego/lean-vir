/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createDOMTokenListHostBindings() {
  return {
    "browser.domTokenList.add": (tokenList, className) =>
      tokenList.add(className),
    "browser.domTokenList.remove": (tokenList, className) =>
      tokenList.remove(className),
    "browser.domTokenList.toggle": (tokenList, className) =>
      tokenList.toggle(className),
  };
}

export function createBrowserEventHostBindings() {
  return {
    "js.value.browser.eventListener": (callback) => callback,
    "browser.keyboardEvent.fromEvent": (event) =>
      isKeyboardEvent(event) ? event : null,
    "browser.keyboardEvent.getKey": (event) => event.key,
    "browser.event.target": (event) => event.target,
    "browser.event.currentTarget": (event) => event.currentTarget,
    "browser.eventTarget.asElement": (target) =>
      isElement(target) ? target : null,
    "browser.event.preventDefault": (event) => event.preventDefault(),
    "browser.event.stopPropagation": (event) => event.stopPropagation(),
    "browser.event.formValue": (event) => formControlEventValue(event),
  };
}

export function createBrowserElementHostBindings() {
  return {
    "browser.elementCSSInlineStyle.fromElement": (element) =>
      isElementCSSInlineStyle(element) ? element : null,
    "browser.elementCSSInlineStyle.getStyle": (element) => element.style,
    "browser.elementCSSInlineStyle.setStyle": (element, style) => {
      element.style = style;
      return undefined;
    },
    "browser.cssStyleDeclaration.setProperty": (declaration, property, value) =>
      declaration.setProperty(property, value),
    "browser.element.querySelector": (element, selector) =>
      element.querySelector(selector),
    "browser.element.querySelectorAll": (element, selector) =>
      element.querySelectorAll(selector),
    "browser.element.getInnerHTML": (element) => element.innerHTML,
    "browser.element.setInnerHTML": (element, html) => {
      element.innerHTML = html;
      return undefined;
    },
    "browser.element.getTextContent": (element) => element.textContent,
    "browser.element.setTextContent": (element, text) => {
      element.textContent = text;
      return undefined;
    },
    "browser.element.getClassList": (element) => element.classList,
    "browser.element.setClassList": (element, classList) => {
      element.classList = classList;
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      element.getAttribute(name),
    "browser.element.setAttribute": (element, name, value) =>
      element.setAttribute(name, value),
    "browser.element.addEventListener": (element, eventName, listener) =>
      element.addEventListener(eventName, listener),
    "browser.element.removeEventListener": (element, eventName, listener) =>
      element.removeEventListener(eventName, listener),
    "browser.element.appendChild": (parent, child) => parent.appendChild(child),
    "browser.element.remove": (element) => element.remove(),
  };
}

export function createBrowserHtmlInputElementHostBindings() {
  return {
    "browser.htmlInputElement.fromElement": (element) =>
      isInputElement(element) ? element : null,
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

function isElementCSSInlineStyle(value) {
  return typeof value?.style?.setProperty === "function";
}

function isKeyboardEvent(value) {
  const KeyboardEvent = globalThis.KeyboardEvent;
  if (typeof KeyboardEvent !== "function") return false;
  const getKey = Object.getOwnPropertyDescriptor(
    KeyboardEvent.prototype,
    "key",
  )?.get;
  if (typeof getKey !== "function") return false;
  try {
    Reflect.apply(getKey, value, []);
    return true;
  } catch {
    return false;
  }
}

function isElement(value) {
  return (
    typeof globalThis.Element === "function" &&
    value instanceof globalThis.Element
  );
}

function isInputElement(value) {
  return (
    typeof globalThis.HTMLInputElement === "function" &&
    value instanceof globalThis.HTMLInputElement
  );
}

function isTextAreaElement(value) {
  return (
    typeof globalThis.HTMLTextAreaElement === "function" &&
    value instanceof globalThis.HTMLTextAreaElement
  );
}

function isSelectElement(value) {
  return (
    typeof globalThis.HTMLSelectElement === "function" &&
    value instanceof globalThis.HTMLSelectElement
  );
}

function formControlEventValue(event) {
  const currentValue = formControlValue(event?.currentTarget);
  if (currentValue !== null) return currentValue;
  return formControlValue(event?.target);
}

function formControlValue(value) {
  if (
    !isInputElement(value) &&
    !isTextAreaElement(value) &&
    !isSelectElement(value)
  ) {
    return null;
  }
  return value.value;
}
