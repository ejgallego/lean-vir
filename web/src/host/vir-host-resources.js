/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  beginHostResourceOwnerDisposal,
  createHostResource,
  createHostResourceOwner,
  finishHostResourceOwnerDisposal,
  hasHostResourceFinalizationSupport,
  hostResourceLabel,
  hostResourceOwner,
  hostResourceOwnerPhase,
  hostResourceValue,
  isRetainableHostResourcePayload,
  isHostResource,
  releaseHostResourcePayload,
  releaseHostResource,
  requireExternrefTableSupport,
  retainHostResourcePayload,
  transferHostResource,
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
import { takeCallbackLease } from "../runtime/callbacks.js";

export class HostResourceState {
  constructor() {
    requireExternrefTableSupport();
    this.owner = createHostResourceOwner("HostResourceState");
    this.revocableResources = new WeakMap();
    this.ownedPayloadResources = new Set();
    this.weakOwnedPayloadResources = new Set();
    this.gcFinalizerErrorMessages = [];
    this.temporaryResourceScopes = [];
    this.disposables = new Set();
  }

  resourceForValue(value) {
    this.requireUsable();
    if (value === null || value === undefined) return null;
    if (this.temporaryResourceScopes.length !== 0) {
      return this.temporaryResourceForValue(value);
    }
    return this.ownedResourceForValue(value);
  }

  // Takes ownership of an already-retained payload produced by a host binding.
  adoptResourceForValue(value, { tracked = true } = {}) {
    this.requireUsable();
    if (value === null || value === undefined) return null;
    let resource = null;
    const retainable = isRetainableHostResourcePayload(value);
    try {
      resource = createHostResource(value, null, {
        owner: this.owner,
        ...(retainable ? payloadResourceLifecycle(this, value) : {}),
      });
      if (retainable) {
        this.requireActive();
        this.ownedPayloadResources.add(resource);
        if (!tracked) {
          if (!hasHostResourceFinalizationSupport()) {
            throw new Error("untracked host resources require WeakRef and FinalizationRegistry support");
          }
          transferHostResource(resource);
        }
      }
      const scope = this.temporaryResourceScopes.at(-1);
      scope?.add(resource);
      return resource;
    } catch (error) {
      const errors = [error instanceof Error ? error : new Error(String(error))];
      if (retainable) {
        if (resource === null) {
          collectCleanupError(errors, () => releaseHostResourcePayload(value));
        } else {
          collectCleanupError(errors, () => releaseHostResource(resource));
        }
      }
      throwCollectedErrors(errors, "host resource adoption failed during ownership rollback");
    }
  }

  recordGcFinalizerError(error) {
    if (this.gcFinalizerErrorMessages.length >= 16) return;
    const name = error instanceof Error && error.name ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    this.gcFinalizerErrorMessages.push(`${name}: ${message}`.slice(0, 2048));
  }

  // Creates a unique resource whose receiver is responsible for releasing it.
  ownedResourceForValue(value) {
    this.requireUsable();
    if (value === null || value === undefined) return null;
    if (!isRetainableHostResourcePayload(value)) {
      return createHostResource(value, null, { owner: this.owner });
    }
    this.requireActive();
    const retainedValue = retainHostResourcePayload(value);
    let resource = null;
    try {
      resource = createHostResource(retainedValue, null, {
        owner: this.owner,
        ...payloadResourceLifecycle(this, retainedValue),
      });
      this.ownedPayloadResources.add(resource);
      return resource;
    } catch (error) {
      const errors = [error instanceof Error ? error : new Error(String(error))];
      if (resource === null) {
        collectCleanupError(errors, () => releaseHostResourcePayload(retainedValue));
      } else {
        collectCleanupError(errors, () => releaseHostResource(resource));
      }
      throwCollectedErrors(errors, "host resource creation failed during ownership rollback");
    }
  }

  // Creates a passive resource that can also be invalidated by its JS value.
  // The reverse index contains only WeakRefs and never owns the wrapper/value.
  revocableResourceForValue(value) {
    const resource = this.ownedResourceForValue(value);
    if (resource === null || !isWeakMapKey(value)) return resource;
    let references = this.revocableResources.get(value);
    if (references === undefined) {
      references = new Set();
      this.revocableResources.set(value, references);
    } else {
      sweepRevocableReferences(references);
    }
    references.add(new WeakRef(resource));
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
    if (!isHostResource(resource) || hostResourceOwner(resource) !== this.owner) {
      throw new Error("host resource does not belong to this state");
    }
    releaseHostResource(resource);
    return undefined;
  }

