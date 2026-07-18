/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createHostResource,
  hostResourceLabel,
  hostResourceValue,
  isHostResource,
  releaseHostResource,
  requireExternrefTableSupport,
} from "../host-resource.js";
import {
  createReactElementTypeTagResource,
  createReactNodeChildrenResource,
  createReactPropsResource,
  disposeReactNode,
  pushReactNodeChild,
  setReactPropsEventHandler,
  setReactPropsKey,
  setReactPropsProperty,
  setReactPropsRef,
} from "../react/vir-react-node.js";
import { createNullableValue } from "./vir-js-value-bindings.js";
import { collectCleanupError, throwCollectedErrors } from "../runtime/cleanup.js";

// Map uses SameValueZero; remap -0 so primitive interning follows Object.is.
const negativeZeroPrimitiveKey = Symbol("lean-vir.negativeZero");

export class HostResourceState {
  constructor() {
    requireExternrefTableSupport();
    this.resources = new WeakMap();
    this.primitiveResources = new Map();
    this.liveResources = new Set();
    this.temporaryResourceScopes = [];
    this.disposables = new Set();
  }

  resourceForValue(value) {
    if (value === null || value === undefined) return null;
    if (this.temporaryResourceScopes.length !== 0) {
      return this.temporaryResourceForValue(value);
    }
    if (!isWeakMapKey(value)) {
      const key = primitiveResourceKey(value);
      let resource = this.primitiveResources.get(key);
      if (!isHostResource(resource) || hostResourceValue(resource) === null) {
        resource = createHostResource(value);
        this.primitiveResources.set(key, resource);
      }
      this.liveResources.add(resource);
      return resource;
    }
    let resource = this.resources.get(value);
    if (!isHostResource(resource) || hostResourceValue(resource) === null) {
      resource = createHostResource(value);
      this.resources.set(value, resource);
    }
    this.liveResources.add(resource);
    return resource;
  }

  // Creates a unique resource whose receiver is responsible for releasing it.
  ownedResourceForValue(value) {
    if (value === null || value === undefined) return null;
    const resource = createHostResource(value);
    this.liveResources.add(resource);
    return resource;
  }

  temporaryResourceForValue(value) {
    const resource = this.ownedResourceForValue(value);
    if (resource === null) return null;
    const scope = this.temporaryResourceScopes.at(-1);
    if (scope !== undefined) {
      scope.add(resource);
    }
    return resource;
  }

  withTemporaryResourceScope(run) {
    const scope = new Set();
    this.temporaryResourceScopes.push(scope);
    const errors = [];
    let result;
    try {
      const attempted = collectCleanupError(errors, run);
      result = attempted.value;
    } finally {
      this.temporaryResourceScopes.pop();
      for (const resource of Array.from(scope)) {
        collectCleanupError(errors, () => this.releaseResource(resource));
      }
      scope.clear();
    }
    throwCollectedErrors(errors, "temporary host resource scope cleanup failed");
    return result;
  }

  releaseResource(resource) {
    const value = hostResourceValue(resource);
    if (isWeakMapKey(value)) {
      if (this.resources.get(value) === resource) {
        this.resources.delete(value);
      }
    } else if (value !== null && value !== undefined) {
      const key = primitiveResourceKey(value);
      if (this.primitiveResources.get(key) === resource) {
        this.primitiveResources.delete(key);
      }
    }
    if (isHostResource(resource)) {
      this.liveResources.delete(resource);
    }
    releaseHostResource(resource);
    return undefined;
  }

  releaseValueResource(value) {
    if (!isWeakMapKey(value)) {
      const resource = this.primitiveResources.get(primitiveResourceKey(value));
      if (resource !== undefined) {
        this.releaseResource(resource);
      }
      return undefined;
    }
    const resource = this.resources.get(value);
    if (resource !== undefined) {
      this.releaseResource(resource);
    }
    return undefined;
  }

