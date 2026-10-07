/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirCallback } from "./callbacks.js";
import {
  customInductiveConstructorAt,
  requireFunctionArgs,
  requireFunctionResult,
  requireStructureFields,
  requireTypeField,
  taggedUnionConstructorAt,
} from "./vir-codec.js";
import { interfaceEffectRuntimeTag } from "./interface-effects.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import {
  objectArgumentSupported,
  objectResultSupported,
  objectLayoutPlan,
  objectLayoutSlotsFromPlan,
  readObjectScalarField as readObjectScalarFieldValue,
  taggedUnionField,
  writeObjectScalarField,
} from "./object-abi.js";
import {
  enumValue,
  flattenStructureSubobjects,
  normalizeArray,
  normalizeCustomInductive,
  normalizeEnum,
  normalizeOption,
  normalizePair,
  normalizeStructure,
  normalizeTaggedUnion,
} from "./vir-value-normalizers.js";
import {
  normalizeBoundedUnsignedDecimal,
  normalizeBoundedUnsignedBigInt,
  normalizeDecimal,
} from "./primitive-value-normalizers.js";
import { trivialStructureField } from "./object-boundary.js";
import { requireString } from "./object-core.js";

// The pinned kernel stores index + 1 in a 20-bit loose-bound-variable range.
const MAX_EXPR_BVAR_INDEX = 1048574n;

