/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  normalizeUint32,
  requireCustomInductiveConstructors,
  requireFunctionArgs,
  requireFunctionResult,
  requireStructureFields,
  requireTaggedUnionConstructors,
  requireTypeField,
} from "./vir-codec.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import {
  enumValue,
  normalizeBoundedUnsignedBigInt,
  normalizeEnum,
  normalizeFloat,
  normalizeInteger,
} from "./vir-value-normalizers.js";

const MAX_UINT32 = 0xffffffffn;
const MAX_UINT64 = 0xffffffffffffffffn;
const objectLayoutPlanCache = new WeakMap();

export const OBJECT_VALUE_EXPORTS = [
  "vir_obj_array",
  "vir_obj_array_get",
  "vir_obj_array_size",
  "vir_obj_byte_array",
  "vir_obj_byte_array_data",
  "vir_obj_byte_array_size",
  "vir_obj_ctor",
  "vir_obj_ctor_layout",
  "vir_obj_ctor_scalar_data",
  "vir_obj_ctor_usize_decimal",
  "vir_obj_closure_root",
  "vir_obj_decimal_size",
  "vir_obj_expr_app",
  "vir_obj_expr_bvar",
  "vir_obj_expr_const",
  "vir_obj_expr_forall",
  "vir_obj_expr_fvar",
  "vir_obj_expr_lambda",
  "vir_obj_expr_let",
  "vir_obj_expr_lit",
  "vir_obj_expr_mvar",
  "vir_obj_expr_proj",
  "vir_obj_expr_scalar_u8",
  "vir_obj_expr_sort",
  "vir_obj_field",
  "vir_obj_float",
  "vir_obj_float_value",
  "vir_obj_float32",
  "vir_obj_float32_value",
  "vir_obj_inc",
  "vir_obj_int",
  "vir_obj_int_decimal",
  "vir_obj_level_imax",
  "vir_obj_level_max",
  "vir_obj_level_mvar",
  "vir_obj_level_param",
  "vir_obj_level_succ",
  "vir_obj_level_zero",
  "vir_obj_list",
  "vir_obj_list_head",
  "vir_obj_list_is_nil",
  "vir_obj_list_tail",
  "vir_obj_literal_nat",
  "vir_obj_literal_string",
  "vir_obj_name_string",
  "vir_obj_name_string_size",
  "vir_obj_resource",
  "vir_obj_resource_externref",
  "vir_obj_nat",
  "vir_obj_nat_decimal",
  "vir_obj_is_scalar",
  "vir_obj_scalar",
  "vir_obj_scalar_value",
  "vir_obj_string",
  "vir_obj_string_data",
  "vir_obj_string_size",
  "vir_obj_tag",
  "vir_obj_uint32",
  "vir_obj_uint32_value",
  "vir_obj_uint64",
  "vir_obj_uint64_decimal",
  "vir_obj_usize",
  "vir_obj_usize_decimal",
];

export function objectArgumentSupported(type, selfType = null) {
  const tag = type?.interfaceTag;
  switch (tag) {
    case INTERFACE_TAG.RECURSIVE_SELF:
      return selfType !== null;
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
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      return objectArgumentSupported(requireTypeField(type, "element", "object argument"), selfType);
    case INTERFACE_TAG.PROD:
      return objectArgumentSupported(requireTypeField(type, "fst", "object argument"), selfType) &&
        objectArgumentSupported(requireTypeField(type, "snd", "object argument"), selfType);
    case INTERFACE_TAG.STRUCTURE:
      return objectStructureSupported(type, objectArgumentSupported);
    case INTERFACE_TAG.TAGGED_UNION:
      return objectTaggedUnionSupported(type, objectArgumentSupported);
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return objectCustomInductiveSupported(type, objectArgumentSupported);
    default:
      return false;
  }
}

export function objectResultSupported(type, selfType = null) {
  const tag = type?.interfaceTag;
  switch (tag) {
    case INTERFACE_TAG.RECURSIVE_SELF:
      return selfType !== null;
    case INTERFACE_TAG.UNIT:
    case INTERFACE_TAG.RESOURCE:
    case INTERFACE_TAG.FUNCTION:
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
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      return objectResultSupported(requireTypeField(type, "element", "object result"), selfType);
    case INTERFACE_TAG.PROD:
      return objectResultSupported(requireTypeField(type, "fst", "object result"), selfType) &&
        objectResultSupported(requireTypeField(type, "snd", "object result"), selfType);
    case INTERFACE_TAG.STRUCTURE:
      return objectStructureSupported(type, objectResultSupported);
    case INTERFACE_TAG.TAGGED_UNION:
      return objectTaggedUnionSupported(type, objectResultSupported);
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return objectCustomInductiveSupported(type, objectResultSupported);
    default:
      return false;
  }
}

export function hostWireArgumentSupported(type) {
  if (hostWireValueSupported(type)) {
    return true;
  }
  if (type?.interfaceTag !== INTERFACE_TAG.FUNCTION) {
    return false;
  }
  const args = requireFunctionArgs(type, "host wire callback");
  return args.every((arg) => hostWireValueSupported(arg.type)) &&
    hostWireValueSupported(requireFunctionResult(type, "host wire callback"));
}

export function hostWireResultSupported(type) {
  return hostWireValueSupported(type);
}

function hostWireValueSupported(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.UNIT:
    case INTERFACE_TAG.RESOURCE:
      return true;
    default:
      return false;
  }
}

