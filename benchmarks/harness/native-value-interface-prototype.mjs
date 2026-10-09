/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { compileConstructorValueInterface } from "./constructor-value-interface-prototype.mjs";
import {
  normalizeDecimal, normalizeInteger,
} from "../../web/src/runtime/primitive-value-normalizers.js";

// Experimental binding of the draft native/value pair. Runtime allocation and
// ownership operations are reused; no intermediate tree of normalized values
// is built. This is benchmark code, not a public raw-object API.
export function compileNativeValueInterface(runtime, native, view, bindings = []) {
  if ("ref" in native) {
    if (view.tag !== "recursive" || bindings[native.ref] === undefined)
      throw new Error("unbound recursive interface");
    return bindings[native.ref];
  }
  const type = native.type;
  const codec = {};
  const compile = (type, value, scope = bindings) =>
    compileNativeValueInterface(runtime, type, value, scope);
  const expect = tag => {
    if (view.tag !== tag) throw new Error(`${type.tag} requires ${tag} view`);
  };
  switch (type.tag) {
    case "nat":
    case "int": {
      if (!["bigint", "safeInteger"].includes(view.tag)) throw new Error("integer view required");
      const safe = view.tag === "safeInteger", signed = type.tag === "int";
      codec.lower = (value, label) => {
        if (safe && !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
        return runtime.makeObjectDecimal(signed ? "vir_obj_int" : "vir_obj_nat",
          normalizeDecimal(value, label, { signed }), label);
      };
      codec.lift = (obj, label) => {
        const value = signed ? BigInt(runtime.readObjectDecimal(obj, "vir_obj_int_decimal"))
          : runtime.readObjectNat(obj);
        if (!safe) return value;
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error(`${label} exceeds safe integer range`);
        return number;
      };
      break;
    }
    case "string":
      expect("string");
      codec.lower = (value, label) => runtime.makeObjectString(value, label);
      codec.lift = obj => runtime.readObjectString(obj);
      break;
    case "byteArray":
      expect("bytes");
      codec.lower = (value, label) => runtime.makeObjectByteArray(value, label);
      codec.lift = obj => runtime.readObjectByteArray(obj);
      break;
    case "resource":
      expect("jsReference");
      codec.lower = (value, label) => runtime.makeObjectResource(value, label);
      codec.lift = (obj, label) => runtime.liftObjectResource(obj, label);
      break;
    case "unsigned": {
      const width = type.width;
      expect(width === 64 ? "bigint" : "number");
      if (width === "usize") runtime.requireWasm32USize();
      if (width === 8 || width === 16) {
        codec.lower = (value, label) => runtime.makeObjectScalar(
          normalizeInteger(value, label, 0, 2 ** width - 1), label);
        codec.lift = (obj, label) => runtime.readBoundedObjectScalar(obj, label, 2 ** width - 1);
      } else {
        const suffix = width === "usize" ? "USize" : `Uint${width}`;
        codec.lower = (value, label) => runtime[`makeObject${suffix}`](value, label);
        codec.lift = obj => width === 64 ? BigInt.asUintN(64, runtime.exports.vir_obj_uint64_value(obj))
          : runtime.exports[width === "usize" ? "vir_obj_usize_value" : "vir_obj_uint32_value"](obj) >>> 0;
      }
      // Packed scalar storage uses the same validation as an object boundary.
      codec.scalar = unsignedScalar(width === "usize" ? 32 : width);
      break;
    }
    case "float": {
      expect("number");
      const single = type.width === 32;
      codec.lower = (value, label) => single ? runtime.makeObjectFloat32(value, label)
        : runtime.makeObjectFloat(value, label);
      codec.lift = obj => single ? Math.fround(runtime.exports.vir_obj_float32_value(obj))
        : runtime.exports.vir_obj_float_value(obj);
      codec.scalar = {
        write(bytes, offset, _size, value, label) {
          if (typeof value !== "number") throw new Error(`${label} must be a number`);
          bytes[single ? "setFloat32" : "setFloat64"](offset, value, true);
        },
        read: (bytes, offset) => bytes[single ? "getFloat32" : "getFloat64"](offset, true),
      };
      break;
    }
    case "leanObject": {
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
        throw new Error(`prototype does not bind object view ${view.tag}`);
      if (constructors === undefined) throw new Error("structural codec requires constructor metadata");
      const scope = [codec, ...bindings];
      if (["unit", "boolean", "enum"].includes(view.tag)) {
        if (!constructors.every(ctor => ctor.representation === "immediate"))
          throw new Error("scalar views require immediate constructors");
        const scalar = immediateView(constructors, view);
        // Ask the native allocator for these constants once. Immediate values
        // own no heap references and survive memory growth; no pointer encoding
        // is reproduced in JS. Membership checks reject heap objects as well as
        // unknown ordinals, without two Wasm unboxing calls per value.
        const objects = constructors.map((_ctor, index) =>
          runtime.makeObjectScalar(index, "immediate constructor binding"));
        const ordinals = new Map(objects.map((obj, index) => [obj, index]));
        codec.lower = (value, label) => objects[scalar.encode(value, label)];
        codec.lift = (obj, label) => {
          const index = ordinals.get(obj);
          if (index === undefined) throw new Error(`${label} constructor is out of range`);
          return scalar.decode(index, label);
        };
        codec.scalar = {
          write: (bytes, offset, size, value, label) => writeOrdinal(bytes, offset, size, scalar.encode(value, label)),
          read: (bytes, offset, size, label) => scalar.decode(readOrdinal(bytes, offset, size), label),
        };
      } else if (view.tag === "sequence") {
        Object.assign(codec, compileChain(runtime, constructors, view, scope, compile));
      } else if (view.tag === "variant") {
        const shape = compileConstructorValueInterface(native, view);
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
          const index = runtime.exports.vir_obj_tag(obj);
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
    default: throw new Error(`prototype does not bind ${type.tag}`);
  }
  return Object.freeze(codec);
}

function constructorKernel(runtime, ctor, mappings, scope, compile, reader, single, build) {
  if (mappings.length !== ctor.fields.length) throw new Error("view must cover native fields");
  const used = new Set(), keys = new Set();
  const fields = mappings.map((mapping, index) => {
    const path = mapping.path;
    if (path.length !== 1 || !Number.isInteger(path[0]) || !ctor.fields[path[0]] || used.has(path[0]))
      throw new Error("prototype requires distinct immediate field paths");
    if (mapping.key !== undefined && keys.has(mapping.key)) throw new Error("duplicate field key");
    used.add(path[0]); keys.add(mapping.key);
    const field = ctor.fields[path[0]];
    const codec = compile(field.type, mapping.value, scope);
    return { field, codec, read: reader(mapping.key), key: mapping.key };
  });
  // Spread creates writable own data properties even for __proto__. Subsequent
  // writes hit those properties, never a setter inherited from Object.prototype.
  // The template and its property descriptors are prepared once, not per node.
  const outputTemplate = single ? null
    : Object.freeze(Object.fromEntries(fields.map(entry => [entry.key, undefined])));
  if (ctor.representation === "immediate") return {
    lower: (index, _value, label) => runtime.makeObjectScalar(index, label),
    lift: () => build(undefined),
  };
  if (ctor.representation === "identity") return {
    lower: (_index, value, label, scratch) => fields[0].codec.lower(fields[0].read(value), label, scratch),
    lift(obj, label) {
      const value = fields[0].codec.lift(obj, label);
      if (single) return build(value);
      const output = { ...outputTemplate }; output[fields[0].key] = value; return build(output);
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
    const readers = fields.map(({ field, codec, key }) => {
      const index = field.location.index, name = field.name;
      return { key, lift(obj, label) {
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
        output[first.key] = first.lift(obj, label); return build(output);
      };
    } else {
      const [first, second] = readers;
      liftObjects = (obj, label) => {
        const output = { ...outputTemplate };
        output[first.key] = first.lift(obj, label);
        output[second.key] = second.lift(obj, label); return build(output);
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
          else if (at.tag === "usize") usize[at.index] = BigInt(normalizeInteger(child, fieldLabel, 0, 0xffffffff));
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
            output[entry.key] = liftField(entry, obj, `${label}.${entry.field.name}`);
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

function immediateView(constructors, view) {
  const count = constructors.length;
  let encode, decode;
  if (view.tag === "unit") {
    if (count !== 1) throw new Error("unit requires one constructor");
    encode = (value, label) => { if (value !== undefined && value !== null) throw new Error(`${label} must be Unit`); return 0; };
    decode = () => undefined;
  } else if (view.tag === "boolean") {
    const no = view.false, yes = view.true;
    if (count !== 2 || ![0, 1].includes(no) || yes !== 1 - no) throw new Error("invalid boolean mapping");
    encode = (value, label) => { if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`); return value ? yes : no; };
    decode = value => value === yes;
  } else {
    const names = [...view.cases], ordinals = new Map(names.map((name, index) => [name, index]));
    if (names.length !== count || ordinals.size !== count || names.some(name => typeof name !== "string" || !name)) throw new Error("invalid enum mapping");
    encode = (value, label) => { const index = ordinals.get(value); if (index === undefined) throw new Error(`${label} has unknown enum value`); return index; };
    decode = value => names[value];
  }
  return { encode, decode(index, label) {
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`${label} constructor is out of range`);
    return decode(index);
  } };
}

function unsignedScalar(width) {
  const max = width === 64 ? 0xffffffffffffffffn : 2 ** width - 1;
  return {
    write(bytes, offset, _size, value, label) {
      if (width === 64) {
        const n = BigInt(normalizeDecimal(value, label, { signed: false }));
        if (n > max) throw new Error(`${label} exceeds UInt64 range`);
        bytes.setBigUint64(offset, n, true);
      } else bytes[`setUint${width}`](offset, normalizeInteger(value, label, 0, max), true);
    },
    read: (bytes, offset) => bytes[width === 64 ? "getBigUint64" : `getUint${width}`](offset, true),
  };
}
function writeOrdinal(bytes, offset, size, value) {
  if (size === 8) bytes.setBigUint64(offset, BigInt(value), true);
  else bytes[`setUint${size * 8}`](offset, value, true);
}
function readOrdinal(bytes, offset, size) {
  return size === 8 ? Number(bytes.getBigUint64(offset, true)) : bytes[`getUint${size * 8}`](offset, true);
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
