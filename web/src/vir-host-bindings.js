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
  once,
  performanceNow,
  preventDefaultOnEvent,
  reportEventHandlerError,
  stopPropagationOnEvent,
} from "./host/vir-host-resources.js";
import {
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  normalizeProofWidgetsRpcRef,
} from "./host/vir-virtual-host-bindings.js";
import { VIR_HOST_DISPOSE } from "./host-resource.js";

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
  normalizeProofWidgetsRpcRef,
  virtualReactElementById,
} from "./host/vir-virtual-host-bindings.js";

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
    "browser.document.querySelector": (selector) => state.resourceForValue(queryDocumentElement(selector)),
  };
}

export function createBrowserEventHostBindings(state = createHostResourceState()) {
  return {
    "browser.event.target": (event) =>
      resourceForElementTarget(state, state.resolveResource(event, "Event").target),
    "browser.event.currentTarget": (event) =>
      resourceForElementTarget(state, state.resolveResource(event, "Event").currentTarget),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(state.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(state.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.formValue": (event) => formControlEventValue(state.resolveResource(event, "Event")),
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
    fromElement: (element) => isInputElement(element) ? state.resourceForValue(element) : null,
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

export function createInfoviewHostBindings({ commandDispatcher = null } = {}) {
  return {
    "infoview.clipboard.writeText": (text) => writeTextToHostClipboard(text),
    "infoview.command.revealPosition": (position) => revealInfoviewPosition(commandDispatcher, position),
    "proofwidgets.rpc.inspectRef": (ref) => inspectProofWidgetsRpcRef(commandDispatcher, ref),
    "proofwidgets.rpc.resolveRef": (ref, callback) =>
      resolveProofWidgetsRpcRef(commandDispatcher, ref, callback),
  };
}

export function createBrowserHostBindings({
  resources = createHostResourceState(),
  infoviewCommandDispatcher = null,
  reactHostBindings = null,
} = {}) {
  const state = resources;
  const reactBindingsSource =
    typeof reactHostBindings === "function"
      ? reactHostBindings(state, { querySelector: queryDocumentElement })
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
    ...createInfoviewHostBindings({ commandDispatcher: infoviewCommandDispatcher }),
    ...reactBindings,
    [VIR_HOST_DISPOSE]: () => state.dispose(),
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

function writeTextToHostClipboard(text) {
  const copiedSynchronously = copyTextWithExecCommand(text);
  if (copiedSynchronously) {
    return true;
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard !== null && typeof clipboard === "object" && typeof clipboard.writeText === "function") {
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
  return dispatchInfoviewCommand(commandDispatcher, "revealPosition", normalized);
}

function inspectProofWidgetsRpcRef(commandDispatcher, ref) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(commandDispatcher, "proofwidgetsRpcInspectRef", normalized);
}

function resolveProofWidgetsRpcRef(commandDispatcher, ref, callback) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null || typeof callback !== "function") {
    releaseCallback(callback);
    return false;
  }
  const handler = infoviewCommandHandler(commandDispatcher, "proofwidgetsRpcResolveRef");
  if (handler === null) {
    releaseCallback(callback);
    return false;
  }
  let result;
  try {
    result = handler(normalized);
  } catch (error) {
    reportEventHandlerError(error);
    releaseCallback(callback);
    return false;
  }
  if (result === false) {
    releaseCallback(callback);
    return false;
  }
  if (result !== null && typeof result === "object" && typeof result.then === "function") {
    result.then((info) => {
      callAndReleaseCallback(callback, info);
    }).catch((error) => {
      reportEventHandlerError(error);
      releaseCallback(callback);
    });
  } else {
    callAndReleaseCallback(callback, result);
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
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
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

function dispatchInfoviewCommand(commandDispatcher, name, payload) {
  const handler = infoviewCommandHandler(commandDispatcher, name);
  if (handler === null) {
    return false;
  }
  try {
    const result = handler(payload);
    if (result !== null && typeof result === "object" && typeof result.then === "function") {
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
  const dispatcher = commandDispatcher ?? globalThis.leanVirInfoviewCommands ?? null;
  if (typeof dispatcher === "function") {
    return (value) => dispatcher(name, value);
  }
  if (dispatcher !== null && typeof dispatcher === "object" && typeof dispatcher[name] === "function") {
    return (value) => dispatcher[name](value);
  }
  return null;
}

function callAndReleaseCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    reportEventHandlerError(error);
  } finally {
    releaseCallback(callback);
  }
}

function releaseCallback(callback) {
  if (callback !== null && typeof callback === "function" && typeof callback.release === "function") {
    callback.release();
  }
}

function copyTextWithExecCommand(text) {
  const document = globalThis.document;
  if (document === null || typeof document !== "object" || typeof document.execCommand !== "function") {
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

function createBrowserEventListenerResource(resources, target, eventName, callback) {
  const handler = (event) => callLeanEventCallback(resources, event, callback);
  target.addEventListener(eventName, handler);
  const listener = {
    remove: once(() => {
      target.removeEventListener(eventName, handler);
      callback.release();
      resources.removeDisposable(listener);
    }),
  };
  return listener;
}

function isInputElement(value) {
  return typeof globalThis.HTMLInputElement === "function" && value instanceof globalThis.HTMLInputElement;
}

function isTextAreaElement(value) {
  return typeof globalThis.HTMLTextAreaElement === "function" && value instanceof globalThis.HTMLTextAreaElement;
}

function isSelectElement(value) {
  return typeof globalThis.HTMLSelectElement === "function" && value instanceof globalThis.HTMLSelectElement;
}

function isElement(value) {
  return typeof globalThis.Element === "function" && value instanceof globalThis.Element;
}

function resourceForElementTarget(state, value) {
  return isElement(value) ? state.resourceForValue(value) : null;
}

function formControlEventValue(event) {
  const currentValue = formControlValue(event?.currentTarget);
  if (currentValue !== null) return currentValue;
  return formControlValue(event?.target);
}

function formControlValue(value) {
  if (!isInputElement(value) && !isTextAreaElement(value) && !isSelectElement(value)) {
    return null;
  }
  return String(value.value ?? "");
}
