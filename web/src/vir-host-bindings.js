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
  normalizeProofWidgetsResolvedRef,
  normalizeProofWidgetsRpcRef,
} from "./host/vir-virtual-host-bindings.js";
import {
  createJsValueHostBindings,
  createNullableValue,
  nullablePayload,
} from "./host/vir-js-value-bindings.js";
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
  normalizeProofWidgetsResolvedRef,
  normalizeProofWidgetsRpcRef,
  virtualReactElementById,
} from "./host/vir-virtual-host-bindings.js";

export function createCommonHostBindings(state = createHostResourceState()) {
  return {
    ...createJsValueHostBindings(state),
    "common.echoString": (value) => state.resourceForValue(state.resolveResource(value, "JsString")),
    "common.addNat": (lhs, rhs) =>
      state.resourceForValue(state.resolveResource(lhs, "JsNat") + state.resolveResource(rhs, "JsNat")),
  };
}

export function createConsoleHostBindings(state = createHostResourceState()) {
  return {
    "browser.console.log": (message) => {
      console.log(state.resolveResource(message, "JsString"));
      return undefined;
    },
  };
}

export function createBrowserDocumentHostBindings(state = createHostResourceState()) {
  return {
    "browser.document.getTitle": () => state.resourceForValue(browserDocument().title),
    "browser.document.setTitle": (title) => {
      browserDocument().title = state.resolveResource(title, "JsString");
      return undefined;
    },
    "browser.document.querySelector": (selector) =>
      state.resourceForValue(createNullableValue(queryDocumentElement(state.resolveResource(selector, "JsString")))),
    "browser.document.createElement": (tagName) =>
      state.resourceForValue(browserDocument().createElement(state.resolveResource(tagName, "JsString"))),
  };
}

