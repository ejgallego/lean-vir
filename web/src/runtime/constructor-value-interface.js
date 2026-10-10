/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Bind an admitted variant's JavaScript shape. Native layouts and field paths
// stay with the construction kernel; only caller values are checked here.
export function compileConstructorValueInterface(view) {
  const byName = new Map();
  const cases = view.cases.map((entry, index) => {
    const kind = entry.kind, expected = JSON.stringify(kind);
    let keys, read, wrap;
    if (entry.payload === "none") {
      keys = new Set(["kind"]);
      read = () => undefined;
      wrap = () => ({ kind });
    } else if (entry.payload === "value") {
      keys = new Set(["kind", "value"]);
      read = (value, label) => {
        if (!Object.hasOwn(value, "value")) throw new Error(`${label}.${kind} is missing value`);
        return value.value;
      };
      wrap = value => ({ kind, value });
    } else {
      const fieldKeys = new Set(entry.fields.map(field => field.key));
      keys = new Set(["kind", "fields"]);
      read = (value, label) => {
        if (!Object.hasOwn(value, "fields")) throw new Error(`${label}.${kind} is missing fields`);
        const payload = value.fields;
        requireObject(payload, `${label}.${kind}.fields`);
        requireKeys(payload, fieldKeys, label, expected);
        for (const key of fieldKeys) {
          if (!Object.hasOwn(payload, key)) throw new Error(`${label}.${kind} is missing ${key}`);
        }
        return payload;
      };
      wrap = fields => ({ kind, fields });
    }
    byName.set(kind, index);
    return Object.freeze({
      read(value, label) { requireKeys(value, keys, label, expected); return read(value, label); },
      // The native binder constructs final writable own-property fields.
      wrap,
    });
  });
  return Object.freeze({
    select(value, label = "argument") {
      requireObject(value, label);
      const kind = value.kind;
      if (typeof kind !== "string") throw new Error(`${label} must specify variant kind`);
      const index = byName.get(kind);
      if (index === undefined) throw new Error(`${label} has unknown variant constructor ${kind}`);
      return index;
    },
    cases: Object.freeze(cases),
  });
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireKeys(value, allowed, label, expected) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not supported for ${expected}`);
  }
}
