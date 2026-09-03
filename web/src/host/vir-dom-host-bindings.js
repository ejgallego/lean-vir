/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createNullableValue,
  nullablePayload,
} from "./vir-js-value-bindings.js";

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

export function createCSSStyleDeclarationHostBindings({ fromElement }) {
  return {
    "browser.elementCSSInlineStyle.fromElement": (element) =>
      createNullableValue(fromElement(element)),
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
      declaration.setProperty(property, nullablePayload(value));
      return undefined;
    },
  };
}

export function createKeyboardEventHostBindings({ fromEvent }) {
  return {
    "browser.keyboardEvent.fromEvent": (event) =>
      createNullableValue(fromEvent(event)),
    "browser.keyboardEvent.getKey": (event) => event.key,
  };
}

export function createHtmlInputElementHostBindings({ fromElement }) {
  return {
    "browser.htmlInputElement.fromElement": (element) =>
      createNullableValue(fromElement(element)),
    "browser.htmlInputElement.getChecked": (input) => input.checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      input.checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) => input.value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      input.value = value;
      return undefined;
    },
  };
}
