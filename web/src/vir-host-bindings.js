/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

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

function createDomResourceState() {
  return {
    nextHandle: 1,
    values: new Map(),
    handles: new WeakMap(),
    disposables: new Set(),
  };
}

export function createBrowserDocumentHostBindings(state = createDomResourceState()) {
  return {
    "browser.document.getTitle": () => browserDocument().title,
    "browser.document.setTitle": (title) => {
      browserDocument().title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state, queryDocumentElement(selector)),
  };
}

export function createBrowserElementHostBindings(state = createDomResourceState(), { runtimeRef = null } = {}) {
  return {
    "browser.element.getTextContent": (element) => resolveResource(state, element, "Element").textContent ?? "",
    "browser.element.setTextContent": (element, text) => {
      resolveResource(state, element, "Element").textContent = text;
      return undefined;
    },
    "browser.element.getAttribute": (element, name) => resolveResource(state, element, "Element").getAttribute(name) ?? null,
    "browser.element.setAttribute": (element, name, value) => {
      resolveResource(state, element, "Element").setAttribute(name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, callback) => {
      const target = resolveResource(state, element, "Element");
      const handler = (event) => callLeanEventCallback(state, event, callback);
      target.addEventListener(eventName, handler);
      const listener = {
        remove: once(() => {
          target.removeEventListener(eventName, handler);
          callback.release();
          removeDisposable(state, listener);
        }),
      };
      addDisposable(state, listener);
      return resourceForValue(state, listener);
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resolveResource(state, listener, "EventListener");
      value.remove();
      releaseResource(state, listener);
      return undefined;
    },
  };
}

export function createBrowserHtmlInputElementHostBindings(state = createDomResourceState()) {
  return {
    "browser.htmlInputElement.fromElement": (element) => {
      const value = resolveResource(state, element, "Element");
      return isInputElement(value) ? resourceForValue(state, value) : null;
    },
    "browser.htmlInputElement.getChecked": (input) => resolveResource(state, input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resolveResource(state, input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) => resolveResource(state, input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resolveResource(state, input, "HTMLInputElement").value = value;
      return undefined;
    },
  };
}

export function createBrowserTimerHostBindings(state = createDomResourceState()) {
  return {
    "browser.timer.setTimeout": (delayMs, callback) => {
      let timeout = null;
      const value = {
        clear: once(() => {
          if (timeout !== null) {
            globalThis.clearTimeout(timeout);
            timeout = null;
          }
          callback.release();
          removeDisposable(state, value);
        }),
      };
      timeout = globalThis.setTimeout(() => {
        timeout = null;
        try {
          callback();
        } catch (error) {
          reportEventHandlerError(error);
        } finally {
          value.clear();
          releaseValueResource(state, value);
        }
      }, delayMs);
      addDisposable(state, value);
      return resourceForValue(state, value);
    },
    "browser.timer.clearTimeout": (timeout) => {
      const value = resolveResource(state, timeout, "Timeout");
      value.clear();
      releaseResource(state, timeout);
      return undefined;
    },
  };
}

export function createBrowserAnimationHostBindings(state = createDomResourceState()) {
  const requestFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => globalThis.setTimeout(() => callback(performanceNow()), 16);
  const cancelFrame =
    typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : globalThis.clearTimeout.bind(globalThis);
  return {
    "browser.animation.requestAnimationFrame": (callback) => {
      let frame = null;
      const value = {
        cancel: once(() => {
          if (frame !== null) {
            cancelFrame(frame);
            frame = null;
          }
          callback.release();
          removeDisposable(state, value);
        }),
      };
      frame = requestFrame((timestamp) => {
        frame = null;
        try {
          callback(Number(timestamp));
        } catch (error) {
          reportEventHandlerError(error);
        } finally {
          value.cancel();
          releaseValueResource(state, value);
        }
      });
      addDisposable(state, value);
      return resourceForValue(state, value);
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resolveResource(state, frame, "AnimationFrame");
      value.cancel();
      releaseResource(state, frame);
      return undefined;
    },
  };
}

export function createBrowserHostBindings({ runtimeRef = null } = {}) {
  const state = createDomResourceState();
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createBrowserDocumentHostBindings(state),
    ...createBrowserElementHostBindings(state, { runtimeRef }),
    ...createBrowserHtmlInputElementHostBindings(state),
    ...createBrowserTimerHostBindings(state),
    ...createBrowserAnimationHostBindings(state),
    [VIR_HOST_DISPOSE]: () => disposeDomResourceState(state),
  };
}

export function createVirtualDocumentState({ title = "", elements = new Map(), resources = createDomResourceState() } = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return { title, elements, resources };
}

export function createVirtualDocumentHostBindings(
  state = createVirtualDocumentState(),
  { runtimeRef = null } = {},
) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources ??= createDomResourceState();
  return {
    "browser.document.getTitle": () => state.title,
    "browser.document.setTitle": (title) => {
      state.title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state.resources, virtualElementState(state, selector)),
    "browser.element.getTextContent": (element) => resolveResource(state.resources, element, "Element").textContent,
    "browser.element.setTextContent": (element, text) => {
      resolveResource(state.resources, element, "Element").textContent = text;
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      resolveResource(state.resources, element, "Element").attributes.get(name) ?? null,
    "browser.element.setAttribute": (element, name, value) => {
      resolveResource(state.resources, element, "Element").attributes.set(name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, callback) => {
      const target = resolveResource(state.resources, element, "Element");
      const listener = virtualCallbackEventListenerState(target, eventName, callback, state.resources);
      target.listeners.get(eventName).push(listener);
      addDisposable(state.resources, listener);
      return resourceForValue(state.resources, listener);
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resolveResource(state.resources, listener, "EventListener");
      value.remove();
      releaseResource(state.resources, listener);
      return undefined;
    },
    "browser.htmlInputElement.fromElement": (element) =>
      resourceForValue(state.resources, resolveResource(state.resources, element, "Element")),
    "browser.htmlInputElement.getChecked": (input) =>
      resolveResource(state.resources, input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resolveResource(state.resources, input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) =>
      resolveResource(state.resources, input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resolveResource(state.resources, input, "HTMLInputElement").value = value;
      return undefined;
    },
    "browser.timer.setTimeout": (delayMs, callback) => {
      let timeout = null;
      const value = {
        clear: once(() => {
          if (timeout !== null) {
            globalThis.clearTimeout(timeout);
            timeout = null;
          }
          callback.release();
          removeDisposable(state.resources, value);
        }),
      };
      timeout = globalThis.setTimeout(() => {
        timeout = null;
        try {
          callback();
        } catch (error) {
          reportEventHandlerError(error);
        } finally {
          value.clear();
          releaseValueResource(state.resources, value);
        }
      }, delayMs);
      addDisposable(state.resources, value);
      return resourceForValue(state.resources, value);
    },
    "browser.timer.clearTimeout": (timeout) => {
      const value = resolveResource(state.resources, timeout, "Timeout");
      value.clear();
      releaseResource(state.resources, timeout);
      return undefined;
    },
    "browser.animation.requestAnimationFrame": (callback) => {
      let frame = null;
      const value = {
        cancel: once(() => {
          if (frame !== null) {
            globalThis.clearTimeout(frame);
            frame = null;
          }
          callback.release();
          removeDisposable(state.resources, value);
        }),
      };
      frame = globalThis.setTimeout(() => {
        frame = null;
        try {
          callback(performanceNow());
        } catch (error) {
          reportEventHandlerError(error);
        } finally {
          value.cancel();
          releaseValueResource(state.resources, value);
        }
      }, 16);
      addDisposable(state.resources, value);
      return resourceForValue(state.resources, value);
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resolveResource(state.resources, frame, "AnimationFrame");
      value.cancel();
      releaseResource(state.resources, frame);
      return undefined;
    },
    [VIR_HOST_DISPOSE]: () => disposeDomResourceState(state.resources),
  };
}

export function createNodeHostBindings(state = createVirtualDocumentState(), { runtimeRef = null } = {}) {
  return {
    ...createCommonHostBindings(),
    ...createConsoleHostBindings(),
    ...createVirtualDocumentHostBindings(state, { runtimeRef }),
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

function resourceForValue(state, value) {
  if (value === null || value === undefined) return null;
  let handle = state.handles.get(value);
  if (handle === undefined) {
    handle = state.nextHandle++;
    state.handles.set(value, handle);
    state.values.set(handle, value);
  }
  return { handle };
}

function releaseResource(state, resource) {
  const handle = resourceHandle(resource, "Resource");
  const value = state.values.get(handle);
  if (value !== undefined) {
    state.handles.delete(value);
    state.values.delete(handle);
  }
}

function releaseValueResource(state, value) {
  const handle = state.handles.get(value);
  if (handle !== undefined) {
    releaseResource(state, { handle });
  }
}

function addDisposable(state, value) {
  state.disposables ??= new Set();
  state.disposables.add(value);
}

function removeDisposable(state, value) {
  state.disposables?.delete(value);
}

function disposeDomResourceState(state) {
  for (const value of Array.from(state.disposables ?? [])) {
    if (typeof value.remove === "function") {
      value.remove();
    } else if (typeof value.clear === "function") {
      value.clear();
    } else if (typeof value.cancel === "function") {
      value.cancel();
    }
  }
  state.disposables?.clear();
  state.values?.clear();
  state.handles = new WeakMap();
  state.nextHandle = 1;
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return fn(...args);
  };
}

function resolveResource(state, resource, label) {
  const handle = resourceHandle(resource, label);
  const value = state.values.get(handle);
  if (value === undefined) {
    throw new Error(`${label} resource handle ${handle} is not live`);
  }
  return value;
}

function resourceHandle(resource, label) {
  const handle = resource?.handle;
  if (!Number.isInteger(handle) || handle <= 0 || handle > 0xffffffff) {
    throw new Error(`${label} resource must be a live DOM resource handle`);
  }
  return handle;
}

function isInputElement(value) {
  return typeof globalThis.HTMLInputElement === "function" && value instanceof globalThis.HTMLInputElement;
}

function callLeanEventCallback(state, event, callback) {
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

function reportEventHandlerError(error) {
  console.error(error);
  const status = globalThis.document?.querySelector?.("#status") ?? null;
  if (status !== null) {
    status.textContent = "Trap";
    status.dataset.ready = "false";
  }
}

function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function virtualElementState(state, selector) {
  let element = state.elements.get(selector);
  if (element === undefined) {
    element = { textContent: "", attributes: new Map(), checked: false, value: "", listeners: new Map() };
    state.elements.set(selector, element);
  } else {
    element.textContent ??= "";
    element.attributes ??= new Map();
    element.checked ??= false;
    element.value ??= "";
    element.listeners ??= new Map();
  }
  return element;
}

function virtualCallbackEventListenerState(target, eventName, callback, resources) {
  if (!target.listeners.has(eventName)) {
    target.listeners.set(eventName, []);
  }
  const listener = {
    removed: false,
    dispatch(event = {}) {
      if (!listener.removed) {
        callLeanEventCallback(resources, event, callback);
      }
    },
    remove() {
      if (listener.removed) return;
      listener.removed = true;
      const listeners = target.listeners.get(eventName) ?? [];
      target.listeners.set(eventName, listeners.filter((candidate) => candidate !== listener));
      callback.release();
      removeDisposable(resources, listener);
    },
  };
  return listener;
}
