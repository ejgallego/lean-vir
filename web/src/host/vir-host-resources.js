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
      let resource = this.primitiveResources.get(value);
      if (!isHostResource(resource) || hostResourceValue(resource) === null) {
        resource = createHostResource(value);
        this.primitiveResources.set(value, resource);
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

  temporaryResourceForValue(value) {
    if (value === null || value === undefined) return null;
    const resource = createHostResource(value);
    this.liveResources.add(resource);
    const scope = this.temporaryResourceScopes.at(-1);
    if (scope !== undefined) {
      scope.add(resource);
    }
    return resource;
  }

  withTemporaryResourceScope(run) {
    const scope = new Set();
    this.temporaryResourceScopes.push(scope);
    try {
      return run();
    } finally {
      this.temporaryResourceScopes.pop();
      for (const resource of Array.from(scope)) {
        this.releaseResource(resource);
      }
      scope.clear();
    }
  }

  releaseResource(resource) {
    const value = hostResourceValue(resource);
    if (isWeakMapKey(value)) {
      if (this.resources.get(value) === resource) {
        this.resources.delete(value);
      }
    } else if (value !== null && value !== undefined) {
      if (this.primitiveResources.get(value) === resource) {
        this.primitiveResources.delete(value);
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
      const resource = this.primitiveResources.get(value);
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
    for (const value of Array.from(this.disposables)) {
      if (typeof value.dispose === "function") {
        value.dispose();
      } else if (typeof value.remove === "function") {
        value.remove();
      } else if (typeof value.clear === "function") {
        value.clear();
      } else if (typeof value.cancel === "function") {
        value.cancel();
      } else if (typeof value.unmount === "function") {
        value.unmount();
      }
    }
    this.disposables.clear();
    for (const resource of Array.from(this.liveResources)) {
      this.releaseResource(resource);
    }
    this.resources = new WeakMap();
    this.primitiveResources.clear();
    this.liveResources.clear();
    this.temporaryResourceScopes.length = 0;
    return undefined;
  }
}

function isWeakMapKey(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function createHostResourceState() {
  return new HostResourceState();
}

export function createElementResourceHostBindings(resources, operations) {
  return {
    "browser.element.getTextContent": (element) =>
      operations.getTextContent(resources.resolveResource(element, "Element")),
    "browser.element.setTextContent": (element, text) => {
      operations.setTextContent(resources.resolveResource(element, "Element"), text);
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      operations.getAttribute(resources.resolveResource(element, "Element"), name),
    "browser.element.setAttribute": (element, name, value) => {
      operations.setAttribute(resources.resolveResource(element, "Element"), name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, callback) => {
      const target = resources.resolveResource(element, "Element");
      const listener = operations.createEventListener(target, eventName, callback);
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

export function createHtmlInputElementResourceHostBindings(resources, { fromElement }) {
  return {
    "browser.htmlInputElement.fromElement": (element) =>
      fromElement(resources.resolveResource(element, "Element")),
    "browser.htmlInputElement.getChecked": (input) =>
      resources.resolveResource(input, "HTMLInputElement").checked === true,
    "browser.htmlInputElement.setChecked": (input, checked) => {
      resources.resolveResource(input, "HTMLInputElement").checked = checked;
      return undefined;
    },
    "browser.htmlInputElement.getValue": (input) =>
      resources.resolveResource(input, "HTMLInputElement").value ?? "",
    "browser.htmlInputElement.setValue": (input, value) => {
      resources.resolveResource(input, "HTMLInputElement").value = value;
      return undefined;
    },
  };
}

export function createReactRootResourceHostBindings(resources, createRootResource, {
  createNodeTextResource = null,
  createNodeElementResource = null,
} = {}) {
  return {
    "react.node.text": (value) =>
      resources.resourceForValue(requireReactNodeTextResourceFactory(createNodeTextResource)(value)),
    "react.node.createElement": (tag, key, props, handlers, children) =>
      resources.resourceForValue(
        requireReactNodeElementResourceFactory(createNodeElementResource)(tag, key, props, handlers, children)
      ),
    "react.root.create": (container) => {
      const target = resources.resolveResource(container, "Element");
      return resources.resourceForValue(createRootResource(target));
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
    "react.root.unmount": (root) => {
      const value = resources.resolveResource(root, "ReactRoot");
      value.unmount();
      resources.releaseResource(root);
      return undefined;
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

export function createTimerResourceHostBindings(resources) {
  return {
    "browser.timer.setTimeout": (delayMs, callback) =>
      resources.resourceForValue(createTimeoutResource(resources, delayMs, callback)),
    "browser.timer.clearTimeout": (timeout) => {
      const value = resources.resolveResource(timeout, "Timeout");
      value.clear();
      resources.releaseResource(timeout);
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
