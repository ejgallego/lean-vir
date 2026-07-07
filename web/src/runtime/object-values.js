/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirCallback } from "./callbacks.js";
import {
  customInductiveConstructorAt,
  normalizeUint32,
  requireFunctionArgs,
  requireFunctionResult,
  requireStructureFields,
  requireTypeField,
  taggedUnionConstructorAt,
} from "./vir-codec.js";
import { interfaceEffectRuntimeTag } from "./interface-effects.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import {
  createHostResource,
  hostResourceValue,
  isHostResource,
  normalizeHostResource,
} from "../host-resource.js";
import {
  OBJECT_VALUE_EXPORTS,
  hostWireArgumentSupported,
  hostWireResultSupported,
  objectLayoutPlan,
  objectLayoutSlotsFromPlan,
  readObjectScalarField as readObjectScalarFieldValue,
  taggedUnionField,
  trivialStructureField,
  writeObjectScalarField,
} from "./object-abi.js";
import {
  asByteArrayBytes,
  enumValue,
  flattenStructureSubobjects,
  normalizeBoundedUnsignedDecimal,
  normalizeBoundedUnsignedBigInt,
  normalizeArray,
  normalizeCustomInductive,
  normalizeDecimal,
  normalizeEnum,
  normalizeFloat,
  normalizeInteger,
  normalizeOption,
  normalizePair,
  normalizeStructure,
  normalizeTaggedUnion,
} from "./vir-value-normalizers.js";

const textEncoder = new TextEncoder();
const MAX_UINT64 = 0xffffffffffffffffn;
const LEAN_OBJECT_HANDLE = Symbol("lean-vir.leanObjectHandle");