  addDisposable(value) {
    this.disposables.add(value);
    return undefined;
  }

  removeDisposable(value) {
    this.disposables.delete(value);
    return undefined;
  }

  // Debug-only lifecycle visibility for runtime tests; not a stable host API.
  debugResourceCounts() {
    return {
      live: this.liveResources.size,
      primitives: this.primitiveResources.size,
      temporaryScopes: this.temporaryResourceScopes.length,
      disposables: this.disposables.size,
    };
  }

  resolveResource(resource, label) {
    const value = hostResourceValue(resource);
    if (value === null || value === undefined || !this.liveResources.has(resource)) {
      throw new Error(`${hostResourceLabel(resource) ?? label} resource is not live`);
    }
    return value;
  }

  dispose() {
    const errors = [];
    for (const value of Array.from(this.disposables)) {
      collectCleanupError(errors, () => disposeHostResourceValue(value));
    }
    this.disposables.clear();
    for (const resource of Array.from(this.liveResources)) {
      collectCleanupError(errors, () => this.releaseResource(resource));
    }
    this.resources = new WeakMap();
    this.primitiveResources.clear();
    this.liveResources.clear();
    this.temporaryResourceScopes.length = 0;
    throwCollectedErrors(errors, "host resource disposal failed");
    return undefined;
  }
}

function disposeHostResourceValue(value) {
  if (typeof value.dispose === "function") {
    return value.dispose();
  }
  if (typeof value.remove === "function") {
    return value.remove();
  }
  if (typeof value.clear === "function") {
    return value.clear();
  }
  if (typeof value.cancel === "function") {
    return value.cancel();
  }
  if (typeof value.unmount === "function") {
    return value.unmount();
  }
  return undefined;
}

function isWeakMapKey(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function primitiveResourceKey(value) {
  return typeof value === "number" && Object.is(value, -0)
    ? negativeZeroPrimitiveKey
    : value;
}

export function createHostResourceState() {
  return new HostResourceState();
}

export function createElementResourceHostBindings(resources, operations) {
  return {
    "browser.element.getTextContent": (element) =>
      resources.resourceForValue(operations.getTextContent(resources.resolveResource(element, "Element"))),
    "browser.element.setTextContent": (element, text) => {
      const target = resources.resolveResource(element, "Element");
      return withConsumedResources(resources, [[text, "JsString"]], (resolvedText) => {
        operations.setTextContent(target, resolvedText);
        return undefined;
      });
    },
    "browser.element.getAttribute": (element, name) =>
      resources.resourceForValue(createNullableValue(
        operations.getAttribute(
          resources.resolveResource(element, "Element"),
          resources.resolveResource(name, "JsString"),
        ),
      )),
    "browser.element.setAttribute": (element, name, value) => {
      operations.setAttribute(
        resources.resolveResource(element, "Element"),
        resources.resolveResource(name, "JsString"),
        resources.resolveResource(value, "JsString"),
      );
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, callback) => {
      const target = resources.resolveResource(element, "Element");
      const listener = operations.createEventListener(
        target,
        resources.resolveResource(eventName, "JsString"),
        callback,
      );
      resources.addDisposable(listener);
      return resources.resourceForValue(listener);
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resources.resolveResource(listener, "EventListener");
      value.remove();
      resources.releaseResource(listener);
      return undefined;
    },
  };
}

export function withConsumedResources(resources, inputs, run) {
  const consumed = [];
  const errors = [];
  const attempted = collectCleanupError(errors, () => {
    const values = inputs.map(([resource, label]) => {
      const value = resources.resolveResource(resource, label);
      consumed.push(resource);
      return value;
    });
    return run(...values);
  });
  for (const resource of new Set(consumed)) {
    collectCleanupError(errors, () => resources.releaseResource(resource));
  }
  throwCollectedErrors(errors, "consumed host resource cleanup failed");
  return attempted.value;
}

export function createHtmlInputElementResourceHostBindings(resources, { fromElement }) {
  return {
    "browser.htmlInputElement.fromElement": (element) =>
      resources.resourceForValue(createNullableValue(fromElement(resources.resolveResource(element, "Element")))),
    "browser.htmlInputElement.getChecked": (input) =>
      resources.resourceForValue(resources.resolveResource(input, "HTMLInputElement").checked === true),
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resources.resolveResource(input, "HTMLInputElement").checked =
        resources.resolveResource(checked, "JsBool");
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) =>
      resources.resourceForValue(resources.resolveResource(input, "HTMLInputElement").value ?? ""),
    "browser.htmlInputElement.setValue": (input, value) => {
      resources.resolveResource(input, "HTMLInputElement").value =
        resources.resolveResource(value, "JsString");
      return undefined;
    },
  };
}

