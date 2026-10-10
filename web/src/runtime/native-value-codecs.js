/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { compileConstructorValueInterface } from "./constructor-value-interface.js";
import { compilePrimitiveValueCodec } from "./primitive-values.js";
import {
  normalizeBoundedUnsignedBigInt,
} from "./primitive-value-normalizers.js";

// Bind immutable admitted compiler facts to the selected JS representation.
// Plans reuse managed allocation/ownership and construct values directly.
// No intermediate normalized tree or second descriptor interpretation is needed.
export function compileNativeValueCodec(runtime, pair) {
  return compileValueCodec(runtime, pair.native, pair.value);
}

function compileValueCodec(runtime, native, view, bindings = []) {
  if ("ref" in native) {
    if (view.tag !== "recursive" || bindings[native.ref] === undefined)
      throw new Error("unbound recursive interface");
    return bindings[native.ref];
  }
  const primitive = compilePrimitiveValueCodec(runtime, native, view);
  if (primitive !== null) return primitive;
  const type = native.type;
  const codec = {};
  const compile = (type, value, scope = bindings) =>
    compileValueCodec(runtime, type, value, scope);
  switch (type.tag) {
    case "leanObject": {
      if (view.tag === "expr") {
        codec.lower = (value, label) => runtime.makeObjectExpr(value, label);
        codec.lift = (obj, label) => runtime.liftObjectExpr(obj, label);
        break;
      }
      if (view.tag === "function") {
        codec.lower = (_value, label) => { throw new Error(`${label} cannot be a JavaScript function at this boundary`); };
        codec.lift = (obj, label) => runtime.liftObjectFunction({ native, value: view }, obj, label);
        break;
      }
      if (view.tag === "sequence" && view.chain === undefined) {
        const elementType = native.metadata?.arrayElement;
        if (elementType === undefined) throw new Error("array codec requires native array metadata");
        const element = compile(elementType, view.element);
        codec.lower = (value, label, scratch) => {
          requireArray(value, label);
          const objects = [];
          try {
            for (let i = 0; i < value.length; i++) objects.push(element.lower(value[i], `${label}[${i}]`, scratch));
            return runtime.makeObjectArrayFromOwnedElements(objects, label);
          } finally { runtime.releaseOwnedObjects(objects); }
        };
        codec.lift = (obj, label) => {
          const values = [], size = runtime.exports.vir_obj_array_size(obj);
          for (let i = 0; i < size; i++) {
            const child = runtime.exports.vir_obj_array_get(obj, i);
            if (child === 0) throw new Error(`${label}[${i}] is unavailable`);
            try { own(values, i, element.lift(child, `${label}[${i}]`)); }
            finally { runtime.exports.vir_obj_dec(child); }
          }
          return values;
        };
        break;
      }
      const constructors = native.metadata?.constructors;
      if (!["unit", "boolean", "enum", "sequence", "variant", "record"].includes(view.tag))
        throw new Error(`unsupported object view ${view.tag}`);
      if (constructors === undefined) throw new Error("structural codec requires constructor metadata");
      const scope = [codec, ...bindings];
      if (view.tag === "sequence") {
        Object.assign(codec, compileChain(runtime, constructors, view, scope, compile));
      } else if (view.tag === "variant") {
        const shape = compileConstructorValueInterface(view);
        const identity = constructors.length === 1 && constructors[0].representation === "identity";
        const plans = constructors.map((ctor, index) => {
          const entry = view.cases[index];
          const mappings = entry.payload === "none" ? [] : entry.payload === "value"
            ? [{ path: [0], value: entry.value }] : entry.fields;
          return constructorKernel(runtime, ctor, mappings, scope, compile,
            entry.payload === "value" ? () => value => value : key => value => value[key],
            entry.payload === "value", shape.cases[index].wrap);
        });
        codec.lower = (value, label, scratch) => {
          const index = shape.select(value, label);
          const payload = shape.cases[index].read(value, label);
          return plans[index].lower(index, payload, label, scratch);
        };
        codec.lift = (obj, label) => {
          const index = identity ? 0 : runtime.exports.vir_obj_tag(obj);
          if (!Number.isInteger(index) || index < 0 || index >= plans.length)
            throw new Error(`${label} constructor is out of range`);
          return plans[index].lift(obj, label);
        };
      } else if (view.tag === "record") {
        if (constructors.length !== 1) throw new Error("record view requires one constructor");
        const fieldKeys = view.fields.map(field => field.key);
        if (fieldKeys.some(key => typeof key !== "string")) throw new Error("record keys must be strings");
        const keys = new Set(fieldKeys);
        const ctor = constructorKernel(runtime, constructors[0], view.fields, scope, compile,
          key => value => value[key], false, value => value);
        codec.lower = (value, label, scratch) => {
          requireRecord(value, keys, label);
          return ctor.lower(0, value, label, scratch);
        };
        codec.lift = (obj, label) => ctor.lift(obj, label);
      } else throw new Error(`unsupported constructor view ${view.tag}`);
      break;
    }
    default: throw new Error(`unsupported native type ${type.tag}`);
  }
  return Object.freeze(codec);
}