// Add structural, syntax and automatic callable conversion to the same managed
// runtime. Primitive conversions and opaque Js/JSL ownership stay inherited.
export function withObjectValues(Base) {
  return class extends Base {
    callClosure(rootId, type, args) {
      this.requireLiveRuntime();
      this.requireFunction("vir_closure_call_objects");
      const fnArgs = requireFunctionArgs(type, "callback");
      // Like ordinary JS formal parameters, ignore extra arguments and read
      // missing arguments as undefined. Each declared boundary view still
      // performs its normal conversion/check when lowered into Lean.
      const argObjs = [];
      try {
        fnArgs.forEach((arg, index) => {
          argObjs.push(
            this.makeObjectValue(
              arg.type,
              args[index],
              `callback argument ${arg.name}`,
            ),
          );
        });
        return this.callClosureObjects(rootId, type, argObjs);
      } finally {
        this.releaseOwnedObjects(argObjs);
      }
    }

    callClosureObjects(rootId, type, argObjs) {
      let argvPtr = 0;
      let resultObj = 0;
      try {
        if (this.hostState?.callError) throw this.hostState.callError;
        if (argObjs.length !== 0) {
          argvPtr = this.allocByteLength(
            argObjs.length * 4,
            "callback argv pointer array",
          );
          this.writePointerArray(argvPtr, argObjs);
        }
        try {
          const argc = argObjs.length;
          // The consuming ABI owns arguments from entry, including trap paths.
          argObjs.length = 0;
          resultObj = this.exports.vir_closure_call_objects(
            rootId,
            argvPtr,
            argc,
          );
        } catch (error) {
          const hostError = this.hostState?.takeCallError();
          throw hostError ?? error;
        }
        const hostError = this.hostState?.takeCallError();
        if (hostError) {
          throw hostError;
        }
        if (resultObj === 0) {
          throw new Error(this.lastClosureCallError() || "closure call failed");
        }
        return this.liftObjectValue(
          requireFunctionResult(type, "callback"),
          resultObj,
          "callback result",
        );
      } finally {
        if (argvPtr !== 0) {
          this.freeBytes(argvPtr);
        }
        if (resultObj !== 0) {
          this.exports.vir_obj_dec(resultObj);
        }
      }
    }

    lastClosureCallError() {
      const len = this.exports.vir_closure_call_error_size?.() ?? 0;
      return len === 0
        ? ""
        : this.readWasmString(this.exports.vir_closure_call_error(), len);
    }

    makeObjectStringConstructor(
      constructorName,
      value,
      stringLabel,
      objectLabel,
    ) {
      return this.withWasmString(
        requireString(value, stringLabel),
        stringLabel,
        (inputPtr, inputLen) => {
          const obj = this.exports[constructorName](inputPtr, inputLen);
          if (obj === 0) {
            throw new Error(
              `${objectLabel} could not be lowered to a Lean object`,
            );
          }
          return obj;
        },
      );
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

    objectArgumentSupported(type) {
      return objectArgumentSupported(type);
    }
    objectResultSupported(type) {
      return objectResultSupported(type);
    }
    makeObjectValue(type, value, label, selfType = null) {
      const tag = type?.interfaceTag;
      switch (tag) {
        case INTERFACE_TAG.RECURSIVE_SELF:
          if (selfType === null) {
            throw new Error(
              `${label} has a recursive self reference without an enclosing type`,
            );
          }
          return this.makeObjectValue(selfType, value, label, selfType);
        case INTERFACE_TAG.FUNCTION:
          throw new Error(
            `${label} cannot be a JavaScript function at this boundary`,
          );
        case INTERFACE_TAG.SIMPLE_ENUM:
          return this.makeObjectScalar(
            normalizeEnum(value, type, label),
            label,
          );
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
          return super.makeObjectValue(type, value, label, selfType);
      }
    }
    liftObjectValue(type, obj, label, selfType = null) {
      const tag = type?.interfaceTag;
      switch (tag) {
        case INTERFACE_TAG.RECURSIVE_SELF:
          if (selfType === null) {
            throw new Error(
              `${label} has a recursive self reference without an enclosing type`,
            );
          }
          return this.liftObjectValue(selfType, obj, label, selfType);
        case INTERFACE_TAG.FUNCTION:
          return this.liftObjectFunction(type, obj, label);
        case INTERFACE_TAG.SIMPLE_ENUM:
          return enumValue(type, this.readObjectScalar(obj, label));
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
          return super.liftObjectValue(type, obj, label, selfType);
      }
    }
    makeObjectSequenceValue(sequenceType, value, label, selfType) {
      const sequenceTag = sequenceType?.interfaceTag;
      if (
        sequenceTag !== INTERFACE_TAG.ARRAY &&
        sequenceTag !== INTERFACE_TAG.LIST
      ) {
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
          elementObjs.push(
            this.makeObjectValue(
              elementType,
              values[index],
              `${label}[${index}]`,
              selfType,
            ),
          );
        }
        return sequenceTag === INTERFACE_TAG.ARRAY
          ? this.makeObjectArrayFromOwnedElements(elementObjs, label)
          : this.makeObjectListFromOwnedElements(elementObjs, label);
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
        this.makeObjectValue(
          requireTypeField(type, "element", label),
          option.value,
          `${label}.value`,
          selfType,
        ),
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
        fields.push(
          this.makeObjectValue(
            requireTypeField(type, "fst", label),
            pair.fst,
            `${label}.fst`,
            selfType,
          ),
        );
        fields.push(
          this.makeObjectValue(
            requireTypeField(type, "snd", label),
            pair.snd,
            `${label}.snd`,
            selfType,
          ),
        );
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
        return this.makeObjectValue(
          trivial.type,
          record[trivial.name],
          `${label}.${trivial.name}`,
          type,
        );
      }
      return this.makeObjectCtorFromLayout(
        0,
        type,
        fields,
        record,
        label,
        type,
      );
    }

    makeObjectTaggedUnionValue(type, value, label) {
      const { index, ctor, payload } = normalizeTaggedUnion(value, type, label);
      const field = taggedUnionField(ctor);
      return this.makeObjectCtorFromLayout(
        index,
        ctor,
        [field],
        { [field.name]: payload },
        label,
        type,
      );
    }

    makeObjectCustomInductiveValue(type, value, label) {
      const { index, ctor, fields } = normalizeCustomInductive(
        value,
        type,
        label,
      );
      if (ctor.fields.length === 0) {
        return this.makeObjectScalar(index, label);
      }
      return this.makeObjectCtorFromLayout(
        index,
        ctor,
        ctor.fields,
        fields,
        label,
        type,
      );
    }

    makeObjectCtorFromLayout(tag, owner, fields, values, label, selfType) {
      const plan = objectLayoutPlan(owner, fields, label);
      const layout = objectLayoutSlotsFromPlan(plan);
      try {
        for (const fieldPlan of plan.fields) {
          const field = fieldPlan.field;
          this.writeObjectLayoutField(
            layout,
            fieldPlan,
            values[field.name],
            `${label}.${field.name}`,
            selfType,
          );
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
          layout.objectFields[fieldPlan.index] = this.makeObjectValue(
            field.type,
            value,
            label,
            selfType,
          );
          return;
        case "usize":
          layout.usizeFields[fieldPlan.index] = normalizeBoundedUnsignedBigInt(
            value,
            label,
            this.usizeMaxValue(),
            "USize",
          );
          return;
        case "scalar":
          writeObjectScalarField(
            layout.scalarBytes,
            field.type,
            field.layout,
            value,
            label,
            fieldPlan.offset,
          );
          return;
        default:
          throw new Error(`${label} has unsupported object ABI layout`);
      }
    }

    makeObjectExpr(value, label) {
      const expr = value;
      switch (expr?.kind) {
        case "bvar":
          return this.makeObjectDecimal(
            "vir_obj_expr_bvar",
            normalizeBoundedUnsignedDecimal(
              expr.index,
              `${label}.index`,
              MAX_EXPR_BVAR_INDEX,
              "Lean.Expr.bvar (maximum index 1048574)",
            ),
            label,
          );
        case "fvar":
          return this.makeObjectStringConstructor(
            "vir_obj_expr_fvar",
            requireObjectName(expr.name, `${label}.name`),
            `${label}.name`,
            label,
          );
        case "mvar":
          return this.makeObjectStringConstructor(
            "vir_obj_expr_mvar",
            requireObjectName(expr.name, `${label}.name`),
            `${label}.name`,
            label,
          );
        case "sort": {
          let level = this.makeObjectLevel(expr.level, `${label}.level`);
          try {
            const obj = this.exports.vir_obj_expr_sort(level);
            if (obj === 0)
              throw new Error(
                `${label} could not be lowered to a Lean.Expr sort object`,
              );
            level = 0;
            return obj;
          } finally {
            this.releaseOwnedObjects([level]);
          }
        }
        case "const": {
          let levels = this.makeObjectLevelList(expr.levels, `${label}.levels`);
          try {
            return this.withWasmString(
              requireObjectName(expr.name, `${label}.name`),
              `${label}.name`,
              (namePtr, nameLen) => {
                const obj = this.exports.vir_obj_expr_const(
                  namePtr,
                  nameLen,
                  levels,
                );
                if (obj === 0)
                  throw new Error(
                    `${label} could not be lowered to a Lean.Expr const object`,
                  );
                levels = 0;
                return obj;
              },
            );
          } finally {
            this.releaseOwnedObjects([levels]);
          }
        }
        case "app":
          return this.makeObjectExprBinary(
            "vir_obj_expr_app",
            expr.fn,
            `${label}.fn`,
            expr.arg,
            `${label}.arg`,
            label,
          );
        case "lam":
          return this.makeObjectExprBinding(
            "vir_obj_expr_lambda",
            expr.name,
            expr.type,
            expr.body,
            normalizeBinderInfo(
              expr.binderInfo ?? "default",
              `${label}.binderInfo`,
            ),
            label,
          );
        case "forall":
          return this.makeObjectExprBinding(
            "vir_obj_expr_forall",
            expr.name,
            expr.type,
            expr.body,
            normalizeBinderInfo(
              expr.binderInfo ?? "default",
              `${label}.binderInfo`,
            ),
            label,
          );
        case "let":
          return this.makeObjectExprLet(expr, label);
        case "lit": {
          let literal = this.makeObjectLiteral(
            expr.literal,
            `${label}.literal`,
          );
          try {
            const obj = this.exports.vir_obj_expr_lit(literal);
            if (obj === 0)
              throw new Error(
                `${label} could not be lowered to a Lean.Expr literal object`,
              );
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
          throw new Error(
            `${label} has unsupported Lean.Expr kind ${expr?.kind}`,
          );
      }
    }

    makeObjectLevel(value, label) {
      const level = value;
      switch (level.kind) {
        case "zero": {
          const obj = this.exports.vir_obj_level_zero();
          if (obj === 0)
            throw new Error(
              `${label} could not be lowered to a Lean.Level zero object`,
            );
          return obj;
        }
        case "succ": {
          let child = this.makeObjectLevel(level.of, `${label}.of`);
          try {
            const obj = this.exports.vir_obj_level_succ(child);
            if (obj === 0)
              throw new Error(
                `${label} could not be lowered to a Lean.Level succ object`,
              );
            child = 0;
            return obj;
          } finally {
            this.releaseOwnedObjects([child]);
          }
        }
        case "max":
          return this.makeObjectLevelBinary(
            "vir_obj_level_max",
            level.left,
            `${label}.left`,
            level.right,
            `${label}.right`,
            label,
          );
        case "imax":
          return this.makeObjectLevelBinary(
            "vir_obj_level_imax",
            level.left,
            `${label}.left`,
            level.right,
            `${label}.right`,
            label,
          );
        case "param":
          return this.makeObjectStringConstructor(
            "vir_obj_level_param",
            requireObjectName(level.name, `${label}.name`),
            `${label}.name`,
            label,
          );
        case "mvar":
          return this.makeObjectStringConstructor(
            "vir_obj_level_mvar",
            requireObjectName(level.name, `${label}.name`),
            `${label}.name`,
            label,
          );
        default:
          throw new Error(
            `${label} has unsupported Lean.Level kind ${level.kind}`,
          );
      }
    }

    makeObjectLevelList(levels, label) {
      const values = normalizeArray(levels, label);
      const levelObjs = [];
      try {
        values.forEach((level, index) => {
          levelObjs.push(this.makeObjectLevel(level, `${label}[${index}]`));
        });
        return this.makeObjectListFromOwnedElements(levelObjs, label);
      } finally {
        this.releaseOwnedObjects(levelObjs);
      }
    }

    makeObjectLiteral(value, label) {
      const literal = value;
      switch (literal?.kind) {
        case "nat":
          return this.makeObjectDecimal(
            "vir_obj_literal_nat",
            normalizeDecimal(literal.value, `${label}.value`, {
              signed: false,
            }),
            label,
          );
        case "string":
          return this.makeObjectStringConstructor(
            "vir_obj_literal_string",
            literal.value,
            `${label}.value`,
            label,
          );
        default:
          throw new Error(
            `${label} has unsupported Lean.Literal kind ${literal?.kind}`,
          );
      }
    }

    makeObjectLevelBinary(
      constructorName,
      leftValue,
      leftLabel,
      rightValue,
      rightLabel,
      label,
    ) {
      let left = this.makeObjectLevel(leftValue, leftLabel);
      let right = 0;
      try {
        right = this.makeObjectLevel(rightValue, rightLabel);
        const obj = this.exports[constructorName](left, right);
        if (obj === 0)
          throw new Error(
            `${label} could not be lowered to a Lean.Level object`,
          );
        left = 0;
        right = 0;
        return obj;
      } finally {
        this.releaseOwnedObjects([left, right]);
      }
    }

    makeObjectExprBinary(
      constructorName,
      leftValue,
      leftLabel,
      rightValue,
      rightLabel,
      label,
    ) {
      let left = this.makeObjectExpr(leftValue, leftLabel);
      let right = 0;
      try {
        right = this.makeObjectExpr(rightValue, rightLabel);
        const obj = this.exports[constructorName](left, right);
        if (obj === 0)
          throw new Error(
            `${label} could not be lowered to a Lean.Expr object`,
          );
        left = 0;
        right = 0;
        return obj;
      } finally {
        this.releaseOwnedObjects([left, right]);
      }
    }

    makeObjectExprBinding(
      constructorName,
      name,
      typeValue,
      bodyValue,
      binderInfo,
      label,
    ) {
      const checkedName = requireObjectName(name, `${label}.name`);
      let type = this.makeObjectExpr(typeValue, `${label}.type`);
      let body = 0;
      try {
        body = this.makeObjectExpr(bodyValue, `${label}.body`);
        return this.withWasmString(
          checkedName,
          `${label}.name`,
          (namePtr, nameLen) => {
            const obj = this.exports[constructorName](
              namePtr,
              nameLen,
              type,
              body,
              binderInfo,
            );
            if (obj === 0)
              throw new Error(
                `${label} could not be lowered to a Lean.Expr binding object`,
              );
            type = 0;
            body = 0;
            return obj;
          },
        );
      } finally {
        this.releaseOwnedObjects([type, body]);
      }
    }

    makeObjectExprLet(expr, label) {
      const checkedName = requireObjectName(expr.name, `${label}.name`);
      let type = this.makeObjectExpr(expr.type, `${label}.type`);
      let value = 0;
      let body = 0;
      try {
        value = this.makeObjectExpr(expr.value, `${label}.value`);
        body = this.makeObjectExpr(expr.body, `${label}.body`);
        return this.withWasmString(
          checkedName,
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
            if (obj === 0)
              throw new Error(
                `${label} could not be lowered to a Lean.Expr let object`,
              );
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
      const checkedTypeName = requireObjectName(
        expr.typeName,
        `${label}.typeName`,
      );
      let structure = this.makeObjectExpr(expr.struct, `${label}.struct`);
      try {
        return this.withWasmString(
          checkedTypeName,
          `${label}.typeName`,
          (typeNamePtr, typeNameLen) =>
            this.withWasmString(
              normalizeDecimal(expr.index, `${label}.index`, {
                signed: false,
              }),
              `${label}.index`,
              (indexPtr, indexLen) => {
                const obj = this.exports.vir_obj_expr_proj(
                  typeNamePtr,
                  typeNameLen,
                  indexPtr,
                  indexLen,
                  structure,
                );
                if (obj === 0)
                  throw new Error(
                    `${label} could not be lowered to a Lean.Expr proj object`,
                  );
                structure = 0;
                return obj;
              },
            ),
        );
      } finally {
        this.releaseOwnedObjects([structure]);
      }
    }

    makeObjectArrayFromOwnedElements(elementObjs, label) {
      let valuesPtr = 0;
      try {
        if (elementObjs.length !== 0) {
          valuesPtr = this.allocByteLength(
            elementObjs.length * 4,
            `${label} pointer array`,
          );
          this.writePointerArray(valuesPtr, elementObjs);
        }
        const sequenceObj = this.exports.vir_obj_array(
          valuesPtr,
          elementObjs.length,
        );
        if (sequenceObj === 0) {
          throw new Error(
            `${label} could not be lowered to a Lean array object`,
          );
        }
        elementObjs.length = 0;
        return sequenceObj;
      } finally {
        if (valuesPtr !== 0) {
          this.freeBytes(valuesPtr);
        }
      }
    }

    makeObjectListFromOwnedElements(elementObjs, label) {
      let tail = this.makeObjectScalar(0, `${label}.nil`);
      try {
        for (let index = elementObjs.length - 1; index >= 0; index--) {
          const fields = [elementObjs[index], tail];
          const cons = this.makeObjectCtorFromOwnedFields(
            1,
            fields,
            `${label}[${index}]`,
          );
          elementObjs[index] = 0;
          tail = cons;
        }
        elementObjs.length = 0;
        const list = tail;
        tail = 0;
        return list;
      } finally {
        if (tail !== 0) {
          this.exports.vir_obj_dec(tail);
        }
      }
    }

    makeObjectCtorFromOwnedFields(tag, fields, label) {
      let fieldsPtr = 0;
      try {
        if (fields.length !== 0) {
          fieldsPtr = this.allocByteLength(
            fields.length * 4,
            `${label} field pointer array`,
          );
          this.writePointerArray(fieldsPtr, fields);
        }
        const obj = this.exports.vir_obj_ctor(tag, fieldsPtr, fields.length);
        if (obj === 0) {
          throw new Error(
            `${label} could not be lowered to a Lean constructor object`,
          );
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
          objectFieldsPtr = this.allocByteLength(
            layout.objectFields.length * 4,
            `${label} object field pointer array`,
          );
          this.writePointerArray(objectFieldsPtr, layout.objectFields);
        }
        if (layout.usizeFields.length !== 0) {
          const pointerBytes = this.targetPointerBytes();
          usizeFieldsPtr = this.allocByteLength(
            layout.usizeFields.length * pointerBytes,
            `${label} usize field array`,
          );
          const view = new DataView(
            this.exports.memory.buffer,
            usizeFieldsPtr,
            layout.usizeFields.length * pointerBytes,
          );
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
          throw new Error(
            `${label} could not be lowered to a Lean constructor object`,
          );
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

    readObjectName(obj) {
      const data = this.exports.vir_obj_name_string(obj);
      const len = this.exports.vir_obj_name_string_size();
      if (data === 0 || data === null) {
        throw new Error(
          "Lean.Name result contains unsupported numeric, escaped, empty, or non-identifier components",
        );
      }
      return requireObjectName(
        this.readWasmString(data, len),
        "Lean.Name result",
      );
    }

    liftObjectExpr(obj, label) {
      const kind = this.exports.vir_obj_tag(obj);
      switch (kind) {
        case 0:
          return this.withOwnedObjectField(obj, 0, label, (index) => ({
            kind: "bvar",
            index: this.readObjectNat(index),
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
          return this.withOwnedObjectFields(
            obj,
            [0, 1],
            label,
            ([name, levels]) => ({
              kind: "const",
              name: this.readObjectName(name),
              levels: this.liftObjectLevelList(levels, `${label}.levels`),
            }),
          );
        case 5:
          return this.withOwnedObjectFields(
            obj,
            [0, 1],
            label,
            ([fn, arg]) => ({
              kind: "app",
              fn: this.liftObjectExpr(fn, `${label}.fn`),
              arg: this.liftObjectExpr(arg, `${label}.arg`),
            }),
          );
        case 6:
          return this.withOwnedObjectFields(
            obj,
            [0, 1, 2],
            label,
            ([name, type, body]) => ({
              kind: "lam",
              name: this.readObjectName(name),
              type: this.liftObjectExpr(type, `${label}.type`),
              body: this.liftObjectExpr(body, `${label}.body`),
              binderInfo: decodeBinderInfo(
                this.exports.vir_obj_expr_scalar_u8(obj, 3),
              ),
            }),
          );
        case 7:
          return this.withOwnedObjectFields(
            obj,
            [0, 1, 2],
            label,
            ([name, type, body]) => ({
              kind: "forall",
              name: this.readObjectName(name),
              type: this.liftObjectExpr(type, `${label}.type`),
              body: this.liftObjectExpr(body, `${label}.body`),
              binderInfo: decodeBinderInfo(
                this.exports.vir_obj_expr_scalar_u8(obj, 3),
              ),
            }),
          );
        case 8:
          return this.withOwnedObjectFields(
            obj,
            [0, 1, 2, 3],
            label,
            ([name, type, value, body]) => ({
              kind: "let",
              name: this.readObjectName(name),
              type: this.liftObjectExpr(type, `${label}.type`),
              value: this.liftObjectExpr(value, `${label}.value`),
              body: this.liftObjectExpr(body, `${label}.body`),
              nondep: this.exports.vir_obj_expr_scalar_u8(obj, 4) !== 0,
            }),
          );
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
          return this.withOwnedObjectFields(
            obj,
            [0, 1, 2],
            label,
            ([typeName, index, structure]) => ({
              kind: "proj",
              typeName: this.readObjectName(typeName),
              index: this.readObjectNat(index),
              struct: this.liftObjectExpr(structure, `${label}.struct`),
            }),
          );
        default:
          throw new Error(
            `${label} has unsupported Lean.Expr result kind ${kind}`,
          );
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
          return this.withOwnedObjectFields(
            obj,
            [0, 1],
            label,
            ([left, right]) => ({
              kind: "max",
              left: this.liftObjectLevel(left, `${label}.left`),
              right: this.liftObjectLevel(right, `${label}.right`),
            }),
          );
        case 3:
          return this.withOwnedObjectFields(
            obj,
            [0, 1],
            label,
            ([left, right]) => ({
              kind: "imax",
              left: this.liftObjectLevel(left, `${label}.left`),
              right: this.liftObjectLevel(right, `${label}.right`),
            }),
          );
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
          throw new Error(
            `${label} has unsupported Lean.Level result kind ${kind}`,
          );
      }
    }

    liftObjectLevelList(obj, label) {
      return this.liftObjectConstructorList(obj, label, (head, index) =>
        this.liftObjectLevel(head, `${label}[${index}]`),
      );
    }

    liftObjectLiteral(obj, label) {
      const kind = this.exports.vir_obj_tag(obj);
      switch (kind) {
        case 0:
          return this.withOwnedObjectField(obj, 0, label, (value) => ({
            kind: "nat",
            value: this.readObjectNat(value),
          }));
        case 1:
          return this.withOwnedObjectField(obj, 0, label, (value) => ({
            kind: "string",
            value: this.readObjectString(value),
          }));
        default:
          throw new Error(
            `${label} has unsupported Lean.Literal result kind ${kind}`,
          );
      }
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
          const value = this.liftObjectValue(
            elementType,
            element,
            `${label}[${index}]`,
            selfType,
          );
          // Structural arrays are dense like literals: `push` could invoke an
          // inherited numeric setter and leave a hole instead of an own value.
          // This calls the mutable Object.defineProperty function, not the JS
          // literal's internal operation. If it throws, `finally` still releases
          // this borrowed element; no later element is lifted.
          Object.defineProperty(values, index, {
            __proto__: null,
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        } finally {
          this.exports.vir_obj_dec(element);
        }
      }
      return values;
    }

    liftObjectListValue(type, obj, label, selfType) {
      const elementType = requireTypeField(type, "element", label);
      return this.liftObjectConstructorList(obj, label, (head, index) =>
        this.liftObjectValue(elementType, head, `${label}[${index}]`, selfType),
      );
    }

    liftObjectConstructorList(obj, label, liftElement) {
      const values = [];
      let cursor = obj;
      let ownsCursor = false;
      try {
        while (true) {
          if (this.exports.vir_obj_is_scalar(cursor) !== 0) {
            const tag = this.exports.vir_obj_scalar_value(cursor) >>> 0;
            if (tag !== 0) {
              throw new Error(
                `${label} has unsupported Lean.List scalar tag ${tag}`,
              );
            }
            return values;
          }
          const tag = this.exports.vir_obj_tag(cursor);
          if (tag !== 1) {
            throw new Error(
              `${label} has unsupported Lean.List constructor tag ${tag}`,
            );
          }
          const index = values.length;
          const head = this.ownedObjectField(cursor, 0, `${label}[${index}]`);
          try {
            values.push(liftElement(head, index));
          } finally {
            this.exports.vir_obj_dec(head);
          }

          let tail = this.ownedObjectField(
            cursor,
            1,
            `${label} tail after index ${index}`,
          );
          try {
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
        throw new Error(
          `${label} has unexpected Option constructor tag ${tag}`,
        );
      }
      const field = this.ownedObjectField(obj, 0, label);
      try {
        return this.liftObjectValue(
          requireTypeField(type, "element", label),
          field,
          `${label}.value`,
          selfType,
        );
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
            fst: this.liftObjectValue(
              requireTypeField(type, "fst", label),
              fst,
              `${label}.fst`,
              selfType,
            ),
            snd: this.liftObjectValue(
              requireTypeField(type, "snd", label),
              snd,
              `${label}.snd`,
              selfType,
            ),
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
        return {
          [trivial.name]: this.liftObjectValue(
            trivial.type,
            obj,
            `${label}.${trivial.name}`,
            type,
          ),
        };
      }
      const plan = objectLayoutPlan(type, fields, label);
      const values = {};
      for (const fieldPlan of plan.fields) {
        const field = fieldPlan.field;
        values[field.name] = this.liftObjectLayoutField(
          type,
          obj,
          fieldPlan,
          `${label}.${field.name}`,
          type,
        );
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
        value: this.liftObjectLayoutField(
          ctor,
          obj,
          plan.fields[0],
          `${label}.${ctor.jsName}`,
          type,
        ),
      };
    }

    liftObjectCustomInductiveValue(type, obj, label) {
      const tag = this.exports.vir_obj_tag(obj);
      const ctor = customInductiveConstructorAt(type, tag, label);
      if (ctor.fields.length === 0) {
        return { kind: ctor.jsName };
      }
      const plan = objectLayoutPlan(
        ctor,
        ctor.fields,
        `${label}.${ctor.jsName}`,
      );
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
      return ctor.fields.length === 1
        ? {
            kind: ctor.jsName,
            value: values[ctor.fields[0].name],
          }
        : {
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
          return this.readObjectUSizeField(owner, obj, fieldPlan.index, label);
        case "scalar":
          return this.readObjectScalarField(
            owner,
            obj,
            field.type,
            field.layout,
            label,
            fieldPlan.offset,
          );
        default:
          throw new Error(`${label} has unsupported object ABI layout`);
      }
    }

    readObjectUSizeField(owner, obj, index, label) {
      this.requireWasm32USize();
      const data = this.exports.vir_obj_ctor_scalar_data(obj, 0);
      if (data === 0) {
        throw new Error(
          `${label} USize field ${owner.objectFieldCount + index} is unavailable`,
        );
      }
      const fields = new DataView(
        this.exports.memory.buffer,
        data,
        owner.usizeFieldCount * 4,
      );
      return fields.getUint32(index * 4, true);
    }

    readObjectScalarField(owner, obj, type, layout, label, offset = null) {
      const data = this.exports.vir_obj_ctor_scalar_data(
        obj,
        owner.usizeFieldCount,
      );
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
  };
}

function normalizeBinderInfo(value, label) {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 3
  )
    return value;
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
      throw new Error(
        `${label} must be default, implicit, strictImplicit, or instImplicit`,
      );
  }
}

function decodeBinderInfo(value) {
  return (
    ["default", "implicit", "strictImplicit", "instImplicit"][value] ??
    String(value)
  );
}

function requireObjectName(value, label) {
  const text = requireString(value, label);
  // TextEncoder replaces lone surrogates; reject them before crossing the ABI.
  if (/[\uD800-\uDFFF]/u.test(text)) {
    throw new Error(`${label} must contain well-formed Unicode`);
  }
  // The empty spelling is retained for compatibility with the existing
  // anonymous Name construction; Name.toString emits the explicit spelling.
  if (text === "" || text === "[anonymous]") {
    return text;
  }
  const components = text.split(".");
  for (const component of components) {
    if (component.length === 0) {
      throw new Error(
        `${label} must use non-empty dotted identifier components`,
      );
    }
    if (/^[0-9]+$/.test(component)) {
      throw new Error(`${label} cannot contain numeric Name components`);
    }
    if (component.includes("«") || component.includes("»")) {
      throw new Error(`${label} cannot contain escaped Name components`);
    }
  }
  // The Wasm constructor/getter uses the pinned Lean identifier predicates.
  // Do not approximate that grammar with JavaScript's Unicode ID properties.
  return text;
}
