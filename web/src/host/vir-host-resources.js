/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { registerHostCallRollback } from "../host-boundary.js";
import {
  createReactElementTypeTag,
  createReactProps,
  setReactPropsEventHandler,
  setReactPropsProperty,
  setReactPropsRef,
} from "../react/vir-react-node.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "../runtime/cleanup.js";

export class HostLifecycle {
  constructor() {
    this.phase = "active";
    this.activeCleanups = new Map();
  }

  stageResult(value, { onAbort = null } = {}) {
    this.requireActive();
    if (typeof onAbort === "function") registerHostCallRollback(onAbort);
    return value;
  }

  addDisposable(value, cleanup) {
    if (typeof cleanup !== "function") {
      throw new Error("active host resource cleanup must be a function");
    }
    try {
      this.requireActive();
    } catch (error) {
      const errors = [error];
      collectCleanupError(errors, cleanup);
      throwCollectedErrors(
        errors,
        "active host value registration failed during rollback",
      );
    }
    this.activeCleanups.set(value, cleanup);
    return undefined;
  }

  removeDisposable(value) {
    this.activeCleanups.delete(value);
    return undefined;
  }

  // Debug-only lifecycle visibility for runtime tests; not a stable host API.
  debugResourceCounts() {
    return {
      active: this.activeCleanups.size,
    };
  }

  dispose() {
    if (this.phase === "disposed" || this.phase === "disposing")
      return undefined;
    this.phase = "disposing";
    const errors = [];
    try {
      for (const cleanup of Array.from(this.activeCleanups.values())) {
        collectCleanupError(errors, cleanup);
      }
      this.activeCleanups.clear();
    } finally {
      this.phase = "disposed";
    }
    throwCollectedErrors(errors, "host lifecycle disposal failed");
    return undefined;
  }

  requireActive() {
    if (this.phase !== "active") {
      throw new Error(
        "host lifecycle cannot register active resources while disposing or disposed",
      );
    }
  }
}

export function createHostLifecycle() {
  return new HostLifecycle();
}

export function createElementHostBindings(operations) {
  return {
    "browser.element.querySelector": (element, selector) =>
      operations.querySelector(element, selector),
    "browser.element.querySelectorAll": (element, selector) =>
      operations.querySelectorAll(element, selector),
    "browser.element.getInnerHTML": (element) =>
      operations.getInnerHTML(element),
    "browser.element.setInnerHTML": (element, html) => {
      operations.setInnerHTML(element, html);
      return undefined;
    },
    "browser.element.getTextContent": (element) =>
      operations.getTextContent(element),
    "browser.element.setTextContent": (element, text) => {
      operations.setTextContent(element, text);
      return undefined;
    },
    "browser.element.getClassList": (element) =>
      operations.getClassList(element),
    "browser.element.setClassList": (element, classList) => {
      operations.setClassList(element, classList);
      return undefined;
    },
    "browser.element.getAttribute": (element, name) =>
      operations.getAttribute(element, name),
    "browser.element.setAttribute": (element, name, value) => {
      operations.setAttribute(element, name, value);
      return undefined;
    },
    "browser.element.addEventListener": (element, eventName, listener) => {
      operations.addEventListener(element, eventName, listener);
      return undefined;
    },
    "browser.element.removeEventListener": (element, eventName, listener) => {
      operations.removeEventListener(element, eventName, listener);
      return undefined;
    },
  };
}

