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
import { createNullableValue, nullablePayload } from "./vir-js-value-bindings.js";
import { createStaticNodeList } from "./vir-js-collection-bindings.js";
import { takeCallbackLease } from "../runtime/callbacks.js";
import { collectCleanupError, throwCollectedErrors } from "../runtime/cleanup.js";

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
  innerHTML = "",
  textContent = "",
  attributes = new Map(),
  queries = new Map(),
  checked = false,
  value = "",
  listeners = new Map(),
} = {}) {
  return { innerHTML, textContent, attributes, queries, checked, value, listeners };
}

export function ensureVirtualElementState(state, selector, element = null) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  let value = state.elements.get(selector);
  if (value === undefined) {
    value = element ?? createVirtualElementState();
    state.elements.set(selector, value);
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      value.push(element ?? createVirtualElementState());
    }
    value = value[0];
  }
  return normalizeVirtualElementState(value);
}

export function ensureVirtualElementStates(state, selector, elements) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  if (!Array.isArray(elements)) {
    throw new Error("virtual document selector elements must be an Array");
  }
  const values = elements.map((element) => normalizeVirtualElementState(element ?? createVirtualElementState()));
  state.elements.set(selector, values);
  return values;
}

export function createVirtualEventState({
  target = null,
  currentTarget = null,
  key = "",
  defaultPrevented = false,
  propagationStopped = false,
  onPreventDefault = null,
  onStopPropagation = null,
} = {}) {
  const event = {
    target,
    currentTarget,
    key,
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

export function createVirtualEventHostBindings(
  state = createVirtualDocumentState(),
  resources = state.resources ?? createHostResourceState(),
) {
  state.resources = resources;
  return {
    "browser.event.target": (event) =>
      resources.adoptResourceForValue(createNullableValue(virtualEventElementValue(state, resources, event, "target"))),
    "browser.event.currentTarget": (event) =>
      resources.adoptResourceForValue(createNullableValue(virtualEventElementValue(state, resources, event, "currentTarget"))),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(resources.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(resources.resolveResource(event, "Event"));
      return undefined;
    },
    "browser.event.key": (event) => {
      const key = resources.resolveResource(event, "Event")?.key;
      return resources.resourceForValue(typeof key === "string" ? key : "");
    },
    "browser.event.formValue": (event) =>
      resources.adoptResourceForValue(createNullableValue(formControlEventValue(resources.resolveResource(event, "Event")))),
  };
}

export function createVirtualDocumentHostBindings(
  state = createVirtualDocumentState(),
  resources = state.resources ?? createHostResourceState(),
) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources = resources;
  const reactHookRuntime = createVirtualReactHookRuntime(resources);
  const reactHooks = {
    ...createReactHostHooks({
      resources,
      reportError: (error) => resources.recordGcFinalizerError(error),
    }),
    hookRuntime: reactHookRuntime,
  };
  return {
    "browser.document.getTitle": () => resources.resourceForValue(state.title),
    "browser.document.setTitle": (title) => {
      state.title = resources.resolveResource(title, "JsString");
      return undefined;
    },
    "browser.document.querySelector": (selector) =>
      resources.adoptResourceForValue(createNullableValue(
        queryVirtualElementState(
          state,
          resources.resolveResource(selector, "JsString"),
        ),
      )),
    "browser.document.querySelectorAll": (selector) =>
      resources.resourceForValue(createStaticNodeList(
        queryVirtualElementStates(
          state,
          resources.resolveResource(selector, "JsString"),
        ),
      )),
    ...createVirtualEventHostBindings(state, resources),
    ...createElementResourceHostBindings(resources, {
      querySelector: (target, selector) =>
        queryVirtualDescendantStates(target, selector)[0] ?? null,
      querySelectorAll: (target, selector) =>
        createStaticNodeList(queryVirtualDescendantStates(target, selector)),
      getInnerHTML: (target) => target.innerHTML,
      setInnerHTML: (target, html) => {
        target.innerHTML = html;
        target.queries.clear();
      },
      getTextContent: (target) => target.textContent,
      setTextContent: (target, text) => {
        target.textContent = text;
      },
      getAttribute: (target, name) => target.attributes.get(name) ?? null,
      setAttribute: (target, name, value) => target.attributes.set(name, value),
      createEventListener: (target, eventName, callback) =>
        createVirtualEventListenerResource(resources, target, eventName, callback),
    }),
    ...createHtmlInputElementResourceHostBindings(resources, {
      fromElement: (element) => element,
    }),
    ...createTimerResourceHostBindings(resources),
    ...createAnimationResourceHostBindings(resources, {
      requestFrame: (run) => globalThis.setTimeout(() => run(performanceNow()), 16),
      cancelFrame: globalThis.clearTimeout.bind(globalThis),
    }),
    ...createReactRootResourceHostBindings(resources, (target) =>
      createVirtualReactRootResource(resources, target, reactHooks), {
        querySelector: (selector) => queryVirtualElementState(state, selector),
        createNodeTextResource: (value) => createVirtualReactNodeTextResource(resources, value),
        createNodeElementResource: (elementType, props, children) =>
          createVirtualReactNodeElementResource(resources, reactHooks, elementType, props, children),
        createNodeFragmentResource: (props, children) =>
          createVirtualReactNodeFragmentResource(resources, props, children),
      }),
    ...createReactJsValueHostBindings(resources),
    ...createReactStateHostBindings(resources, reactHookRuntime),
    "infoview.documentPosition": (uri, fileName, line, character, label) =>
      resources.resourceForValue({
        uri: resources.resolveResource(uri, "JsString"),
        fileName: resources.resolveResource(fileName, "JsString"),
        line: resources.resolveResource(line, "JsNat"),
        character: resources.resolveResource(character, "JsNat"),
        label: resources.resolveResource(label, "JsString"),
      }),
    "infoview.clipboard.writeText": (text) => {
      const value = resources.resolveResource(text, "JsString");
      state.clipboardText = value;
      state.clipboardWrites ??= [];
      state.clipboardWrites.push(value);
      return resources.resourceForValue(true);
    },
    "infoview.command.revealPosition": (position) => {
      const normalized = normalizeInfoviewDocumentPosition(
        resources.resolveResource(position, "DocumentPosition"),
      );
      if (normalized === null) {
        return resources.resourceForValue(false);
      }
      state.revealedPosition = normalized;
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "revealPosition", position: normalized });
      return resources.resourceForValue(true);
    },
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) =>
      resources.resourceForValue({
        id: resources.resolveResource(id, "JsString"),
        label: resources.resolveResource(label, "JsString"),
        typeName: resources.resolveResource(typeName, "JsString"),
        summary: resources.resolveResource(summary, "JsString"),
        expression: resources.resolveResource(expression, "JsString"),
        typeText: "",
        context: "",
      }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) =>
      resources.resourceForValue({
        ...resources.resolveResource(ref, "RpcRef"),
        typeText: resources.resolveResource(typeText, "JsString"),
        context: resources.resolveResource(context, "JsString"),
        ...nullableField(resources, serverRef, "serverRef"),
      }),
    "js.value.proofwidgets.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(resources.resolveResource(ref, "ResolvedRef")),
    "proofwidgets.rpc.inspectRef": (ref) => {
      const normalized = normalizeProofWidgetsRpcRef(resources.resolveResource(ref, "RpcRef"));
      if (normalized === null) {
        return resources.resourceForValue(false);
      }
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "proofwidgetsRpcInspectRef", ref: normalized });
      return resources.resourceForValue(true);
    },
    "proofwidgets.rpc.resolveRef": (ref, callback) => {
      const normalized = normalizeProofWidgetsRpcRef(resources.resolveResource(ref, "RpcRef"));
      if (normalized === null || typeof callback !== "function") {
        releaseCallback(callback);
        return resources.resourceForValue(false);
      }
      const result = virtualProofWidgetsRpcRefInfo(normalized);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "proofwidgetsRpcResolveRef", ref: normalized, result });
      callAndReleaseCallback(callback, resources.resourceForValue(result));
      return resources.resourceForValue(true);
    },
    [VIR_HOST_DISPOSE]: () => resources.dispose(),
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
  return queryVirtualElementStates(state, selector)[0] ?? null;
}

