/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

// Small constructors for independently authored descriptor-pair fixtures.
// These helpers only spell the new schema; they do not read or translate an
// older manifest representation.
export function nativeDescriptor(tag, facts = {}, metadata) {
  return {
    type: { tag, ...facts },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function boundary(native, value) {
  return { native, value };
}

export function primitiveBoundary(nativeTag, valueTag, facts = {}) {
  return boundary(nativeDescriptor(nativeTag, facts), { tag: valueTag });
}

export function objectBoundary(declaration, constructors, value, metadata = {}) {
  return boundary(
    nativeDescriptor("leanObject", {}, { declaration, constructors, ...metadata }),
    value,
  );
}

export function resourceBoundary(value = { tag: "jsReference" }, metadata) {
  return boundary(nativeDescriptor("resource", {}, metadata), value);
}

export function functionBoundary(args, result, effect = "pure") {
  return boundary(
    nativeDescriptor("leanObject", {}, {
      declaration: "Function",
      signature: {
        args: args.map((arg) => arg.native),
        result: result.native,
        effect,
      },
    }),
    {
      tag: "function",
      args: args.map((arg) => arg.value),
      result: result.value,
    },
  );
}

export function unitBoundary() {
  return objectBoundary(
    "Unit",
    [immediateConstructor("Unit.unit")],
    { tag: "unit" },
  );
}

export function booleanBoundary() {
  return objectBoundary(
    "Bool",
    [
      immediateConstructor("Bool.false"),
      immediateConstructor("Bool.true"),
    ],
    { tag: "boolean", false: 0, true: 1 },
  );
}

export function enumBoundary(declaration, names) {
  const constructors = names.map((name) =>
    immediateConstructor(`${declaration}.${name}`),
  );
  return objectBoundary(
    declaration,
    constructors,
    { tag: "enum", cases: names },
  );
}

export function arrayBoundary(elementNative, elementValue) {
  return boundary(
    nativeDescriptor("leanObject", {}, { arrayElement: elementNative }),
    { tag: "sequence", element: elementValue },
  );
}

export function recursiveRef(ref) {
  return { ref };
}

export function nativeField(name, type, location) {
  return { name, type, location };
}

export function immediateConstructor(name) {
  return { name, representation: "immediate", fields: [] };
}

export function objectConstructor(name, storage, fields) {
  return { name, representation: "object", storage, fields };
}

export function identityConstructor(name, field) {
  return { name, representation: "identity", fields: [field] };
}