export function createReactRootHostBindings(
  resources,
  createRoot,
  {
    querySelector = null,
    createLeanComponentNode = null,
    createNodeText = null,
    createNodeElement = null,
    createNodeFragment = null,
  } = {},
) {
  const rootsByContainer = new WeakMap();
  const containersByRoot = new WeakMap();
  const rootsBySelector = new Map();

  function forgetRoot(root) {
    const container = containersByRoot.get(root);
    if (rootsByContainer.get(container) === root) {
      rootsByContainer.delete(container);
    }
    containersByRoot.delete(root);
    for (const [selector, mounted] of rootsBySelector) {
      if (mounted.root === root) {
        rootsBySelector.delete(selector);
      }
    }
  }

  function rootForContainer(container) {
    let root = rootsByContainer.get(container);
    if (root !== undefined) {
      return { root, created: false };
    }
    root = createTrackedRoot(container);
    rootsByContainer.set(container, root);
    containersByRoot.set(root, container);
    return { root, created: true };
  }

  function createTrackedRoot(container) {
    const root = createRoot(container);
    if (
      typeof root?.render !== "function" ||
      typeof root?.unmount !== "function"
    ) {
      const errors = [
        new Error("React root must provide render and unmount functions"),
      ];
      collectCleanupError(errors, () => root?.unmount?.());
      throwCollectedErrors(
        errors,
        "React root creation failed during rollback",
      );
    }
    // addDisposable owns failure rollback once registration begins. Keeping the
    // validation above separate prevents this caller from unmounting twice.
    resources.addDisposable(root, () => root.unmount());
    return root;
  }

  function queryReactRootSelector(selector) {
    if (typeof querySelector !== "function") {
      throw new Error(
        "react.root selector host bindings require a querySelector function",
      );
    }
    return querySelector(selector);
  }

  function releaseRoot(root) {
    const errors = [];
    collectCleanupError(errors, () => forgetRoot(root));
    collectCleanupError(errors, () => resources.removeDisposable(root));
    collectCleanupError(errors, () => root.unmount());
    throwCollectedErrors(errors, "React root release failed");
  }

  function selectorRoot(selector, onMissing) {
    const target = queryReactRootSelector(selector);
    if (target === null || target === undefined) {
      onMissing();
      return null;
    }
    const existing = rootsBySelector.get(selector);
    if (existing !== undefined && existing.container !== target) {
      releaseRoot(existing.root);
    }
    const { root, created } = rootForContainer(target);
    rootsBySelector.set(selector, { container: target, root });
    return { root, created };
  }

  function selectorPublication(root) {
    return resources.stageResult(true, {
      onAbort: () => releaseRoot(root),
    });
  }

  function publishSelectorRender(selected, render, failureMessage) {
    const errors = [];
    const rendered = collectCleanupError(errors, render);
    if (!rendered.ok) {
      if (selected.created) {
        collectCleanupError(errors, () => releaseRoot(selected.root));
      }
      throwCollectedErrors(errors, failureMessage);
    }
    const published = collectCleanupError(errors, () =>
      selectorPublication(selected.root),
    );
    if (!published.ok) {
      // Publication failure rolls the whole side effect back. This also
      // terminates an existing root whose committed tree was just replaced.
      collectCleanupError(errors, () => releaseRoot(selected.root));
    }
    throwCollectedErrors(errors, failureMessage);
    return published.value;
  }

  return {
    "react.node.text": (value) =>
      requireReactNodeTextFactory(createNodeText)(
        jsStringValue(value, "React Node text value"),
      ),
    "react.elementType.tag": (tag) =>
      createReactElementTypeTag(jsStringValue(tag, "React element type tag")),
    "react.props.empty": createReactProps,
    "react.props.setProperty": (props, property) =>
      setReactPropsProperty(props, property),
    "react.props.setEventHandler": (props, handler) =>
      setReactPropsEventHandler(props, handler),
    "react.props.setRef": (props, ref) => setReactPropsRef(props, ref),
    "react.node.createElement": (elementType, props, children) =>
      requireReactNodeElementFactory(createNodeElement)(
        elementType,
        props,
        children,
      ),
    "react.node.component": (component, props) =>
      requireLeanComponentNodeCreator(createLeanComponentNode)(
        component,
        props,
      ),
    "react.node.keyedComponent": (component, props, key) =>
      requireLeanComponentNodeCreator(createLeanComponentNode)(
        component,
        props,
        key,
      ),
    "react.node.fragment": (props, children) =>
      requireReactNodeFragmentFactory(createNodeFragment)(props, children),
    "react.root.create": (container) => {
      const root = createTrackedRoot(container);
      return resources.stageResult(root, {
        onAbort: () => releaseRoot(root),
      });
    },
    "react.root.renderNode": (root, node) => {
      root.render(node);
      return undefined;
    },
    "react.root.renderIntoSelector": (selector, node) => {
      const selected = selectorRoot(
        jsStringValue(selector, "React root selector"),
        // The node is an ordinary borrowed JavaScript value. A missing mount
        // point has no effect on it.
        () => undefined,
      );
      if (selected === null) {
        return false;
      }
      return publishSelectorRender(
        selected,
        () => selected.root.render(node),
        "React selector render failed during root rollback",
      );
    },
    "react.root.unmount": (root) => {
      releaseRoot(root);
      return undefined;
    },
    "react.root.unmountSelector": (selector) => {
      const mounted = rootsBySelector.get(
        jsStringValue(selector, "React root selector"),
      );
      if (mounted === undefined) {
        return false;
      }
      releaseRoot(mounted.root);
      return true;
    },
  };
}

function requireReactNodeTextFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.text host binding requires a React Node text factory",
    );
  }
  return factory;
}

function requireReactNodeElementFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.createElement host binding requires a React Node element factory",
    );
  }
  return factory;
}

function requireLeanComponentNodeCreator(createNode) {
  if (typeof createNode !== "function") {
    throw new Error(
      "react.node.component host binding requires a browser node creator",
    );
  }
  return createNode;
}

function requireReactNodeFragmentFactory(factory) {
  if (typeof factory !== "function") {
    throw new Error(
      "react.node.fragment host binding requires a React Node fragment factory",
    );
  }
  return factory;
}