export function createBrowserEventHostBindings(state = createHostResourceState()) {
  return {
    "browser.event.target": (event) =>
      state.resourceForValue(nullableElementTarget(state.resolveResource(event, "Event").target)),
    "browser.event.currentTarget": (event) =>
      state.resourceForValue(nullableElementTarget(state.resolveResource(event, "Event").currentTarget)),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(state.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(state.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.formValue": (event) =>
      state.resourceForValue(createNullableValue(formControlEventValue(state.resolveResource(event, "Event")))),
  };
}

export function createBrowserElementHostBindings(state = createHostResourceState()) {
  return {
    ...createElementResourceHostBindings(state, {
    getTextContent: (target) => target.textContent ?? "",
    setTextContent: (target, text) => {
      target.textContent = text;
    },
    getAttribute: (target, name) => target.getAttribute(name) ?? null,
    setAttribute: (target, name, value) => target.setAttribute(name, value),
    createEventListener: (target, eventName, callback) =>
      createBrowserEventListenerResource(state, target, eventName, callback),
    }),
    "browser.element.appendChild": (parent, child) => {
      state.resolveResource(parent, "Element").appendChild(state.resolveResource(child, "Element"));
      return undefined;
    },
    "browser.element.remove": (element) => {
      state.resolveResource(element, "Element").remove();
      return undefined;
    },
    "browser.element.classList.add": (element, className) => {
      state.resolveResource(element, "Element").classList.add(state.resolveResource(className, "JsString"));
      return undefined;
    },
    "browser.element.classList.remove": (element, className) => {
      state.resolveResource(element, "Element").classList.remove(state.resolveResource(className, "JsString"));
      return undefined;
    },
    "browser.element.classList.toggle": (element, className) =>
      state.resourceForValue(
        state.resolveResource(element, "Element").classList.toggle(
          state.resolveResource(className, "JsString"),
        ),
      ),
    "browser.element.style.setProperty": (element, name, value) => {
      state.resolveResource(element, "Element").style.setProperty(
        state.resolveResource(name, "JsString"),
        state.resolveResource(value, "JsString"),
      );
      return undefined;
    },
  };
}

export function createBrowserCanvasHostBindings(state = createHostResourceState()) {
  const value = (resource, label) => state.resolveResource(resource, label);
  const number = (resource) => value(resource, "JsFloat");
  return {
    "browser.htmlCanvasElement.fromElement": (element) => {
      const candidate = value(element, "Element");
      const canvas = isCanvasElement(candidate) ? candidate : null;
      return state.resourceForValue(createNullableValue(canvas));
    },
    "browser.htmlCanvasElement.getWidth": (canvas) =>
      state.resourceForValue(BigInt(value(canvas, "HTMLCanvasElement").width)),
    "browser.htmlCanvasElement.setWidth": (canvas, width) => {
      value(canvas, "HTMLCanvasElement").width = Number(value(width, "JsNat"));
      return undefined;
    },
    "browser.htmlCanvasElement.getHeight": (canvas) =>
      state.resourceForValue(BigInt(value(canvas, "HTMLCanvasElement").height)),
    "browser.htmlCanvasElement.setHeight": (canvas, height) => {
      value(canvas, "HTMLCanvasElement").height = Number(value(height, "JsNat"));
      return undefined;
    },
    "browser.htmlCanvasElement.getContext2D": (canvas) =>
      state.resourceForValue(createNullableValue(value(canvas, "HTMLCanvasElement").getContext("2d"))),
    "browser.canvas2d.clearRect": (ctx, x, y, width, height) =>
      value(ctx, "CanvasRenderingContext2D").clearRect(number(x), number(y), number(width), number(height)),
    "browser.canvas2d.fillRect": (ctx, x, y, width, height) =>
      value(ctx, "CanvasRenderingContext2D").fillRect(number(x), number(y), number(width), number(height)),
    "browser.canvas2d.strokeRect": (ctx, x, y, width, height) =>
      value(ctx, "CanvasRenderingContext2D").strokeRect(number(x), number(y), number(width), number(height)),
    "browser.canvas2d.beginPath": (ctx) => value(ctx, "CanvasRenderingContext2D").beginPath(),
    "browser.canvas2d.closePath": (ctx) => value(ctx, "CanvasRenderingContext2D").closePath(),
    "browser.canvas2d.moveTo": (ctx, x, y) =>
      value(ctx, "CanvasRenderingContext2D").moveTo(number(x), number(y)),
    "browser.canvas2d.lineTo": (ctx, x, y) =>
      value(ctx, "CanvasRenderingContext2D").lineTo(number(x), number(y)),
    "browser.canvas2d.arc": (ctx, x, y, radius, startAngle, endAngle) =>
      value(ctx, "CanvasRenderingContext2D").arc(
        number(x), number(y), number(radius), number(startAngle), number(endAngle),
      ),
    "browser.canvas2d.fill": (ctx) => value(ctx, "CanvasRenderingContext2D").fill(),
    "browser.canvas2d.stroke": (ctx) => value(ctx, "CanvasRenderingContext2D").stroke(),
    "browser.canvas2d.setFillStyle": (ctx, style) => {
      value(ctx, "CanvasRenderingContext2D").fillStyle = value(style, "JsString");
      return undefined;
    },
    "browser.canvas2d.setStrokeStyle": (ctx, style) => {
      value(ctx, "CanvasRenderingContext2D").strokeStyle = value(style, "JsString");
      return undefined;
    },
    "browser.canvas2d.setLineWidth": (ctx, width) => {
      value(ctx, "CanvasRenderingContext2D").lineWidth = number(width);
      return undefined;
    },
    "browser.canvas2d.save": (ctx) => value(ctx, "CanvasRenderingContext2D").save(),
    "browser.canvas2d.restore": (ctx) => value(ctx, "CanvasRenderingContext2D").restore(),
    "browser.canvas2d.translate": (ctx, x, y) =>
      value(ctx, "CanvasRenderingContext2D").translate(number(x), number(y)),
    "browser.canvas2d.rotate": (ctx, angle) =>
      value(ctx, "CanvasRenderingContext2D").rotate(number(angle)),
  };
}

export function createBrowserHtmlInputElementHostBindings(state = createHostResourceState()) {
  return createHtmlInputElementResourceHostBindings(state, {
    fromElement: (element) => isInputElement(element) ? element : null,
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

export function createInfoviewHostBindings({ resources = createHostResourceState(), commandDispatcher = null } = {}) {
  return {
    "infoview.documentPosition": (uri, fileName, line, character, label) =>
      resources.resourceForValue({
        uri: resources.resolveResource(uri, "JsString"),
        fileName: resources.resolveResource(fileName, "JsString"),
        line: resources.resolveResource(line, "JsNat"),
        character: resources.resolveResource(character, "JsNat"),
        label: resources.resolveResource(label, "JsString"),
      }),
    "infoview.clipboard.writeText": (text) =>
      resources.resourceForValue(writeTextToHostClipboard(resources.resolveResource(text, "JsString"))),
    "infoview.command.revealPosition": (position) =>
      resources.resourceForValue(revealInfoviewPosition(
        commandDispatcher,
        resources.resolveResource(position, "DocumentPosition"),
      )),
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) =>
      resources.resourceForValue({
        id: resources.resolveResource(id, "JsString"),
        label: resources.resolveResource(label, "JsString"),
        typeName: resources.resolveResource(typeName, "JsString"),
        summary: resources.resolveResource(summary, "JsString"),
        expression: resources.resolveResource(expression, "JsString"),
        typeText: "",
        context: "",
      }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) =>
      resources.resourceForValue({
        ...resources.resolveResource(ref, "RpcRef"),
        typeText: resources.resolveResource(typeText, "JsString"),
        context: resources.resolveResource(context, "JsString"),
        ...nullableField(resources, serverRef, "serverRef"),
      }),
    "js.value.proofwidgets.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(resources.resolveResource(ref, "ResolvedRef")),
    "proofwidgets.rpc.inspectRef": (ref) =>
      resources.resourceForValue(inspectProofWidgetsRpcRef(
        commandDispatcher,
        resources.resolveResource(ref, "RpcRef"),
      )),
    "proofwidgets.rpc.resolveRef": (ref, callback) =>
      resources.resourceForValue(resolveProofWidgetsRpcRef(
        resources,
        commandDispatcher,
        resources.resolveResource(ref, "RpcRef"),
        callback,
      )),
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
    ...createCommonHostBindings(state),
    ...createConsoleHostBindings(state),
    ...createBrowserDocumentHostBindings(state),
    ...createBrowserEventHostBindings(state),
    ...createBrowserElementHostBindings(state),
    ...createBrowserHtmlInputElementHostBindings(state),
    ...createBrowserCanvasHostBindings(state),
    ...createBrowserTimerHostBindings(state),
    ...createBrowserAnimationHostBindings(state),
    ...createInfoviewHostBindings({ resources: state, commandDispatcher: infoviewCommandDispatcher }),
    ...reactBindings,
    [VIR_HOST_DISPOSE]: () => state.dispose(),
  };
}

export function createNodeHostBindings(state = createVirtualDocumentState()) {
  state.resources ??= createHostResourceState();
  return {
    ...createCommonHostBindings(state.resources),
    ...createConsoleHostBindings(state.resources),
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

function isCanvasElement(value) {
  const Canvas = globalThis.HTMLCanvasElement;
  return typeof Canvas === "function"
    ? value instanceof Canvas
    : value !== null && typeof value === "object" && typeof value.getContext === "function";
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

function nullableField(resources, value, name) {
  const payload = nullablePayload(resources, value);
  return payload === null ? {} : { [name]: payload };
}

function inspectProofWidgetsRpcRef(commandDispatcher, ref) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(commandDispatcher, "proofwidgetsRpcInspectRef", normalized);
}

function resolveProofWidgetsRpcRef(resources, commandDispatcher, ref, callback) {
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
      callAndReleaseCallback(callback, resources.resourceForValue(normalizeProofWidgetsResolvedRef(info)));
    }).catch((error) => {
      reportEventHandlerError(error);
      releaseCallback(callback);
    });
  } else {
    callAndReleaseCallback(callback, resources.resourceForValue(normalizeProofWidgetsResolvedRef(result)));
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

function nullableElementTarget(value) {
  return createNullableValue(isElement(value) ? value : null);
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
