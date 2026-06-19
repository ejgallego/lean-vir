/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { isHostResource } from "../host-resource.js";

const REACT_NODE_MAX_DEPTH = 128;
const REACT_NODE_MAX_NODES = 10000;

export function createBrowserReactRootResource(state, root, React, hooks) {
  const createElement = requireReactCreateElement(React, "createBrowserReactRootResource");
  return createReactRootResource(state, hooks, {
    commitNode(_value, nextNode) {
      root.render(nextNode.node);
    },
    createComponent(resources, rootHooks, renderCallback, renderNode, disposePreviousNode) {
      return createReactComponentResource(
        resources,
        renderCallback,
        rootHooks.hookRuntime,
        renderNode,
        null,
        disposePreviousNode);
    },
    commitComponent(_value, component) {
      root.render(createElement(component.Component));
    },
    unmount() {
      root.unmount();
    },
  });
}

export function createVirtualReactRootResource(resources, target, hooks) {
  return createReactRootResource(resources, hooks, {
    initialState: { current: null },
    commitNode(value, nextNode) {
      updateVirtualReactRoot(target, value, nextNode.node);
    },
    createComponent(rootResources, rootHooks, renderCallback, renderNode, disposePreviousNode, value) {
      let component = null;
      const renderCurrent = () => {
        updateVirtualReactRoot(target, value, component.render());
      };
      component = createReactComponentResource(
        rootResources,
        renderCallback,
        rootHooks.hookRuntime,
        renderNode,
        renderCurrent,
        disposePreviousNode);
      return component;
    },
    commitComponent(value, component) {
      updateVirtualReactRoot(target, value, component.render());
    },
    unmount(value) {
      value.current = null;
      if (target.reactRoot === value) {
        delete target.reactRoot;
      }
    },
  });
}

function createReactRootResource(resources, hooks, adapter) {
  const { addDisposable, removeDisposable, once } = requireReactHostHooks(hooks);
  let currentNode = null;
  let currentComponent = null;
  const value = {
    ...(adapter.initialState ?? {}),
    render(node) {
      currentNode = commitReactNodeRender(resources, hooks, node, currentNode, (nextNode) => {
        adapter.commitNode(value, nextNode);
      });
      disposeReactComponent(currentComponent);
      currentComponent = null;
    },
    renderComponent(renderCallback) {
      const component = adapter.createComponent(
        resources,
        hooks,
        renderCallback,
        (node) => resolveRenderedReactNodeValue(resources, node),
        (node) => queueReactNodeRelease(resources, node, hooks),
        value);
      try {
        adapter.commitComponent(value, component);
      } catch (error) {
        component.dispose();
        throw error;
      }
      queueReactNodeRelease(resources, currentNode, hooks);
      currentNode = null;
      disposeReactComponent(currentComponent);
      currentComponent = component;
    },
    unmount: once(() => {
      try {
        adapter.unmount?.(value);
      } finally {
        releaseReactNodeResource(resources, currentNode);
        currentNode = null;
        disposeReactComponent(currentComponent);
        currentComponent = null;
        removeDisposable(resources, value);
      }
    }),
  };
  addDisposable(resources, value);
  return value;
}

function commitReactNodeRender(resources, hooks, node, currentNode, commit) {
  const sameNode = currentNode === node;
  let nextNode = null;
  let retained = false;
  try {
    nextNode = resolveReactNodeResource(resources, node);
    validateRenderableReactNode(nextNode);
    if (!sameNode) {
      retainReactNodeValue(nextNode);
      retained = true;
    }
    commit(nextNode);
  } catch (error) {
    if (retained) {
      releaseReactNodeValue(resources, nextNode);
    } else if (!sameNode && nextNode?.refCount === 0) {
      disposeReactNode(resources, node);
    }
    throw error;
  }
  if (!sameNode) {
    queueReactNodeRelease(resources, currentNode, hooks);
  }
  return node;
}

