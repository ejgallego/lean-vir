/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  callLeanEventCallback,
  createAnimationHostBindings,
  createDOMTokenListHostBindings,
  createElementHostBindings,
  createHostLifecycle,
  createHtmlInputElementHostBindings,
  createTimerHostBindings,
  once,
  performanceNow,
  preventDefaultOnEvent,
  reportEventHandlerError,
  stopPropagationOnEvent,
} from "./host/vir-host-resources.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  normalizeProofWidgetsResolvedRef,
  normalizeProofWidgetsRpcRef,
} from "./host/vir-virtual-host-bindings.js";
import {
  createJsValueHostBindings,
  createNullableValue,
  nullablePayload,
} from "./host/vir-js-value-bindings.js";
import { createJsCollectionHostBindings } from "./host/vir-js-collection-bindings.js";
import { VIR_HOST_DISPOSE } from "./host-boundary.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "./runtime/cleanup.js";

export {
  hasExternrefTableSupport,
  requireExternrefTableSupport,
} from "./host-boundary.js";
export {
  createDOMTokenListHostBindings,
  createHostLifecycle,
} from "./host/vir-host-resources.js";
export {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  ensureVirtualElementState,
  ensureVirtualElementStates,
  createVirtualEventState,
  createVirtualEventHostBindings,
  normalizeProofWidgetsResolvedRef,
  normalizeProofWidgetsRpcRef,
} from "./host/vir-virtual-host-bindings.js";

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
    "browser.document.querySelector": (selector) =>
      createNullableValue(queryDocumentElement(selector)),
    "browser.document.querySelectorAll": (selector) =>
      queryDocumentElements(selector),
    "browser.document.createElement": (tagName) =>
      browserDocument().createElement(tagName),
  };
}

export function createBrowserEventHostBindings() {
  return {
    "browser.event.target": (event) => nullableElementTarget(event.target),
    "browser.event.currentTarget": (event) =>
      nullableElementTarget(event.currentTarget),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(event);
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(event);
      return undefined;
    },
    "browser.event.key": (event) => {
      const key = event?.key;
      return typeof key === "string" ? key : "";
    },
    "browser.event.formValue": (event) =>
      createNullableValue(formControlEventValue(event)),
  };
}

export function createBrowserElementHostBindings(
  state = createHostLifecycle(),
) {
  return {
    ...createElementHostBindings(state, {
      querySelector: (target, selector) => target.querySelector(selector),
      querySelectorAll: (target, selector) => target.querySelectorAll(selector),
      getInnerHTML: (target) => target.innerHTML ?? "",
      setInnerHTML: (target, html) => {
        target.innerHTML = html;
      },
      getTextContent: (target) => target.textContent ?? "",
      setTextContent: (target, text) => {
        target.textContent = text;
      },
      getClassList: (target) => target.classList,
      setClassList: (target, classList) => {
        target.classList = classList;
      },
      getAttribute: (target, name) => target.getAttribute(name) ?? null,
      setAttribute: (target, name, value) => target.setAttribute(name, value),
      createEventListener: (target, eventName, callback) =>
        createBrowserEventListenerSubscription(
          state,
          target,
          eventName,
          callback,
        ),
    }),
    "browser.element.appendChild": (parent, child) => {
      parent.appendChild(child);
      return child;
    },
    "browser.element.remove": (element) => {
      element.remove();
      return undefined;
    },
    "browser.element.style.setProperty": (element, name, value) => {
      element.style.setProperty(name, nullablePayload(value));
      return undefined;
    },
  };
}

