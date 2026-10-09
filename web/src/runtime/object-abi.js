/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { normalizeUint32 } from "./vir-codec.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import { enumValue, normalizeEnum } from "./vir-value-normalizers.js";
import {
  normalizeBoundedUnsignedBigInt,
  normalizeFloat,
  normalizeInteger,
} from "./primitive-value-normalizers.js";
import { trivialStructureField } from "./object-boundary.js";

const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
const objectLayoutPlanCache = new WeakMap();
// Zero-sized scalar/usize buffers contain no mutable slots. Object references
// always get fresh owned slots, even for constructors with no scalar storage.
const emptyUSizeFields = Object.freeze([]);
const emptyScalarBytes = new Uint8Array(0);

export function objectArgumentSupported(type, bindings = []) {
  return objectTypeSupported(type, false, bindings);
}

export function objectResultSupported(type, bindings = []) {
  return objectTypeSupported(type, true, bindings);
}

// One descriptor traversal; automatic functions are results only. These helpers
// consume admitted descriptors, not another independently validated type grammar.
function objectTypeSupported(type, isResult, bindings) {
  const fieldSupported = isResult ? objectResultSupported : objectArgumentSupported;
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_REF:
      return type.depth < bindings.length;
    case INTERFACE_TAG.FUNCTION:
      return isResult;
    case INTERFACE_TAG.UNIT:
    case INTERFACE_TAG.RESOURCE:
    case INTERFACE_TAG.BOOL:
    case INTERFACE_TAG.NAT:
    case INTERFACE_TAG.INT:
    case INTERFACE_TAG.STRING:
    case INTERFACE_TAG.UINT8:
    case INTERFACE_TAG.UINT16:
    case INTERFACE_TAG.UINT32:
    case INTERFACE_TAG.UINT64:
    case INTERFACE_TAG.USIZE:
    case INTERFACE_TAG.BYTE_ARRAY:
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
    case INTERFACE_TAG.EXPR:
    case INTERFACE_TAG.SIMPLE_ENUM:
      return true;
    case INTERFACE_TAG.ARRAY:
      return fieldSupported(type.element, bindings);
    case INTERFACE_TAG.STRUCTURE:
      return objectStructureSupported(type, fieldSupported, bindings);
    case INTERFACE_TAG.TAGGED_UNION:
      return objectTaggedUnionSupported(type, fieldSupported, bindings);
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return objectCustomInductiveSupported(type, fieldSupported, bindings);
    default:
      return false;
  }
}

function objectStructureSupported(type, fieldSupported, bindings) {
  const fields = type.fields;
  const trivial = trivialStructureField(type, fields);
  if (trivial !== null) {
    return fieldSupported(trivial.type, [type, ...bindings]);
  }
  return objectLayoutSupported(type, fieldSupported, [type, ...bindings]);
}

function objectTaggedUnionSupported(type, fieldSupported, bindings) {
  // The constructor owns storage, but its payload retains the enclosing recursive type.
  return type.constructors.every((ctor) =>
    objectLayoutSupported(ctor, fieldSupported, bindings));
}

function objectCustomInductiveSupported(type, fieldSupported, bindings) {
  return type.constructors.every((ctor) => {
    if (ctor.fields.length === 0) {
      const counts = objectRuntimeCounts(ctor, "object custom inductive");
      return counts.objectFieldCount === 0 && counts.usizeFieldCount === 0 && counts.scalarByteSize === 0;
    }
    return objectLayoutSupported(ctor, fieldSupported, [type, ...bindings]);
  });
}

function objectLayoutSupported(owner, fieldSupported, bindings) {
  let plan;
  try {
    plan = objectLayoutPlan(owner, "object layout");
  } catch {
    return false;
  }
  return plan.fields.every((fieldPlan) => objectFieldPlanSupported(fieldPlan, fieldSupported, bindings));
}

function objectFieldPlanSupported(fieldPlan, fieldSupported, bindings) {
  const field = fieldPlan.field;
  switch (fieldPlan.kind) {
    case "object":
      return fieldSupported(field.type, bindings);
    case "usize":
      return field.type?.interfaceTag === INTERFACE_TAG.USIZE;
    case "scalar":
      return objectScalarFieldSupported(field.type, field.layout);
    default:
      return false;
  }
}

export function objectLayoutSlotsFromPlan(plan) {
  // Slots own per-call Lean references. Cache metadata, never these mutable buffers.
  return {
    objectFields: Array(plan.objectFieldCount).fill(0),
    usizeFields: plan.usizeFieldCount === 0 ? emptyUSizeFields : Array(plan.usizeFieldCount).fill(0n),
    scalarBytes: plan.scalarByteSize === 0 ? emptyScalarBytes : new Uint8Array(plan.scalarByteSize),
  };
}

