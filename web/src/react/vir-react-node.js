/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// React values use the same representation and reachability rules as they do
// in an ordinary JavaScript React program. VIR does not wrap nodes, props,
// children, element types, refs, or callbacks in a second ownership graph.

export function createReactElementTypeTag(value) {
  return reactNodeName(value, "element type tag");
}

export function createBrowserReactNodeElement(
  createElement,
  elementType,
  props,
  children,
) {
  return requireCreateElement(createElement)(
    reactElementTypeValue(elementType),
    reactPropsValue(props),
    ...requireReactNodeArray(children),
  );
}

export function createBrowserReactNodeFragment(
  createElement,
  Fragment,
  props,
  children,
) {
  if (Fragment === null || Fragment === undefined) {
    throw new Error("React.Fragment is not available");
  }
  return requireCreateElement(createElement)(
    Fragment,
    reactFragmentPropsValue(props),
    ...requireReactNodeArray(children),
  );
}

// The component argument is already the exact reusable JavaScript function
// that React uses as its component type. The only VIR-specific prop is the JSL
// object carrying the corresponding Lean value.
export function createBrowserLeanComponentNode(
  createElement,
  component,
  leanProps,
  key = null,
) {
  const create = requireCreateElement(createElement);
  const props = {
    leanProps: requireObject(leanProps, "Lean component JSL props"),
  };
  if (key !== null && key !== undefined) {
    props.key = reactNodeName(key, "component key");
  }
  return create(requireFunction(component, "Lean component"), props);
}

export function createReactProps() {
  return {};
}

export function setReactPropsRef(props, ref) {
  setReactObjectProperty(reactPropsValue(props), "ref", reactNodeRef(ref));
  return undefined;
}

export function setReactPropsProperty(props, property) {
  const [name, value] = reactNodePropertyEntry(property);
  setReactObjectProperty(reactPropsValue(props), name, value);
  return undefined;
}

export function setReactPropsEventHandler(props, handler) {
  const [name, callback] = reactNodeEventHandlerEntry(handler);
  setReactObjectProperty(reactPropsValue(props), name, callback);
  return undefined;
}

export function reactNodeTextValue(value) {
  if (typeof value !== "string") {
    throw new Error("React Node text value must be a string");
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

function requireCreateElement(createElement) {
  if (typeof createElement !== "function") {
    throw new Error("React.createElement is not available");
  }
  return createElement;
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new Error(`${label} must be a JavaScript function`);
  }
  return value;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label} must be a JavaScript object`);
  }
  return value;
}

function reactPropsValue(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("React props must be a JavaScript object");
  }
  return value;
}

function requireReactNodeArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("React children must be a JavaScript Array");
  }
  return value;
}

function reactFragmentPropsValue(props) {
  const value = reactPropsValue(props);
  for (const name of Reflect.ownKeys(value)) {
    if (name !== "key") {
      throw new Error("React Fragment props only support key");
    }
  }
  return value;
}

function reactElementTypeValue(value) {
  if (
    typeof value === "string" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return value;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    typeof value.$$typeof === "symbol"
  ) {
    return value;
  }
  throw new Error(
    "React element type must be a tag, component, or React element type object",
  );
}

function reactNodePropertyEntry(property) {
  const name = reactNodePropertyName(property);
  return [name, reactPropValue(property.value, name)];
}

function reactNodeEventHandlerEntry(handler) {
  const name = reactNodeNamedField(handler, "event handler");
  if (typeof handler.callback !== "function") {
    throw new Error(
      "React Node event handler callback must be a JavaScript function",
    );
  }
  return [name, handler.callback];
}

function reactNodeRef(ref) {
  if (
    ref !== null &&
    ref !== undefined &&
    typeof ref !== "object" &&
    typeof ref !== "function"
  ) {
    throw new Error(
      "React Node element ref must be a React ref object, callback, or null",
    );
  }
  return ref;
}

function reactNodePropertyName(property) {
  const name = reactNodeNamedField(property, "property");
  if (name === "data-") {
    throw new Error("React Node data-* property name must include a suffix");
  }
  return name;
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
        throw new Error(
          "React PropValue.style is only supported for the style prop",
        );
      }
      return reactStylePropValue(value.value);
    case "classList":
      if (propName !== "className") {
        throw new Error(
          "React PropValue.classList is only supported for the className prop",
        );
      }
      return reactClassListPropValue(value.value);
    default:
      throw new Error(
        "React PropValue must be string, bool, int, float, style, or classList",
      );
  }
}

function reactIntPropValue(value) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN;
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
  if (!Array.isArray(entries)) {
    throw new Error("React PropValue.style value must be an array");
  }
  const style = {};
  for (const [index, entry] of entries.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`React PropValue.style[${index}] must be an object`);
    }
    const name = reactSafeObjectKey(
      reactNodeName(entry.name, `React PropValue.style[${index}].name`),
      `React PropValue.style[${index}].name`,
    );
    if (typeof entry.value !== "string") {
      throw new Error(`React PropValue.style[${index}].value must be a string`);
    }
    style[name] = entry.value;
  }
  return style;
}

function reactClassListPropValue(classes) {
  if (!Array.isArray(classes)) {
    throw new Error("React PropValue.classList value must be an array");
  }
  const tokens = [];
  const seen = new Set();
  for (const [index, value] of classes.entries()) {
    if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
      throw new Error(
        `React PropValue.classList[${index}] must be a non-empty token without whitespace`,
      );
    }
    if (!seen.has(value)) {
      seen.add(value);
      tokens.push(value);
    }
  }
  return tokens.join(" ");
}

function reactSafeObjectKey(value, label) {
  if (
    value === "__proto__" ||
    value === "prototype" ||
    value === "constructor"
  ) {
    throw new Error(`${label} is not supported`);
  }
  return value;
}