export function createReactRootResourceHostBindings(resources, createRootResource, {
  querySelector = null,
  createNodeTextResource = null,
  createNodeElementResource = null,
  createNodeFragmentResource = null,
} = {}) {
  const rootsByContainer = new WeakMap();
  const rootsBySelector = new Map();

  function forgetRoot(container, root) {
    if (rootsByContainer.get(container) === root) {
      rootsByContainer.delete(container);
    }
    for (const [selector, mounted] of rootsBySelector) {
      if (mounted.root === root) {
        rootsBySelector.delete(selector);
      }
    }
  }

  function rootForContainer(container) {
    let root = rootsByContainer.get(container);
    if (root !== undefined) {
      return root;
    }
    root = createRootResource(container);
    if (typeof root?.unmount !== "function") {
      throw new Error("React root resource must provide an unmount function");
    }
    const unmount = root.unmount;
    root.unmount = (...args) => {
      try {
        return unmount.apply(root, args);
      } finally {
        forgetRoot(container, root);
      }
    };
    rootsByContainer.set(container, root);
    return root;
  }

  function queryReactRootSelector(selector) {
    if (typeof querySelector !== "function") {
      throw new Error("react.root selector host bindings require a querySelector function");
    }
    return querySelector(selector);
  }

  function releaseRootResource(root) {
    root.unmount();
    resources.releaseValueResource(root);
  }

  function releaseLeanCallback(callback) {
    if (typeof callback?.release === "function") {
      callback.release();
    }
  }

  function disposeUnrenderedReactNode(node) {
    disposeReactNode(resources, node);
  }

  function selectorRoot(selector, onMissing) {
    const target = queryReactRootSelector(selector);
    if (target === null || target === undefined) {
      onMissing();
      return null;
    }
    const existing = rootsBySelector.get(selector);
    if (existing !== undefined && existing.container !== target) {
      releaseRootResource(existing.root);
    }
    const root = rootForContainer(target);
    rootsBySelector.set(selector, { container: target, root });
    return root;
  }

  return {
    "react.node.text": (value) =>
      resources.resourceForValue(
        requireReactNodeTextResourceFactory(createNodeTextResource)(jsStringValue(resources, value, "React Node text value"))
      ),
    "react.elementType.tag": (tag) =>
      resources.resourceForValue(createReactElementTypeTagResource(
        jsStringValue(resources, tag, "React element type tag"),
      )),
    "react.props.empty": () =>
      resources.resourceForValue(createReactPropsResource()),
    "react.props.setKey": (props, key) =>
      setReactPropsKey(resources, props, key),
    "react.props.setProperty": (props, property) =>
      setReactPropsProperty(resources, props, property),
    "react.props.setEventHandler": (props, handler) =>
      setReactPropsEventHandler(resources, props, handler),
    "react.props.setRef": (props, ref) =>
      setReactPropsRef(resources, props, ref),
    "react.node.children.empty": () =>
      resources.resourceForValue(createReactNodeChildrenResource()),
    "react.node.children.push": (children, child) =>
      pushReactNodeChild(resources, children, child),
    "react.node.createElement": (elementType, props, children) =>
      resources.resourceForValue(
        requireReactNodeElementResourceFactory(createNodeElementResource)(
          elementType,
          props,
          children,
        )
      ),
    "react.node.fragment": (props, children) =>
      resources.resourceForValue(
        requireReactNodeFragmentResourceFactory(createNodeFragmentResource)(
          props,
          children,
        )
      ),
    "react.root.create": (container) => {
      const target = resources.resolveResource(container, "Element");
      return resources.resourceForValue(rootForContainer(target));
    },
    "react.root.render": (root, renderTree) => {
      const render = requireReactRenderCallback(renderTree);
      try {
        const value = resources.resolveResource(root, "ReactRoot");
        const node = render();
        value.render(node);
        return undefined;
      } finally {
        render.release();
      }
    },
    "react.root.renderComponent": (root, component) => {
      const value = resources.resolveResource(root, "ReactRoot");
      value.renderComponent(component);
      return undefined;
    },
    "react.root.renderIntoSelector": (selector, node) => {
      const root = selectorRoot(
        jsStringValue(resources, selector, "React root selector"),
        () => disposeUnrenderedReactNode(node),
      );
      if (root === null) {
        return resources.resourceForValue(false);
      }
      root.render(node);
      return resources.resourceForValue(true);
    },
    "react.root.renderComponentIntoSelector": (selector, component) => {
      const root = selectorRoot(
        jsStringValue(resources, selector, "React root selector"),
        () => releaseLeanCallback(component),
      );
      if (root === null) {
        return resources.resourceForValue(false);
      }
      root.renderComponent(component);
      return resources.resourceForValue(true);
    },
    "react.root.unmount": (root) => {
      const value = resources.resolveResource(root, "ReactRoot");
      value.unmount();
      resources.releaseResource(root);
      return undefined;
    },
    "react.root.unmountSelector": (selector) => {
      const mounted = rootsBySelector.get(jsStringValue(resources, selector, "React root selector"));
      if (mounted === undefined) {
        return resources.resourceForValue(false);
      }
      releaseRootResource(mounted.root);
      return resources.resourceForValue(true);
    },
  };
}

