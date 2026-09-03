/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VIR_HOST_DISPOSE } from "../host-boundary.js";
import {
  callLeanEventCallback,
  createAnimationHostBindings,
  createElementHostBindings,
  createHostLifecycle,
  createTimerHostBindings,
  performanceNow,
  preventDefaultOnEvent,
  stopPropagationOnEvent,
} from "./vir-host-resources.js";
import {
  createCSSStyleDeclarationHostBindings,
  createDOMTokenListHostBindings,
  createHtmlInputElementHostBindings,
  createKeyboardEventHostBindings,
} from "./vir-dom-host-bindings.js";
import {
  createNullableValue,
  nullablePayload,
} from "./vir-js-value-bindings.js";
import { createStaticNodeList } from "./vir-js-collection-bindings.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "../runtime/cleanup.js";

export function createVirtualDocumentState({
  title = "",
  elements = new Map(),
  resources = createHostLifecycle(),
  clipboardText = "",
  clipboardWrites = [],
  revealedPosition = null,
  appliedEdits = [],
  infoviewCommands = [],
} = {}) {
  if (!(elements instanceof Map)) {
    throw new Error("virtual document elements must be a Map");
  }
  return {
    title,
    elements,
    resources,
    clipboardText,
    clipboardWrites,
    revealedPosition,
    appliedEdits,
    infoviewCommands,
  };
}

export function createVirtualElementState({
  innerHTML = "",
  textContent = "",
  attributes = new Map(),
  queries = new Map(),
  checked = false,
  value = "",
  listeners = new Map(),
  inlineStyle = createVirtualCSSStyleDeclarationState(),
} = {}) {
  const element = {
    innerHTML,
    textContent,
    attributes,
    queries,
    checked,
    value,
    listeners,
  };
  if (inlineStyle !== null) {
    Object.defineProperty(element, "style", {
      enumerable: true,
      get: () => inlineStyle,
      set: (cssText) => {
        inlineStyle.cssText = String(cssText);
      },
    });
  }
  return element;
}

function createVirtualCSSStyleDeclarationState() {
  const properties = new Map();
  return {
    cssText: "",
    properties,
    setProperty: (property, value) => {
      const text = value ?? "";
      if (text === "") properties.delete(property);
      else properties.set(property, text);
    },
  };
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
  const values = elements.map((element) =>
    normalizeVirtualElementState(element ?? createVirtualElementState()),
  );
  state.elements.set(selector, values);
  return values;
}