function updateVirtualReactRoot(target, value, nextTree) {
  value.current = nextTree;
  target.reactRoot = value;
  target.textContent = virtualReactTextContent(nextTree);
}

export function createBrowserReactNodeTextResource(resources, value) {
  return createReactNodeResource(resources, {
    node: reactNodeTextValue(value),
  });
}

export function createBrowserReactNodeElementResource(resources, createElement, hooks, tag, key, props, handlers, children) {
  if (typeof createElement !== "function") {
    throw new Error("createBrowserReactNodeElementResource requires a React.createElement-compatible function");
  }
  const { callLeanEventCallback } = requireReactHostHooks(hooks);
  return createReactNodeElementResource(resources, tag, key, props, handlers, children, (fields, childEntries) => {
    const { props: reactProps, callbacks } = reactPropsFromNode(resources, fields, callLeanEventCallback, hooks);
    return {
      node: createElement(fields.tag, reactProps, ...childEntries.map((child) => child.value.node)),
      callbacks,
    };
  });
}

export function createVirtualReactNodeTextResource(resources, value) {
  return createReactNodeResource(resources, {
    node: { kind: "text", value: reactNodeTextValue(value) },
  });
}

export function createVirtualReactNodeElementResource(resources, hooks, tag, key, props, handlers, children) {
  const { callLeanEventCallback } = requireReactHostHooks(hooks);
  return createReactNodeElementResource(resources, tag, key, props, handlers, children, (fields, childEntries) => {
    const { handlers: virtualHandlers, callbacks } =
      virtualReactHandlersFromNode(resources, fields, callLeanEventCallback, hooks);
    return {
      node: {
        kind: "element",
        tag: fields.tag,
        key: fields.key,
        props: virtualReactPropsFromNode(fields),
        handlers: virtualHandlers,
        children: childEntries.map((child) => child.value.node),
      },
      callbacks,
    };
  });
}

export function createReactNodeElementResource(resources, tag, key, props, handlers, children, createNode) {
  const childEntries = resolveReactNodeChildren(resources, children);
  const stats = reactNodeSubtreeStats(childEntries);
  const fields = {
    tag: reactNodeName(tag, "element tag"),
    key: reactNodeKey(key),
    props: reactNodeArray(props, "props"),
    handlers: reactNodeArray(handlers, "handlers"),
  };
  let callbacks = [];
  try {
    const created = createNode(fields, childEntries);
    callbacks = created.callbacks;
    return createReactNodeResource(resources, {
      node: created.node,
      childEntries,
      callbacks,
      ...stats,
    });
  } catch (error) {
    releaseReactCallbacks(callbacks);
    throw error;
  }
}

export function createReactNodeResource(resources, { node, childEntries = [], callbacks = [], nodeCount = 1, maxDepth = 0 }) {
  const children = childEntries.map((child) => child.value);
  const value = {
    kind: "ReactNode",
    node,
    children,
    callbacks,
    nodeCount,
    maxDepth,
    refCount: 0,
    finalized: false,
    dispose() {
      finalizeReactNodeValue(resources, value);
      return undefined;
    },
  };
  for (const child of children) {
    retainReactNodeValue(child);
  }
  resources.addDisposable(value);
  return value;
}

export function disposeReactNode(resources, node) {
  if (node === null || node === undefined) return;
  if (isHostResource(node)) {
    if (typeof resources?.releaseResource !== "function") {
      throw new Error("React Node disposal requires a host resource state");
    }
    const value = resolveReactNodeResource(resources, node);
    value.dispose();
    resources.releaseResource(node);
    return;
  }
  if (typeof node.dispose === "function") {
    node.dispose();
  }
}

export function disposeUnownedReactNode(resources, node) {
  if (node === null || node === undefined || !isHostResource(node)) return;
  const value = resolveReactNodeResource(resources, node);
  if (value.refCount === 0) {
    disposeReactNode(resources, node);
  }
}

