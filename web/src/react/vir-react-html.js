/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const REACT_HTML_MAX_DEPTH = 128;
const REACT_HTML_MAX_NODES = 10000;
const disposedReactHtmlRoots = new WeakSet();

export function createBrowserReactRootResource(state, root, createElement, hooks) {
  if (typeof createElement !== "function") {
    throw new Error("createBrowserReactRootResource requires a React.createElement-compatible function");
  }
  const { addDisposable, removeDisposable, callLeanEventCallback, once } = requireReactHostHooks(hooks);
  let currentHtml = null;
  const value = {
    render(html) {
      let nextElement;
      try {
        nextElement = reactElementFromHtml(state, html, createElement, callLeanEventCallback);
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

export function createVirtualReactRootResource(resources, target, hooks) {
  const { addDisposable, removeDisposable, callLeanEventCallback, once } = requireReactHostHooks(hooks);
  let currentHtml = null;
  const value = {
    current: null,
    render(html) {
      let nextTree;
      try {
        nextTree = virtualReactNodeFromHtml(resources, html, callLeanEventCallback);
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

export function virtualReactTextContent(node) {
  if (node === null || node === undefined) return "";
  if (node.kind === "text") return node.value;
  if (node.kind === "element") return node.children.map(virtualReactTextContent).join("");
  return "";
}

export function disposeReactHtml(html) {
  if (html === null || html === undefined) return;
  if (typeof html.dispose === "function") {
    html.dispose();
    return;
  }
  if (typeof html !== "object" || disposedReactHtmlRoots.has(html)) return;
  disposedReactHtmlRoots.add(html);
  releaseReactHtmlCallbacks(html);
}

function reactElementFromHtml(state, html, createElement, callLeanEventCallback) {
  return mapReactHtml(html, {
    text: (value) => value,
    element: (fields, children) => {
      const props = reactPropsFromHtml(state, fields, callLeanEventCallback);
      return createElement(fields.tag, props, ...children());
    },
  });
}

function reactPropsFromHtml(state, fields, callLeanEventCallback) {
  const props = {};
  const key = reactHtmlKey(fields);
  if (key !== null && key !== undefined) {
    props.key = key;
  }
  for (const [name, value] of reactHtmlPropertyEntries(fields)) {
    setReactObjectProperty(props, name, value);
  }
  for (const [name, callback] of reactHtmlEventHandlerEntries(fields)) {
    setReactObjectProperty(props, name, (event) => callLeanEventCallback(state, event, callback));
  }
  return props;
}

function virtualReactNodeFromHtml(resources, html, callLeanEventCallback) {
  return mapReactHtml(html, {
    text: (value) => ({ kind: "text", value }),
    element: (fields, children) => ({
      kind: "element",
      tag: fields.tag,
      key: reactHtmlKey(fields),
      props: virtualReactPropsFromHtml(fields),
      handlers: virtualReactHandlersFromHtml(resources, fields, callLeanEventCallback),
      children: children(),
    }),
  });
}

function virtualReactPropsFromHtml(fields) {
  const props = {};
  for (const [name, value] of reactHtmlPropertyEntries(fields)) {
    setReactObjectProperty(props, name, value);
  }
  return props;
}

function virtualReactHandlersFromHtml(resources, fields, callLeanEventCallback) {
  const handlers = {};
  for (const [name, callback] of reactHtmlEventHandlerEntries(fields)) {
    setReactObjectProperty(handlers, name, (event = {}) => callLeanEventCallback(resources, event, callback));
  }
  return handlers;
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
    .map((prop) => {
      const name = reactHtmlPropertyName(prop);
      return [name, reactPropValue(prop?.value, name)];
    });
}

function reactHtmlEventHandlerEntries(fields) {
  return reactHtmlArray(fields.handlers, "handlers")
    .map((handler) => [
      reactSafeObjectKey(reactHtmlNamedField(handler, "event handler"), "React Html event handler name"),
      reactHtmlEventCallback(handler),
    ]);
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

function reactSafeObjectKey(value, label) {
  if (value === "__proto__" || value === "prototype" || value === "constructor") {
    throw new Error(`${label} is not supported`);
  }
  return value;
}

function setReactObjectProperty(target, name, value) {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
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

function requireReactHostHooks(hooks) {
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
