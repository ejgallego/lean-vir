/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VIR_HOST_DISPOSE } from "../host-boundary.js";
import {
  createAnimationHostBindings,
  createHostLifecycle,
  createTimerHostBindings,
} from "./vir-active-host-bindings.js";
import {
  createCSSStyleDeclarationHostBindings,
  createDOMTokenListHostBindings,
  createElementHostBindings,
  createEventListenerValueHostBindings,
  createHtmlInputElementHostBindings,
  createKeyboardEventHostBindings,
} from "./vir-dom-host-bindings.js";
import { createStaticNodeList } from "./vir-js-collection-bindings.js";
import { createInfoviewHostBindings } from "./vir-infoview-host-bindings.js";
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

export function createVirtualEventHostBindings() {
  return {
    ...createEventListenerValueHostBindings(),
    ...createKeyboardEventHostBindings({
      fromEvent: (event) => (typeof event?.key === "string" ? event : null),
    }),
    "browser.event.target": (event) => event?.target ?? null,
    "browser.event.currentTarget": (event) => event?.currentTarget ?? null,
    "browser.eventTarget.asElement": (target) =>
      target !== null && typeof target === "object" ? target : null,
    "browser.event.preventDefault": (event) => {
      event.preventDefault();
      return undefined;
    },
    "browser.event.stopPropagation": (event) => {
      event.stopPropagation();
      return undefined;
    },
    "browser.event.formValue": (event) => formControlEventValue(event),
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
    "browser.document.current": () => state,
    "browser.document.getTitle": (documentValue) => documentValue.title,
    "browser.document.setTitle": (documentValue, title) => {
      documentValue.title = title;
      return undefined;
    },
    "browser.document.querySelector": (documentValue, selector) =>
      queryVirtualElementState(documentValue, selector),
    "browser.document.querySelectorAll": (documentValue, selector) =>
      createStaticNodeList(queryVirtualElementStates(documentValue, selector)),
    "browser.document.createElement": (_documentValue, _tagName) =>
      createVirtualElementState(),
    ...createVirtualEventHostBindings(),
    ...createElementHostBindings({
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
      addEventListener: (target, eventName, listener) =>
        addVirtualEventListener(target, eventName, listener),
      removeEventListener: (target, eventName, listener) =>
        removeVirtualEventListener(target, eventName, listener),
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
        globalThis.setTimeout(() => run(virtualPerformanceNow()), 16),
      cancelFrame: globalThis.clearTimeout.bind(globalThis),
    }),
    ...createUnsupportedReactHostBindings(),
    ...createInfoviewHostBindings({
      commandDispatcher: createVirtualInfoviewCommandDispatcher(state),
    }),
    "infoview.clipboard.writeText": (text) => {
      state.clipboardText = text;
      state.clipboardWrites ??= [];
      state.clipboardWrites.push(text);
      return true;
    },
    [VIR_HOST_DISPOSE]: () => resources.dispose(),
  };
}

function virtualPerformanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
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

function queryVirtualElementState(state, selector) {
  return queryVirtualElementStates(state, selector)[0] ?? null;
}

function queryVirtualElementStates(state, selector) {
  const value = state.elements.get(selector);
  if (value === undefined) return [];
  const elements = Array.isArray(value) ? value : [value];
  return elements.map(normalizeVirtualElementState);
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

function createVirtualInfoviewCommandDispatcher(state) {
  return {
    revealPosition(position) {
      state.revealedPosition = position;
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "revealPosition", position });
      return true;
    },
    insertText(position, text) {
      const edit = { position, newText: text };
      state.appliedEdits ??= [];
      state.appliedEdits.push(edit);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "insertText", ...edit });
      return true;
    },
    proofwidgetsRpcInspectRef(ref) {
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({ kind: "proofwidgetsRpcInspectRef", ref });
      return true;
    },
    proofwidgetsRpcResolveRef(ref) {
      const result = virtualProofWidgetsRpcRefInfo(ref);
      state.infoviewCommands ??= [];
      state.infoviewCommands.push({
        kind: "proofwidgetsRpcResolveRef",
        ref,
        result,
      });
      return result;
    },
  };
}

function callHostCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    console.error(error);
  }
}

function addVirtualEventListener(target, eventName, listener) {
  if (typeof listener !== "function")
    throw new Error("browser event listener callback must be a function");
  if (!target.listeners.has(eventName)) {
    target.listeners.set(eventName, []);
  }
  const listeners = target.listeners.get(eventName);
  if (listeners.some((entry) => entry.callback === listener)) return;
  const entry = {
    callback: listener,
    removed: false,
    dispatch(event = {}) {
      if (!entry.removed) {
        const dispatchEvent =
          event !== null && typeof event === "object" ? event : {};
        dispatchEvent.target ??= target;
        dispatchEvent.currentTarget ??= target;
        callHostCallback(listener, dispatchEvent);
      }
    },
  };
  listeners.push(entry);
}

function removeVirtualEventListener(target, eventName, listener) {
  const listeners = target.listeners.get(eventName) ?? [];
  for (const entry of listeners) {
    if (entry.callback === listener) entry.removed = true;
  }
  target.listeners.set(
    eventName,
    listeners.filter((entry) => entry.callback !== listener),
  );
}