  releaseValueResource(value) {
    if (!isWeakMapKey(value)) return undefined;
    const references = this.revocableResources.get(value);
    if (references === undefined) return undefined;
    this.revocableResources.delete(value);
    const pending = Array.from(references);
    references.clear();
    const errors = [];
    for (const reference of pending) {
      const resource = reference.deref();
      if (resource !== undefined && hostResourceOwner(resource) === this.owner) {
        collectCleanupError(errors, () => releaseHostResource(resource));
      }
    }
    throwCollectedErrors(errors, "host resource alias invalidation failed");
    return undefined;
  }

  addDisposable(value) {
    try {
      this.requireActive();
    } catch (error) {
      const errors = [error];
      collectCleanupError(errors, () => disposeHostResourceValue(value));
      throwCollectedErrors(errors, "active host resource registration failed during rollback");
    }
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
      passiveStrong: 0,
      scoped: this.temporaryResourceScopes.reduce((count, scope) => count + scope.size, 0),
      temporaryScopes: this.temporaryResourceScopes.length,
      owners: this.disposables.size + this.ownedPayloadResources.size,
    };
  }

  resolveResource(resource, label) {
    const value = hostResourceValue(resource);
    if (value === null || value === undefined || hostResourceOwner(resource) !== this.owner) {
      throw new Error(`${hostResourceLabel(resource) ?? label} resource is not live`);
    }
    return value;
  }

  dispose() {
    const phase = hostResourceOwnerPhase(this.owner);
    if (phase === "disposed" || phase === "disposing") return undefined;
    beginHostResourceOwnerDisposal(this.owner);
    const errors = [];
    try {
      for (const value of Array.from(this.disposables)) {
        collectCleanupError(errors, () => disposeHostResourceValue(value));
      }
      this.disposables.clear();
      for (const resource of Array.from(this.ownedPayloadResources)) {
        collectCleanupError(errors, () => releaseHostResource(resource));
      }
      this.ownedPayloadResources.clear();
      for (const reference of Array.from(this.weakOwnedPayloadResources)) {
        const resource = reference.deref();
        if (resource !== undefined) {
          collectCleanupError(errors, () => releaseHostResource(resource));
        }
      }
      this.weakOwnedPayloadResources.clear();
      for (const scope of this.temporaryResourceScopes) {
        for (const resource of Array.from(scope)) {
          collectCleanupError(errors, () => this.releaseResource(resource));
        }
        scope.clear();
      }
      this.temporaryResourceScopes.length = 0;
      this.revocableResources = new WeakMap();
      for (const message of this.gcFinalizerErrorMessages.splice(0)) {
        errors.push(new Error(message));
      }
    } finally {
      finishHostResourceOwnerDisposal(this.owner);
    }
    throwCollectedErrors(errors, "host resource disposal failed");
    return undefined;
  }

  requireUsable() {
    if (hostResourceOwnerPhase(this.owner) === "disposed") {
      throw new Error("HostResourceState has been disposed");
    }
  }

  requireActive() {
    if (hostResourceOwnerPhase(this.owner) !== "active") {
      throw new Error("HostResourceState cannot register active resources while disposing or disposed");
    }
  }
}