export function createBrowserCanvasHostBindings() {
  return {
    "browser.htmlCanvasElement.fromElement": (element) => {
      return createNullableValue(isCanvasElement(element) ? element : null);
    },
    "browser.htmlCanvasElement.getWidth": (canvas) => Number(canvas.width),
    "browser.htmlCanvasElement.setWidth": (canvas, width) => {
      canvas.width = width;
      return undefined;
    },
    "browser.htmlCanvasElement.getHeight": (canvas) => Number(canvas.height),
    "browser.htmlCanvasElement.setHeight": (canvas, height) => {
      canvas.height = height;
      return undefined;
    },
    "browser.htmlCanvasElement.getContext2D": (canvas) =>
      createNullableValue(canvas.getContext("2d")),
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
    "browser.canvas2d.setFillStyle": (ctx, style) => {
      ctx.fillStyle = style;
      return undefined;
    },
    "browser.canvas2d.getStrokeStyle": (ctx) => ctx.strokeStyle,
    "browser.canvas2d.setStrokeStyleValue": (ctx, style) => {
      ctx.strokeStyle = style;
      return undefined;
    },
    "browser.canvas2d.setStrokeStyle": (ctx, style) => {
      ctx.strokeStyle = style;
      return undefined;
    },
    "browser.canvas2d.getLineWidth": (ctx) => Number(ctx.lineWidth),
    "browser.canvas2d.setLineWidth": (ctx, width) => {
      ctx.lineWidth = width;
      return undefined;
    },
    "browser.canvas2d.textMetrics.getWidth": (metrics) => Number(metrics.width),
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

export function createBrowserTimerHostBindings(state = createHostLifecycle()) {
  return createTimerHostBindings(state);
}

export function createBrowserAnimationHostBindings(
  state = createHostLifecycle(),
) {
  const requestFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) =>
          globalThis.setTimeout(() => callback(performanceNow()), 16);
  const cancelFrame =
    typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : globalThis.clearTimeout.bind(globalThis);
  return createAnimationHostBindings(state, { requestFrame, cancelFrame });
}

export function createInfoviewHostBindings({ commandDispatcher = null } = {}) {
  return {
    "infoview.documentPosition": (uri, fileName, line, character, label) => ({
      uri,
      fileName,
      line,
      character,
      label,
    }),
    "infoview.clipboard.writeText": (text) => writeTextToHostClipboard(text),
    "infoview.command.revealPosition": (position) =>
      revealInfoviewPosition(commandDispatcher, position),
    "infoview.command.insertText": (position, text) =>
      insertInfoviewText(commandDispatcher, position, text),
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) => ({
      id,
      label,
      typeName,
      summary,
      expression,
      typeText: "",
      context: "",
    }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) => ({
      ...ref,
      typeText,
      context,
      ...nullableField(serverRef, "serverRef"),
    }),
    "js.value.proofwidgets.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(ref),
    "proofwidgets.rpc.inspectRef": (ref) =>
      inspectProofWidgetsRpcRef(commandDispatcher, ref),
    "proofwidgets.rpc.resolveRef": (ref, callback) =>
      resolveProofWidgetsRpcRef(commandDispatcher, ref, callback),
  };
}

export function createBrowserHostBindings({
  resources = createHostLifecycle(),
  infoviewCommandDispatcher = null,
  reactHostBindings = null,
} = {}) {
  const state = resources;
  const reactBindingsSource =
    typeof reactHostBindings === "function"
      ? reactHostBindings(state, { querySelector: queryDocumentElement })
      : reactHostBindings;
  const reactBindings = normalizeOptionalHostBindingMap(
    reactBindingsSource,
    "reactHostBindings",
  );
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(),
    ...createBrowserEventHostBindings(),
    ...createBrowserElementHostBindings(state),
    ...createDOMTokenListHostBindings(),
    ...createBrowserHtmlInputElementHostBindings(state),
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

export function createNodeHostBindings(
  state = createVirtualDocumentState(),
  resources = state.resources ?? createHostLifecycle(),
) {
  const previousResources = state.resources;
  state.resources = resources;
  const bindings = {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createVirtualDocumentHostBindings(state, resources),
  };
  const dispose = bindings[VIR_HOST_DISPOSE];
  bindings[VIR_HOST_DISPOSE] = () => {
    try {
      return dispose?.();
    } finally {
      if (
        state.resources === resources &&
        previousResources?.phase === "active"
      ) {
        state.resources = previousResources;
      }
    }
  };
  return bindings;
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

function queryDocumentElements(selector) {
  return browserDocument().querySelectorAll(selector);
}

function isCanvasElement(value) {
  const Canvas = globalThis.HTMLCanvasElement;
  return typeof Canvas === "function"
    ? value instanceof Canvas
    : value !== null &&
        typeof value === "object" &&
        typeof value.getContext === "function";
}

function writeTextToHostClipboard(text) {
  const copiedSynchronously = copyTextWithExecCommand(text);
  if (copiedSynchronously) {
    return true;
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (
    clipboard !== null &&
    typeof clipboard === "object" &&
    typeof clipboard.writeText === "function"
  ) {
    try {
      clipboard.writeText(text).catch((error) => {
        reportEventHandlerError(error);
      });
      return true;
    } catch (error) {
      reportEventHandlerError(error);
      return false;
    }
  }
  return false;
}

function revealInfoviewPosition(commandDispatcher, position) {
  const normalized = normalizeInfoviewDocumentPosition(position);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "revealPosition",
    normalized,
  );
}

function insertInfoviewText(commandDispatcher, position, text) {
  const normalized = normalizeInfoviewDocumentPosition(position);
  if (normalized === null || typeof text !== "string") {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "insertText",
    normalized,
    text,
  );
}

function nullableField(value, name) {
  const payload = nullablePayload(value);
  return payload === null ? {} : { [name]: payload };
}

function inspectProofWidgetsRpcRef(commandDispatcher, ref) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "proofwidgetsRpcInspectRef",
    normalized,
  );
}

