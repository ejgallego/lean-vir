/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { disposeReactHtml } from "../react/vir-react-html.js";
import {
  createHostResource,
  hostResourceLabel,
  hostResourceValue,
  isHostResource,
  releaseHostResource,
} from "../host-resource.js";

const EXTERNREF_TABLE_INITIAL_LENGTH = 1;
let externrefTableSupport = null;

export function hasExternrefTableSupport() {
  if (externrefTableSupport !== null) {
    return externrefTableSupport;
  }
  try {
    const table = new WebAssembly.Table({
      element: "externref",
      initial: EXTERNREF_TABLE_INITIAL_LENGTH,
    });
    const marker = { kind: "lean-vir.externref-table-probe" };
    table.set(0, marker);
    externrefTableSupport = table.get(0) === marker;
  } catch {
    externrefTableSupport = false;
  }
  return externrefTableSupport;
}

export function requireExternrefTableSupport() {
  if (!hasExternrefTableSupport()) {
    throw new Error("Lean VIR React/browser host resources require WebAssembly externref support");
  }
}

export function createHostResourceState() {
  requireExternrefTableSupport();
  return {
    resources: new WeakMap(),
    liveResources: new WeakSet(),
    disposables: new Set(),
  };
}

export function createElementResourceHostBindings(resources, operations) {
  return {
    "browser.element.getTextContent": (element) =>
      operations.getTextContent(resolveResource(resources, element, "Element")),
    "browser.element.setTextContent": (element, text) => {
      operations.setTextContent(resolveResource(resources, element, "Element"), text);
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      operations.getAttribute(resolveResource(resources, element, "Element"), name),
    "browser.element.setAttribute": (element, name, value) => {
      operations.setAttribute(resolveResource(resources, element, "Element"), name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, callback) => {
      const target = resolveResource(resources, element, "Element");
      const listener = operations.createEventListener(target, eventName, callback);
      addDisposable(resources, listener);
      return resourceForValue(resources, listener);
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resolveResource(resources, listener, "EventListener");
      value.remove();
      releaseResource(resources, listener);
      return undefined;
    },
  };
}

export function createHtmlInputElementResourceHostBindings(resources, { fromElement }) {
  return {
    "browser.htmlInputElement.fromElement": (element) =>
      fromElement(resolveResource(resources, element, "Element")),
    "browser.htmlInputElement.getChecked": (input) =>
      resolveResource(resources, input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resolveResource(resources, input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) =>
      resolveResource(resources, input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resolveResource(resources, input, "HTMLInputElement").value = value;
      return undefined;
    },
  };
}

export function createReactRootResourceHostBindings(resources, createRootResource) {
  return {
    "react.root.create": (container) => {
      const target = resolveResource(resources, container, "Element");
      return resourceForValue(resources, createRootResource(target));
    },
    "react.root.render": (root, html) => {
      try {
        const value = resolveResource(resources, root, "ReactRoot");
        value.render(html);
      } catch (error) {
        disposeReactHtml(html);
        throw error;
      }
      return undefined;
    },
    "react.root.unmount": (root) => {
      const value = resolveResource(resources, root, "ReactRoot");
      value.unmount();
      releaseResource(resources, root);
      return undefined;
    },
  };
}

export function resourceForValue(state, value) {
  if (value === null || value === undefined) return null;
  let resource = state.resources.get(value);
  if (!isHostResource(resource) || hostResourceValue(resource) === null) {
    resource = createHostResource(value);
    state.resources.set(value, resource);
  }
  state.liveResources.add(resource);
  return resource;
}

export function releaseResource(state, resource) {
  const value = hostResourceValue(resource);
  if (value !== null && value !== undefined) {
    state.resources.delete(value);
  }
  if (isHostResource(resource)) {
    state.liveResources.delete(resource);
  }
  releaseHostResource(resource);
}

export function releaseValueResource(state, value) {
  const resource = state.resources.get(value);
  if (resource !== undefined) {
    releaseResource(state, resource);
  }
}

export function addDisposable(state, value) {
  state.disposables ??= new Set();
  state.disposables.add(value);
}

export function removeDisposable(state, value) {
  state.disposables?.delete(value);
}

export function disposeDomResourceState(state) {
  for (const value of Array.from(state.disposables ?? [])) {
    if (typeof value.remove === "function") {
      value.remove();
    } else if (typeof value.clear === "function") {
      value.clear();
    } else if (typeof value.cancel === "function") {
      value.cancel();
    } else if (typeof value.unmount === "function") {
      value.unmount();
    }
  }
  state.disposables?.clear();
  state.resources = new WeakMap();
  state.liveResources = new WeakSet();
}

export function createTimeoutResource(resources, delayMs, callback) {
  return createScheduledCallbackResource(resources, callback, {
    disposeMethod: "clear",
    schedule: (run) => globalThis.setTimeout(run, delayMs),
    cancel: globalThis.clearTimeout.bind(globalThis),
    invoke: (leanCallback) => leanCallback(),
  });
}

export function createAnimationFrameResource(resources, callback, requestFrame, cancelFrame) {
  return createScheduledCallbackResource(resources, callback, {
    disposeMethod: "cancel",
    schedule: requestFrame,
    cancel: cancelFrame,
    invoke: (leanCallback, timestamp) => leanCallback(Number(timestamp)),
  });
}

export function createScheduledCallbackResource(resources, callback, { disposeMethod, schedule, cancel, invoke }) {
  let token = null;
  const value = {
    [disposeMethod]: once(() => {
      if (token !== null) {
        cancel(token);
        token = null;
      }
      callback.release();
      removeDisposable(resources, value);
    }),
  };
  token = schedule((...args) => {
    token = null;
    try {
      invoke(callback, ...args);
    } catch (error) {
      reportEventHandlerError(error);
    } finally {
      value[disposeMethod]();
      releaseValueResource(resources, value);
    }
  });
  addDisposable(resources, value);
  return value;
}

export function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return fn(...args);
  };
}

export function resolveResource(state, resource, label) {
  const value = hostResourceValue(resource);
  if (value === null || value === undefined || !state.liveResources.has(resource)) {
    throw new Error(`${hostResourceLabel(resource) ?? label} resource is not live`);
  }
  return value;
}

export function preventDefaultOnEvent(event) {
  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  } else {
    event.defaultPrevented = true;
  }
}

export function stopPropagationOnEvent(event) {
  if (typeof event.stopPropagation === "function") {
    event.stopPropagation();
  } else {
    event.propagationStopped = true;
  }
}

export function callLeanEventCallback(state, event, callback) {
  const eventResource = resourceForValue(state, event ?? {});
  try {
    callback(eventResource);
  } catch (error) {
    reportEventHandlerError(error);
  } finally {
    if (eventResource !== null) {
      releaseResource(state, eventResource);
    }
  }
}

export function reportEventHandlerError(error) {
  console.error(error);
  const status = globalThis.document?.querySelector?.("#status") ?? null;
  if (status !== null) {
    status.textContent = "Trap";
    status.dataset.ready = "false";
  }
}

export function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createReactHostHooks() {
  return {
    addDisposable,
    removeDisposable,
    callLeanEventCallback,
    once,
  };
}
