/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "react-dom/client";

const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");
const REACT_HTML_MAX_DEPTH = 128;
const REACT_HTML_MAX_NODES = 10000;
const disposedReactHtmlRoots = new WeakSet();

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

export function createBrowserEventHostBindings(state = createDomResourceState()) {
  return {
    "browser.event.target": (event) =>
      resourceForElementTarget(state, resolveResource(state, event, "Event").target),
    "browser.event.currentTarget": (event) =>
      resourceForElementTarget(state, resolveResource(state, event, "Event").currentTarget),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(resolveResource(state, event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(resolveResource(state, event, "Event"));
      return undefined;
    },
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

export function createBrowserReactHostBindings(state = createDomResourceState()) {
  return {
    "react.root.create": (container) => {
      const target = resolveResource(state, container, "Element");
      const root = ReactDOMClient.createRoot(target);
      return resourceForValue(state, createReactRootResource(state, root));
    },
    "react.root.render": (root, html) => {
      try {
        const value = resolveResource(state, root, "ReactRoot");
        value.render(html);
      } catch (error) {
        disposeReactHtml(html);
        throw error;
      }
      return undefined;
    },
    "react.root.unmount": (root) => {
      const value = resolveResource(state, root, "ReactRoot");
      value.unmount();
      releaseResource(state, root);
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
    ...createBrowserEventHostBindings(state),
    ...createBrowserElementHostBindings(state, { runtimeRef }),
    ...createBrowserHtmlInputElementHostBindings(state),
    ...createBrowserTimerHostBindings(state),
    ...createBrowserAnimationHostBindings(state),
    ...createBrowserReactHostBindings(state),
    [VIR_HOST_DISPOSE]: () => disposeDomResourceState(state),
  };
}

export function createVirtualDocumentState({ title = "", elements = new Map(), resources = createDomResourceState() } = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return { title, elements, resources };
}

export function createVirtualElementState({
  textContent = "",
  attributes = new Map(),
  checked = false,
  value = "",
  listeners = new Map(),
} = {}) {
  return { textContent, attributes, checked, value, listeners };
}

export function ensureVirtualElementState(state, selector, element = null) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  let value = state.elements.get(selector);
  if (value === undefined) {
    value = element ?? createVirtualElementState();
    state.elements.set(selector, value);
  }
  return normalizeVirtualElementState(value);
}

export function createVirtualEventState({
  target = null,
  currentTarget = null,
  defaultPrevented = false,
  propagationStopped = false,
  onPreventDefault = null,
  onStopPropagation = null,
} = {}) {
  const event = {
    target,
    currentTarget,
    defaultPrevented,
    propagationStopped,
    preventDefault: () => {
      event.defaultPrevented = true;
      if (typeof onPreventDefault === "function") onPreventDefault(event);
    },
    stopPropagation: () => {
      event.propagationStopped = true;
      if (typeof onStopPropagation === "function") onStopPropagation(event);
    },
  };
  return event;
}

export function createVirtualEventHostBindings(state = createVirtualDocumentState()) {
  return {
    "browser.event.target": (event) => virtualEventElementResource(state, event, "target"),
    "browser.event.currentTarget": (event) => virtualEventElementResource(state, event, "currentTarget"),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(resolveResource(state.resources, event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(resolveResource(state.resources, event, "Event"));
      return undefined;
    },
  };
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
    "browser.document.querySelector": (selector) => resourceForValue(state.resources, queryVirtualElementState(state, selector)),
    ...createVirtualEventHostBindings(state),
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
    "react.root.create": (container) => {
      const target = resolveResource(state.resources, container, "Element");
      return resourceForValue(state.resources, createVirtualReactRootResource(state.resources, target));
    },
    "react.root.render": (root, html) => {
      try {
        const value = resolveResource(state.resources, root, "ReactRoot");
        value.render(html);
      } catch (error) {
        disposeReactHtml(html);
        throw error;
      }
      return undefined;
    },
    "react.root.unmount": (root) => {
      const value = resolveResource(state.resources, root, "ReactRoot");
      value.unmount();
      releaseResource(state.resources, root);
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

export function findVirtualReactElementById(rootOrNode, id) {
  const node = rootOrNode?.current ?? rootOrNode;
  return findVirtualReactElementNodeById(node, id);
}

export function virtualReactElementById(rootOrNode, id) {
  const node = findVirtualReactElementById(rootOrNode, id);
  if (node === null) {
    throw new Error(`expected virtual React element #${id}`);
  }
  return node;
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
    } else if (typeof value.unmount === "function") {
      value.unmount();
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

function isElement(value) {
  return typeof globalThis.Element === "function" && value instanceof globalThis.Element;
}

function resourceForElementTarget(state, value) {
  return isElement(value) ? resourceForValue(state, value) : null;
}

function preventDefaultOnEvent(event) {
  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  } else {
    event.defaultPrevented = true;
  }
}

function stopPropagationOnEvent(event) {
  if (typeof event.stopPropagation === "function") {
    event.stopPropagation();
  } else {
    event.propagationStopped = true;
  }
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

function createReactRootResource(state, root) {
  let currentHtml = null;
  const value = {
    render(html) {
      let nextElement;
      try {
        nextElement = reactElementFromHtml(state, html);
        root.render(nextElement);
      } catch (error) {
        disposeReactHtml(html);
        throw error;
      }
      queueReactHtmlDispose(currentHtml);
      currentHtml = html;
    },
    unmount: once(() => {
      try {
        root.unmount();
      } finally {
        disposeReactHtml(currentHtml);
        currentHtml = null;
        removeDisposable(state, value);
      }
    }),
  };
  addDisposable(state, value);
  return value;
}

function createVirtualReactRootResource(resources, target) {
  let currentHtml = null;
  const value = {
    current: null,
    render(html) {
      let nextTree;
      try {
        nextTree = virtualReactNodeFromHtml(resources, html);
      } catch (error) {
        disposeReactHtml(html);
        throw error;
      }
      disposeReactHtml(currentHtml);
      currentHtml = html;
      value.current = nextTree;
      target.reactRoot = value;
      target.textContent = virtualReactTextContent(nextTree);
    },
    unmount: once(() => {
      disposeReactHtml(currentHtml);
      currentHtml = null;
      value.current = null;
      if (target.reactRoot === value) {
        delete target.reactRoot;
      }
      removeDisposable(resources, value);
    }),
  };
  addDisposable(resources, value);
  return value;
}

function reactElementFromHtml(state, html) {
  return mapReactHtml(html, {
    text: (value) => value,
    element: (fields, children) => {
      const props = reactPropsFromHtml(state, fields);
      return React.createElement(fields.tag, props, ...children());
    },
  });
}

function reactPropsFromHtml(state, fields) {
  const props = {};
  const key = reactHtmlKey(fields);
  if (key !== null && key !== undefined) {
    props.key = key;
  }
  for (const [name, value] of reactHtmlPropertyEntries(fields)) {
    props[name] = value;
  }
  for (const [name, callback] of reactHtmlEventHandlerEntries(fields)) {
    props[name] = (event) => callLeanEventCallback(state, event, callback);
  }
  return props;
}

function virtualReactNodeFromHtml(resources, html) {
  return mapReactHtml(html, {
    text: (value) => ({ kind: "text", value }),
    element: (fields, children) => ({
      kind: "element",
      tag: fields.tag,
      key: reactHtmlKey(fields),
      props: Object.fromEntries(reactHtmlPropertyEntries(fields)),
      handlers: Object.fromEntries(
        reactHtmlEventHandlerEntries(fields)
          .map(([name, callback]) => [name, (event = {}) => callLeanEventCallback(resources, event, callback)]),
      ),
      children: children(),
    }),
  });
}

function mapReactHtml(html, renderer) {
  return mapReactHtmlNode(html, renderer, createReactHtmlTraversalContext(), 0);
}

function mapReactHtmlNode(html, renderer, context, depth) {
  countReactHtmlNode(context, depth);
  if (html?.kind === "text") {
    return renderer.text(reactHtmlTextValue(html));
  }
  if (html?.kind !== "element") {
    throw new Error("React Html node must be text or element");
  }
  const fields = reactHtmlElementFields(html);
  return renderer.element(fields, () =>
    reactHtmlArray(fields.children, "children")
      .map((child) => mapReactHtmlNode(child, renderer, context, depth + 1)));
}

function virtualReactTextContent(node) {
  if (node === null || node === undefined) return "";
  if (node.kind === "text") return node.value;
  if (node.kind === "element") return node.children.map(virtualReactTextContent).join("");
  return "";
}

function disposeReactHtml(html) {
  if (html === null || html === undefined) return;
  if (typeof html.dispose === "function") {
    html.dispose();
    return;
  }
  if (typeof html !== "object" || disposedReactHtmlRoots.has(html)) return;
  disposedReactHtmlRoots.add(html);
  releaseReactHtmlCallbacks(html);
}

function queueReactHtmlDispose(html) {
  if (html === null || html === undefined) return;
  const queue =
    typeof globalThis.queueMicrotask === "function"
      ? globalThis.queueMicrotask.bind(globalThis)
      : (callback) => Promise.resolve().then(callback);
  queue(() => disposeReactHtml(html));
}

function createReactHtmlTraversalContext() {
  return { nodeCount: 0 };
}

function countReactHtmlNode(context, depth) {
  if (depth > REACT_HTML_MAX_DEPTH) {
    throw new Error(`React Html exceeds maximum depth ${REACT_HTML_MAX_DEPTH}`);
  }
  context.nodeCount++;
  if (context.nodeCount > REACT_HTML_MAX_NODES) {
    throw new Error(`React Html exceeds maximum node count ${REACT_HTML_MAX_NODES}`);
  }
}

function reactHtmlElementFields(html) {
  const fields = html?.fields;
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("React Html element fields must be an object");
  }
  reactHtmlName(fields.tag, "element tag");
  return fields;
}

function reactHtmlTextValue(html) {
  if (typeof html.value !== "string") {
    throw new Error("React Html text value must be a string");
  }
  return html.value;
}

function reactHtmlKey(fields) {
  const key = Object.prototype.hasOwnProperty.call(fields, "key?") ? fields["key?"] : fields.key;
  if (key !== null && key !== undefined && typeof key !== "string") {
    throw new Error("React Html element key must be a string or null");
  }
  return key;
}

function reactHtmlArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`React Html ${label} must be an array`);
  }
  return value;
}

function reactHtmlPropertyEntries(fields) {
  return reactHtmlArray(fields.props, "props")
    .map((prop) => [reactHtmlPropertyName(prop), reactPropValue(prop?.value)]);
}

function reactHtmlEventHandlerEntries(fields) {
  return reactHtmlArray(fields.handlers, "handlers")
    .map((handler) => [reactHtmlNamedField(handler, "event handler"), reactHtmlEventCallback(handler)]);
}

function reactHtmlPropertyName(prop) {
  const name = reactHtmlNamedField(prop, "property");
  if (name === "data-") {
    throw new Error("React Html data-* property name must include a suffix");
  }
  return name;
}

function reactHtmlNamedField(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`React Html ${label} must be an object`);
  }
  return reactHtmlName(value.name, `${label} name`);
}

function reactHtmlName(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`React Html ${label} must be a non-empty string`);
  }
  return value;
}

