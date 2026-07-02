/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirtualReactNodeElementResource,
  createVirtualReactNodeFragmentResource,
  createVirtualReactNodeTextResource,
  createVirtualReactRootResource as createVirtualReactRootResourceFromNode,
} from "../react/vir-react-node.js";
import {
  createReactJsValueHostBindings,
  createReactStateHostBindings,
  createVirtualReactHookRuntime,
} from "../react/vir-react-hooks.js";
import { VIR_HOST_DISPOSE, hostResourceValue, isHostResource } from "../host-resource.js";
import {
  callLeanEventCallback,
  createAnimationResourceHostBindings,
  createElementResourceHostBindings,
  createHostResourceState,
  createHtmlInputElementResourceHostBindings,
  createReactHostHooks,
  createReactRootResourceHostBindings,
  createTimerResourceHostBindings,
  performanceNow,
  preventDefaultOnEvent,
  stopPropagationOnEvent,
} from "./vir-host-resources.js";

export function createVirtualDocumentState({
  title = "",
  elements = new Map(),
  resources = createHostResourceState(),
  clipboardText = "",
  clipboardWrites = [],
  revealedPosition = null,
  infoviewCommands = [],
} = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return { title, elements, resources, clipboardText, clipboardWrites, revealedPosition, infoviewCommands };
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
      preventDefaultOnEvent(state.resources.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(state.resources.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.formValue": (event) =>
      state.resources.resourceForValue(formControlEventValue(state.resources.resolveResource(event, "Event"))),
  };
}

export function createVirtualDocumentHostBindings(state = createVirtualDocumentState()) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources ??= createHostResourceState();
  const reactHookRuntime = createVirtualReactHookRuntime(state.resources);
  const reactHooks = {
    ...createReactHostHooks(),
    hookRuntime: reactHookRuntime,
  };
  return {
    "browser.document.getTitle": () => state.resources.resourceForValue(state.title),
    "browser.document.setTitle": (title) => {
      state.title = state.resources.resolveResource(title, "JsString");
      return undefined;
    },
    "browser.document.querySelector": (selector) =>
      state.resources.resourceForValue(queryVirtualElementState(
        state,
        state.resources.resolveResource(selector, "JsString"),
      )),
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
      fromElement: (element) => state.resources.resourceForValue(element),
    }),
    ...createTimerResourceHostBindings(state.resources),
    ...createAnimationResourceHostBindings(state.resources, {
      requestFrame: (run) => globalThis.setTimeout(() => run(performanceNow()), 16),
      cancelFrame: globalThis.clearTimeout.bind(globalThis),
    }),
    ...createReactRootResourceHostBindings(state.resources, (target) =>
      createVirtualReactRootResource(state.resources, target, reactHooks), {
        querySelector: (selector) => queryVirtualElementState(state, selector),
        createNodeTextResource: (value) => createVirtualReactNodeTextResource(state.resources, value),
        createNodeElementResource: (tag, key, props, handlers, children) =>
          createVirtualReactNodeElementResource(state.resources, reactHooks, tag, key, props, handlers, children),
        createNodeFragmentResource: (key, children) =>
          createVirtualReactNodeFragmentResource(state.resources, key, children),
      }),
    ...createReactJsValueHostBindings(state.resources),
    ...createReactStateHostBindings(state.resources, reactHookRuntime),
    "infoview.documentPosition": (uri, fileName, line, character, label) =>
      state.resources.resourceForValue({
        uri: state.resources.resolveResource(uri, "JsString"),
        fileName: state.resources.resolveResource(fileName, "JsString"),
        line: state.resources.resolveResource(line, "JsNat"),
        character: state.resources.resolveResource(character, "JsNat"),
        label: state.resources.resolveResource(label, "JsString"),
      }),
    "infoview.clipboard.writeText": (text) => {
      const value = state.resources.resolveResource(text, "JsString");
      state.clipboardText = value;
      state.clipboardWrites ??= [];
      state.clipboardWrites.push(value);
      return state.resources.resourceForValue(true);
    },
    "infoview.command.revealPosition": (position) => {
      const normalized = normalizeInfoviewDocumentPosition(
        state.resources.resolveResource(position, "DocumentPosition"),
      );
      if (normalized === null) {
        return state.resources.resourceForValue(false);
      }
      state.revealedPosition = normalized;
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "revealPosition", position: normalized });
      return state.resources.resourceForValue(true);
    },
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) =>
      state.resources.resourceForValue({
        id: state.resources.resolveResource(id, "JsString"),
        label: state.resources.resolveResource(label, "JsString"),
        typeName: state.resources.resolveResource(typeName, "JsString"),
        summary: state.resources.resolveResource(summary, "JsString"),
        expression: state.resources.resolveResource(expression, "JsString"),
        typeText: "",
        context: "",
      }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) =>
      state.resources.resourceForValue({
        ...state.resources.resolveResource(ref, "RpcRef"),
        typeText: state.resources.resolveResource(typeText, "JsString"),
        context: state.resources.resolveResource(context, "JsString"),
        ...(serverRef === null || serverRef === undefined ? {} : { serverRef }),
      }),
    "proofwidgets.rpc.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(state.resources.resolveResource(ref, "ResolvedRef")),
    "proofwidgets.rpc.inspectRef": (ref) => {
      const normalized = normalizeProofWidgetsRpcRef(state.resources.resolveResource(ref, "RpcRef"));
      if (normalized === null) {
        return state.resources.resourceForValue(false);
      }
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "proofwidgetsRpcInspectRef", ref: normalized });
      return state.resources.resourceForValue(true);
    },
    "proofwidgets.rpc.resolveRef": (ref, callback) => {
      const normalized = normalizeProofWidgetsRpcRef(state.resources.resolveResource(ref, "RpcRef"));
      if (normalized === null || typeof callback !== "function") {
        releaseCallback(callback);
        return state.resources.resourceForValue(false);
      }
      const result = virtualProofWidgetsRpcRefInfo(normalized);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "proofwidgetsRpcResolveRef", ref: normalized, result });
      callAndReleaseCallback(callback, state.resources.resourceForValue(result));
      return state.resources.resourceForValue(true);
    },
    [VIR_HOST_DISPOSE]: () => state.resources.dispose(),
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