export function resolveReactNodeResource(resources, resource, label = "ReactNode") {
  const value = resources.resolveResource(resource, label);
  if (value?.kind !== "ReactNode") {
    throw new Error("ReactNode resource has invalid value");
  }
  return value;
}

export function retainReactNodeValue(value) {
  if (value?.kind !== "ReactNode" || value.finalized) {
    throw new Error("ReactNode resource has invalid value");
  }
  value.refCount++;
}

export function releaseReactNodeResource(resources, resource) {
  if (resource === null || resource === undefined) return;
  releaseReactNodeValue(resources, resolveReactNodeResource(resources, resource));
}

export function queueReactNodeRelease(resources, node, hooks = null) {
  if (node === null || node === undefined) return;
  const run = () => releaseReactNodeResource(resources, node);
  if (typeof hooks?.deferReactNodeDispose === "function") {
    hooks.deferReactNodeDispose(run);
    return;
  }
  const queue =
    typeof globalThis.queueMicrotask === "function"
      ? globalThis.queueMicrotask.bind(globalThis)
      : (callback) => Promise.resolve().then(callback);
  queue(run);
}

export function flushReactNodeDisposals(hooks) {
  if (typeof hooks?.flushReactNodeDisposals === "function") {
    hooks.flushReactNodeDisposals();
  }
}

export function beginReactNodeEventCallback(hooks) {
  if (typeof hooks?.beginReactNodeEventCallback === "function") {
    hooks.beginReactNodeEventCallback();
  }
}

export function endReactNodeEventCallback(hooks) {
  if (typeof hooks?.endReactNodeEventCallback === "function") {
    hooks.endReactNodeEventCallback();
  }
}

export function validateReactNodeResourceLimits(node) {
  if (node.maxDepth > REACT_NODE_MAX_DEPTH) {
    throw new Error(`React Node exceeds maximum depth ${REACT_NODE_MAX_DEPTH}`);
  }
  if (node.nodeCount > REACT_NODE_MAX_NODES) {
    throw new Error(`React Node exceeds maximum node count ${REACT_NODE_MAX_NODES}`);
  }
}

export function virtualReactTextContent(node) {
  if (node === null || node === undefined) return "";
  if (node.kind === "text") return node.value;
  if (node.kind === "element") return node.children.map(virtualReactTextContent).join("");
  return "";
}

export function reactNodeTextValue(value) {
  if (typeof value !== "string") {
    throw new Error("React Node text value must be a string");
  }
  return value;
}

export function reactNodePropertyEntries(props) {
  return props.map((prop) => {
    const name = reactNodePropertyName(prop);
    return [name, reactPropValue(prop?.value, name)];
  });
}

export function reactNodeEventHandlerEntries(handlers) {
  return handlers.map((handler) => [
    reactSafeObjectKey(reactNodeNamedField(handler, "event handler"), "React Node event handler name"),
    reactNodeEventCallback(handler),
  ]);
}