function reactHtmlEventCallback(handler) {
  const callback = handler?.callback;
  if (typeof callback !== "function" || typeof callback.release !== "function") {
    throw new Error("React Html event handler callback must be a releasable function");
  }
  return callback;
}

function reactPropValue(value) {
  switch (value?.kind) {
    case "string":
      if (typeof value.value !== "string") {
        throw new Error("React PropValue.string value must be a string");
      }
      return value.value;
    case "bool":
      if (typeof value.value !== "boolean") {
        throw new Error("React PropValue.bool value must be a boolean");
      }
      return value.value;
    case "int":
      return reactIntPropValue(value.value);
    case "float":
      return reactFloatPropValue(value.value);
    default:
      throw new Error("React PropValue must be string, bool, int, or float");
  }
}

function reactIntPropValue(value) {
  let number;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
    number = Number(value);
  } else {
    throw new Error("React PropValue.int value must be a safe integer");
  }
  if (!Number.isSafeInteger(number)) {
    throw new Error("React PropValue.int value must be a safe integer");
  }
  return number;
}

function reactFloatPropValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("React PropValue.float value must be a finite number");
  }
  return value;
}

function releaseReactHtmlCallbacks(html) {
  if (html === null || typeof html !== "object" || html.kind !== "element") return;
  const fields = html.fields;
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return;
  if (Array.isArray(fields.handlers)) {
    for (const handler of fields.handlers) {
      if (typeof handler?.callback?.release === "function") {
        handler.callback.release();
      }
    }
  }
  if (Array.isArray(fields.children)) {
    for (const child of fields.children) {
      releaseReactHtmlCallbacks(child);
    }
  }
}