function constructorKernel(runtime, ctor, mappings, scope, compile, reader, single, build) {
  const groups = new Map();
  for (const mapping of mappings) {
    const index = mapping.path[0];
    if (!Number.isInteger(index) || !ctor.fields[index]) throw new Error("unknown constructor field path");
    let group = groups.get(index);
    if (group === undefined) { group = []; groups.set(index, group); }
    group.push(mapping);
  }
  if (groups.size !== ctor.fields.length) throw new Error("view must cover native fields");
  const fields = ctor.fields.map((field, index) => {
    const group = groups.get(index);
    if (group.length === 1 && group[0].path.length === 1) {
      const mapping = group[0];
      return { field, codec: compile(field.type, mapping.value, scope),
        read: reader(mapping.key), key: mapping.key, keys: [mapping.key], nested: false };
    }
    if (single || group.some(mapping => mapping.path.length === 1)) throw new Error("overlapping constructor field paths");
    const nested = group.map(mapping => ({ ...mapping, path: mapping.path.slice(1) }));
    return { field, codec: compile(field.type, { tag: "record", fields: nested }, scope),
      read: value => Object.fromEntries(group.map(mapping => [mapping.key, reader(mapping.key)(value)])),
      keys: group.map(mapping => mapping.key), nested: true };
  });
  // Prepare writable own fields once; __proto__ never invokes an inherited setter.
  const outputTemplate = single ? null
    : Object.freeze(Object.fromEntries(mappings.map(entry => [entry.key, undefined])));
  function append(output, entry, value) {
    if (entry.nested) for (const key of entry.keys) output[key] = value[key];
    else output[entry.key] = value;
  }
  if (ctor.representation === "immediate") return {
    lower: (index, _value, label) => runtime.makeObjectScalar(index, label),
    lift: () => build(undefined),
  };
  if (ctor.representation === "identity") return {
    lower: (_index, value, label, scratch) => fields[0].codec.lower(fields[0].read(value), label, scratch),
    lift(obj, label) {
      const value = fields[0].codec.lift(obj, label);
      if (single) return build(value);
      const output = { ...outputTemplate }; append(output, fields[0], value); return build(output);
    },
  };
  const storage = ctor.storage, objectOnly = storage.usizeFieldCount === 0 && storage.scalarByteSize === 0;
  // Physical slots are admitted facts. Bind the common small object layouts
  // once instead of branching on every field's location at every value.
  const objectFields = objectOnly ? [...fields].sort((a, b) => a.field.location.index - b.field.location.index) : null;
  const lowerObjectField = (entry, value, label, scratch) => entry.codec.lower(
    entry.read(value), `${label}.${entry.field.name}`, scratch);
  let lowerObjects;
  if (objectOnly && objectFields.length === storage.objectFieldCount) {
    if (objectFields.length === 1) {
      const first = objectFields[0];
      lowerObjects = (index, value, label, scratch) => {
        const objects = [0];
        try {
          objects[0] = lowerObjectField(first, value, label, scratch);
          return scratch.createObjects(index, objects, label);
        } finally { runtime.releaseOwnedObjects(objects); }
      };
    } else if (objectFields.length === 2) {
      const [first, second] = objectFields;
      lowerObjects = (index, value, label, scratch) => {
        const objects = [0, 0];
        try {
          objects[0] = lowerObjectField(first, value, label, scratch);
          objects[1] = lowerObjectField(second, value, label, scratch);
          return scratch.createObjects(index, objects, label);
        } finally { runtime.releaseOwnedObjects(objects); }
      };
    }
  }
  function liftField({ field, codec }, obj, label) {
    const at = field.location;
    if (at.tag === "object") {
      const child = runtime.ownedObjectField(obj, at.index, label);
      try { return codec.lift(child, label); }
      finally { runtime.exports.vir_obj_dec(child); }
    }
    const ptr = runtime.exports.vir_obj_ctor_scalar_data(obj, at.tag === "usize" ? 0 : storage.usizeFieldCount);
    if (ptr === 0) throw new Error(`${label} scalar field is unavailable`);
    if (at.tag === "usize") return new DataView(runtime.exports.memory.buffer, ptr, storage.usizeFieldCount * 4).getUint32(at.index * 4, true);
    return codec.scalar.read(new DataView(runtime.exports.memory.buffer, ptr, storage.scalarByteSize), at.offset, at.size, label);
  }
  let liftObjects;
  if (lowerObjects !== undefined) {
    // These readers contain the bound codec and physical slot, with no location
    // interpretation in the hot path. Each acquired child is still released.
    const readers = fields.map(entry => {
      const { field, codec } = entry;
      const index = field.location.index, name = field.name;
      return { ...entry, lift(obj, label) {
        const fieldLabel = `${label}.${name}`;
        const child = runtime.ownedObjectField(obj, index, fieldLabel);
        try { return codec.lift(child, fieldLabel); }
        finally { runtime.exports.vir_obj_dec(child); }
      } };
    });
    if (single) {
      const first = readers[0];
      liftObjects = (obj, label) => build(first.lift(obj, label));
    } else if (readers.length === 1) {
      const first = readers[0];
      liftObjects = (obj, label) => {
        const output = { ...outputTemplate };
        append(output, first, first.lift(obj, label)); return build(output);
      };
    } else {
      const [first, second] = readers;
      liftObjects = (obj, label) => {
        const output = { ...outputTemplate };
        append(output, first, first.lift(obj, label));
        append(output, second, second.lift(obj, label)); return build(output);
      };
    }
  }
  return {
    lower: lowerObjects ?? ((index, value, label, scratch) => {
      const objects = Array(storage.objectFieldCount).fill(0);
      const usize = objectOnly ? null : Array(storage.usizeFieldCount).fill(0n);
      const bytes = objectOnly ? null : new Uint8Array(storage.scalarByteSize);
      const scalars = objectOnly ? null : new DataView(bytes.buffer);
      try {
        for (const entry of fields) {
          const at = entry.field.location, child = entry.read(value);
          const fieldLabel = `${label}.${entry.field.name}`;
          if (at.tag === "object") objects[at.index] = entry.codec.lower(child, fieldLabel, scratch);
          else if (at.tag === "usize") usize[at.index] = normalizeBoundedUnsignedBigInt(child, fieldLabel, 0xffffffffn, "USize");
          else entry.codec.scalar.write(scalars, at.offset, at.size, child, fieldLabel);
        }
        return objectOnly ? scratch.createObjects(index, objects, label)
          : scratch.create(index, { objectFields: objects, usizeFields: usize, scalarBytes: bytes }, label);
      } finally { runtime.releaseOwnedObjects(objects); }
    }),
    lift: liftObjects ?? (single ? (obj, label) => build(liftField(fields[0], obj, label))
      : (obj, label) => {
          const output = { ...outputTemplate };
          for (const entry of fields)
            append(output, entry, liftField(entry, obj, `${label}.${entry.field.name}`));
          return build(output);
        }),
  };
}