function resolveProofWidgetsRpcRef(commandDispatcher, ref, callback) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null || typeof callback !== "function") {
    return false;
  }
  const handler = infoviewCommandHandler(
    commandDispatcher,
    "proofwidgetsRpcResolveRef",
  );
  if (handler === null) {
    return false;
  }
  let result;
  try {
    result = handler(normalized);
  } catch (error) {
    reportEventHandlerError(error);
    return false;
  }
  if (result === false) {
    return false;
  }
  if (
    result !== null &&
    typeof result === "object" &&
    typeof result.then === "function"
  ) {
    try {
      result
        .then((info) => {
          callHostCallback(callback, normalizeProofWidgetsResolvedRef(info));
        })
        .catch((error) => {
          reportEventHandlerError(error);
        });
    } catch (error) {
      throw error;
    }
  } else {
    callHostCallback(callback, normalizeProofWidgetsResolvedRef(result));
  }
  return true;
}

export function normalizeInfoviewDocumentPosition(position) {
  if (position === null || typeof position !== "object") {
    return null;
  }
  const uri = typeof position.uri === "string" ? position.uri : "";
  if (uri.length === 0) {
    return null;
  }
  const line = nonNegativeInteger(position.line);
  const character = nonNegativeInteger(position.character);
  if (line === null || character === null) {
    return null;
  }
  return { uri, line, character };
}

function nonNegativeInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function dispatchInfoviewCommand(commandDispatcher, name, ...payload) {
  const handler = infoviewCommandHandler(commandDispatcher, name);
  if (handler === null) {
    return false;
  }
  try {
    const result = handler(...payload);
    if (
      result !== null &&
      typeof result === "object" &&
      typeof result.then === "function"
    ) {
      result.catch((error) => {
        reportEventHandlerError(error);
      });
      return true;
    }
    return result !== false;
  } catch (error) {
    reportEventHandlerError(error);
    return false;
  }
}

function infoviewCommandHandler(commandDispatcher, name) {
  const dispatcher =
    commandDispatcher ?? globalThis.leanVirInfoviewCommands ?? null;
  if (typeof dispatcher === "function") {
    return (value) => dispatcher(name, value);
  }
  if (
    dispatcher !== null &&
    typeof dispatcher === "object" &&
    typeof dispatcher[name] === "function"
  ) {
    return (value) => dispatcher[name](value);
  }
  return null;
}

function callHostCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    reportEventHandlerError(error);
  }
}

function copyTextWithExecCommand(text) {
  const document = globalThis.document;
  if (
    document === null ||
    typeof document !== "object" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }
  const body = document.body;
  if (body === null || typeof body !== "object") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function createBrowserEventListenerSubscription(
  resources,
  target,
  eventName,
  callback,
) {
  if (typeof callback !== "function")
    throw new Error("browser event listener callback must be a function");
  const handler = (event) => callLeanEventCallback(event, callback);
  target.addEventListener(eventName, handler);
  const listener = {
    remove: once(() => {
      const errors = [];
      resources.removeDisposable(listener);
      collectCleanupError(errors, () =>
        target.removeEventListener(eventName, handler),
      );
      throwCollectedErrors(errors, "browser event listener removal failed");
    }),
  };
  return listener;
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

function isElement(value) {
  return (
    typeof globalThis.Element === "function" &&
    value instanceof globalThis.Element
  );
}

function nullableElementTarget(value) {
  return createNullableValue(isElement(value) ? value : null);
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