export function setReactObjectProperty(target, name, value) {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function resolveRenderedReactNode(resources, node) {
  const nextNode = resolveReactNodeResource(resources, node);
  validateRenderableReactNode(nextNode);
  return nextNode;
}

function validateRenderableReactNode(nextNode) {
  if (nextNode.finalized) {
    throw new Error("ReactNode resource has been disposed");
  }
  validateReactNodeResourceLimits(nextNode);
}

function resolveRenderedReactNodeValue(resources, node) {
  const nextNode = resolveRenderedReactNode(resources, node);
  retainReactNodeValue(nextNode);
  return nextNode.node;
}

function releaseReactNodeValue(resources, value) {
  if (value?.kind !== "ReactNode" || value.finalized) return;
  value.refCount--;
  if (value.refCount > 0) {
    return;
  }
  finalizeReactNodeValue(resources, value);
}

function finalizeReactNodeValue(resources, value) {
  if (value?.kind !== "ReactNode" || value.finalized) return;
  value.finalized = true;
  value.refCount = 0;
  releaseReactCallbacks(value.callbacks);
  value.callbacks.length = 0;
  for (const child of value.children) {
    releaseReactNodeValue(resources, child);
  }
  value.children.length = 0;
  resources.removeDisposable(value);
}

function resolveReactNodeChildren(resources, children) {
  return reactNodeArray(children, "children").map((resource, index) => ({
    resource,
    value: resolveReactNodeResource(resources, resource, `React Node child[${index}]`),
  }));
}

function reactNodeSubtreeStats(childEntries) {
  let nodeCount = 1;
  let maxDepth = 0;
  for (const child of childEntries) {
    nodeCount += child.value.nodeCount;
    maxDepth = Math.max(maxDepth, child.value.maxDepth + 1);
  }
  return { nodeCount, maxDepth };
}

function createReactComponentResource(
    resources,
    renderCallback,
    hookRuntime,
    renderNode,
    scheduleRender = null,
    disposePreviousNode = queueReactNodeRelease) {
  requireReactComponentRenderCallback(renderCallback);
  requireReactHookRuntime(hookRuntime);
  const componentState = hookRuntime.createComponentState(scheduleRender);
  let currentNode = null;
  let disposed = false;
  const component = {
    Component() {
      return component.render();
    },
    render() {
      if (disposed) {
        throw new Error("React component has been disposed");
      }
      return hookRuntime.withComponentRender(componentState, () => {
        let node = null;
        try {
          node = renderCallback(undefined);
          const next = renderNode(node);
          disposePreviousNode(currentNode);
          currentNode = node;
          return next;
        } catch (error) {
          disposeReactNode(resources, node);
          throw error;
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseReactNodeResource(resources, currentNode);
      currentNode = null;
      hookRuntime.disposeComponent(componentState);
      renderCallback.release();
    },
  };
  return component;
}

function disposeReactComponent(component) {
  if (component !== null && component !== undefined) {
    component.dispose();
  }
}

function reactPropsFromNode(state, fields, callLeanEventCallback, hooks) {
  const props = {};
  const callbacks = [];
  if (fields.key !== null && fields.key !== undefined) {
    props.key = fields.key;
  }
  for (const [name, value] of reactNodePropertyEntries(fields.props)) {
    setReactObjectProperty(props, name, value);
  }
  for (const [name, callback] of reactNodeEventHandlerEntries(fields.handlers)) {
    callbacks.push(callback);
    setReactObjectProperty(props, name, (event) => {
      beginReactNodeEventCallback(hooks);
      try {
        return callLeanEventCallback(state, event, callback);
      } finally {
        endReactNodeEventCallback(hooks);
        flushReactNodeDisposals(hooks);
      }
    });
  }
  return { props, callbacks };
}

function virtualReactPropsFromNode(fields) {
  const props = {};
  for (const [name, value] of reactNodePropertyEntries(fields.props)) {
    setReactObjectProperty(props, name, value);
  }
  return props;
}

function virtualReactHandlersFromNode(resources, fields, callLeanEventCallback, hooks) {
  const handlers = {};
  const callbacks = [];
  for (const [name, callback] of reactNodeEventHandlerEntries(fields.handlers)) {
    callbacks.push(callback);
    setReactObjectProperty(handlers, name, (event = {}) => {
      beginReactNodeEventCallback(hooks);
      try {
        return callLeanEventCallback(resources, event, callback);
      } finally {
        endReactNodeEventCallback(hooks);
        flushReactNodeDisposals(hooks);
      }
    });
  }
  return { handlers, callbacks };
}

function reactNodeKey(key) {
  if (key !== null && key !== undefined && typeof key !== "string") {
    throw new Error("React Node element key must be a string or null");
  }
  return key;
}

function reactNodeArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`React Node ${label} must be an array`);
  }
  return value;
}

function reactNodePropertyName(prop) {
  const name = reactNodeNamedField(prop, "property");
  if (name === "data-") {
    throw new Error("React Node data-* property name must include a suffix");
  }
  return reactSafeObjectKey(name, "React Node property name");
}

function reactNodeNamedField(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`React Node ${label} must be an object`);
  }
  return reactNodeName(value.name, `${label} name`);
}