export function createTimerHostBindings(resources) {
  const timeouts = new Map();
  const intervals = new Map();
  return {
    "browser.timer.setTimeout": (delayMs, callback) => {
      const delay = jsNatAsDelay(delayMs);
      const registration = createScheduledCallbackRegistration(
        resources,
        callback,
        {
          label: "browser timeout",
          schedule: (run) => globalThis.setTimeout(run, delay),
          cancel: globalThis.clearTimeout.bind(globalThis),
          invoke: (leanCallback) => leanCallback(),
          onInactive: (token) => timeouts.delete(token),
        },
      );
      if (registration.active) timeouts.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
    },
    "browser.timer.clearTimeout": (timeout) => {
      const registration = timeouts.get(timeout);
      if (registration === undefined) globalThis.clearTimeout(timeout);
      else registration.dispose();
      return undefined;
    },
    "browser.timer.setInterval": (delayMs, callback) => {
      const delay = jsNatAsDelay(delayMs);
      const registration = createRecurringCallbackRegistration(
        resources,
        callback,
        {
          label: "browser interval",
          schedule: (run) => globalThis.setInterval(run, delay),
          cancel: globalThis.clearInterval.bind(globalThis),
          invoke: (leanCallback) => leanCallback(),
          onInactive: (token) => intervals.delete(token),
        },
      );
      intervals.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
    },
    "browser.timer.clearInterval": (interval) => {
      const registration = intervals.get(interval);
      if (registration === undefined) globalThis.clearInterval(interval);
      else registration.dispose();
      return undefined;
    },
  };
}

export function createAnimationHostBindings(
  resources,
  { requestFrame, cancelFrame },
) {
  const frames = new Map();
  return {
    "browser.animation.requestAnimationFrame": (callback) => {
      const registration = createScheduledCallbackRegistration(
        resources,
        callback,
        {
          label: "browser animation frame",
          schedule: requestFrame,
          cancel: cancelFrame,
          invoke: (leanCallback, timestamp) => leanCallback(Number(timestamp)),
          onInactive: (token) => frames.delete(token),
        },
      );
      if (registration.active) frames.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const registration = frames.get(frame);
      if (registration === undefined) cancelFrame(frame);
      else registration.dispose();
      return undefined;
    },
  };
}

function jsNatAsDelay(delay) {
  if (typeof delay !== "bigint" || delay < 0n || delay > 0xffffffffn) {
    throw new Error("timer delay must be a Js Nat in the UInt32 range");
  }
  return Number(delay);
}

function jsStringValue(text, label) {
  if (typeof text !== "string") {
    throw new Error(`${label} must be a Js String`);
  }
  return text;
}

function createScheduledCallbackRegistration(
  resources,
  callback,
  { label, schedule, cancel, invoke, onInactive },
) {
  if (typeof callback !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
  let token;
  let active = false;
  let completed = false;
  const registration = {
    get token() {
      return token;
    },
    get active() {
      return active;
    },
    dispose: once(() => {
      const errors = [];
      collectCleanupError(errors, () =>
        resources.removeDisposable(registration),
      );
      collectCleanupError(errors, () => onInactive?.(token));
      if (active) {
        active = false;
        collectCleanupError(errors, () => cancel(token));
      }
      throwCollectedErrors(errors, `${label} cancellation failed`);
    }),
  };
  const run = (...args) => {
    if (completed) return undefined;
    completed = true;
    active = false;
    try {
      invoke(callback, ...args);
    } catch (error) {
      reportEventHandlerError(error);
    } finally {
      const errors = [];
      collectCleanupError(errors, () =>
        resources.removeDisposable(registration),
      );
      collectCleanupError(errors, () => onInactive?.(token));
      throwCollectedErrors(errors, `${label} completion cleanup failed`);
    }
    return undefined;
  };
  try {
    token = schedule(run);
    if (!completed) {
      active = true;
      resources.addDisposable(registration, registration.dispose);
    }
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, registration.dispose);
    throwCollectedErrors(
      errors,
      `${label} registration failed during rollback`,
    );
  }
  return registration;
}

function createRecurringCallbackRegistration(
  resources,
  callback,
  { label, schedule, cancel, invoke, onInactive },
) {
  if (typeof callback !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
  let token;
  let active = true;
  let scheduled = false;
  const registration = {
    get token() {
      return token;
    },
    dispose: once(() => {
      active = false;
      const errors = [];
      collectCleanupError(errors, () =>
        resources.removeDisposable(registration),
      );
      collectCleanupError(errors, () => onInactive?.(token));
      if (scheduled) {
        scheduled = false;
        collectCleanupError(errors, () => cancel(token));
      }
      throwCollectedErrors(errors, `${label} cancellation failed`);
    }),
  };
  const run = (...args) => {
    if (!active) return undefined;
    try {
      invoke(callback, ...args);
    } catch (error) {
      reportEventHandlerError(error);
    }
    return undefined;
  };
  try {
    token = schedule(run);
    scheduled = true;
    resources.addDisposable(registration, registration.dispose);
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, registration.dispose);
    throwCollectedErrors(
      errors,
      `${label} registration failed during rollback`,
    );
  }
  return registration;
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