export function objectTypeNeedsBoxedBoundary(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.FLOAT:
    case INTERFACE_TAG.FLOAT32:
    case INTERFACE_TAG.UINT64:
      return true;
    case INTERFACE_TAG.STRUCTURE: {
      const fields = requireStructureFields(type, "object boundary");
      const trivial = trivialStructureField(type, fields);
      return trivial !== null && objectTypeNeedsBoxedBoundary(trivial.type);
    }
    default:
      return false;
  }
}

function objectStructureSupported(type, fieldSupported) {
  const fields = requireStructureFields(type, "object structure");
  const trivial = trivialStructureField(type, fields);
  if (trivial !== null) {
    return fieldSupported(trivial.type, type);
  }
  return objectLayoutSupported(type, fields, fieldSupported, type);
}

function objectTaggedUnionSupported(type, fieldSupported) {
  return requireTaggedUnionConstructors(type, "object tagged union").every((ctor) =>
    objectLayoutSupported(ctor, [taggedUnionField(ctor)], fieldSupported, type));
}

function objectCustomInductiveSupported(type, fieldSupported) {
  return requireCustomInductiveConstructors(type, "object custom inductive").every((ctor) => {
    if (ctor.fields.length === 0) {
      const counts = objectRuntimeCounts(ctor, "object custom inductive");
      return counts.objectFieldCount === 0 && counts.usizeFieldCount === 0 && counts.scalarByteSize === 0;
    }
    return objectLayoutSupported(ctor, ctor.fields, fieldSupported, type);
  });
}

function objectLayoutSupported(owner, fields, fieldSupported, selfType) {
  let plan;
  try {
    plan = objectLayoutPlan(owner, fields, "object layout");
  } catch {
    return false;
  }
  return plan.fields.every((fieldPlan) => objectFieldPlanSupported(fieldPlan, fieldSupported, selfType));
}

function objectFieldPlanSupported(fieldPlan, fieldSupported, selfType) {
  const field = fieldPlan.field;
  switch (fieldPlan.kind) {
    case "object":
      return fieldSupported(field.type, selfType);
    case "usize":
      return field.type?.interfaceTag === INTERFACE_TAG.USIZE;
    case "scalar":
      return objectScalarFieldSupported(field.type, field.layout);
    default:
      return false;
  }
}

export function trivialStructureField(type, fields) {
  const index = type?.trivialFieldIndex;
  if (!Number.isInteger(index)) {
    return null;
  }
  if (index < 0 || index >= fields.length) {
    throw new Error(`${type?.type ?? "structure"} has invalid trivial field index`);
  }
  return fields[index];
}

export function taggedUnionField(ctor) {
  return {
    name: ctor.jsName,
    type: ctor.type,
    layout: ctor.layout,
  };
}

export function objectLayoutSlotsFromPlan(plan) {
  return {
    objectFields: Array(plan.objectFieldCount).fill(0),
    usizeFields: Array(plan.usizeFieldCount).fill(0n),
    scalarBytes: new Uint8Array(plan.scalarByteSize),
  };
}

export function objectLayoutPlan(owner, fields, label) {
  const cacheable = owner !== null && (typeof owner === "object" || typeof owner === "function");
  let cachedPlans;
  if (cacheable) {
    cachedPlans = objectLayoutPlanCache.get(owner);
    if (cachedPlans !== undefined) {
      for (const plan of cachedPlans) {
        if (objectLayoutPlanMatches(plan, fields)) {
          return plan;
        }
      }
    }
  }

  const counts = objectRuntimeCounts(owner, label);
  const fieldPlans = [];
  const seenObjects = new Set();
  const seenUSize = new Set();
  const seenScalarBytes = new Set();
  for (const field of fields) {
    const fieldLabel = `${label}.${field.name ?? "field"}`;
    switch (field.layout.kind) {
      case "object": {
        const index = objectLayoutIndex(owner, field.layout, fieldLabel);
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
        const index = usizeLayoutIndex(owner, field.layout, fieldLabel);
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
  if (!cacheable) {
    return plan;
  }
  if (cachedPlans === undefined) {
    objectLayoutPlanCache.set(owner, [plan]);
  } else {
    cachedPlans.push(plan);
  }
  return plan;
}

function objectLayoutPlanMatches(plan, fields) {
  if (plan.fields.length !== fields.length) {
    return false;
  }
  for (let index = 0; index < fields.length; index++) {
    if (!sameLayoutField(plan.fields[index].field, fields[index])) {
      return false;
    }
  }
  return true;
}

function sameLayoutField(lhs, rhs) {
  return lhs === rhs || (
    lhs?.name === rhs?.name &&
    lhs?.type === rhs?.type &&
    sameLayout(lhs?.layout, rhs?.layout)
  );
}

function sameLayout(lhs, rhs) {
  return lhs === rhs || (
    lhs?.kind === rhs?.kind &&
    lhs?.index === rhs?.index &&
    lhs?.offset === rhs?.offset &&
    lhs?.size === rhs?.size
  );
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

function objectLayoutIndex(owner, layout, label) {
  if (layout?.kind !== "object" || !Number.isInteger(layout.index)) {
    return null;
  }
  const { objectFieldCount } = objectRuntimeCounts(owner, label);
  return layout.index >= 0 && layout.index < objectFieldCount ? layout.index : null;
}

function usizeLayoutIndex(owner, layout, label) {
  if (layout?.kind !== "usize" || !Number.isInteger(layout.index)) {
    return null;
  }
  const { objectFieldCount, usizeFieldCount } = objectRuntimeCounts(owner, label);
  const index = layout.index - objectFieldCount;
  return index >= 0 && index < usizeFieldCount ? index : null;
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
      return view.getBigUint64(offset, true).toString();
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
