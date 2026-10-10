/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const JSON_VALUE_TAGS = new Set(["expr", "record", "sequence", "variant"]);

export function interfaceInputTag(pair) {
  if (pair?.value?.tag === "enum") return "SELECT";
  if (isJsonInput(pair)) return "TEXTAREA";
  return "INPUT";
}

export function inputDefault(input) {
  const value = defaultValueForType(input.type);
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function parseBoolText(text) {
  if (text === true || text === false) return text;
  if (String(text).trim() === "true") return true;
  if (String(text).trim() === "false") return false;
  return false;
}

export function isJsonInput(pair) {
  return JSON_VALUE_TAGS.has(pair?.value?.tag);
}

export function defaultValueForType(pair, bindings = [], depth = 0) {
  if (pair?.native?.ref !== undefined || pair?.value?.tag === "recursive") {
    if (depth >= 2) return null;
    const target = resolvePair(pair, bindings);
    return target === null
      ? null
      : defaultValueForType(target, bindings, depth + 1);
  }
  const resolved = resolvePair(pair, bindings);
  if (resolved === null) return null;
  const view = resolved.value;
  switch (view?.tag) {
    case "bigint":
    case "number":
    case "safeInteger":
      return 0;
    case "string":
      return "";
    case "bytes":
      return [];
    case "unit":
      return null;
    case "boolean":
      return false;
    case "enum":
      return view.cases[0] ?? "";
    case "expr":
      return { kind: "const", name: "Nat", levels: [] };
    case "record":
      return defaultRecordValue(resolved, bindings, depth);
    case "variant":
      return view.cases.length === 0
        ? null
        : constructorTemplate(resolved, 0, bindings, depth);
    case "sequence":
      return [];
    case "recursive":
    case "function":
    case "jsReference":
    case "leanReference":
    default:
      return null;
  }
}

function defaultRecordValue(pair, bindings, depth) {
  const fields = pair.value.fields ?? [];
  const result = {};
  for (const field of fields) {
    const resolvedField = nativeFieldAtPath(
      pair.native,
      field.path,
      0,
      [pair, ...bindings],
    );
    result[field.key] = defaultValueForType(
      { native: resolvedField?.native ?? null, value: field.value },
      resolvedField?.bindings ?? [pair, ...bindings],
      depth + 1,
    );
  }
  return result;
}

// The editable template follows the chosen JS case and resolves native fields
// only to obtain the child descriptor; constructor indices come from the view.
export function constructorTemplate(pair, caseIndex, bindings = [], depth = 0) {
  const resolved = resolvePair(pair, bindings);
  if (resolved === null || resolved.value?.tag !== "variant") return null;
  const view = resolved.value.cases[caseIndex];
  if (view === undefined) return null;
  if (view.payload === "none") return { kind: view.kind };

  const localBindings = [resolved, ...bindings];
  if (view.payload === "value") {
    const resolvedField = nativeFieldAtPath(
      resolved.native,
      [0],
      caseIndex,
      localBindings,
    );
    return {
      kind: view.kind,
      value: defaultValueForType(
        { native: resolvedField?.native ?? null, value: view.value },
        resolvedField?.bindings ?? localBindings,
        depth + 1,
      ),
    };
  }

  const fields = {};
  for (const field of view.fields) {
    const resolvedField = nativeFieldAtPath(
      resolved.native,
      field.path,
      caseIndex,
      localBindings,
    );
    fields[field.key] = defaultValueForType(
      { native: resolvedField?.native ?? null, value: field.value },
      resolvedField?.bindings ?? localBindings,
      depth + 1,
    );
  }
  return { kind: view.kind, fields };
}

function resolvePair(pair, bindings) {
  if (pair?.value?.tag === "recursive" && pair.native?.ref === undefined) {
    return bindings[0] ?? null;
  }
  if (pair?.native?.ref !== undefined) {
    const target = bindings[pair.native.ref];
    return target === undefined ? null : resolvePair(target, bindings.slice(pair.native.ref + 1));
  }
  return pair;
}

function resolveNative(native, bindings) {
  if (native?.ref !== undefined) {
    return bindings[native.ref]?.native ?? null;
  }
  return native;
}

function nativeFieldAtPath(native, path, firstConstructor, bindings) {
  let current = resolveNative(native, bindings);
  let owners = bindings;
  for (const [position, fieldIndex] of path.entries()) {
    const constructorIndex = position === 0 ? firstConstructor : 0;
    const ctor = current?.metadata?.constructors?.[constructorIndex];
    const field = ctor?.fields?.[fieldIndex];
    if (field === undefined) return null;
    if (position === path.length - 1) return { native: field.type, bindings: owners };
    current = resolveNative(field.type, owners);
    if (current === null) return null;
    owners = [current, ...owners];
  }
  return path.length === 0 ? { native: current, bindings: owners } : null;
}