// Keep finalizer holdings in a separate lexical environment from the wrapper
// variable: indirectly retaining the FinalizationRegistry target prevents its
// cleanup callback from ever running.
function payloadResourceLifecycle(resources, payload) {
  const tracking = { reference: null };
  return {
    dispose: () => releaseHostResourcePayload(payload),
    onFinalize: () => {
      if (tracking.reference !== null) {
        resources.weakOwnedPayloadResources.delete(tracking.reference);
      }
    },
    onRelease: (resource) => {
      resources.ownedPayloadResources.delete(resource);
      if (tracking.reference !== null) {
        resources.weakOwnedPayloadResources.delete(tracking.reference);
      }
    },
    onTake: (resource) => {
      if (!hasHostResourceFinalizationSupport() || tracking.reference !== null) return false;
      resources.ownedPayloadResources.delete(resource);
      tracking.reference = new WeakRef(resource);
      resources.weakOwnedPayloadResources.add(tracking.reference);
      return true;
    },
    reportFinalizerError: (error) => resources.recordGcFinalizerError(error),
  };
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

function sweepRevocableReferences(references) {
  for (const reference of references) {
    const resource = reference.deref();
    if (resource === undefined || hostResourceValue(resource) === null) {
      references.delete(reference);
    }
  }
}

export function createHostResourceState() {
  return new HostResourceState();
}

export function createElementResourceHostBindings(resources, operations) {
  return {
    "browser.element.querySelector": (element, selector) =>
      resources.adoptResourceForValue(createNullableValue(
        operations.querySelector(
          resources.resolveResource(element, "Element"),
          resources.resolveResource(selector, "JsString"),
        ),
      )),
    "browser.element.querySelectorAll": (element, selector) =>
      resources.resourceForValue(operations.querySelectorAll(
        resources.resolveResource(element, "Element"),
        resources.resolveResource(selector, "JsString"),
      )),
    "browser.element.getInnerHTML": (element) =>
      resources.resourceForValue(operations.getInnerHTML(resources.resolveResource(element, "Element"))),
    "browser.element.setInnerHTML": (element, html) => {
      const target = resources.resolveResource(element, "Element");
      return withConsumedResources(resources, [[html, "JsString"]], (resolvedHtml) => {
        operations.setInnerHTML(target, resolvedHtml);
        return undefined;
      });
    },
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
      resources.adoptResourceForValue(createNullableValue(
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
      return resources.revocableResourceForValue(listener);
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resources.resolveResource(listener, "EventListener");
      value.remove();
      resources.releaseValueResource(value);
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
      resources.adoptResourceForValue(createNullableValue(fromElement(resources.resolveResource(element, "Element")))),
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
      const errors = [];
      const unmounted = collectCleanupError(errors, () => unmount.apply(root, args));
      collectCleanupError(errors, () => forgetRoot(container, root));
      collectCleanupError(errors, () => resources.releaseValueResource(root));
      throwCollectedErrors(errors, "React root terminal invalidation failed");
      return unmounted.value;
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
    const errors = [];
    collectCleanupError(errors, () => root.unmount());
    collectCleanupError(errors, () => resources.releaseValueResource(root));
    throwCollectedErrors(errors, "React root release failed");
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
      resources.adoptResourceForValue(
        requireReactNodeTextResourceFactory(createNodeTextResource)(jsStringValue(resources, value, "React Node text value")),
        { tracked: false },
      ),
    "react.elementType.tag": (tag) =>
      resources.resourceForValue(createReactElementTypeTagResource(
        jsStringValue(resources, tag, "React element type tag"),
      )),
    "react.props.empty": () =>
      resources.adoptResourceForValue(createReactPropsResource()),
    "react.props.setKey": (props, key) =>
      setReactPropsKey(resources, props, key),
    "react.props.setProperty": (props, property) =>
      setReactPropsProperty(resources, props, property),
    "react.props.setEventHandler": (props, handler) =>
      setReactPropsEventHandler(resources, props, handler),
    "react.props.setRef": (props, ref) =>
      setReactPropsRef(resources, props, ref),
    "react.node.children.empty": () =>
      resources.adoptResourceForValue(createReactNodeChildrenResource()),
    "react.node.children.push": (children, child) =>
      pushReactNodeChild(resources, children, child),
    "react.node.createElement": (elementType, props, children) =>
      resources.adoptResourceForValue(
        requireReactNodeElementResourceFactory(createNodeElementResource)(
          elementType,
          props,
          children,
        ),
        { tracked: false },
      ),
    "react.node.fragment": (props, children) =>
      resources.adoptResourceForValue(
        requireReactNodeFragmentResourceFactory(createNodeFragmentResource)(
          props,
          children,
        ),
        { tracked: false },
      ),
    "react.root.create": (container) => {
      const target = resources.resolveResource(container, "Element");
      return resources.revocableResourceForValue(rootForContainer(target));
    },
    "react.root.render": (root, renderTree) => {
      const render = requireReactRenderCallback(renderTree);
      let node = null;
      const errors = [];
      collectCleanupError(errors, () => {
        const value = resources.resolveResource(root, "ReactRoot");
        node = render();
        value.render(node);
      });
      if (isHostResource(node)) {
        collectCleanupError(errors, () => resources.releaseResource(node));
      }
      collectCleanupError(errors, () => render.release());
      throwCollectedErrors(errors, "React root render failed during cleanup");
      return undefined;
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
      const errors = [];
      collectCleanupError(errors, () => value.unmount());
      collectCleanupError(errors, () => resources.releaseValueResource(value));
      throwCollectedErrors(errors, "React root unmount failed");
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
      resources.revocableResourceForValue(createTimeoutResource(resources, jsNatAsDelay(resources, delayMs), callback)),
    "browser.timer.clearTimeout": (timeout) => {
      const value = resources.resolveResource(timeout, "Timeout");
      value.clear();
      resources.releaseValueResource(value);
      return undefined;
    },
    "browser.timer.setInterval": (delayMs, callback) =>
      resources.revocableResourceForValue(createIntervalResource(resources, jsNatAsDelay(resources, delayMs), callback)),
    "browser.timer.clearInterval": (interval) => {
      const value = resources.resolveResource(interval, "Interval");
      value.clear();
      resources.releaseValueResource(value);
      return undefined;
    },
  };
}

export function createAnimationResourceHostBindings(resources, { requestFrame, cancelFrame }) {
  return {
    "browser.animation.requestAnimationFrame": (callback) =>
      resources.revocableResourceForValue(createAnimationFrameResource(resources, callback, requestFrame, cancelFrame)),
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resources.resolveResource(frame, "AnimationFrame");
      value.cancel();
      resources.releaseValueResource(value);
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
  const ownedCallback = takeCallbackLease(callback, "browser.timer.setInterval callback");
  let token = null;
  let running = 0;
  let cleared = false;
  const release = () => {
    const errors = [];
    collectCleanupError(errors, () => ownedCallback.release());
    resources.removeDisposable(value);
    throwCollectedErrors(errors, "browser interval callback release failed");
  };
  const value = {
    clear() {
      if (cleared) return undefined;
      cleared = true;
      const errors = [];
      if (token !== null) {
        const activeToken = token;
        token = null;
        collectCleanupError(errors, () => globalThis.clearInterval(activeToken));
      }
      if (running === 0) {
        collectCleanupError(errors, release);
      }
      throwCollectedErrors(errors, "browser interval cancellation failed");
      return undefined;
    },
  };
  try {
    token = globalThis.setInterval(() => {
      if (cleared) return undefined;
      running++;
      try {
        ownedCallback();
      } catch (error) {
        reportEventHandlerError(error);
      } finally {
        running--;
        if (cleared && running === 0) {
          release();
        }
      }
    }, delayMs);
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, () => ownedCallback.release());
    throwCollectedErrors(errors, "browser.timer.setInterval registration failed during callback cleanup");
  }
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
  const ownedCallback = takeCallbackLease(callback, `scheduled ${disposeMethod} callback`);
  let token = null;
  let completed = false;
  const value = {
    [disposeMethod]: once(() => {
      const errors = [];
      if (token !== null) {
        const activeToken = token;
        token = null;
        collectCleanupError(errors, () => cancel(activeToken));
      }
      collectCleanupError(errors, () => ownedCallback.release());
      resources.removeDisposable(value);
      throwCollectedErrors(errors, `scheduled ${disposeMethod} cleanup failed`);
    }),
  };
  const run = (...args) => {
    token = null;
    try {
      invoke(ownedCallback, ...args);
    } catch (error) {
      reportEventHandlerError(error);
    } finally {
      completed = true;
      value[disposeMethod]();
      resources.releaseValueResource(value);
    }
  };
  try {
    const scheduledToken = schedule(run);
    if (!completed) {
      token = scheduledToken;
      resources.addDisposable(value);
    }
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, () => value[disposeMethod]());
    throwCollectedErrors(errors, `scheduled ${disposeMethod} registration failed during callback cleanup`);
  }
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
