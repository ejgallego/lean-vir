/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createAnimationHostBindings,
  createHostLifecycle,
  createTimerHostBindings,
} from "./host/vir-active-host-bindings.js";
import {
  createCSSStyleDeclarationHostBindings,
  createDOMTokenListHostBindings,
  createElementHostBindings,
  createEventListenerValueHostBindings,
  createHtmlInputElementHostBindings,
  createKeyboardEventHostBindings,
} from "./host/vir-dom-host-bindings.js";
import { createInfoviewHostBindings } from "./host/vir-infoview-host-bindings.js";
import { createJsValueHostBindings } from "./host/vir-js-value-bindings.js";
import { createJsCollectionHostBindings } from "./host/vir-js-collection-bindings.js";
import { VIR_HOST_DISPOSE } from "./host-boundary.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./host-boundary.js";
export { createHostLifecycle } from "./host/vir-active-host-bindings.js";
export {
  createInfoviewHostBindings,
  normalizeInfoviewDocumentPosition,
  normalizeProofWidgetsResolvedRef,
  normalizeProofWidgetsRpcRef,
} from "./host/vir-infoview-host-bindings.js";

export function createCommonHostBindings() {
  return {
    ...createJsValueHostBindings(),
    ...createJsCollectionHostBindings(),
    "common.echoString": (value) => value,
    "common.addNat": (lhs, rhs) => lhs + rhs,
  };
}

export function createConsoleHostBindings() {
  return {
    "browser.console.current": () => browserConsole(),
    "browser.console.log": (consoleValue, message) => {
      consoleValue.log(message);
      return undefined;
    },
  };
}

export function createBrowserDocumentHostBindings() {
  return {
    "browser.document.current": () => browserDocument(),
    "browser.document.getTitle": (documentValue) => documentValue.title,
    "browser.document.setTitle": (documentValue, title) => {
      documentValue.title = title;
      return undefined;
    },
    "browser.document.querySelector": (documentValue, selector) =>
      documentValue.querySelector(selector),
    "browser.document.querySelectorAll": (documentValue, selector) =>
      documentValue.querySelectorAll(selector),
    "browser.document.createElement": (documentValue, tagName) =>
      documentValue.createElement(tagName),
  };
}

export function createBrowserEventHostBindings() {
  return {
    ...createEventListenerValueHostBindings(),
    ...createKeyboardEventHostBindings({
      fromEvent: (event) => (isKeyboardEvent(event) ? event : null),
    }),
    "browser.event.target": (event) => event.target,
    "browser.event.currentTarget": (event) => event.currentTarget,
    "browser.eventTarget.asElement": (target) =>
      isElement(target) ? target : null,
    "browser.event.preventDefault": (event) => {
      event.preventDefault();
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      event.stopPropagation();
      return undefined;
    },
    "browser.event.formValue": (event) => formControlEventValue(event),
  };
}

export function createBrowserElementHostBindings() {
  return {
    ...createCSSStyleDeclarationHostBindings({
      fromElement: (element) =>
        isElementCSSInlineStyle(element) ? element : null,
    }),
    ...createElementHostBindings({
      querySelector: (target, selector) => target.querySelector(selector),
      querySelectorAll: (target, selector) => target.querySelectorAll(selector),
      getInnerHTML: (target) => target.innerHTML,
      setInnerHTML: (target, html) => {
        target.innerHTML = html;
      },
      getTextContent: (target) => target.textContent,
      setTextContent: (target, text) => {
        target.textContent = text;
      },
      getClassList: (target) => target.classList,
      setClassList: (target, classList) => {
        target.classList = classList;
      },
      getAttribute: (target, name) => target.getAttribute(name),
      setAttribute: (target, name, value) => target.setAttribute(name, value),
      addEventListener: (target, eventName, listener) =>
        target.addEventListener(eventName, listener),
      removeEventListener: (target, eventName, listener) =>
        target.removeEventListener(eventName, listener),
    }),
    "browser.element.appendChild": (parent, child) => {
      parent.appendChild(child);
      return child;
    },
    "browser.element.remove": (element) => {
      element.remove();
      return undefined;
    },
  };
}

