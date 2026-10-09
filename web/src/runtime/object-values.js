/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { interfaceEffectRuntimeTag } from "./interface-effects.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import {
  objectArgumentSupported,
  objectResultSupported,
  readObjectScalarField as readObjectScalarFieldValue,
} from "./object-abi.js";
import { normalizeArray } from "./vir-value-normalizers.js";
import { ConstructorScratch } from "./constructor-scratch.js";
import { compileNativeValueCodec } from "./native-value-codecs.js";
import {
  normalizeBoundedUnsignedDecimal,
  normalizeDecimal,
} from "./primitive-value-normalizers.js";
import { requireString } from "./object-core.js";

// The pinned kernel stores index + 1 in a 20-bit loose-bound-variable range.
const MAX_EXPR_BVAR_INDEX = 1048574n;

// A callback must capture only its cell, not a construction method's context
// containing the runtime: retired targets must allow that generation to collect.
function makeLeanCallback(cell) {
  return function virCallback(...args) {
    if (!cell.live) throw new Error("Vir callback belongs to a disposed runtime");
    return cell.runtime.callClosure(cell, args);
  };
}

// Add structural, syntax and automatic callable conversion to the same managed
// runtime. Primitive conversions and opaque Js/JSL ownership stay inherited.
export function withObjectValues(Base) {
  return class extends Base {
    callClosure(cell, args) {
      this.requireLiveRuntime();
      if (this.hostState?.callError) throw this.hostState.callError;
      this.requireLiveLeanObjectCell(cell, "callback");
      this.requireFunction("vir_closure_apply_objects");
      const type = cell.callType;
      const fnArgs = type.args;
      const argObjs = [];
      try {
        let argvPtr = 0;
        let resultObj = 0;
        try {
          // Match JS formal parameters: ignore extras, read absent values as
          // undefined, and convert each declared argument normally.
          fnArgs.forEach((arg, index) => {
            argObjs.push(
              this.makeObjectValue(arg.type, args[index], `callback argument ${arg.name}`),
            );
          });
          if (this.hostState?.callError) throw this.hostState.callError;
          this.requireLiveLeanObjectCell(cell, "callback");
          const effect = interfaceEffectRuntimeTag(type.effect);
          if (argObjs.length !== 0) {
            argvPtr = this.allocByteLength(
              argObjs.length * 4, "callback argv pointer array",
            );
            this.writePointerArray(argvPtr, argObjs);
          }
          try {
            const argc = argObjs.length;
            // The consuming ABI owns arguments from entry, including traps.
            argObjs.length = 0;
            resultObj = this.exports.vir_closure_apply_objects(
              cell.object, effect, argvPtr, argc,
            );
          } catch (error) {
            throw this.hostState?.takeCallError() ?? error;
          }
          const hostError = this.hostState?.takeCallError();
          if (hostError) throw hostError;
          if (resultObj === 0) {
            throw new Error(this.lastClosureCallError() || "closure call failed");
          }
          return this.liftObjectValue(
            type.result, resultObj, "callback result",
          );
        } finally {
          if (argvPtr !== 0) this.freeBytes(argvPtr);
          if (resultObj !== 0) this.exports.vir_obj_dec(resultObj);
        }
      } finally {
        // Also runs if argv/result cleanup itself throws before native transfer.
        this.releaseOwnedObjects(argObjs);
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
    nativeValueCodec(type) {
      this.nativeValueCodecs ??= new WeakMap();
      let codec = this.nativeValueCodecs.get(type);
      if (codec === undefined) {
        codec = compileNativeValueCodec(this, type);
        this.nativeValueCodecs.set(type, codec);
      }
      return codec;
    }

    makeObjectValue(type, value, label) {
      const scratch = new ConstructorScratch(this);
      try { return this.nativeValueCodec(type).lower(value, label, scratch); }
      finally { scratch.dispose(); }
    }

    liftObjectValue(type, obj, label) {
      return this.nativeValueCodec(type).lift(obj, label);
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
        { nilTag: 0, consTag: 1, headIndex: 0, tailIndex: 1 },
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
      return this.makeLeanObjectHandleTarget(obj, label, type, makeLeanCallback);
    }

    liftObjectConstructorList(obj, label, liftElement, { nilTag, consTag, headIndex, tailIndex }) {
      const values = [];
      let cursor = obj;
      let ownsCursor = false;
      try {
        while (true) {
          if (this.exports.vir_obj_is_scalar(cursor) !== 0) {
            const tag = this.exports.vir_obj_scalar_value(cursor) >>> 0;
            if (tag !== nilTag) {
              throw new Error(
                `${label} has unsupported Lean.List scalar tag ${tag}`,
              );
            }
            return values;
          }
          const tag = this.exports.vir_obj_tag(cursor);
          if (tag !== consTag) {
            throw new Error(
              `${label} has unsupported Lean.List constructor tag ${tag}`,
            );
          }
          const index = values.length;
          const head = this.ownedObjectField(cursor, headIndex, `${label}[${index}]`);
          try {
            values.push(liftElement(head, index));
          } finally {
            this.exports.vir_obj_dec(head);
          }

          let tail = this.ownedObjectField(
            cursor,
            tailIndex,
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