function reactNodeName(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`React Node ${label} must be a non-empty string`);
  }
  return value;
}

function reactNodeEventCallback(handler) {
  const callback = handler?.callback;
  if (typeof callback !== "function" || typeof callback.release !== "function") {
    throw new Error("React Node event handler callback must be a releasable function");
  }
  return callback;
}

function reactPropValue(value, propName) {
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
    case "style":
      if (propName !== "style") {
        throw new Error("React PropValue.style is only supported for the style prop");
      }
      return reactStylePropValue(value.value);
    case "classList":
      if (propName !== "className") {
        throw new Error("React PropValue.classList is only supported for the className prop");
      }
      return reactClassListPropValue(value.value);
    default:
      throw new Error("React PropValue must be string, bool, int, float, style, or classList");
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

function reactStylePropValue(entries) {
  const style = {};
  for (const [index, entry] of reactStyleEntries(entries).entries()) {
    const styleEntry = reactStyleEntry(entry, `React PropValue.style[${index}]`);
    const name = reactStyleName(styleEntry.name, `React PropValue.style[${index}].name`);
    style[name] = reactStyleEntryValue(styleEntry.value, `React PropValue.style[${index}].value`);
  }
  return style;
}

function reactStyleEntries(value) {
  if (!Array.isArray(value)) {
    throw new Error("React PropValue.style value must be an array");
  }
  return value;
}

function reactStyleEntry(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function reactStyleName(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return reactSafeObjectKey(value, label);
}

function reactStyleEntryValue(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function reactClassListPropValue(classes) {
  if (!Array.isArray(classes)) {
    throw new Error("React PropValue.classList value must be an array");
  }
  const tokens = [];
  const seen = new Set();
  for (const [index, value] of classes.entries()) {
    const token = reactClassToken(value, index);
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens.join(" ");
}

function reactClassToken(value, index) {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
    throw new Error(`React PropValue.classList[${index}] must be a non-empty token without whitespace`);
  }
  return value;
}

function reactSafeObjectKey(value, label) {
  if (value === "__proto__" || value === "prototype" || value === "constructor") {
    throw new Error(`${label} is not supported`);
  }
  return value;
}

function releaseReactCallbacks(callbacks) {
  for (const callback of callbacks) {
    if (typeof callback?.release === "function") {
      callback.release();
    }
  }
}

function requireReactCreateElement(React, label) {
  if (typeof React === "function") {
    return React;
  }
  if (typeof React?.createElement !== "function") {
    throw new Error(`${label} requires a React.createElement-compatible function`);
  }
  return React.createElement.bind(React);
}

function requireReactComponentRenderCallback(renderCallback) {
  if (typeof renderCallback !== "function" || typeof renderCallback.release !== "function") {
    throw new Error("React component render callback must be a releasable function");
  }
}

function requireReactHookRuntime(hookRuntime) {
  if (hookRuntime === null || typeof hookRuntime !== "object") {
    throw new Error("React component renderer requires a hook runtime");
  }
  for (const name of ["createComponentState", "withComponentRender", "disposeComponent"]) {
    if (typeof hookRuntime[name] !== "function") {
      throw new Error(`React hook runtime ${name} must be a function`);
    }
  }
  return hookRuntime;
}

export function requireReactHostHooks(hooks) {
  if (hooks === null || typeof hooks !== "object") {
    throw new Error("React Node renderer requires host resource hooks");
  }
  for (const name of ["addDisposable", "removeDisposable", "callLeanEventCallback", "once"]) {
    if (typeof hooks[name] !== "function") {
      throw new Error(`React Node renderer hook ${name} must be a function`);
    }
  }
  return hooks;
}