export function createBrowserCanvasHostBindings() {
  return {
    "js.value.browser.canvasStyle.string": (style) => style,
    "browser.htmlCanvasElement.fromElement": (element) => {
      return isCanvasElement(element) ? element : null;
    },
    "browser.htmlCanvasElement.getWidth": (canvas) => canvas.width,
    "browser.htmlCanvasElement.setWidth": (canvas, width) => {
      canvas.width = width;
      return undefined;
    },
    "browser.htmlCanvasElement.getHeight": (canvas) => canvas.height,
    "browser.htmlCanvasElement.setHeight": (canvas, height) => {
      canvas.height = height;
      return undefined;
    },
    "browser.htmlCanvasElement.getContext2D": (canvas) =>
      canvas.getContext("2d"),
    "browser.canvas2d.clearRect": (ctx, x, y, width, height) =>
      ctx.clearRect(x, y, width, height),
    "browser.canvas2d.fillRect": (ctx, x, y, width, height) =>
      ctx.fillRect(x, y, width, height),
    "browser.canvas2d.strokeRect": (ctx, x, y, width, height) =>
      ctx.strokeRect(x, y, width, height),
    "browser.canvas2d.beginPath": (ctx) => ctx.beginPath(),
    "browser.canvas2d.closePath": (ctx) => ctx.closePath(),
    "browser.canvas2d.moveTo": (ctx, x, y) => ctx.moveTo(x, y),
    "browser.canvas2d.lineTo": (ctx, x, y) => ctx.lineTo(x, y),
    "browser.canvas2d.measureText": (ctx, text) => ctx.measureText(text),
    "browser.canvas2d.arc": (ctx, x, y, radius, startAngle, endAngle) =>
      ctx.arc(x, y, radius, startAngle, endAngle),
    "browser.canvas2d.fill": (ctx) => ctx.fill(),
    "browser.canvas2d.stroke": (ctx) => ctx.stroke(),
    "browser.canvas2d.getFillStyle": (ctx) => ctx.fillStyle,
    "browser.canvas2d.setFillStyleValue": (ctx, style) => {
      ctx.fillStyle = style;
      return undefined;
    },
    "browser.canvas2d.getStrokeStyle": (ctx) => ctx.strokeStyle,
    "browser.canvas2d.setStrokeStyleValue": (ctx, style) => {
      ctx.strokeStyle = style;
      return undefined;
    },
    "browser.canvas2d.getLineWidth": (ctx) => ctx.lineWidth,
    "browser.canvas2d.setLineWidth": (ctx, width) => {
      ctx.lineWidth = width;
      return undefined;
    },
    "browser.canvas2d.textMetrics.getWidth": (metrics) => metrics.width,
    "browser.canvas2d.save": (ctx) => ctx.save(),
    "browser.canvas2d.restore": (ctx) => ctx.restore(),
    "browser.canvas2d.translate": (ctx, x, y) => ctx.translate(x, y),
    "browser.canvas2d.rotate": (ctx, angle) => ctx.rotate(angle),
  };
}

export function createBrowserHtmlInputElementHostBindings() {
  return createHtmlInputElementHostBindings({
    fromElement: (element) => (isInputElement(element) ? element : null),
  });
}

export function createBrowserTimerHostBindings(state) {
  return createTimerHostBindings(state);
}

export function createBrowserAnimationHostBindings(state) {
  const requestFrame = (callback) => {
    const request = browserAnimationFunction("requestAnimationFrame");
    browserAnimationFunction("cancelAnimationFrame");
    return request(callback);
  };
  const cancelFrame = (frame) =>
    browserAnimationFunction("cancelAnimationFrame")(frame);
  return createAnimationHostBindings(state, { requestFrame, cancelFrame });
}

export function createBrowserHostBindings({
  resources = createHostLifecycle(),
  infoviewCommandDispatcher = null,
  reactHostBindings = null,
} = {}) {
  const state = resources;
  let reactBindings = {};
  if (reactHostBindings !== null && reactHostBindings !== undefined) {
    if (typeof reactHostBindings !== "function") {
      throw new Error("reactHostBindings must be a host binding factory");
    }
    reactBindings = normalizeHostBindingMap(
      reactHostBindings(state),
      "reactHostBindings factory result",
    );
  }
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(),
    ...createBrowserEventHostBindings(),
    ...createBrowserElementHostBindings(),
    ...createDOMTokenListHostBindings(),
    ...createBrowserHtmlInputElementHostBindings(),
    ...createBrowserCanvasHostBindings(),
    ...createBrowserTimerHostBindings(state),
    ...createBrowserAnimationHostBindings(state),
    ...createInfoviewHostBindings({
      commandDispatcher: infoviewCommandDispatcher,
    }),
    ...reactBindings,
    [VIR_HOST_DISPOSE]: () => state.dispose(),
  };
}

function normalizeHostBindingMap(value, label) {
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

function browserConsole() {
  const consoleValue = globalThis.console;
  if (!consoleValue || typeof consoleValue.log !== "function") {
    throw new Error(
      "browser.console host binding requires globalThis.console or explicit hostBindings",
    );
  }
  return consoleValue;
}

function browserAnimationFunction(name) {
  const operation = globalThis[name];
  if (typeof operation !== "function") {
    throw new Error(
      `browser.animation host binding requires globalThis.${name}`,
    );
  }
  return operation.bind(globalThis);
}

function isCanvasElement(value) {
  const Canvas = globalThis.HTMLCanvasElement;
  return typeof Canvas === "function" && value instanceof Canvas;
}

function isInputElement(value) {
  return (
    typeof globalThis.HTMLInputElement === "function" &&
    value instanceof globalThis.HTMLInputElement
  );
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

function isElement(value) {
  return (
    typeof globalThis.Element === "function" &&
    value instanceof globalThis.Element
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
  return String(value.value ?? "");
}
