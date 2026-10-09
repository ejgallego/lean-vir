/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { INTERFACE_TAG } from "./interface-tags.js";
import { PrimitiveObjectRuntime } from "./primitive-values.js";
import {
  objectLayoutPlan,
  objectLayoutSlotsFromPlan,
  writeObjectScalarField,
} from "./object-abi.js";
import { normalizeBoundedUnsignedBigInt } from "./primitive-value-normalizers.js";
import {
  constructorValue,
  customInductiveConstructorAt,
  enumValue,
  flattenStructureSubobjects,
  normalizeArray,
  normalizeCustomInductive,
  normalizeEnum,
  normalizeStructure,
  normalizeTaggedUnion,
  taggedUnionConstructorAt,
} from "./vir-value-normalizers.js";
import { trivialStructureField } from "./object-boundary.js";

// Compile one immutable admitted descriptor into native JS conversions. The
// lexical bindings are compiler-owned constructor scopes, not layout owners.
// Cache the resulting root codec at the call site; never re-validate descriptors
// while converting values. Only dynamic values, ordinals and fields are checked.
export function compileNativeValueCodec(runtime, type, bindings = []) {
  const codec = {};
  const compile = (child, scope = bindings) =>
    compileNativeValueCodec(runtime, child, scope);
  const lowerPrimitive = (value, label) =>
    PrimitiveObjectRuntime.prototype.makeObjectValue.call(
      runtime,
      type,
      value,
      label,
    );
  const liftPrimitive = (obj, label) =>
    PrimitiveObjectRuntime.prototype.liftObjectValue.call(
      runtime,
      type,
      obj,
      label,
    );

  function layoutCodec(owner, scope, singlePayload = false) {
    const plan = objectLayoutPlan(owner, "constructor layout");
    const fields = plan.fields.map((fieldPlan) => ({
      ...fieldPlan,
      codec:
        fieldPlan.kind === "object"
          ? compile(fieldPlan.field.type, scope)
          : null,
    }));
    function liftField(field, obj, label) {
      const fieldLabel = `${label}.${field.field.name}`;
      if (field.kind === "object") {
        const acquired = runtime.ownedObjectField(obj, field.index, fieldLabel);
        try {
          return field.codec.lift(acquired, fieldLabel);
        } finally {
          runtime.exports.vir_obj_dec(acquired);
        }
      }
      if (field.kind === "usize")
        return runtime.readObjectUSizeField(
          owner,
          obj,
          field.index,
          fieldLabel,
        );
      return runtime.readObjectScalarField(
        owner,
        obj,
        field.field.type,
        field.field.layout,
        fieldLabel,
        field.offset,
      );
    }

    // Object-only layouts need no scalar buffers or layout record per node.
    // This is a storage specialization for every admitted constructor, not a
    // separate policy for Option or Prod.
    const lowerObjects = singlePayload
      ? (tag, value, label, scratch) => {
          const field = fields[0];
          const objects = [
            field.codec.lower(value, `${label}.${field.field.name}`, scratch),
          ];
          try {
            return scratch.createObjects(tag, objects, label);
          } finally {
            runtime.releaseOwnedObjects(objects);
          }
        }
      : (tag, values, label, scratch) => {
          const objects = Array(plan.objectFieldCount).fill(0);
          try {
            for (const field of fields)
              objects[field.index] = field.codec.lower(
                values[field.field.name],
                `${label}.${field.field.name}`,
                scratch,
              );
            return scratch.createObjects(tag, objects, label);
          } finally {
            runtime.releaseOwnedObjects(objects);
          }
        };
    const objectOnly = plan.usizeFieldCount === 0 && plan.scalarByteSize === 0;
    return {
      lower: objectOnly
        ? lowerObjects
        : (tag, values, label, scratch) => {
            const layout = objectLayoutSlotsFromPlan(plan);
            try {
              for (const field of fields) {
                const value = singlePayload ? values : values[field.field.name];
                const fieldLabel = `${label}.${field.field.name}`;
                if (field.kind === "object")
                  layout.objectFields[field.index] = field.codec.lower(
                    value,
                    fieldLabel,
                    scratch,
                  );
                else if (field.kind === "usize")
                  layout.usizeFields[field.index] =
                    normalizeBoundedUnsignedBigInt(
                      value,
                      fieldLabel,
                      runtime.usizeMaxValue(),
                      "USize",
                    );
                else
                  writeObjectScalarField(
                    layout.scalarBytes,
                    field.field.type,
                    field.field.layout,
                    value,
                    fieldLabel,
                    field.offset,
                  );
              }
              return scratch.create(tag, layout, label);
            } finally {
              runtime.releaseOwnedObjects(layout.objectFields);
            }
          },
      lift(obj, label) {
        if (singlePayload) return liftField(fields[0], obj, label);
        const values = {};
        for (const field of fields)
          values[field.field.name] = liftField(field, obj, label);
        return values;
      },
    };
  }

  switch (type.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_REF: {
      const owner = bindings[type.depth];
      if (owner === undefined)
        throw new Error("recursive codec reference has no enclosing binding");
      return owner;
    }
    case INTERFACE_TAG.SIMPLE_ENUM:
      codec.lower = (value, label) =>
        runtime.makeObjectScalar(normalizeEnum(value, type, label), label);
      codec.lift = (obj, label) =>
        enumValue(type, runtime.readObjectScalar(obj, label));
      break;
    case INTERFACE_TAG.EXPR:
      codec.lower = (value, label) => runtime.makeObjectExpr(value, label);
      codec.lift = (obj, label) => runtime.liftObjectExpr(obj, label);
      break;
    case INTERFACE_TAG.FUNCTION:
      codec.lower = (_value, label) => {
        throw new Error(
          `${label} cannot be a JavaScript function at this boundary`,
        );
      };
      codec.lift = (obj, label) => runtime.liftObjectFunction(type, obj, label);
      break;
    case INTERFACE_TAG.ARRAY: {
      const element = compile(type.element);
      codec.lower = (value, label, scratch) => {
        const values = normalizeArray(value, label);
        const objects = [];
        try {
          for (let i = 0; i < values.length; i++)
            objects.push(element.lower(values[i], `${label}[${i}]`, scratch));
          return runtime.makeObjectArrayFromOwnedElements(objects, label);
        } finally {
          runtime.releaseOwnedObjects(objects);
        }
      };
      codec.lift = (obj, label) => {
        const values = [],
          size = runtime.exports.vir_obj_array_size(obj);
        for (let i = 0; i < size; i++) {
          const field = runtime.exports.vir_obj_array_get(obj, i);
          if (field === 0) throw new Error(`${label}[${i}] is unavailable`);
          try {
            Object.defineProperty(values, i, {
              __proto__: null,
              value: element.lift(field, `${label}[${i}]`),
              writable: true,
              enumerable: true,
              configurable: true,
            });
          } finally {
            runtime.exports.vir_obj_dec(field);
          }
        }
        return values;
      };
      break;
    }
    case INTERFACE_TAG.STRUCTURE: {
      const scope = [codec, ...bindings];
      const trivial = trivialStructureField(type, type.fields);
      const child = trivial === null ? null : compile(trivial.type, scope);
      const layout = trivial === null ? layoutCodec(type, scope) : null;
      codec.lower = (value, label, scratch) => {
        const record = normalizeStructure(value, type.fields, label);
        return child === null
          ? layout.lower(0, record, label, scratch)
          : child.lower(
              record[trivial.name],
              `${label}.${trivial.name}`,
              scratch,
            );
      };
      const hasSubobjects = type.fields.some(
        (field) => field.subobject === true,
      );
      codec.lift = (obj, label) => {
        const value =
          child === null
            ? layout.lift(obj, label)
            : { [trivial.name]: child.lift(obj, `${label}.${trivial.name}`) };
        return hasSubobjects ? flattenStructureSubobjects(type, value) : value;
      };
      break;
    }
    case INTERFACE_TAG.TAGGED_UNION: {
      const constructors = type.constructors.map((ctor) => ({
        layout: layoutCodec(ctor, bindings, true),
        ctor,
      }));
      codec.lower = (value, label, scratch) => {
        const { index, ctor, payload } = normalizeTaggedUnion(
          value,
          type,
          label,
        );
        return constructors[index].layout.lower(index, payload, label, scratch);
      };
      codec.lift = (obj, label) => {
        const tag = runtime.exports.vir_obj_tag(obj),
          ctor = taggedUnionConstructorAt(type, tag, label);
        return constructorValue(
          type,
          ctor,
          constructors[tag].layout.lift(obj, label),
        );
      };
      break;
    }
    case INTERFACE_TAG.CUSTOM_INDUCTIVE: {
      const scope = [codec, ...bindings];
      if (type.name === "List") {
        // An iterative codec adapter, not a dedicated manifest type or runtime
        // constructor-layout assumption. All tags/field positions come from Lean.
        const [nil, cons] = type.constructors;
        const plan = objectLayoutPlan(cons, "List constructor");
        const [head, tail] = plan.fields;
        const element = compile(head.field.type, scope);
        codec.lower = (value, label, scratch) => {
          const values = normalizeArray(value, label);
          let cursor = runtime.makeObjectScalar(nil.tag, `${label}.nil`);
          try {
            for (let i = values.length - 1; i >= 0; i--) {
              const objects = Array(plan.objectFieldCount).fill(0);
              try {
                objects[head.index] = element.lower(
                  values[i],
                  `${label}[${i}]`,
                  scratch,
                );
                objects[tail.index] = cursor;
                cursor = 0;
                cursor = scratch.createObjects(
                  cons.tag,
                  objects,
                  `${label}[${i}]`,
                );
              } finally {
                runtime.releaseOwnedObjects(objects);
              }
            }
            const result = cursor;
            cursor = 0;
            return result;
          } finally {
            if (cursor !== 0) runtime.exports.vir_obj_dec(cursor);
          }
        };
        codec.lift = (obj, label) =>
          runtime.liftObjectConstructorList(
            obj,
            label,
            (field, index) => element.lift(field, `${label}[${index}]`),
            {
              nilTag: nil.tag,
              consTag: cons.tag,
              headIndex: head.index,
              tailIndex: tail.index,
            },
          );
      } else {
        const constructors = type.constructors.map((ctor) => ({
          ctor,
          layout: layoutCodec(ctor, scope, ctor.fields.length === 1),
        }));
        codec.lower = (value, label, scratch) => {
          const { index, ctor, payload } = normalizeCustomInductive(
            value,
            type,
            label,
          );
          return ctor.fields.length === 0
            ? runtime.makeObjectScalar(index, label)
            : constructors[index].layout.lower(index, payload, label, scratch);
        };
        codec.lift = (obj, label) => {
          const tag = runtime.exports.vir_obj_tag(obj),
            ctor = customInductiveConstructorAt(type, tag, label);
          return constructorValue(
            type,
            ctor,
            ctor.fields.length === 0
              ? null
              : constructors[tag].layout.lift(obj, `${label}.${ctor.jsName}`),
          );
        };
      }
      break;
    }
    default:
      codec.lower = lowerPrimitive;
      codec.lift = liftPrimitive;
      break;
  }
  return Object.freeze(codec);
}
