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
  createBrowserElementHostBindings,
  createBrowserEventHostBindings,
  createBrowserHtmlInputElementHostBindings,
  createDOMTokenListHostBindings,
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
  createBrowserElementHostBindings,
  createBrowserEventHostBindings,
  createBrowserHtmlInputElementHostBindings,
} from "./host/vir-dom-host-bindings.js";
export {
  createInfoviewHostBindings,
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
    "browser.console.log": (consoleValue, message) => consoleValue.log(message),
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

export function createBrowserCanvasHostBindings() {
  return {
    "js.value.browser.canvasStyle.string": (style) => style,
    "browser.htmlCanvasElement.fromElement": (element) =>
      isCanvasElement(element) ? element : null,
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

export function createBrowserAnimationHostBindings(lifecycle) {
  const requestFrame = (callback) => {
    const request = browserAnimationFunction("requestAnimationFrame");
    browserAnimationFunction("cancelAnimationFrame");
    return request(callback);
  };
  const cancelFrame = (frame) =>
    browserAnimationFunction("cancelAnimationFrame")(frame);
  return createAnimationHostBindings(lifecycle, { requestFrame, cancelFrame });
}

export function createBrowserHostBindings({
  lifecycle = createHostLifecycle(),
  infoviewCommandDispatcher = null,
  reactHostBindings = null,
} = {}) {
  const reactBindings =
    reactHostBindings === null || reactHostBindings === undefined
      ? {}
      : createReactHostBindings(reactHostBindings, lifecycle);
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(),
    ...createBrowserEventHostBindings(),
    ...createBrowserElementHostBindings(),
    ...createDOMTokenListHostBindings(),
    ...createBrowserHtmlInputElementHostBindings(),
    ...createBrowserCanvasHostBindings(),
    ...createTimerHostBindings(lifecycle),
    ...createBrowserAnimationHostBindings(lifecycle),
    ...createInfoviewHostBindings({
      commandDispatcher: infoviewCommandDispatcher,
    }),
    ...reactBindings,
    [VIR_HOST_DISPOSE]: () => lifecycle.dispose(),
  };
}

function createReactHostBindings(factory, lifecycle) {
  if (typeof factory !== "function") {
    throw new Error("reactHostBindings must be a host binding factory");
  }
  return normalizeHostBindingMap(
    factory(lifecycle),
    "reactHostBindings factory result",
  );
}

function normalizeHostBindingMap(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
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
