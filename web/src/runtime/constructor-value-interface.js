/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Bind the selected JavaScript constructor shape. Native layouts and child
// codecs stay with the construction kernel.
// Descriptors are admitted before binding. No metadata is checked per value.
export function compileConstructorValueInterface(native, view) {
  const constructors = native.metadata?.constructors;
  if (native.type.tag !== "leanObject" || constructors === undefined || view.tag !== "variant") {
    throw new Error("constructor interface requires object metadata and variant");
  }
  if (view.cases.length !== constructors.length) {
    throw new Error("variant must cover every native constructor");
  }
  const byName = new Map();
  const cases = view.cases.map((entry, index) => {
    const kind = entry.kind;
    if (typeof kind !== "string" || kind.length === 0 || byName.has(kind)) {
      throw new Error("variant constructor spellings must be nonempty and unique");
    }
    const fields = constructors[index].fields;
    const expected = JSON.stringify(kind);
    let keys, read, build, wrap;
    if (entry.payload === "none") {
      if (fields.length !== 0) throw new Error("empty payload requires a nullary constructor");
      keys = new Set(["kind"]);
      read = () => undefined;
      build = () => ({ kind });
      wrap = build;
    } else if (entry.payload === "value") {
      if (fields.length !== 1) throw new Error("value payload requires one native field");
      keys = new Set(["kind", "value"]);
      read = (value, label) => {
        if (!Object.hasOwn(value, "value")) throw new Error(`${label}.${kind} is missing value`);
        return value.value;
      };
      build = payload => ({ kind, value: payload });
      wrap = build;
    } else if (entry.payload === "fields") {
      const used = new Set(), fieldKeys = new Set(), paths = new Set();
      const mappings = entry.fields.map(field => {
        // The construction plan resolves logical paths, including inherited records.
        if (field.path.length === 0 || !Number.isInteger(field.path[0]) ||
            field.path[0] < 0 || field.path[0] >= fields.length) {
          throw new Error("constructor field paths must cover distinct immediate fields");
        }
        if (typeof field.key !== "string" || fieldKeys.has(field.key)) {
          throw new Error("constructor field keys must be unique strings");
        }
        const path = JSON.stringify(field.path);
        if (paths.has(path)) throw new Error("duplicate constructor field path");
        paths.add(path); used.add(field.path[0]); fieldKeys.add(field.key);
        return { key: field.key, index: field.path[0] };
      });
      if (used.size !== fields.length) throw new Error("payload must cover every native field");
      keys = new Set(["kind", "fields"]);
      read = (value, label) => {
        if (!Object.hasOwn(value, "fields")) throw new Error(`${label}.${kind} is missing fields`);
        const payload = value.fields;
        requireObject(payload, `${label}.${kind}.fields`);
        requireKeys(payload, fieldKeys, label, expected);
        for (const { key } of mappings) {
          if (!Object.hasOwn(payload, key)) throw new Error(`${label}.${kind} is missing ${key}`);
        }
        return payload;
      };
      build = payload => {
        const result = {};
        for (const { key, index } of mappings) {
          Object.defineProperty(result, key, {
            value: payload[index], writable: true, enumerable: true, configurable: true,
          });
        }
        return { kind, fields: result };
      };
      wrap = fields => ({ kind, fields });
    } else throw new Error("unknown variant payload shape");
    byName.set(kind, index);
    return {
      // Selection returns the ordinal directly, without an intermediate node.
      read(value, label) { requireKeys(value, keys, label, expected); return read(value, label); },
      build,
      // The native binder already constructs final own-property fields.
      wrap,
    };
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
    cases: Object.freeze(cases.map(entry => Object.freeze(entry))),
    build(index, payload) {
      if (!Number.isInteger(index) || index < 0 || index >= cases.length) {
        throw new Error("result constructor index is out of range");
      }
      return cases[index].build(payload);
    },
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