export function objectLayoutPlan(owner, label) {
  // A structure/custom constructor owns fields; a Sum/Except constructor owns
  // one payload. Derive that layout only on a cache miss from the admitted owner.
  const cached = objectLayoutPlanCache.get(owner);
  if (cached !== undefined) return cached;

  const counts = objectRuntimeCounts(owner, label);
  const fields = owner.fields ?? [{
    name: owner.jsName, type: owner.type, layout: owner.layout,
  }];
  const fieldPlans = [];
  const seenObjects = new Set();
  const seenUSize = new Set();
  const seenScalarBytes = new Set();
  for (const field of fields) {
    const fieldLabel = `${label}.${field.name ?? "field"}`;
    switch (field.layout.kind) {
      case "object": {
        const index = objectLayoutIndex(counts, field.layout);
        if (index === null) {
          throw new Error(`${fieldLabel} has unsupported object ABI layout`);
        }
        if (seenObjects.has(index)) {
          throw new Error(`${fieldLabel} duplicates object field index ${index}`);
        }
        seenObjects.add(index);
        fieldPlans.push({ field, kind: "object", index });
        break;
      }
      case "usize": {
        const index = usizeLayoutIndex(counts, field.layout);
        if (index === null) {
          throw new Error(`${fieldLabel} has unsupported object ABI layout`);
        }
        if (seenUSize.has(index)) {
          throw new Error(`${fieldLabel} duplicates USize field index ${field.layout.index}`);
        }
        seenUSize.add(index);
        fieldPlans.push({ field, kind: "usize", index });
        break;
      }
      case "scalar": {
        const offset = scalarLayoutOffset(field.layout, counts.scalarByteSize, fieldLabel);
        for (let index = field.layout.offset; index < field.layout.offset + field.layout.size; index++) {
          if (seenScalarBytes.has(index)) {
            throw new Error(`${fieldLabel} overlaps scalar byte ${index}`);
          }
          seenScalarBytes.add(index);
        }
        fieldPlans.push({ field, kind: "scalar", offset });
        break;
      }
      default:
        throw new Error(`${fieldLabel} has unsupported object ABI layout`);
    }
  }
  const plan = {
    objectFieldCount: counts.objectFieldCount,
    usizeFieldCount: counts.usizeFieldCount,
    scalarByteSize: counts.scalarByteSize,
    fields: fieldPlans,
  };
  objectLayoutPlanCache.set(owner, plan);
  return plan;
}

function objectRuntimeCounts(owner, label) {
  const objectFieldCount = owner?.objectFieldCount;
  const usizeFieldCount = owner?.usizeFieldCount;
  const scalarByteSize = owner?.scalarByteSize;
  if (
    !Number.isInteger(objectFieldCount) || objectFieldCount < 0 ||
    !Number.isInteger(usizeFieldCount) || usizeFieldCount < 0 ||
    !Number.isInteger(scalarByteSize) || scalarByteSize < 0
  ) {
    throw new Error(`${label} has unsupported object ABI runtime counts`);
  }
  return { objectFieldCount, usizeFieldCount, scalarByteSize };
}

function objectLayoutIndex(counts, layout) {
  if (!Number.isInteger(layout.index)) {
    return null;
  }
  return layout.index >= 0 && layout.index < counts.objectFieldCount ? layout.index : null;
}

function usizeLayoutIndex(counts, layout) {
  if (!Number.isInteger(layout.index)) {
    return null;
  }
  // Native indices include the object-field prefix; the USize buffer does not.
  const index = layout.index - counts.objectFieldCount;
  return index >= 0 && index < counts.usizeFieldCount ? index : null;
}

function scalarLayoutOffset(layout, scalarByteSize, label) {
  if (
    layout?.kind !== "scalar" ||
    !Number.isInteger(layout.offset) ||
    !Number.isInteger(layout.size) ||
    layout.offset < 0 ||
    layout.size <= 0 ||
    layout.offset + layout.size > scalarByteSize
  ) {
    throw new Error(`${label} has unsupported object ABI scalar layout`);
  }
  return layout.offset;
}

function objectScalarFieldSupported(type, layout) {
  if (layout?.kind !== "scalar") {
    return false;
  }
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.BOOL:
    case INTERFACE_TAG.SIMPLE_ENUM:
      return [1, 2, 4, 8].includes(layout.size);
    case INTERFACE_TAG.UINT8:
      return layout.size === 1;
    case INTERFACE_TAG.UINT16:
      return layout.size === 2;
    case INTERFACE_TAG.UINT32:
    case INTERFACE_TAG.FLOAT32:
      return layout.size === 4;
    case INTERFACE_TAG.UINT64:
    case INTERFACE_TAG.FLOAT:
      return layout.size === 8;
    default:
      return false;
  }
}