function normalizeObjectPointer(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a live Lean object pointer`);
  }
  return value >>> 0;
}

function releaseLeanObjectHandleCell(cell) {
  const onRelease = cell?.onRelease;
  if (cell !== null && cell !== undefined) {
    cell.onRelease = null;
  }
  if (cell?.live !== true) {
    if (typeof onRelease === "function") onRelease();
    return false;
  }
  cell.live = false;
  cell.runtime.exports.vir_obj_dec(cell.object);
  if (typeof onRelease === "function") onRelease();
  return true;
}

function requireLeanObjectHandleCell(resource, runtime, label) {
  const handle = hostResourceValue(resource);
  const cell = handle?.cell;
  if (handle?.[LEAN_OBJECT_HANDLE] !== true ||
      handle.runtime !== runtime ||
      cell?.runtime !== runtime ||
      cell.live !== true) {
    throw new Error(`${label} must be a live Lean object handle resource`);
  }
  normalizeObjectPointer(cell.object, label);
  return cell;
}

export class ObjectValueRuntime {
  hasObjectValueExports() {
    return this.hasObjectCallExports(...OBJECT_VALUE_EXPORTS);
  }

  makeHostWireObjectValue(type, value, label) {
    if (!hostWireResultSupported(type)) {
      throw new Error(`${label} has unsupported JavaScript host wire result type`);
    }
    return this.makeObjectValue(type, value, label);
  }

  makeExplicitConversionObjectValue(type, value, label) {
    return this.makeObjectValue(type, value, label);
  }

  makeObjectValue(type, value, label, selfType = null) {
    const tag = type?.interfaceTag;
    switch (tag) {
      case INTERFACE_TAG.RECURSIVE_SELF:
        if (selfType === null) {
          throw new Error(`${label} has a recursive self reference without an enclosing type`);
        }
        return this.makeObjectValue(selfType, value, label, selfType);
      case INTERFACE_TAG.UNIT:
        if (value !== undefined && value !== null) throw new Error(`${label} must be undefined or null`);
        return this.makeObjectScalar(0, label);
      case INTERFACE_TAG.RESOURCE:
        return this.makeObjectResource(value, label);
      case INTERFACE_TAG.FUNCTION:
        throw new Error(`${label} cannot be a JavaScript function at this boundary`);
      case INTERFACE_TAG.BOOL:
        if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
        return this.makeObjectScalar(value ? 1 : 0, label);
      case INTERFACE_TAG.UINT8:
        return this.makeObjectScalar(normalizeInteger(value, label, 0, 0xff), label);
      case INTERFACE_TAG.UINT16:
        return this.makeObjectScalar(normalizeInteger(value, label, 0, 0xffff), label);
      case INTERFACE_TAG.SIMPLE_ENUM:
        return this.makeObjectScalar(normalizeEnum(value, type, label), label);
      case INTERFACE_TAG.NAT:
        return this.makeObjectDecimal("vir_obj_nat", normalizeDecimal(value, label, { signed: false }), label);
      case INTERFACE_TAG.INT:
        return this.makeObjectDecimal("vir_obj_int", normalizeDecimal(value, label, { signed: true }), label);
      case INTERFACE_TAG.STRING:
        return this.makeObjectString(value, label);
      case INTERFACE_TAG.UINT32:
        return this.makeObjectUint32(value, label);
      case INTERFACE_TAG.UINT64:
        return this.makeObjectDecimal(
          "vir_obj_uint64",
          normalizeBoundedUnsignedDecimal(value, label, MAX_UINT64, "UInt64"),
          label,
        );
      case INTERFACE_TAG.USIZE:
        return this.makeObjectDecimal(
          "vir_obj_usize",
          normalizeBoundedUnsignedDecimal(value, label, this.usizeMaxValue(), "USize"),
          label,
        );
      case INTERFACE_TAG.BYTE_ARRAY:
        return this.makeObjectByteArray(value, label);
      case INTERFACE_TAG.FLOAT:
        return this.makeObjectFloat(value, label);
      case INTERFACE_TAG.FLOAT32:
        return this.makeObjectFloat32(value, label);
      case INTERFACE_TAG.EXPR:
        return this.makeObjectExpr(value, label);
      case INTERFACE_TAG.ARRAY:
      case INTERFACE_TAG.LIST:
        return this.makeObjectSequenceValue(type, value, label, selfType);
      case INTERFACE_TAG.OPTION:
        return this.makeObjectOptionValue(type, value, label, selfType);
      case INTERFACE_TAG.PROD:
        return this.makeObjectProdValue(type, value, label, selfType);
      case INTERFACE_TAG.STRUCTURE:
        return this.makeObjectStructureValue(type, value, label);
      case INTERFACE_TAG.TAGGED_UNION:
        return this.makeObjectTaggedUnionValue(type, value, label);
      case INTERFACE_TAG.CUSTOM_INDUCTIVE:
        return this.makeObjectCustomInductiveValue(type, value, label);
      default:
        throw new Error(`${label} has unsupported object ABI argument type`);
    }
  }

  makeObjectSequenceValue(sequenceType, value, label, selfType) {
    const sequenceTag = sequenceType?.interfaceTag;
    const builderName =
      sequenceTag === INTERFACE_TAG.ARRAY ? "vir_obj_array" :
      sequenceTag === INTERFACE_TAG.LIST ? "vir_obj_list" :
      null;
    if (builderName === null) {
      throw new Error(`${label} has unsupported object ABI sequence type`);
    }
    const values = normalizeArray(value, label);
    if (values.length > 0xffffffff) {
      throw new Error(`${label} has too many elements`);
    }

    const elementType = requireTypeField(sequenceType, "element", label);
    const elementObjs = [];
    try {
      for (let index = 0; index < values.length; index++) {
        elementObjs.push(this.makeObjectValue(elementType, values[index], `${label}[${index}]`, selfType));
      }
      return this.makeObjectSequenceFromOwnedElements(builderName, elementObjs, label);
    } finally {
      this.releaseOwnedObjects(elementObjs);
    }
  }

  makeObjectOptionValue(type, value, label, selfType) {
    const option = normalizeOption(value, label);
    if (!option.some) {
      return this.makeObjectScalar(0, label);
    }
    const fields = [
      this.makeObjectValue(requireTypeField(type, "element", label), option.value, `${label}.value`, selfType),
    ];
    try {
      return this.makeObjectCtorFromOwnedFields(1, fields, label);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  makeObjectProdValue(type, value, label, selfType) {
    const pair = normalizePair(value, label);
    const fields = [];
    try {
      fields.push(this.makeObjectValue(requireTypeField(type, "fst", label), pair.fst, `${label}.fst`, selfType));
      fields.push(this.makeObjectValue(requireTypeField(type, "snd", label), pair.snd, `${label}.snd`, selfType));
      return this.makeObjectCtorFromOwnedFields(0, fields, label);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  makeObjectStructureValue(type, value, label) {
    const fields = requireStructureFields(type, label);
    const record = normalizeStructure(value, fields, label);
    const trivial = trivialStructureField(type, fields);
    if (trivial !== null) {
      return this.makeObjectValue(trivial.type, record[trivial.name], `${label}.${trivial.name}`, type);
    }
    return this.makeObjectCtorFromLayout(0, type, fields, record, label, type);
  }

  makeObjectTaggedUnionValue(type, value, label) {
    const { index, ctor, payload } = normalizeTaggedUnion(value, type, label);
    const field = taggedUnionField(ctor);
    return this.makeObjectCtorFromLayout(index, ctor, [field], { [field.name]: payload }, label, type);
  }

  makeObjectCustomInductiveValue(type, value, label) {
    const { index, ctor, fields } = normalizeCustomInductive(value, type, label);
    if (ctor.fields.length === 0) {
      return this.makeObjectScalar(index, label);
    }
    return this.makeObjectCtorFromLayout(index, ctor, ctor.fields, fields, label, type);
  }

  makeObjectCtorFromLayout(tag, owner, fields, values, label, selfType) {
    const plan = objectLayoutPlan(owner, fields, label);
    const layout = objectLayoutSlotsFromPlan(plan);
    try {
      for (const fieldPlan of plan.fields) {
        const field = fieldPlan.field;
        this.writeObjectLayoutField(layout, fieldPlan, values[field.name], `${label}.${field.name}`, selfType);
      }
      return this.makeObjectCtorFromOwnedLayout(tag, layout, label);
    } finally {
      this.releaseOwnedObjects(layout.objectFields);
    }
  }

  writeObjectLayoutField(layout, fieldPlan, value, label, selfType) {
    const field = fieldPlan.field;
    switch (fieldPlan.kind) {
      case "object":
        layout.objectFields[fieldPlan.index] = this.makeObjectValue(field.type, value, label, selfType);
        return;
      case "usize":
        layout.usizeFields[fieldPlan.index] =
          normalizeBoundedUnsignedBigInt(value, label, this.usizeMaxValue(), "USize");
        return;
      case "scalar":
        writeObjectScalarField(layout.scalarBytes, field.type, field.layout, value, label, fieldPlan.offset);
        return;
      default:
        throw new Error(`${label} has unsupported object ABI layout`);
    }
  }

  makeObjectScalar(value, label) {
    const argObj = this.exports.vir_obj_scalar(value);
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean scalar object`);
    }
    return argObj;
  }

  makeObjectDecimal(constructorName, decimal, label) {
    const bytes = textEncoder.encode(decimal);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports[constructorName](inputPtr, bytes.byteLength);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean object`);
      }
      return argObj;
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectByteArray(value, label) {
    const bytes = asByteArrayBytes(value);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports.vir_obj_byte_array(inputPtr, bytes.byteLength);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean ByteArray object`);
      }
      return argObj;
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectString(value, label) {
    return this.withWasmString(value, label, (inputPtr, inputLen) => {
      const argObj = this.exports.vir_obj_string(inputPtr, inputLen);
      if (argObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean string object`);
      }
      return argObj;
    });
  }

  makeObjectStringConstructor(constructorName, value, stringLabel, objectLabel) {
    return this.withWasmString(requireString(value, stringLabel), stringLabel, (inputPtr, inputLen) => {
      const obj = this.exports[constructorName](inputPtr, inputLen);
      if (obj === 0) {
        throw new Error(`${objectLabel} could not be lowered to a Lean object`);
      }
      return obj;
    });
  }

  withWasmString(value, label, callback) {
    const bytes = textEncoder.encode(requireString(value, label));
    const inputPtr = this.allocBytes(bytes);
    try {
      return callback(inputPtr, bytes.byteLength);
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectUint32(value, label) {
    const argObj = this.exports.vir_obj_uint32(normalizeUint32(value, label));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean UInt32 object`);
    }
    return argObj;
  }

  makeObjectFloat(value, label) {
    const argObj = this.exports.vir_obj_float(normalizeFloat(value, label));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean Float object`);
    }
    return argObj;
  }

  makeObjectFloat32(value, label) {
    const argObj = this.exports.vir_obj_float32(Math.fround(normalizeFloat(value, label)));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean Float32 object`);
    }
    return argObj;
  }

  makeObjectResource(value, label) {
    const resource = normalizeHostResource(value, label);
    const argObj = this.exports.vir_obj_resource(resource);
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean host resource object`);
    }
    return argObj;
  }

  makeLeanObjectHandleResource(obj, label) {
    const object = normalizeObjectPointer(obj, label);
    this.exports.vir_obj_inc(object);
    const cell = {
      runtime: this,
      object,
      live: true,
      onRelease: null,
    };
    const handle = Object.freeze({
      [LEAN_OBJECT_HANDLE]: true,
      runtime: this,
      object,
      cell,
    });
    const resource = createHostResource(handle, label, {
      dispose: () => {
        releaseLeanObjectHandleCell(cell);
        return undefined;
      },
    });
    return resource;
  }

  leanObjectHandleCell(resource, label) {
    return requireLeanObjectHandleCell(resource, this, label);
  }

  releaseLeanObjectHandleCell(cell) {
    return releaseLeanObjectHandleCell(cell);
  }

  makeObjectExpr(value, label) {
    const expr = typeof value === "string"
      ? { kind: "const", name: value, levels: [] }
      : value;
    switch (expr?.kind) {
      case "bvar":
        return this.makeObjectDecimal(
          "vir_obj_expr_bvar",
          normalizeDecimal(expr.index ?? expr.deBruijnIndex, `${label}.index`, { signed: false }),
          label,
        );
      case "fvar":
        return this.makeObjectStringConstructor("vir_obj_expr_fvar", expr.name, `${label}.name`, label);
      case "mvar":
        return this.makeObjectStringConstructor("vir_obj_expr_mvar", expr.name, `${label}.name`, label);
      case "sort": {
        let level = this.makeObjectLevel(expr.level ?? expr.u, `${label}.level`);
        try {
          const obj = this.exports.vir_obj_expr_sort(level);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr sort object`);
          level = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([level]);
        }
      }
      case "const": {
        let levels = this.makeObjectLevelList(expr.levels ?? [], `${label}.levels`);
        try {
          return this.withWasmString(requireString(expr.name, `${label}.name`), `${label}.name`, (namePtr, nameLen) => {
            const obj = this.exports.vir_obj_expr_const(namePtr, nameLen, levels);
            if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr const object`);
            levels = 0;
            return obj;
          });
        } finally {
          this.releaseOwnedObjects([levels]);
        }
      }
      case "app":
        return this.makeObjectExprBinary("vir_obj_expr_app", expr.fn, `${label}.fn`, expr.arg, `${label}.arg`, label);
      case "lam":
      case "lambda":
        return this.makeObjectExprBinding(
          "vir_obj_expr_lambda",
          expr.name ?? expr.binderName,
          expr.type ?? expr.binderType,
          expr.body,
          normalizeBinderInfo(expr.binderInfo ?? "default", `${label}.binderInfo`),
          label,
        );
      case "forall":
      case "forallE":
        return this.makeObjectExprBinding(
          "vir_obj_expr_forall",
          expr.name ?? expr.binderName,
          expr.type ?? expr.binderType,
          expr.body,
          normalizeBinderInfo(expr.binderInfo ?? "default", `${label}.binderInfo`),
          label,
        );
      case "let":
      case "letE":
        return this.makeObjectExprLet(expr, label);
      case "lit": {
        let literal = this.makeObjectLiteral(expr.literal ?? expr.value, `${label}.literal`);
        try {
          const obj = this.exports.vir_obj_expr_lit(literal);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr literal object`);
          literal = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([literal]);
        }
      }
      case "mdata":
        return this.makeObjectExpr(expr.expr, `${label}.expr`);
      case "proj":
        return this.makeObjectExprProj(expr, label);
      default:
        throw new Error(`${label} has unsupported Lean.Expr kind ${expr?.kind}`);
    }
  }

  makeObjectLevel(value, label) {
    const level = typeof value === "string" ? { kind: value } : value ?? { kind: "zero" };
    switch (level.kind) {
      case "zero": {
        const obj = this.exports.vir_obj_level_zero();
        if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level zero object`);
        return obj;
      }
      case "succ": {
        let child = this.makeObjectLevel(level.of ?? level.level, `${label}.of`);
        try {
          const obj = this.exports.vir_obj_level_succ(child);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level succ object`);
          child = 0;
          return obj;
        } finally {
          this.releaseOwnedObjects([child]);
        }
      }
      case "max":
        return this.makeObjectLevelBinary(
          "vir_obj_level_max",
          level.left ?? level.lhs,
          `${label}.left`,
          level.right ?? level.rhs,
          `${label}.right`,
          label,
        );
      case "imax":
        return this.makeObjectLevelBinary(
          "vir_obj_level_imax",
          level.left ?? level.lhs,
          `${label}.left`,
          level.right ?? level.rhs,
          `${label}.right`,
          label,
        );
      case "param":
        return this.makeObjectStringConstructor("vir_obj_level_param", level.name, `${label}.name`, label);
      case "mvar":
        return this.makeObjectStringConstructor("vir_obj_level_mvar", level.name, `${label}.name`, label);
      default:
        throw new Error(`${label} has unsupported Lean.Level kind ${level.kind}`);
    }
  }

  makeObjectLevelList(levels, label) {
    const values = levels == null ? [] : normalizeArray(levels, label);
    const levelObjs = [];
    try {
      values.forEach((level, index) => {
        levelObjs.push(this.makeObjectLevel(level, `${label}[${index}]`));
      });
      return this.makeObjectSequenceFromOwnedElements("vir_obj_list", levelObjs, label);
    } finally {
      this.releaseOwnedObjects(levelObjs);
    }
  }

  makeObjectLiteral(value, label) {
    const literal =
      typeof value === "string" || typeof value === "number" || typeof value === "bigint"
        ? { kind: typeof value === "string" ? "string" : "nat", value }
        : value;
    switch (literal?.kind) {
      case "nat":
        return this.makeObjectDecimal(
          "vir_obj_literal_nat",
          normalizeDecimal(literal.value, `${label}.value`, { signed: false }),
          label,
        );
      case "string":
        return this.makeObjectStringConstructor("vir_obj_literal_string", literal.value, `${label}.value`, label);
      default:
        throw new Error(`${label} has unsupported Lean.Literal kind ${literal?.kind}`);
    }
  }

  makeObjectLevelBinary(constructorName, leftValue, leftLabel, rightValue, rightLabel, label) {
    let left = this.makeObjectLevel(leftValue, leftLabel);
    let right = 0;
    try {
      right = this.makeObjectLevel(rightValue, rightLabel);
      const obj = this.exports[constructorName](left, right);
      if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Level object`);
      left = 0;
      right = 0;
      return obj;
    } finally {
      this.releaseOwnedObjects([left, right]);
    }
  }

  makeObjectExprBinary(constructorName, leftValue, leftLabel, rightValue, rightLabel, label) {
    let left = this.makeObjectExpr(leftValue, leftLabel);
    let right = 0;
    try {
      right = this.makeObjectExpr(rightValue, rightLabel);
      const obj = this.exports[constructorName](left, right);
      if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr object`);
      left = 0;
      right = 0;
      return obj;
    } finally {
      this.releaseOwnedObjects([left, right]);
    }
  }

  makeObjectExprBinding(constructorName, name, typeValue, bodyValue, binderInfo, label) {
    let type = this.makeObjectExpr(typeValue, `${label}.type`);
    let body = 0;
    try {
      body = this.makeObjectExpr(bodyValue, `${label}.body`);
      return this.withWasmString(requireString(name, `${label}.name`), `${label}.name`, (namePtr, nameLen) => {
        const obj = this.exports[constructorName](namePtr, nameLen, type, body, binderInfo);
        if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr binding object`);
        type = 0;
        body = 0;
        return obj;
      });
    } finally {
      this.releaseOwnedObjects([type, body]);
    }
  }

  makeObjectExprLet(expr, label) {
    let type = this.makeObjectExpr(expr.type, `${label}.type`);
    let value = 0;
    let body = 0;
    try {
      value = this.makeObjectExpr(expr.value, `${label}.value`);
      body = this.makeObjectExpr(expr.body, `${label}.body`);
      return this.withWasmString(
        requireString(expr.name ?? expr.declName, `${label}.name`),
        `${label}.name`,
        (namePtr, nameLen) => {
          const obj = this.exports.vir_obj_expr_let(
            namePtr,
            nameLen,
            type,
            value,
            body,
            expr.nondep ? 1 : 0,
          );
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr let object`);
          type = 0;
          value = 0;
          body = 0;
          return obj;
        },
      );
    } finally {
      this.releaseOwnedObjects([type, value, body]);
    }
  }

  makeObjectExprProj(expr, label) {
    let structure = this.makeObjectExpr(expr.struct ?? expr.expr, `${label}.struct`);
    try {
      return this.withWasmString(requireString(expr.typeName, `${label}.typeName`), `${label}.typeName`, (
        typeNamePtr,
        typeNameLen,
      ) => this.withWasmString(
        normalizeDecimal(expr.index ?? expr.idx, `${label}.index`, { signed: false }),
        `${label}.index`,
        (indexPtr, indexLen) => {
          const obj = this.exports.vir_obj_expr_proj(typeNamePtr, typeNameLen, indexPtr, indexLen, structure);
          if (obj === 0) throw new Error(`${label} could not be lowered to a Lean.Expr proj object`);
          structure = 0;
          return obj;
        },
      ));
    } finally {
      this.releaseOwnedObjects([structure]);
    }
  }

  makeObjectSequenceFromOwnedElements(builderName, elementObjs, label) {
    let valuesPtr = 0;
    try {
      if (elementObjs.length !== 0) {
        valuesPtr = this.allocByteLength(elementObjs.length * 4, `${label} pointer array`);
        this.writePointerArray(valuesPtr, elementObjs);
      }
      const sequenceObj = this.exports[builderName](valuesPtr, elementObjs.length);
      if (sequenceObj === 0) {
        throw new Error(`${label} could not be lowered to a Lean sequence object`);
      }
      elementObjs.length = 0;
      return sequenceObj;
    } finally {
      if (valuesPtr !== 0) {
        this.freeBytes(valuesPtr);
      }
    }
  }

  makeObjectCtorFromOwnedFields(tag, fields, label) {
    let fieldsPtr = 0;
    try {
      if (fields.length !== 0) {
        fieldsPtr = this.allocByteLength(fields.length * 4, `${label} field pointer array`);
        this.writePointerArray(fieldsPtr, fields);
      }
      const obj = this.exports.vir_obj_ctor(tag, fieldsPtr, fields.length);
      if (obj === 0) {
        throw new Error(`${label} could not be lowered to a Lean constructor object`);
      }
      fields.length = 0;
      return obj;
    } finally {
      if (fieldsPtr !== 0) {
        this.freeBytes(fieldsPtr);
      }
    }
  }

  makeObjectCtorFromOwnedLayout(tag, layout, label) {
    let objectFieldsPtr = 0;
    let usizeFieldsPtr = 0;
    let scalarFieldsPtr = 0;
    try {
      if (layout.objectFields.length !== 0) {
        objectFieldsPtr = this.allocByteLength(layout.objectFields.length * 4, `${label} object field pointer array`);
        this.writePointerArray(objectFieldsPtr, layout.objectFields);
      }
      if (layout.usizeFields.length !== 0) {
        const pointerBytes = this.targetPointerBytes();
        usizeFieldsPtr = this.allocByteLength(
          layout.usizeFields.length * pointerBytes,
          `${label} usize field array`,
        );
        const view = new DataView(this.exports.memory.buffer, usizeFieldsPtr, layout.usizeFields.length * pointerBytes);
        for (let index = 0; index < layout.usizeFields.length; index++) {
          const value = layout.usizeFields[index];
          if (pointerBytes === 4) {
            view.setUint32(index * pointerBytes, Number(value), true);
          } else {
            view.setBigUint64(index * pointerBytes, value, true);
          }
        }
      }
      if (layout.scalarBytes.byteLength !== 0) {
        scalarFieldsPtr = this.allocBytes(layout.scalarBytes);
      }
      const obj = this.exports.vir_obj_ctor_layout(
        tag,
        objectFieldsPtr,
        layout.objectFields.length,
        usizeFieldsPtr,
        layout.usizeFields.length,
        scalarFieldsPtr,
        layout.scalarBytes.byteLength,
      );
      if (obj === 0) {
        throw new Error(`${label} could not be lowered to a Lean constructor object`);
      }
      layout.objectFields.length = 0;
      return obj;
    } finally {
      if (objectFieldsPtr !== 0) {
        this.freeBytes(objectFieldsPtr);
      }
      if (usizeFieldsPtr !== 0) {
        this.freeBytes(usizeFieldsPtr);
      }
      if (scalarFieldsPtr !== 0) {
        this.freeBytes(scalarFieldsPtr);
      }
    }
  }

  releaseOwnedObjects(objects) {
    for (const obj of objects) {
      if (obj !== 0) {
        this.exports.vir_obj_dec(obj);
      }
    }
    objects.length = 0;
  }

  callResolvedObjects(entry, cache, argObjs, liftResult) {
    const callSlot = this.resolveCallSlot(entry, cache);
    let argvPtr = 0;
    let resultObj = 0;
    try {
      this.hostState?.clearCallError();
      if (argObjs.length !== 0) {
        argvPtr = this.allocByteLength(argObjs.length * 4, `${entry.entry} argv pointer array`);
        this.writePointerArray(argvPtr, argObjs);
      }
      resultObj = this.exports.vir_call_resolved_objects(callSlot, argvPtr, argObjs.length);
      argObjs.length = 0;
      const hostError = this.hostState?.takeCallError();
      if (hostError) {
        throw hostError;
      }
      const error = this.lastCallError();
      if (error !== "") {
        throw new Error(error);
      }
      if (resultObj === 0) {
        throw new Error(`object call failed: ${entry.entry}`);
      }
      return liftResult(resultObj);
    } finally {
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
    }
  }

  hasObjectCallExports(...names) {
    return (
      typeof this.exports.vir_call_resolved_objects === "function" &&
      typeof this.exports.vir_obj_dec === "function" &&
      names.every((name) => typeof this.exports[name] === "function")
    );
  }

  readObjectByteArray(obj) {
    return this.readWasmBytes(
      this.exports.vir_obj_byte_array_data(obj),
      this.exports.vir_obj_byte_array_size(obj),
    );
  }

  readObjectString(obj) {
    return this.readWasmString(
      this.exports.vir_obj_string_data(obj),
      this.exports.vir_obj_string_size(obj),
    );
  }

  readObjectDecimal(obj, decimalName) {
    const data = this.exports[decimalName](obj);
    const len = this.exports.vir_obj_decimal_size();
    return this.readWasmString(data, len);
  }

  readObjectName(obj) {
    const data = this.exports.vir_obj_name_string(obj);
    const len = this.exports.vir_obj_name_string_size();
    return this.readWasmString(data, len);
  }

  readObjectScalar(obj, label) {
    if (this.exports.vir_obj_is_scalar(obj) === 0) {
      throw new Error(`${label} is not a Lean scalar object`);
    }
    return this.exports.vir_obj_scalar_value(obj) >>> 0;
  }

  ownedObjectField(obj, index, label) {
    const field = this.exports.vir_obj_field(obj, index);
    if (field === 0) {
      throw new Error(`${label} field ${index} is unavailable`);
    }
    return field;
  }

  withOwnedObjectField(obj, index, label, callback) {
    const field = this.ownedObjectField(obj, index, label);
    try {
      return callback(field);
    } finally {
      this.exports.vir_obj_dec(field);
    }
  }

  withOwnedObjectFields(obj, indexes, label, callback) {
    const fields = [];
    try {
      for (const index of indexes) {
        fields.push(this.ownedObjectField(obj, index, label));
      }
      return callback(fields);
    } finally {
      this.releaseOwnedObjects(fields);
    }
  }

  liftObjectExpr(obj, label) {
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return this.withOwnedObjectField(obj, 0, label, (index) => ({
          kind: "bvar",
          index: this.readObjectDecimal(index, "vir_obj_nat_decimal"),
        }));
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "fvar",
          name: this.readObjectName(name),
        }));
      case 2:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "mvar",
          name: this.readObjectName(name),
        }));
      case 3:
        return this.withOwnedObjectField(obj, 0, label, (level) => ({
          kind: "sort",
          level: this.liftObjectLevel(level, `${label}.level`),
        }));
      case 4:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([name, levels]) => ({
          kind: "const",
          name: this.readObjectName(name),
          levels: this.liftObjectLevelList(levels, `${label}.levels`),
        }));
      case 5:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([fn, arg]) => ({
          kind: "app",
          fn: this.liftObjectExpr(fn, `${label}.fn`),
          arg: this.liftObjectExpr(arg, `${label}.arg`),
        }));
      case 6:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([name, type, body]) => ({
          kind: "lam",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          body: this.liftObjectExpr(body, `${label}.body`),
          binderInfo: decodeBinderInfo(this.exports.vir_obj_expr_scalar_u8(obj, 3)),
        }));
      case 7:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([name, type, body]) => ({
          kind: "forall",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          body: this.liftObjectExpr(body, `${label}.body`),
          binderInfo: decodeBinderInfo(this.exports.vir_obj_expr_scalar_u8(obj, 3)),
        }));
      case 8:
        return this.withOwnedObjectFields(obj, [0, 1, 2, 3], label, ([name, type, value, body]) => ({
          kind: "let",
          name: this.readObjectName(name),
          type: this.liftObjectExpr(type, `${label}.type`),
          value: this.liftObjectExpr(value, `${label}.value`),
          body: this.liftObjectExpr(body, `${label}.body`),
          nondep: this.exports.vir_obj_expr_scalar_u8(obj, 4) !== 0,
        }));
      case 9:
        return this.withOwnedObjectField(obj, 0, label, (literal) => ({
          kind: "lit",
          literal: this.liftObjectLiteral(literal, `${label}.literal`),
        }));
      case 10:
        return this.withOwnedObjectField(obj, 1, label, (expr) => ({
          kind: "mdata",
          expr: this.liftObjectExpr(expr, `${label}.expr`),
        }));
      case 11:
        return this.withOwnedObjectFields(obj, [0, 1, 2], label, ([typeName, index, structure]) => ({
          kind: "proj",
          typeName: this.readObjectName(typeName),
          index: this.readObjectDecimal(index, "vir_obj_nat_decimal"),
          struct: this.liftObjectExpr(structure, `${label}.struct`),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Expr result kind ${kind}`);
    }
  }

  liftObjectLevel(obj, label) {
    if (this.exports.vir_obj_is_scalar(obj) !== 0) {
      return { kind: "zero" };
    }
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return { kind: "zero" };
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (child) => ({
          kind: "succ",
          of: this.liftObjectLevel(child, `${label}.of`),
        }));
      case 2:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([left, right]) => ({
          kind: "max",
          left: this.liftObjectLevel(left, `${label}.left`),
          right: this.liftObjectLevel(right, `${label}.right`),
        }));
      case 3:
        return this.withOwnedObjectFields(obj, [0, 1], label, ([left, right]) => ({
          kind: "imax",
          left: this.liftObjectLevel(left, `${label}.left`),
          right: this.liftObjectLevel(right, `${label}.right`),
        }));
      case 4:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "param",
          name: this.readObjectName(name),
        }));
      case 5:
        return this.withOwnedObjectField(obj, 0, label, (name) => ({
          kind: "mvar",
          name: this.readObjectName(name),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Level result kind ${kind}`);
    }
  }

  liftObjectLevelList(obj, label) {
    const values = [];
    let cursor = obj;
    let ownsCursor = false;
    try {
      while (this.exports.vir_obj_list_is_nil(cursor) === 0) {
        const index = values.length;
        const head = this.exports.vir_obj_list_head(cursor);
        if (head === 0) {
          throw new Error(`${label}[${index}] is unavailable`);
        }
        try {
          values.push(this.liftObjectLevel(head, `${label}[${index}]`));
        } finally {
          this.exports.vir_obj_dec(head);
        }

        let tail = this.exports.vir_obj_list_tail(cursor);
        try {
          if (tail === 0) {
            throw new Error(`${label} tail after index ${index} is unavailable`);
          }
          if (ownsCursor) {
            this.exports.vir_obj_dec(cursor);
          }
          cursor = tail;
          ownsCursor = true;
          tail = 0;
        } finally {
          if (tail !== 0) {
            this.exports.vir_obj_dec(tail);
          }
        }
      }
      return values;
    } finally {
      if (ownsCursor) {
        this.exports.vir_obj_dec(cursor);
      }
    }
  }

  liftObjectLiteral(obj, label) {
    const kind = this.exports.vir_obj_tag(obj);
    switch (kind) {
      case 0:
        return this.withOwnedObjectField(obj, 0, label, (value) => ({
          kind: "nat",
          value: this.readObjectDecimal(value, "vir_obj_nat_decimal"),
        }));
      case 1:
        return this.withOwnedObjectField(obj, 0, label, (value) => ({
          kind: "string",
          value: this.readObjectString(value),
        }));
      default:
        throw new Error(`${label} has unsupported Lean.Literal result kind ${kind}`);
    }
  }

  liftObjectValue(type, obj, label, selfType = null) {
    const tag = type?.interfaceTag;
    switch (tag) {
      case INTERFACE_TAG.RECURSIVE_SELF:
        if (selfType === null) {
          throw new Error(`${label} has a recursive self reference without an enclosing type`);
        }
        return this.liftObjectValue(selfType, obj, label, selfType);
      case INTERFACE_TAG.UNIT:
        return undefined;
      case INTERFACE_TAG.RESOURCE:
        return this.liftObjectResource(obj, label);
      case INTERFACE_TAG.FUNCTION:
        return this.liftObjectFunction(type, obj, label);
      case INTERFACE_TAG.BOOL:
        return this.readObjectScalar(obj, label) !== 0;
      case INTERFACE_TAG.UINT8:
        return this.readBoundedObjectScalar(obj, label, 0xff);
      case INTERFACE_TAG.UINT16:
        return this.readBoundedObjectScalar(obj, label, 0xffff);
      case INTERFACE_TAG.SIMPLE_ENUM:
        return enumValue(type, this.readObjectScalar(obj, label));
      case INTERFACE_TAG.NAT:
        return this.readObjectDecimal(obj, "vir_obj_nat_decimal");
      case INTERFACE_TAG.INT:
        return this.readObjectDecimal(obj, "vir_obj_int_decimal");
      case INTERFACE_TAG.STRING:
        return this.readObjectString(obj);
      case INTERFACE_TAG.UINT32:
        return this.exports.vir_obj_uint32_value(obj) >>> 0;
      case INTERFACE_TAG.UINT64:
        return this.readObjectDecimal(obj, "vir_obj_uint64_decimal");
      case INTERFACE_TAG.USIZE:
        return this.readObjectDecimal(obj, "vir_obj_usize_decimal");
      case INTERFACE_TAG.BYTE_ARRAY:
        return this.readObjectByteArray(obj);
      case INTERFACE_TAG.FLOAT:
        return this.exports.vir_obj_float_value(obj);
      case INTERFACE_TAG.FLOAT32:
        return Math.fround(this.exports.vir_obj_float32_value(obj));
      case INTERFACE_TAG.EXPR:
        return this.liftObjectExpr(obj, label);
      case INTERFACE_TAG.ARRAY:
        return this.liftObjectArrayValue(type, obj, label, selfType);
      case INTERFACE_TAG.LIST:
        return this.liftObjectListValue(type, obj, label, selfType);
      case INTERFACE_TAG.OPTION:
        return this.liftObjectOptionValue(type, obj, label, selfType);
      case INTERFACE_TAG.PROD:
        return this.liftObjectProdValue(type, obj, label, selfType);
      case INTERFACE_TAG.STRUCTURE:
        return this.liftObjectStructureValue(type, obj, label);
      case INTERFACE_TAG.TAGGED_UNION:
        return this.liftObjectTaggedUnionValue(type, obj, label);
      case INTERFACE_TAG.CUSTOM_INDUCTIVE:
        return this.liftObjectCustomInductiveValue(type, obj, label);
      default:
        throw new Error(`${label} has unsupported object ABI result type`);
    }
  }

  liftHostWireObjectValue(type, obj, label) {
    if (!hostWireArgumentSupported(type)) {
      throw new Error(`${label} has unsupported JavaScript host wire argument type`);
    }
    return this.liftObjectValue(type, obj, label);
  }

  liftExplicitConversionObjectValue(type, obj, label) {
    return this.liftObjectValue(type, obj, label);
  }

  readBoundedObjectScalar(obj, label, max) {
    const value = this.readObjectScalar(obj, label);
    if (value > max) {
      throw new Error(`${label} scalar value ${value} exceeds ${max}`);
    }
    return value;
  }

  liftObjectResource(obj, label) {
    const resource = this.exports.vir_obj_resource_externref(obj);
    if (isHostResource(resource) && hostResourceValue(resource) !== null) {
      return resource;
    }
    // Some effect callback paths can expose one IO.ok wrapper around a Js result
    // at the JS lift boundary. Keep this resource-only; ordinary Lean tag-0
    // constructors must continue through their declared value decoders.
    if (this.exports.vir_obj_is_scalar(obj) === 0 && this.exports.vir_obj_tag(obj) === 0) {
      const field = this.exports.vir_obj_field(obj, 0);
      if (field !== 0) {
        try {
          const nested = this.exports.vir_obj_resource_externref(field);
          if (isHostResource(nested) && hostResourceValue(nested) !== null) {
            return nested;
          }
        } finally {
          this.exports.vir_obj_dec(field);
        }
      }
    }
    throw new Error(`${label} did not lift to a live host resource`);
  }

  retainLeanObjectHandleValue(resource, label) {
    const cell = requireLeanObjectHandleCell(resource, this, label);
    const object = normalizeObjectPointer(cell.object, label);
    this.exports.vir_obj_inc(object);
    return object;
  }

  liftObjectFunction(type, obj, label) {
    const args = requireFunctionArgs(type, label);
    requireFunctionResult(type, label);
    const rootId = this.exports.vir_obj_closure_root(
      obj,
      args.length,
      interfaceEffectRuntimeTag(type.effect),
    );
    if (rootId === 0) {
      throw new Error(`${label} could not be rooted as a Lean callback`);
    }
    return createVirCallback(this, rootId, type);
  }

  liftObjectArrayValue(type, obj, label, selfType) {
    const len = this.exports.vir_obj_array_size(obj);
    const elementType = requireTypeField(type, "element", label);
    const values = [];
    for (let index = 0; index < len; index++) {
      const element = this.exports.vir_obj_array_get(obj, index);
      if (element === 0) {
        throw new Error(`${label}[${index}] is unavailable`);
      }
      try {
        values.push(this.liftObjectValue(elementType, element, `${label}[${index}]`, selfType));
      } finally {
        this.exports.vir_obj_dec(element);
      }
    }
    return values;
  }

  liftObjectListValue(type, obj, label, selfType) {
    const elementType = requireTypeField(type, "element", label);
    const values = [];
    let cursor = obj;
    let ownsCursor = false;
    try {
      while (this.exports.vir_obj_list_is_nil(cursor) === 0) {
        const index = values.length;
        const head = this.exports.vir_obj_list_head(cursor);
        if (head === 0) {
          throw new Error(`${label}[${index}] is unavailable`);
        }
        try {
          values.push(this.liftObjectValue(elementType, head, `${label}[${index}]`, selfType));
        } finally {
          this.exports.vir_obj_dec(head);
        }

        let tail = this.exports.vir_obj_list_tail(cursor);
        try {
          if (tail === 0) {
            throw new Error(`${label} tail after index ${index} is unavailable`);
          }
          if (ownsCursor) {
            this.exports.vir_obj_dec(cursor);
          }
          cursor = tail;
          ownsCursor = true;
          tail = 0;
        } finally {
          if (tail !== 0) {
            this.exports.vir_obj_dec(tail);
          }
        }
      }
      return values;
    } finally {
      if (ownsCursor) {
        this.exports.vir_obj_dec(cursor);
      }
    }
  }

  liftObjectOptionValue(type, obj, label, selfType) {
    const tag = this.exports.vir_obj_tag(obj);
    if (tag === 0) {
      return null;
    }
    if (tag !== 1) {
      throw new Error(`${label} has unexpected Option constructor tag ${tag}`);
    }
    const field = this.ownedObjectField(obj, 0, label);
    try {
      return this.liftObjectValue(requireTypeField(type, "element", label), field, `${label}.value`, selfType);
    } finally {
      this.exports.vir_obj_dec(field);
    }
  }

  liftObjectProdValue(type, obj, label, selfType) {
    const fst = this.ownedObjectField(obj, 0, label);
    try {
      const snd = this.ownedObjectField(obj, 1, label);
      try {
        return {
          fst: this.liftObjectValue(requireTypeField(type, "fst", label), fst, `${label}.fst`, selfType),
          snd: this.liftObjectValue(requireTypeField(type, "snd", label), snd, `${label}.snd`, selfType),
        };
      } finally {
        this.exports.vir_obj_dec(snd);
      }
    } finally {
      this.exports.vir_obj_dec(fst);
    }
  }

  liftObjectStructureValue(type, obj, label) {
    const fields = requireStructureFields(type, label);
    const trivial = trivialStructureField(type, fields);
    if (trivial !== null) {
      return { [trivial.name]: this.liftObjectValue(trivial.type, obj, `${label}.${trivial.name}`, type) };
    }
    const plan = objectLayoutPlan(type, fields, label);
    const values = {};
    for (const fieldPlan of plan.fields) {
      const field = fieldPlan.field;
      values[field.name] = this.liftObjectLayoutField(type, obj, fieldPlan, `${label}.${field.name}`);
    }
    return flattenStructureSubobjects(type, values);
  }

  liftObjectTaggedUnionValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = taggedUnionConstructorAt(type, tag, label);
    const field = taggedUnionField(ctor);
    const plan = objectLayoutPlan(ctor, [field], label);
    return {
      kind: ctor.jsName,
      value: this.liftObjectLayoutField(ctor, obj, plan.fields[0], `${label}.${ctor.jsName}`, type),
    };
  }

  liftObjectCustomInductiveValue(type, obj, label) {
    const tag = this.exports.vir_obj_tag(obj);
    const ctor = customInductiveConstructorAt(type, tag, label);
    if (ctor.fields.length === 0) {
      return { kind: ctor.jsName };
    }
    const plan = objectLayoutPlan(ctor, ctor.fields, `${label}.${ctor.jsName}`);
    const values = {};
    for (const fieldPlan of plan.fields) {
      const field = fieldPlan.field;
      values[field.name] = this.liftObjectLayoutField(
        ctor,
        obj,
        fieldPlan,
        `${label}.${ctor.jsName}.${field.name}`,
        type,
      );
    }
    return ctor.fields.length === 1 ? {
      kind: ctor.jsName,
      value: values[ctor.fields[0].name],
    } : {
      kind: ctor.jsName,
      fields: values,
    };
  }

  liftObjectLayoutField(owner, obj, fieldPlan, label, selfType = owner) {
    const field = fieldPlan.field;
    switch (fieldPlan.kind) {
      case "object": {
        const fieldObj = this.ownedObjectField(obj, fieldPlan.index, label);
        try {
          return this.liftObjectValue(field.type, fieldObj, label, selfType);
        } finally {
          this.exports.vir_obj_dec(fieldObj);
        }
      }
      case "usize":
        return this.readObjectUSizeField(obj, field.layout.index, label);
      case "scalar":
        return this.readObjectScalarField(owner, obj, field.type, field.layout, label, fieldPlan.offset);
      default:
        throw new Error(`${label} has unsupported object ABI layout`);
    }
  }

  readObjectUSizeField(obj, index, label) {
    const data = this.exports.vir_obj_ctor_usize_decimal(obj, index);
    if (data === 0) {
      throw new Error(`${label} USize field ${index} is unavailable`);
    }
    return this.readWasmString(data, this.exports.vir_obj_decimal_size());
  }

  readObjectScalarField(owner, obj, type, layout, label, offset = null) {
    const data = this.exports.vir_obj_ctor_scalar_data(obj, owner.usizeFieldCount);
    if (data === 0) {
      throw new Error(`${label} scalar data is unavailable`);
    }
    return readObjectScalarFieldValue(
      new DataView(this.exports.memory.buffer, data, owner.scalarByteSize),
      type,
      layout,
      label,
      offset,
    );
  }
}

function normalizeBinderInfo(value, label) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3) return value;
  switch (value) {
    case "default":
      return 0;
    case "implicit":
      return 1;
    case "strictImplicit":
      return 2;
    case "instImplicit":
      return 3;
    default:
      throw new Error(`${label} must be default, implicit, strictImplicit, or instImplicit`);
  }
}

function decodeBinderInfo(value) {
  return ["default", "implicit", "strictImplicit", "instImplicit"][value] ?? String(value);
}

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}