export function createVirtualEventState({
  target = null,
  currentTarget = null,
  key = null,
  defaultPrevented = false,
  propagationStopped = false,
  onPreventDefault = null,
  onStopPropagation = null,
} = {}) {
  const event = {
    target,
    currentTarget,
    ...(typeof key === "string" ? { key } : {}),
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
) {
  return {
    ...createKeyboardEventHostBindings({
      fromEvent: (event) =>
        typeof event?.key === "string" ? event : null,
    }),
    "browser.event.target": (event) =>
      createNullableValue(virtualEventElementValue(state, event, "target")),
    "browser.event.currentTarget": (event) =>
      createNullableValue(
        virtualEventElementValue(state, event, "currentTarget"),
      ),
    "browser.event.preventDefault": (event) => {
      preventDefaultOnEvent(event);
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      stopPropagationOnEvent(event);
      return undefined;
    },
    "browser.event.formValue": (event) =>
      createNullableValue(formControlEventValue(event)),
  };
}

export function createVirtualDocumentHostBindings(
  state = createVirtualDocumentState(),
  resources = state.resources ?? createHostLifecycle(),
) {
  if (!(state?.elements instanceof Map)) {
    throw new Error("virtual document state must have an elements Map");
  }
  state.resources = resources;
  return {
    "browser.document.getTitle": () => state.title,
    "browser.document.setTitle": (title) => {
      state.title = title;
      return undefined;
    },
    "browser.document.querySelector": (selector) =>
      createNullableValue(queryVirtualElementState(state, selector)),
    "browser.document.querySelectorAll": (selector) =>
      createStaticNodeList(queryVirtualElementStates(state, selector)),
    ...createVirtualEventHostBindings(state),
    ...createElementHostBindings(resources, {
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
        target.textContent = text ?? "";
      },
      getClassList: (target) => virtualDOMTokenList(target),
      setClassList: (target, classList) => {
        target.attributes.set("class", classList);
      },
      getAttribute: (target, name) => target.attributes.get(name) ?? null,
      setAttribute: (target, name, value) => target.attributes.set(name, value),
      createEventListener: (target, eventName, callback) =>
        createVirtualEventListenerSubscription(
          resources,
          target,
          eventName,
          callback,
        ),
    }),
    ...createDOMTokenListHostBindings(),
    ...createCSSStyleDeclarationHostBindings({
      fromElement: (element) =>
        typeof element?.style?.setProperty === "function" ? element : null,
    }),
    ...createHtmlInputElementHostBindings({
      fromElement: (element) => element,
    }),
    ...createTimerHostBindings(resources),
    ...createAnimationHostBindings(resources, {
      requestFrame: (run) =>
        globalThis.setTimeout(() => run(performanceNow()), 16),
      cancelFrame: globalThis.clearTimeout.bind(globalThis),
    }),
    ...createUnsupportedReactHostBindings(),
    "infoview.documentPosition": (uri, fileName, line, character, label) => ({
      uri,
      fileName,
      line,
      character,
      label,
    }),
    "infoview.clipboard.writeText": (text) => {
      state.clipboardText = text;
      state.clipboardWrites ??= [];
      state.clipboardWrites.push(text);
      return true;
    },
    "infoview.command.revealPosition": (position) => {
      const normalized = normalizeInfoviewDocumentPosition(position);
      if (normalized === null) {
        return false;
      }
      state.revealedPosition = normalized;
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({
        kind: "revealPosition",
        position: normalized,
      });
      return true;
    },
    "infoview.command.insertText": (position, text) => {
      const normalized = normalizeInfoviewDocumentPosition(position);
      const newText = text;
      if (normalized === null) {
        return false;
      }
      const edit = { position: normalized, newText };
      state.appliedEdits ??= [];
      state.appliedEdits.push(edit);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "insertText", ...edit });
      return true;
    },
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) => ({
      id,
      label,
      typeName,
      summary,
      expression,
      typeText: "",
      context: "",
    }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) => ({
      ...ref,
      typeText,
      context,
      ...nullableField(serverRef, "serverRef"),
    }),
    "js.value.proofwidgets.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(ref),
    "proofwidgets.rpc.inspectRef": (ref) => {
      const normalized = normalizeProofWidgetsRpcRef(ref);
      if (normalized === null) {
        return false;
      }
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({
        kind: "proofwidgetsRpcInspectRef",
        ref: normalized,
      });
      return true;
    },
    "proofwidgets.rpc.resolveRef": (ref, callback) => {
      const normalized = normalizeProofWidgetsRpcRef(ref);
      if (normalized === null || typeof callback !== "function") {
        return false;
      }
      const result = virtualProofWidgetsRpcRefInfo(normalized);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({
        kind: "proofwidgetsRpcResolveRef",
        ref: normalized,
        result,
      });
      callHostCallback(callback, result);
      return true;
    },
    [VIR_HOST_DISPOSE]: () => resources.dispose(),
  };
}