function compileChain(runtime, constructors, view, scope, compile) {
  const { nil, cons, head, tail } = view.chain ?? {};
  const empty = constructors[nil], cell = constructors[cons];
  if (constructors.length !== 2 || empty?.representation !== "immediate" || cell?.representation !== "object" ||
      cell.fields.length !== 2 || head === tail || !cell.fields[head] || !cell.fields[tail] ||
      !Object.hasOwn(cell.fields[tail].type, "ref") || cell.fields[tail].type.ref !== 0 ||
      cell.storage.objectFieldCount !== 2 ||
      cell.storage.usizeFieldCount !== 0 || cell.storage.scalarByteSize !== 0 ||
      !cell.fields.every(field => field.location.tag === "object")) throw new Error("unsupported chain traversal");
  const element = compile(cell.fields[head].type, view.element, scope);
  const headIndex = cell.fields[head].location.index, tailIndex = cell.fields[tail].location.index;
  return {
    lower(value, label, scratch) {
      requireArray(value, label);
      let cursor = runtime.makeObjectScalar(nil, label);
      try {
        for (let i = value.length - 1; i >= 0; i--) {
          const objects = [0, 0];
          try {
            objects[headIndex] = element.lower(value[i], `${label}[${i}]`, scratch);
            objects[tailIndex] = cursor; cursor = 0;
            cursor = scratch.createObjects(cons, objects, label);
          } finally { runtime.releaseOwnedObjects(objects); }
        }
        const result = cursor; cursor = 0; return result;
      } finally { if (cursor !== 0) runtime.exports.vir_obj_dec(cursor); }
    },
    lift: (obj, label) => runtime.liftObjectConstructorList(obj, label,
      (child, index) => element.lift(child, `${label}[${index}]`),
      { nilTag: nil, consTag: cons, headIndex, tailIndex }),
  };
}

function requireArray(value, label) { if (!Array.isArray(value)) throw new Error(`${label} must be an array`); }
function requireRecord(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a record`);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error(`${label}.${key} is unexpected`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is missing`);
}
function own(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
