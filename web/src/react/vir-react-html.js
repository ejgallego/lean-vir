/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { isHostResource } from "../host-resource.js";

const REACT_HTML_MAX_DEPTH = 128;
const REACT_HTML_MAX_NODES = 10000;

export function createBrowserReactRootResource(state, root, React, hooks) {
  const createElement = requireReactCreateElement(React, "createBrowserReactRootResource");
  return createReactRootResource(state, hooks, {
    commitHtml(_value, nextHtml) {
      root.render(nextHtml.node);
    },
    createComponent(resources, rootHooks, renderCallback, renderHtml, disposePreviousHtml) {
      return createReactComponentResource(
        resources,
        renderCallback,
        rootHooks.hookRuntime,
        renderHtml,
        null,
        disposePreviousHtml);
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
    commitHtml(value, nextHtml) {
      updateVirtualReactRoot(target, value, nextHtml.node);
    },
    createComponent(rootResources, rootHooks, renderCallback, renderHtml, disposePreviousHtml, value) {
      let component = null;
      const renderCurrent = () => {
        updateVirtualReactRoot(target, value, component.render());
      };
      component = createReactComponentResource(
        rootResources,
        renderCallback,
        rootHooks.hookRuntime,
        renderHtml,
        renderCurrent,
        disposePreviousHtml);
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
  let currentHtml = null;
  let currentComponent = null;
  const value = {
    ...(adapter.initialState ?? {}),
    render(html) {
      currentHtml = commitReactHtmlRender(resources, hooks, html, currentHtml, (nextHtml) => {
        adapter.commitHtml(value, nextHtml);
      });
      disposeReactComponent(currentComponent);
      currentComponent = null;
    },
    renderComponent(renderCallback) {
      const component = adapter.createComponent(
        resources,
        hooks,
        renderCallback,
        (html) => resolveRenderedReactHtmlNode(resources, html),
        (html) => queueReactHtmlRelease(resources, html, hooks),
        value);
      try {
        adapter.commitComponent(value, component);
      } catch (error) {
        component.dispose();
        throw error;
      }
      queueReactHtmlRelease(resources, currentHtml, hooks);
      currentHtml = null;
      disposeReactComponent(currentComponent);
      currentComponent = component;
    },
    unmount: once(() => {
      try {
        adapter.unmount?.(value);
      } finally {
        releaseReactHtmlResource(resources, currentHtml);
        currentHtml = null;
        disposeReactComponent(currentComponent);
        currentComponent = null;
        removeDisposable(resources, value);
      }
    }),
  };
  addDisposable(resources, value);
  return value;
}

function commitReactHtmlRender(resources, hooks, html, currentHtml, commit) {
  const sameHtml = currentHtml === html;
  let nextHtml = null;
  let retained = false;
  try {
    nextHtml = resolveReactHtmlResource(resources, html);
    validateRenderableReactHtml(nextHtml);
    if (!sameHtml) {
      retainReactHtmlValue(nextHtml);
      retained = true;
    }
    commit(nextHtml);
  } catch (error) {
    if (retained) {
      releaseReactHtmlValue(resources, nextHtml);
    } else if (!sameHtml && nextHtml?.refCount === 0) {
      disposeReactHtml(resources, html);
    }
    throw error;
  }
  if (!sameHtml) {
    queueReactHtmlRelease(resources, currentHtml, hooks);
  }
  return html;
}

function updateVirtualReactRoot(target, value, nextTree) {
  value.current = nextTree;
  target.reactRoot = value;
  target.textContent = virtualReactTextContent(nextTree);
}

export function createBrowserReactHtmlTextResource(resources, value) {
  return createReactHtmlResource(resources, {
    node: reactHtmlTextValue(value),
  });
}

export function createBrowserReactHtmlElementResource(resources, createElement, hooks, tag, key, props, handlers, children) {
  if (typeof createElement !== "function") {
    throw new Error("createBrowserReactHtmlElementResource requires a React.createElement-compatible function");
  }
  const { callLeanEventCallback } = requireReactHostHooks(hooks);
  return createReactHtmlElementResource(resources, tag, key, props, handlers, children, (fields, childEntries) => {
    const { props: reactProps, callbacks } = reactPropsFromHtml(resources, fields, callLeanEventCallback, hooks);
    return {
      node: createElement(fields.tag, reactProps, ...childEntries.map((child) => child.value.node)),
      callbacks,
    };
  });
}

export function createVirtualReactHtmlTextResource(resources, value) {
  return createReactHtmlResource(resources, {
    node: { kind: "text", value: reactHtmlTextValue(value) },
  });
}

export function createVirtualReactHtmlElementResource(resources, hooks, tag, key, props, handlers, children) {
  const { callLeanEventCallback } = requireReactHostHooks(hooks);
  return createReactHtmlElementResource(resources, tag, key, props, handlers, children, (fields, childEntries) => {
    const { handlers: virtualHandlers, callbacks } =
      virtualReactHandlersFromHtml(resources, fields, callLeanEventCallback, hooks);
    return {
      node: {
        kind: "element",
        tag: fields.tag,
        key: fields.key,
        props: virtualReactPropsFromHtml(fields),
        handlers: virtualHandlers,
        children: childEntries.map((child) => child.value.node),
      },
      callbacks,
    };
  });
}

export function createReactHtmlElementResource(resources, tag, key, props, handlers, children, createNode) {
  const childEntries = resolveReactHtmlChildren(resources, children);
  const stats = reactHtmlSubtreeStats(childEntries);
  const fields = {
    tag: reactHtmlName(tag, "element tag"),
    key: reactHtmlKey(key),
    props: reactHtmlArray(props, "props"),
    handlers: reactHtmlArray(handlers, "handlers"),
  };
  let callbacks = [];
  try {
    const created = createNode(fields, childEntries);
    callbacks = created.callbacks;
    return createReactHtmlResource(resources, {
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

export function createReactHtmlResource(resources, { node, childEntries = [], callbacks = [], nodeCount = 1, maxDepth = 0 }) {
  const children = childEntries.map((child) => child.value);
  const value = {
    kind: "ReactHtml",
    node,
    children,
    callbacks,
    nodeCount,
    maxDepth,
    refCount: 0,
    finalized: false,
    dispose() {
      finalizeReactHtmlValue(resources, value);
      return undefined;
    },
  };
  for (const child of children) {
    retainReactHtmlValue(child);
  }
  resources.addDisposable(value);
  return value;
}

export function disposeReactHtml(resources, html) {
  if (html === null || html === undefined) return;
  if (isHostResource(html)) {
    if (typeof resources?.releaseResource !== "function") {
      throw new Error("React Html disposal requires a host resource state");
    }
    const value = resolveReactHtmlResource(resources, html);
    value.dispose();
    resources.releaseResource(html);
    return;
  }
  if (typeof html.dispose === "function") {
    html.dispose();
  }
}

export function disposeUnownedReactHtml(resources, html) {
  if (html === null || html === undefined || !isHostResource(html)) return;
  const value = resolveReactHtmlResource(resources, html);
  if (value.refCount === 0) {
    disposeReactHtml(resources, html);
  }
}

export function resolveReactHtmlResource(resources, resource, label = "ReactHtml") {
  const value = resources.resolveResource(resource, label);
  if (value?.kind !== "ReactHtml") {
    throw new Error("ReactHtml resource has invalid value");
  }
  return value;
}

export function retainReactHtmlValue(value) {
  if (value?.kind !== "ReactHtml" || value.finalized) {
    throw new Error("ReactHtml resource has invalid value");
  }
  value.refCount++;
}

export function releaseReactHtmlResource(resources, resource) {
  if (resource === null || resource === undefined) return;
  releaseReactHtmlValue(resources, resolveReactHtmlResource(resources, resource));
}

export function queueReactHtmlRelease(resources, html, hooks = null) {
  if (html === null || html === undefined) return;
  const run = () => releaseReactHtmlResource(resources, html);
  if (typeof hooks?.deferReactHtmlDispose === "function") {
    hooks.deferReactHtmlDispose(run);
    return;
  }
  const queue =
    typeof globalThis.queueMicrotask === "function"
      ? globalThis.queueMicrotask.bind(globalThis)
      : (callback) => Promise.resolve().then(callback);
  queue(run);
}

export function flushReactHtmlDisposals(hooks) {
  if (typeof hooks?.flushReactHtmlDisposals === "function") {
    hooks.flushReactHtmlDisposals();
  }
}

export function beginReactHtmlEventCallback(hooks) {
  if (typeof hooks?.beginReactHtmlEventCallback === "function") {
    hooks.beginReactHtmlEventCallback();
  }
}

export function endReactHtmlEventCallback(hooks) {
  if (typeof hooks?.endReactHtmlEventCallback === "function") {
    hooks.endReactHtmlEventCallback();
  }
}

export function validateReactHtmlResourceLimits(html) {
  if (html.maxDepth > REACT_HTML_MAX_DEPTH) {
    throw new Error(`React Html exceeds maximum depth ${REACT_HTML_MAX_DEPTH}`);
  }
  if (html.nodeCount > REACT_HTML_MAX_NODES) {
    throw new Error(`React Html exceeds maximum node count ${REACT_HTML_MAX_NODES}`);
  }
}

export function virtualReactTextContent(node) {
  if (node === null || node === undefined) return "";
  if (node.kind === "text") return node.value;
  if (node.kind === "element") return node.children.map(virtualReactTextContent).join("");
  return "";
}

export function reactHtmlTextValue(value) {
  if (typeof value !== "string") {
    throw new Error("React Html text value must be a string");
  }
  return value;
}

export function reactHtmlPropertyEntries(props) {
  return props.map((prop) => {
    const name = reactHtmlPropertyName(prop);
    return [name, reactPropValue(prop?.value, name)];
  });
}

export function reactHtmlEventHandlerEntries(handlers) {
  return handlers.map((handler) => [
    reactSafeObjectKey(reactHtmlNamedField(handler, "event handler"), "React Html event handler name"),
    reactHtmlEventCallback(handler),
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

function resolveRenderedReactHtml(resources, html) {
  const nextHtml = resolveReactHtmlResource(resources, html);
  validateRenderableReactHtml(nextHtml);
  return nextHtml;
}

function validateRenderableReactHtml(nextHtml) {
  if (nextHtml.finalized) {
    throw new Error("ReactHtml resource has been disposed");
  }
  validateReactHtmlResourceLimits(nextHtml);
}

function resolveRenderedReactHtmlNode(resources, html) {
  const nextHtml = resolveRenderedReactHtml(resources, html);
  retainReactHtmlValue(nextHtml);
  return nextHtml.node;
}

function releaseReactHtmlValue(resources, value) {
  if (value?.kind !== "ReactHtml" || value.finalized) return;
  value.refCount--;
  if (value.refCount > 0) {
    return;
  }
  finalizeReactHtmlValue(resources, value);
}

function finalizeReactHtmlValue(resources, value) {
  if (value?.kind !== "ReactHtml" || value.finalized) return;
  value.finalized = true;
  value.refCount = 0;
  releaseReactCallbacks(value.callbacks);
  value.callbacks.length = 0;
  for (const child of value.children) {
    releaseReactHtmlValue(resources, child);
  }
  value.children.length = 0;
  resources.removeDisposable(value);
}

function resolveReactHtmlChildren(resources, children) {
  return reactHtmlArray(children, "children").map((resource, index) => ({
    resource,
    value: resolveReactHtmlResource(resources, resource, `React Html child[${index}]`),
  }));
}

function reactHtmlSubtreeStats(childEntries) {
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
    renderHtml,
    scheduleRender = null,
    disposePreviousHtml = queueReactHtmlRelease) {
  requireReactComponentRenderCallback(renderCallback);
  requireReactHookRuntime(hookRuntime);
  const componentState = hookRuntime.createComponentState(scheduleRender);
  let currentHtml = null;
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
        let html = null;
        try {
          html = renderCallback(undefined);
          const next = renderHtml(html);
          disposePreviousHtml(currentHtml);
          currentHtml = html;
          return next;
        } catch (error) {
          disposeReactHtml(resources, html);
          throw error;
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseReactHtmlResource(resources, currentHtml);
      currentHtml = null;
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

function reactPropsFromHtml(state, fields, callLeanEventCallback, hooks) {
  const props = {};
  const callbacks = [];
  if (fields.key !== null && fields.key !== undefined) {
    props.key = fields.key;
  }
  for (const [name, value] of reactHtmlPropertyEntries(fields.props)) {
    setReactObjectProperty(props, name, value);
  }
  for (const [name, callback] of reactHtmlEventHandlerEntries(fields.handlers)) {
    callbacks.push(callback);
    setReactObjectProperty(props, name, (event) => {
      beginReactHtmlEventCallback(hooks);
      try {
        return callLeanEventCallback(state, event, callback);
      } finally {
        endReactHtmlEventCallback(hooks);
        flushReactHtmlDisposals(hooks);
      }
    });
  }
  return { props, callbacks };
}

function virtualReactPropsFromHtml(fields) {
  const props = {};
  for (const [name, value] of reactHtmlPropertyEntries(fields.props)) {
    setReactObjectProperty(props, name, value);
  }
  return props;
}

function virtualReactHandlersFromHtml(resources, fields, callLeanEventCallback, hooks) {
  const handlers = {};
  const callbacks = [];
  for (const [name, callback] of reactHtmlEventHandlerEntries(fields.handlers)) {
    callbacks.push(callback);
    setReactObjectProperty(handlers, name, (event = {}) => {
      beginReactHtmlEventCallback(hooks);
      try {
        return callLeanEventCallback(resources, event, callback);
      } finally {
        endReactHtmlEventCallback(hooks);
        flushReactHtmlDisposals(hooks);
      }
    });
  }
  return { handlers, callbacks };
}

function reactHtmlKey(key) {
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

function reactHtmlPropertyName(prop) {
  const name = reactHtmlNamedField(prop, "property");
  if (name === "data-") {
    throw new Error("React Html data-* property name must include a suffix");
  }
  return reactSafeObjectKey(name, "React Html property name");
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
    throw new Error("React Html renderer requires host resource hooks");
  }
  for (const name of ["addDisposable", "removeDisposable", "callLeanEventCallback", "once"]) {
    if (typeof hooks[name] !== "function") {
      throw new Error(`React Html renderer hook ${name} must be a function`);
    }
  }
  return hooks;
}