function requireReactRenderCallback(renderTree) {
  if (typeof renderTree !== "function" || typeof renderTree.release !== "function") {
    throw new Error("react.root.render requires a releasable render callback");
  }
  return renderTree;
}

function requireReactNodeTextResourceFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error("react.node.text host binding requires a React Node text resource factory");
  }
  return factory;
}

function requireReactNodeElementResourceFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error("react.node.createElement host binding requires a React Node element resource factory");
  }
  return factory;
}

function requireReactNodeFragmentResourceFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error("react.node.fragment host binding requires a React Node fragment resource factory");
  }
  return factory;
}

export function createTimerResourceHostBindings(resources) {
  return {
    "browser.timer.setTimeout": (delayMs, callback) =>
      resources.resourceForValue(createTimeoutResource(resources, jsNatAsDelay(resources, delayMs), callback)),
    "browser.timer.clearTimeout": (timeout) => {
      const value = resources.resolveResource(timeout, "Timeout");
      value.clear();
      resources.releaseResource(timeout);
      return undefined;
    },
    "browser.timer.setInterval": (delayMs, callback) =>
      resources.resourceForValue(createIntervalResource(resources, jsNatAsDelay(resources, delayMs), callback)),
    "browser.timer.clearInterval": (interval) => {
      const value = resources.resolveResource(interval, "Interval");
      value.clear();
      resources.releaseResource(interval);
      return undefined;
    },
  };
}

export function createAnimationResourceHostBindings(resources, { requestFrame, cancelFrame }) {
  return {
    "browser.animation.requestAnimationFrame": (callback) =>
      resources.resourceForValue(createAnimationFrameResource(resources, callback, requestFrame, cancelFrame)),
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resources.resolveResource(frame, "AnimationFrame");
      value.cancel();
      resources.releaseResource(frame);
      return undefined;
    },
  };
}