const unsupportedReactHostTargets = Object.freeze([
  "js.value.react.property",
  "js.value.react.eventHandler",
  "js.value.react.reducer",
  "js.value.react.memoCalculation",
  "js.value.react.callback",
  "js.value.react.effectCallback",
  "js.value.react.component",
  "react.props.empty",
  "react.props.setProperty",
  "react.props.setEventHandler",
  "react.props.setRef",
  "react.state.set",
  "react.state.modify",
  "react.reducer.dispatch",
  "react.useReducer",
  "react.reducerTuple.value",
  "react.reducerTuple.dispatch",
  "react.useState",
  "react.stateTuple.value",
  "react.stateTuple.setter",
  "react.useRef",
  "react.useCallback",
  "react.useContext",
  "react.useEffect",
  "react.deps.empty",
  "react.deps.push",
  "react.useMemo",
  "react.useEffectWithDeps",
  "react.ref.get",
  "react.ref.set",
  "react.elementType.tag",
  "react.node.text",
  "react.node.createElement",
  "react.node.component",
  "react.node.keyedComponent",
  "react.node.fragment",
  "react.root.renderIntoSelector",
  "react.root.unmountSelector",
  "react.root.renderNode",
  "react.root.unmount",
  "react.root.create",
]);

function createUnsupportedReactHostBindings() {
  return Object.fromEntries(
    unsupportedReactHostTargets.map((target) => [
      target,
      () => {
        throw new Error(`${target} requires the browser React host`);
      },
    ]),
  );
}

function createVirtualEventListenerSubscription(
  resources,
  target,
  eventName,
  callback,
) {
  const listener = virtualCallbackEventListenerState(
    target,
    eventName,
    callback,
    resources,
  );
  target.listeners.get(eventName).push(listener);
  return listener;
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

function nullableField(value, name) {
  const payload = nullablePayload(value);
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

function virtualDOMTokenList(element) {
  element.classList ??= {
    add: (token) =>
      updateVirtualClassTokens(element, (tokens) => tokens.add(token)),
    remove: (token) =>
      updateVirtualClassTokens(element, (tokens) => tokens.delete(token)),
    toggle: (token) => {
      const tokens = virtualClassTokens(element);
      const present = tokens.has(token);
      if (present) tokens.delete(token);
      else tokens.add(token);
      writeVirtualClassTokens(element, tokens);
      return !present;
    },
  };
  return element.classList;
}

function virtualClassTokens(element) {
  return new Set(
    String(element.attributes.get("class") ?? "")
      .split(/\s+/u)
      .filter((token) => token.length > 0),
  );
}

function updateVirtualClassTokens(element, update) {
  const tokens = virtualClassTokens(element);
  update(tokens);
  writeVirtualClassTokens(element, tokens);
}

function writeVirtualClassTokens(element, tokens) {
  element.attributes.set("class", [...tokens].join(" "));
}

function queryVirtualDescendantStates(element, selector) {
  const value = element.queries.get(selector);
  if (value === undefined) return [];
  const elements = Array.isArray(value) ? value : [value];
  return elements.map(normalizeVirtualElementState);
}

function virtualEventElementValue(state, event, field) {
  const value = event?.[field];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return queryVirtualElementState(state, value);
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
  return null;
}

function isRpcRefObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.__rpcref === "number" || typeof value.p === "number")
  );
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

function callHostCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    console.error(error);
  }
}

function nonNegativeInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
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

function virtualCallbackEventListenerState(
  target,
  eventName,
  callback,
  resources,
) {
  if (typeof callback !== "function")
    throw new Error("browser event listener callback must be a function");
  if (!target.listeners.has(eventName)) {
    target.listeners.set(eventName, []);
  }
  const listener = {
    removed: false,
    dispatch(event = {}) {
      if (!listener.removed) {
        const dispatchEvent =
          event !== null && typeof event === "object" ? event : {};
        dispatchEvent.target ??= target;
        dispatchEvent.currentTarget ??= target;
        callLeanEventCallback(dispatchEvent, callback);
      }
    },
    remove() {
      if (listener.removed) return;
      listener.removed = true;
      const listeners = target.listeners.get(eventName) ?? [];
      target.listeners.set(
        eventName,
        listeners.filter((candidate) => candidate !== listener),
      );
      resources.removeDisposable(listener);
    },
  };
  return listener;
}
