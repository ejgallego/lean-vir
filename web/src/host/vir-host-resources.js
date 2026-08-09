/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  abandonHostResource,
  beginHostResourceOwnerDisposal,
  createHostResource,
  createHostResourceOwner,
  finishHostResourceOwnerDisposal,
  hasHostResourceFinalizationSupport,
  hostResourceLabel,
  hostResourceOwner,
  hostResourceOwnerPhase,
  hostResourceReleaseTicket,
  hostResourceValue,
  isRetainableHostResourcePayload,
  isHostResource,
  releaseHostResourcePayload,
  releaseHostResource,
  releaseHostResourceTicket,
  requireExternrefTableSupport,
  retainHostResourcePayload,
  transferHostResource,
} from "../host-resource.js";
import {
  createReactElementTypeTagResource,
  createReactNodeChildrenResource,
  createReactPropsResource,
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
    this.transferredPayloadTickets = new Set();
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
  ownedResourceForValue(value, {
    onAbandon = null,
    retentionPolicy = null,
    revocationGroup = null,
  } = {}) {
    this.requireUsable();
    if (value === null || value === undefined) return null;
    if (!isRetainableHostResourcePayload(value)) {
      return createHostResource(value, null, {
        owner: this.owner,
        onAbandon,
        retentionPolicy,
        revocationGroup,
      });
    }
    this.requireActive();
    const retainedValue = retainHostResourcePayload(value);
    let resource = null;
    try {
      resource = createHostResource(retainedValue, null, {
        owner: this.owner,
        ...payloadResourceLifecycle(this, retainedValue),
        onAbandon,
        retentionPolicy,
        revocationGroup,
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

  // Creates a move-only resource that can also be invalidated by its JS value.
  // The reverse index contains only WeakRefs and never owns the wrapper/value.
  revocableResourceForValue(value, { onAbandon = null } = {}) {
    this.requireRevocableResourceSupport();
    let resource = null;
    let group = null;
    try {
      if (isWeakMapKey(value)) {
        group = this.revocableResources.get(value);
        if (group === undefined) {
          group = Object.freeze({ references: new Set() });
          this.revocableResources.set(value, group);
        } else {
          sweepRevocableReferences(group.references);
        }
      }
      resource = this.ownedResourceForValue(value, {
        onAbandon,
        retentionPolicy: "move-only",
        revocationGroup: group,
      });
      if (resource === null || group === null) return resource;
      group.references.add(new WeakRef(resource));
      return resource;
    } catch (error) {
      const errors = [error instanceof Error ? error : new Error(String(error))];
      if (resource === null) {
        if (typeof onAbandon === "function") {
          collectCleanupError(errors, () => onAbandon(value));
        }
      } else {
        collectCleanupError(errors, () => abandonHostResource(resource));
      }
      throwCollectedErrors(errors, "revocable host resource creation failed during rollback");
    }
  }

  requireRevocableResourceSupport() {
    if (typeof WeakRef !== "function") {
      throw new Error("revocable host resources require WeakRef support");
    }
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
    const group = this.revocableResources.get(value);
    if (group === undefined) return undefined;
    this.revocableResources.delete(value);
    const pending = Array.from(group.references);
    group.references.clear();
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
      scoped: this.temporaryResourceScopes.reduce((count, scope) => count + scope.size, 0),
      temporaryScopes: this.temporaryResourceScopes.length,
      owners: this.disposables.size + this.ownedPayloadResources.size + this.transferredPayloadTickets.size,
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
      for (const ticket of Array.from(this.transferredPayloadTickets)) {
        collectCleanupError(errors, () => releaseHostResourceTicket(ticket));
      }
      this.transferredPayloadTickets.clear();
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
  const tracking = { ticket: null };
  return {
    dispose: () => releaseHostResourcePayload(payload),
    onFinalize: () => {
      if (tracking.ticket !== null) {
        resources.transferredPayloadTickets.delete(tracking.ticket);
      }
    },
    onRelease: (resource) => {
      resources.ownedPayloadResources.delete(resource);
      if (tracking.ticket !== null) {
        resources.transferredPayloadTickets.delete(tracking.ticket);
      }
    },
    onTake: (resource) => {
      if (!hasHostResourceFinalizationSupport() || tracking.ticket !== null) return false;
      const ticket = hostResourceReleaseTicket(resource);
      if (ticket === null) return false;
      // Register the destination before detaching the source owner. Everything
      // after Set.add is non-throwing, so a failed take leaves the source intact.
      resources.transferredPayloadTickets.add(ticket);
      resources.ownedPayloadResources.delete(resource);
      tracking.ticket = ticket;
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
      const name = resources.resolveResource(eventName, "JsString");
      resources.requireRevocableResourceSupport();
      const listener = operations.createEventListener(
        target,
        name,
        callback,
      );
      resources.addDisposable(listener);
      return resources.revocableResourceForValue(listener, {
        onAbandon: () => disposeHostResourceValue(listener),
      });
    },
    "browser.element.removeEventListener": (listener) => {
      const value = resources.resolveResource(listener, "EventListener");
      terminateRevocableResource(
        resources,
        value,
        () => value.remove(),
        "browser event listener removal failed",
      );
      return undefined;
    },
  };
}

function terminateRevocableResource(resources, value, cleanup, label) {
  const errors = [];
  collectCleanupError(errors, () => resources.releaseValueResource(value));
  collectCleanupError(errors, cleanup);
  throwCollectedErrors(errors, label);
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
      return { root, created: false };
    }
    root = createRootResource(container);
    if (typeof root?.unmount !== "function") {
      throw new Error("React root resource must provide an unmount function");
    }
    const unmount = root.unmount;
    root.unmount = (...args) => {
      const errors = [];
      collectCleanupError(errors, () => forgetRoot(container, root));
      collectCleanupError(errors, () => resources.releaseValueResource(root));
      const unmounted = collectCleanupError(errors, () => unmount.apply(root, args));
      throwCollectedErrors(errors, "React root terminal invalidation failed");
      return unmounted.value;
    };
    rootsByContainer.set(container, root);
    return { root, created: true };
  }

  function queryReactRootSelector(selector) {
    if (typeof querySelector !== "function") {
      throw new Error("react.root selector host bindings require a querySelector function");
    }
    return querySelector(selector);
  }

  function releaseRootResource(root) {
    terminateRevocableResource(
      resources,
      root,
      () => root.unmount(),
      "React root release failed",
    );
  }

  function releaseLeanCallback(callback) {
    if (typeof callback?.release === "function") {
      callback.release();
    }
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
    const { root, created } = rootForContainer(target);
    rootsBySelector.set(selector, { container: target, root });
    return { root, created };
  }

  function withComponentCallbackHandoff(component, run) {
    // Take an explicit host-side lease before root lookup begins. Until the
    // caller marks a successful renderComponent handoff, every failure path
    // still belongs to this transaction and must consume the callback.
    let ownedComponent = component;
    let handedOff = false;
    const errors = [];
    const attempted = collectCleanupError(errors, () => {
      ownedComponent = takeCallbackLease(component, "React component callback");
      return run(ownedComponent, () => { handedOff = true; });
    });
    if (!handedOff) {
      collectCleanupError(errors, () => releaseLeanCallback(ownedComponent));
    }
    throwCollectedErrors(errors, "React component callback handoff failed");
    return attempted.value;
  }

  function renderComponentIntoSelector(selectorResource, component) {
    return withComponentCallbackHandoff(component, (ownedComponent, markHandedOff) => {
      const selector = jsStringValue(resources, selectorResource, "React root selector");
      const selected = selectorRoot(selector, () => undefined);
      if (selected === null) return false;
      const errors = [];
      const rendered = collectCleanupError(errors, () => selected.root.renderComponent(ownedComponent));
      if (!rendered.ok && selected.created) {
        collectCleanupError(errors, () => releaseRootResource(selected.root));
      }
      throwCollectedErrors(errors, "React selector component render failed during root rollback");
      markHandedOff();
      return true;
    });
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
      resources.requireRevocableResourceSupport();
      const { root, created } = rootForContainer(target);
      return resources.revocableResourceForValue(root, {
        onAbandon: created ? () => root.unmount() : null,
      });
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
      withComponentCallbackHandoff(component, (ownedComponent, markHandedOff) => {
        const value = resources.resolveResource(root, "ReactRoot");
        value.renderComponent(ownedComponent);
        markHandedOff();
      });
      return undefined;
    },
    "react.root.renderIntoSelector": (selector, node) => {
      const selected = selectorRoot(
        jsStringValue(resources, selector, "React root selector"),
        // The Node argument is borrowed. A missing mount point must neither
        // invalidate its wrapper nor revoke a payload owned by another tree.
        () => undefined,
      );
      if (selected === null) {
        return resources.resourceForValue(false);
      }
      const errors = [];
      const rendered = collectCleanupError(errors, () => selected.root.render(node));
      if (!rendered.ok && selected.created) {
        collectCleanupError(errors, () => releaseRootResource(selected.root));
      }
      throwCollectedErrors(errors, "React selector render failed during root rollback");
      return resources.resourceForValue(true);
    },
    "react.root.renderComponentIntoSelector": (selector, component) => {
      return resources.resourceForValue(renderComponentIntoSelector(selector, component));
    },
    "react.root.unmount": (root) => {
      const value = resources.resolveResource(root, "ReactRoot");
      releaseRootResource(value);
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
    "browser.timer.setTimeout": (delayMs, callback) => {
      const delay = jsNatAsDelay(resources, delayMs);
      resources.requireRevocableResourceSupport();
      const timeout = createTimeoutResource(resources, delay, callback);
      return resources.revocableResourceForValue(timeout, {
        onAbandon: () => disposeHostResourceValue(timeout),
      });
    },
    "browser.timer.clearTimeout": (timeout) => {
      const value = resources.resolveResource(timeout, "Timeout");
      terminateRevocableResource(
        resources,
        value,
        () => value.clear(),
        "browser timeout cancellation failed",
      );
      return undefined;
    },
    "browser.timer.setInterval": (delayMs, callback) => {
      const delay = jsNatAsDelay(resources, delayMs);
      resources.requireRevocableResourceSupport();
      const interval = createIntervalResource(resources, delay, callback);
      return resources.revocableResourceForValue(interval, {
        onAbandon: () => disposeHostResourceValue(interval),
      });
    },
    "browser.timer.clearInterval": (interval) => {
      const value = resources.resolveResource(interval, "Interval");
      terminateRevocableResource(
        resources,
        value,
        () => value.clear(),
        "browser interval cancellation failed",
      );
      return undefined;
    },
  };
}

export function createAnimationResourceHostBindings(resources, { requestFrame, cancelFrame }) {
  return {
    "browser.animation.requestAnimationFrame": (callback) => {
      resources.requireRevocableResourceSupport();
      const frame = createAnimationFrameResource(resources, callback, requestFrame, cancelFrame);
      return resources.revocableResourceForValue(frame, {
        onAbandon: () => disposeHostResourceValue(frame),
      });
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const value = resources.resolveResource(frame, "AnimationFrame");
      terminateRevocableResource(
        resources,
        value,
        () => value.cancel(),
        "browser animation-frame cancellation failed",
      );
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
    resources.removeDisposable(value);
    collectCleanupError(errors, () => ownedCallback.release());
    throwCollectedErrors(errors, "browser interval callback release failed");
  };
  const value = {
    clear() {
      if (cleared) return undefined;
      cleared = true;
      resources.removeDisposable(value);
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
      resources.removeDisposable(value);
      if (token !== null) {
        const activeToken = token;
        token = null;
        collectCleanupError(errors, () => cancel(activeToken));
      }
      collectCleanupError(errors, () => ownedCallback.release());
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
      const errors = [];
      collectCleanupError(errors, () => resources.releaseValueResource(value));
      collectCleanupError(errors, () => value[disposeMethod]());
      throwCollectedErrors(errors, `scheduled ${disposeMethod} completion cleanup failed`);
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

export function createReactHostHooks({ resources = null, reportError = null } = {}) {
  let eventDepth = 0;
  let cleanupOwnerRegistered = false;
  let cleanupMicrotaskScheduled = false;
  const deferredReactNodeDisposals = [];
  const cleanupOwner = {
    dispose() {
      return flushReactNodeDisposals({ force: true });
    },
  };
  const registerCleanupOwner = () => {
    if (cleanupOwnerRegistered || resources === null) return undefined;
    resources.addDisposable(cleanupOwner);
    cleanupOwnerRegistered = true;
    return undefined;
  };
  const unregisterCleanupOwner = () => {
    if (!cleanupOwnerRegistered || resources === null) return undefined;
    cleanupOwnerRegistered = false;
    resources.removeDisposable(cleanupOwner);
    return undefined;
  };
  const flushReactNodeDisposals = ({ force = false } = {}) => {
    if (!force && eventDepth !== 0) return undefined;
    const errors = [];
    while (deferredReactNodeDisposals.length !== 0) {
      const pending = deferredReactNodeDisposals.splice(0);
      for (const dispose of pending) {
        collectCleanupError(errors, dispose);
      }
    }
    unregisterCleanupOwner();
    throwCollectedErrors(errors, "deferred React Node cleanup failed");
    return undefined;
  };
  const scheduleReactNodeDisposals = () => {
    if (cleanupMicrotaskScheduled) return undefined;
    cleanupMicrotaskScheduled = true;
    const queue =
      typeof globalThis.queueMicrotask === "function"
        ? globalThis.queueMicrotask.bind(globalThis)
        : (callback) => Promise.resolve().then(callback);
    queue(() => {
      cleanupMicrotaskScheduled = false;
      const errors = [];
      collectCleanupError(errors, flushReactNodeDisposals);
      reportDeferredReactCleanupErrors(reportError, errors);
    });
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
      deferredReactNodeDisposals.push(dispose);
      registerCleanupOwner();
      if (eventDepth === 0) {
        scheduleReactNodeDisposals();
      }
      return undefined;
    },
    flushReactNodeDisposals,
    once,
  };
}

function reportDeferredReactCleanupErrors(reportError, errors) {
  if (errors.length === 0) return;
  const error = errors.length === 1
    ? errors[0]
    : new AggregateError(errors, "deferred React Node cleanup failed");
  try {
    if (typeof reportError === "function") {
      reportError(error);
    } else if (typeof globalThis.reportError === "function") {
      globalThis.reportError(error);
    } else {
      globalThis.console?.error?.(error);
    }
  } catch {
    // Deferred cleanup reporting must never create another host-job failure.
  }
}