function createVirtualReactRootResource(resources, target, hooks) {
  return createVirtualReactRootResourceFromNode(resources, target, hooks);
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
  if (node?.kind !== "element" && node?.kind !== "fragment") return null;
  if (node.kind === "element" && node.props?.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findVirtualReactElementNodeById(child, id);
    if (found !== null) return found;
  }
  return null;
}

function virtualEventElementResource(state, event, field) {
  const value = state.resources.resolveResource(event, "Event")?.[field];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return state.resources.resourceForValue(queryVirtualElementState(state, value));
  }
  if (isHostResource(value)) {
    state.resources.resolveResource(value, "Element");
    return value;
  }
  if (typeof value === "object") {
    return state.resources.resourceForValue(value);
  }
  return null;
}

function formControlEventValue(event) {
  const currentValue = formControlValue(event?.currentTarget);
  if (currentValue !== null) return currentValue;
  return formControlValue(event?.target);
}

function formControlValue(value) {
  if (value === null || typeof value !== "object" || !("value" in value)) {
    return null;
  }
  return String(value.value ?? "");
}

function normalizeInfoviewDocumentPosition(position) {
  if (position === null || typeof position !== "object") {
    return null;
  }
  const uri = typeof position.uri === "string" ? position.uri : "";
  if (uri.length === 0) {
    return null;
  }
  const line = nonNegativeInteger(position.line);
  const character = nonNegativeInteger(position.character);
  if (line === null || character === null) {
    return null;
  }
  return { uri, line, character };
}

export function normalizeProofWidgetsRpcRef(ref) {
  if (ref === null || typeof ref !== "object") {
    return null;
  }
  const id = stringField(ref.id);
  if (id.length === 0) {
    return null;
  }
  const normalized = {
    id,
    label: stringField(ref.label),
    typeName: stringField(ref.typeName),
    summary: stringField(ref.summary),
    expression: stringField(ref.expression),
    typeText: stringField(ref.typeText),
    context: stringField(ref.context),
  };
  const serverRef = proofWidgetsServerRpcRef(ref);
  if (serverRef !== null) {
    normalized.serverRef = serverRef;
  }
  return normalized;
}

export function normalizeProofWidgetsResolvedRef(ref) {
  const value = ref !== null && typeof ref === "object" ? ref : {};
  return {
    id: stringField(value.id),
    label: stringField(value.label),
    typeName: stringField(value.typeName),
    summary: stringField(value.summary),
    expression: stringField(value.expression),
    typeText: stringField(value.typeText),
    context: stringField(value.context),
    source: stringField(value.source),
    position: stringField(value.position),
    packageRevision: stringField(value.packageRevision),
    storeKey: stringField(value.storeKey),
    knownConstant: value.knownConstant === true,
  };
}

function stringField(value) {
  return typeof value === "string" ? value : "";
}

function proofWidgetsServerRpcRef(ref) {
  if (isRpcRefObject(ref.serverRef)) {
    return ref.serverRef;
  }
  if (isHostResource(ref.serverRef)) {
    const value = hostResourceValue(ref.serverRef);
    return isRpcRefObject(value) ? value : null;
  }
  return null;
}

function isRpcRefObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.__rpcref === "number" || typeof value.p === "number");
}

function virtualProofWidgetsRpcRefInfo(ref) {
  return {
    ...ref,
    source: "virtual",
    position: "virtual",
    packageRevision: "virtual",
    storeKey: `virtual:${ref.id}`,
    knownConstant: false,
  };
}

function callAndReleaseCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    console.error(error);
  } finally {
    releaseCallback(callback);
  }
}

function releaseCallback(callback) {
  if (callback !== null && typeof callback === "function" && typeof callback.release === "function") {
    callback.release();
  }
}

function nonNegativeInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
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
      resources.removeDisposable(listener);
    },
  };
  return listener;
}