function jsNatAsDelay(resources, value) {
  const delay = resources.resolveResource(value, "JsNat");
  if (typeof delay !== "bigint" || delay < 0n || delay > 0xffffffffn) {
    throw new Error("timer delay must be a Js Nat in the UInt32 range");
  }
  return Number(delay);
}

function jsStringValue(resources, value, label) {
  const text = resources.resolveResource(value, label);
  if (typeof text !== "string") {
    throw new Error(`${label} must be a Js String`);
  }
  return text;
}

export function createTimeoutResource(resources, delayMs, callback) {
  return createScheduledCallbackResource(resources, callback, {
    disposeMethod: "clear",
    schedule: (run) => globalThis.setTimeout(run, delayMs),
    cancel: globalThis.clearTimeout.bind(globalThis),
    invoke: (leanCallback) => leanCallback(),
  });
}

export function createIntervalResource(resources, delayMs, callback) {
  let token = null;
  let running = 0;
  let cleared = false;
  const release = () => {
    callback.release();
    resources.removeDisposable(value);
  };
  const value = {
    clear() {
      if (cleared) return undefined;
      cleared = true;
      if (token !== null) {
        globalThis.clearInterval(token);
        token = null;
      }
      if (running === 0) {
        release();
      }
      return undefined;
    },
  };
  token = globalThis.setInterval(() => {
    if (cleared) return undefined;
    running++;
    try {
      callback();
    } catch (error) {
      reportEventHandlerError(error);
    } finally {
      running--;
      if (cleared && running === 0) {
        release();
      }
    }
  }, delayMs);
  resources.addDisposable(value);
  return value;
}

export function createAnimationFrameResource(resources, callback, requestFrame, cancelFrame) {
  return createScheduledCallbackResource(resources, callback, {
    disposeMethod: "cancel",
    schedule: requestFrame,
    cancel: cancelFrame,
    invoke: (leanCallback, timestamp) => {
      const timestampResource = resources.temporaryResourceForValue(Number(timestamp));
      try {
        leanCallback(timestampResource);
      } finally {
        if (timestampResource !== null) {
          resources.releaseResource(timestampResource);
        }
      }
    },
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
      resources.removeDisposable(value);
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
      resources.releaseValueResource(value);
    }
  });
  resources.addDisposable(value);
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
  const eventResource = state.resourceForValue(event ?? {});
  try {
    callback(eventResource);
  } catch (error) {
    reportEventHandlerError(error);
  } finally {
    if (eventResource !== null) {
      state.releaseResource(eventResource);
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
  let eventDepth = 0;
  const deferredReactNodeDisposals = [];
  const flushReactNodeDisposals = () => {
    if (eventDepth !== 0) return undefined;
    const pending = deferredReactNodeDisposals.splice(0);
    for (const dispose of pending) {
      dispose();
    }
    return undefined;
  };
  return {
    addDisposable: (state, value) => state.addDisposable(value),
    removeDisposable: (state, value) => state.removeDisposable(value),
    callLeanEventCallback,
    beginReactNodeEventCallback: () => {
      eventDepth++;
      return undefined;
    },
    endReactNodeEventCallback: () => {
      eventDepth = Math.max(0, eventDepth - 1);
      return undefined;
    },
    deferReactNodeDispose: (dispose) => {
      if (typeof dispose !== "function") {
        throw new Error("React Node deferred disposal must be a function");
      }
      if (eventDepth === 0) {
        const queue =
          typeof globalThis.queueMicrotask === "function"
            ? globalThis.queueMicrotask.bind(globalThis)
            : (callback) => Promise.resolve().then(callback);
        queue(dispose);
        return undefined;
      }
      deferredReactNodeDisposals.push(dispose);
      return undefined;
    },
    flushReactNodeDisposals,
    once,
  };
}