export function writeObjectScalarField(bytes, type, layout, value, label, offset = null) {
  offset ??= scalarLayoutOffset(layout, bytes.byteLength, label);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.BOOL:
      if (typeof value !== "boolean") {
        throw new Error(`${label} must be a boolean`);
      }
      writeScalarUnsigned(view, offset, layout.size, value ? 1n : 0n, label);
      return;
    case INTERFACE_TAG.UINT8:
      requireScalarSize(layout, 1, label);
      view.setUint8(offset, normalizeInteger(value, label, 0, 0xff));
      return;
    case INTERFACE_TAG.UINT16:
      requireScalarSize(layout, 2, label);
      view.setUint16(offset, normalizeInteger(value, label, 0, 0xffff), true);
      return;
    case INTERFACE_TAG.UINT32:
      requireScalarSize(layout, 4, label);
      view.setUint32(offset, normalizeUint32(value, label), true);
      return;
    case INTERFACE_TAG.UINT64:
      requireScalarSize(layout, 8, label);
      view.setBigUint64(offset, normalizeBoundedUnsignedBigInt(value, label, MAX_UINT64, "UInt64"), true);
      return;
    case INTERFACE_TAG.FLOAT:
      requireScalarSize(layout, 8, label);
      view.setFloat64(offset, normalizeFloat(value, label), true);
      return;
    case INTERFACE_TAG.FLOAT32:
      requireScalarSize(layout, 4, label);
      view.setFloat32(offset, Math.fround(normalizeFloat(value, label)), true);
      return;
    case INTERFACE_TAG.SIMPLE_ENUM:
      writeScalarUnsigned(view, offset, layout.size, BigInt(normalizeEnum(value, type, label)), label);
      return;
    default:
      throw new Error(`${label} has unsupported object ABI scalar type`);
  }
}

export function readObjectScalarField(view, type, layout, label, offset = null) {
  offset ??= scalarLayoutOffset(layout, view.byteLength, label);
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.BOOL:
      return readScalarUnsigned(view, offset, layout.size, label) !== 0n;
    case INTERFACE_TAG.UINT8:
      requireScalarSize(layout, 1, label);
      return view.getUint8(offset);
    case INTERFACE_TAG.UINT16:
      requireScalarSize(layout, 2, label);
      return view.getUint16(offset, true);
    case INTERFACE_TAG.UINT32:
      requireScalarSize(layout, 4, label);
      return view.getUint32(offset, true);
    case INTERFACE_TAG.UINT64:
      requireScalarSize(layout, 8, label);
      return view.getBigUint64(offset, true);
    case INTERFACE_TAG.FLOAT:
      requireScalarSize(layout, 8, label);
      return view.getFloat64(offset, true);
    case INTERFACE_TAG.FLOAT32:
      requireScalarSize(layout, 4, label);
      return Math.fround(view.getFloat32(offset, true));
    case INTERFACE_TAG.SIMPLE_ENUM: {
      const tag = readScalarUnsigned(view, offset, layout.size, label);
      if (tag > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${label} enum tag is too large for JavaScript`);
      }
      return enumValue(type, Number(tag));
    }
    default:
      throw new Error(`${label} has unsupported object ABI scalar type`);
  }
}

function requireScalarSize(layout, expected, label) {
  if (layout.size !== expected) {
    throw new Error(`${label} has scalar size ${layout.size}, expected ${expected}`);
  }
}

function writeScalarUnsigned(view, offset, size, value, label) {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  switch (size) {
    case 1:
      if (normalized > 0xffn) throw new Error(`${label} exceeds UInt8 scalar field size`);
      view.setUint8(offset, Number(normalized));
      return;
    case 2:
      if (normalized > 0xffffn) throw new Error(`${label} exceeds UInt16 scalar field size`);
      view.setUint16(offset, Number(normalized), true);
      return;
    case 4:
      if (normalized > MAX_UINT32) throw new Error(`${label} exceeds UInt32 scalar field size`);
      view.setUint32(offset, Number(normalized), true);
      return;
    case 8:
      if (normalized > MAX_UINT64) throw new Error(`${label} exceeds UInt64 scalar field size`);
      view.setBigUint64(offset, normalized, true);
      return;
    default:
      throw new Error(`${label} has unsupported scalar field size ${size}`);
  }
}

function readScalarUnsigned(view, offset, size, label) {
  switch (size) {
    case 1:
      return BigInt(view.getUint8(offset));
    case 2:
      return BigInt(view.getUint16(offset, true));
    case 4:
      return BigInt(view.getUint32(offset, true));
    case 8:
      return view.getBigUint64(offset, true);
    default:
      throw new Error(`${label} has unsupported scalar field size ${size}`);
  }
}
