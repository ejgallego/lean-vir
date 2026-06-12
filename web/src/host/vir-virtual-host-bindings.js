/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirtualReactRootResource as createVirtualReactRootResourceFromHtml } from "../react/vir-react-html.js";
import { isHostResource } from "../resource-handles.js";
import {
  callLeanEventCallback,
  createAnimationFrameResource,
  createElementResourceHostBindings,
  createHostResourceState,
  createHtmlInputElementResourceHostBindings,
  createReactHostHooks,
  createReactRootResourceHostBindings,
  createTimeoutResource,
  disposeDomResourceState,
  performanceNow,
  preventDefaultOnEvent,
  releaseResource,
  removeDisposable,
  resolveResource,
  resourceForValue,
  stopPropagationOnEvent,
} from "./vir-host-resources.js";

const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");

export function createVirtualDocumentState({ title = "", elements = new Map(), resources = createHostResourceState() } = {}) {
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

export function createVirtualDocumentHostBindings(state = createVirtualDocumentState()) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources ??= createHostResourceState();
  return {
    "browser.document.getTitle": () => state.title,
    "browser.document.setTitle": (title) => {
      state.title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) => resourceForValue(state.resources, queryVirtualElementState(state, selector)),
    ...createVirtualEventHostBindings(state),
    ...createElementResourceHostBindings(state.resources, {
      getTextContent: (target) => target.textContent,
      setTextContent: (target, text) => {
        target.textContent = text;
      },
      getAttribute: (target, name) => target.attributes.get(name) ?? null,
      setAttribute: (target, name, value) => target.attributes.set(name, value),
      createEventListener: (target, eventName, callback) =>
        createVirtualEventListenerResource(state.resources, target, eventName, callback),
    }),
    ...createHtmlInputElementResourceHostBindings(state.resources, {
      fromElement: (element) => resourceForValue(state.resources, element),
    }),
    "browser.timer.setTimeout": (delayMs, callback) =>
      resourceForValue(state.resources, createTimeoutResource(state.resources, delayMs, callback)),
    "browser.timer.clearTimeout": (timeout) => {
      const value = resolveResource(state.resources, timeout, "Timeout");
      value.clear();
      releaseResource(state.resources, timeout);
      return undefined;
    },
    "browser.animation.requestAnimationFrame": (callback) =>
      resourceForValue(
        state.resources,
        createAnimationFrameResource(
          state.resources,
          callback,
          (run) => globalThis.setTimeout(() => run(performanceNow()), 16),
          globalThis.clearTimeout.bind(globalThis),
        ),
      ),
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resolveResource(state.resources, frame, "AnimationFrame");
      value.cancel();
      releaseResource(state.resources, frame);
      return undefined;
    },
    ...createReactRootResourceHostBindings(state.resources, (target) =>
      createVirtualReactRootResource(state.resources, target)),
    [VIR_HOST_DISPOSE]: () => disposeDomResourceState(state.resources),
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

function createVirtualEventListenerResource(resources, target, eventName, callback) {
  const listener = virtualCallbackEventListenerState(target, eventName, callback, resources);
  target.listeners.get(eventName).push(listener);
  return listener;
}

function createVirtualReactRootResource(resources, target) {
  return createVirtualReactRootResourceFromHtml(resources, target, createReactHostHooks());
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
  if (isHostResource(value)) {
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