function queryVirtualElementState(state, selector) {
  const element = state.elements.get(selector);
  return element === undefined ? null : normalizeVirtualElementState(element);
}

function normalizeVirtualElementState(element) {
  element.textContent ??= "";
  element.attributes ??= new Map();
  element.checked ??= false;
  element.value ??= "";
  element.listeners ??= new Map();
  return element;
}

function findVirtualReactElementNodeById(node, id) {
  if (node?.kind !== "element") return null;
  if (node.props?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findVirtualReactElementNodeById(child, id);
    if (found !== null) return found;
  }
  return null;
}

function virtualEventElementResource(state, event, field) {
  const value = resolveResource(state.resources, event, "Event")?.[field];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return resourceForValue(state.resources, queryVirtualElementState(state, value));
  }
  if (Number.isInteger(value?.handle)) {
    resolveResource(state.resources, value, "Element");
    return value;
  }
  if (typeof value === "object") {
    return resourceForValue(state.resources, value);
  }
  return null;
}

function virtualCallbackEventListenerState(target, eventName, callback, resources) {
  if (!target.listeners.has(eventName)) {
    target.listeners.set(eventName, []);
  }
  const listener = {
    removed: false,
    dispatch(event = {}) {
      if (!listener.removed) {
        const dispatchEvent = event !== null && typeof event === "object" ? event : {};
        dispatchEvent.target ??= target;
        dispatchEvent.currentTarget ??= target;
        callLeanEventCallback(resources, dispatchEvent, callback);
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