function queryVirtualElementStates(state, selector) {
  const value = state.elements.get(selector);
  if (value === undefined) return [];
  const elements = Array.isArray(value) ? value : [value];
  return elements.map(normalizeVirtualElementState);
}

function nullableField(resources, value, name) {
  const payload = nullablePayload(resources, value);
  return payload === null ? {} : { [name]: payload };
}

function normalizeVirtualElementState(element) {
  element.innerHTML ??= "";
  element.textContent ??= "";
  element.attributes ??= new Map();
  element.queries ??= new Map();
  element.checked ??= false;
  element.value ??= "";
  element.listeners ??= new Map();
  return element;
}

function queryVirtualDescendantStates(element, selector) {
  const value = element.queries.get(selector);
  if (value === undefined) return [];
  const elements = Array.isArray(value) ? value : [value];
  return elements.map(normalizeVirtualElementState);
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

function virtualEventElementValue(state, resources, event, field) {
  const value = resources.resolveResource(event, "Event")?.[field];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return queryVirtualElementState(state, value);
  }
  if (isHostResource(value)) {
    return resources.resolveResource(value, "Element");
  }
  if (typeof value === "object") {
    return value;
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
  const ownedCallback = takeCallbackLease(callback, "browser.element.addEventListener callback");
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
        callLeanEventCallback(resources, dispatchEvent, ownedCallback);
      }
    },
    remove() {
      if (listener.removed) return;
      listener.removed = true;
      const listeners = target.listeners.get(eventName) ?? [];
      target.listeners.set(eventName, listeners.filter((candidate) => candidate !== listener));
      resources.removeDisposable(listener);
      const errors = [];
      collectCleanupError(errors, () => ownedCallback.release());
      throwCollectedErrors(errors, "virtual event listener removal failed");
    },
  };
  return listener;
}
