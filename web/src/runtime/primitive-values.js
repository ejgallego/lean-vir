/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { normalizeUint32 } from "./vir-codec.js";
import { INTERFACE_TAG } from "./interface-tags.js";
import {
  requireByteArrayBytes,
  normalizeBoundedUnsignedBigInt,
  normalizeDecimal,
  normalizeFloat,
  normalizeInteger,
} from "./primitive-value-normalizers.js";

import { ObjectRuntime } from "./object-core.js";

const MAX_UINT64 = 0xffffffffffffffffn;
const MAX_WASM32_USIZE = 0xffffffffn;

const primitiveTags = new Set([
  INTERFACE_TAG.UNIT,
  INTERFACE_TAG.RESOURCE,
  INTERFACE_TAG.BOOL,
  INTERFACE_TAG.UINT8,
  INTERFACE_TAG.UINT16,
  INTERFACE_TAG.NAT,
  INTERFACE_TAG.INT,
  INTERFACE_TAG.STRING,
  INTERFACE_TAG.UINT32,
  INTERFACE_TAG.UINT64,
  INTERFACE_TAG.USIZE,
  INTERFACE_TAG.BYTE_ARRAY,
  INTERFACE_TAG.FLOAT,
  INTERFACE_TAG.FLOAT32,
]);

export class PrimitiveObjectRuntime extends ObjectRuntime {
  objectArgumentSupported(type) {
    return primitiveTags.has(type?.interfaceTag);
  }
  objectResultSupported(type) {
    return primitiveTags.has(type?.interfaceTag);
  }
  makeObjectValue(type, value, label) {
    const tag = type?.interfaceTag;
    switch (tag) {
      case INTERFACE_TAG.UNIT:
        if (value !== undefined && value !== null)
          throw new Error(`${label} must be undefined or null`);
        return this.makeObjectScalar(0, label);
      case INTERFACE_TAG.RESOURCE:
        return this.makeObjectResource(value, label);
      case INTERFACE_TAG.BOOL:
        if (typeof value !== "boolean")
          throw new Error(`${label} must be a boolean`);
        return this.makeObjectScalar(value ? 1 : 0, label);
      case INTERFACE_TAG.UINT8:
        return this.makeObjectScalar(
          normalizeInteger(value, label, 0, 0xff),
          label,
        );
      case INTERFACE_TAG.UINT16:
        return this.makeObjectScalar(
          normalizeInteger(value, label, 0, 0xffff),
          label,
        );
      case INTERFACE_TAG.NAT:
        return this.makeObjectDecimal(
          "vir_obj_nat",
          normalizeDecimal(value, label, { signed: false }),
          label,
        );
      case INTERFACE_TAG.INT:
        return this.makeObjectDecimal(
          "vir_obj_int",
          normalizeDecimal(value, label, { signed: true }),
          label,
        );
      case INTERFACE_TAG.STRING:
        return this.makeObjectString(value, label);
      case INTERFACE_TAG.UINT32:
        return this.makeObjectUint32(value, label);
      case INTERFACE_TAG.UINT64:
        return this.makeObjectUint64(value, label);
      case INTERFACE_TAG.USIZE:
        return this.makeObjectUSize(value, label);
      case INTERFACE_TAG.BYTE_ARRAY:
        return this.makeObjectByteArray(value, label);
      case INTERFACE_TAG.FLOAT:
        return this.makeObjectFloat(value, label);
      case INTERFACE_TAG.FLOAT32:
        return this.makeObjectFloat32(value, label);
      default:
        throw new Error(`${label} has unsupported object ABI argument type`);
    }
  }
  liftObjectValue(type, obj, label) {
    const tag = type?.interfaceTag;
    switch (tag) {
      case INTERFACE_TAG.UNIT:
        return undefined;
      case INTERFACE_TAG.RESOURCE:
        return this.liftObjectResource(obj, label);
      case INTERFACE_TAG.BOOL:
        return this.readObjectScalar(obj, label) !== 0;
      case INTERFACE_TAG.UINT8:
        return this.readBoundedObjectScalar(obj, label, 0xff);
      case INTERFACE_TAG.UINT16:
        return this.readBoundedObjectScalar(obj, label, 0xffff);
      case INTERFACE_TAG.NAT:
        return this.readObjectNat(obj);
      case INTERFACE_TAG.INT:
        return BigInt(this.readObjectDecimal(obj, "vir_obj_int_decimal"));
      case INTERFACE_TAG.STRING:
        return this.readObjectString(obj);
      case INTERFACE_TAG.UINT32:
        return this.exports.vir_obj_uint32_value(obj) >>> 0;
      case INTERFACE_TAG.UINT64:
        return BigInt.asUintN(
          64,
          this.exports.vir_obj_uint64_value(obj),
        );
      case INTERFACE_TAG.USIZE:
        this.requireWasm32USize();
        return this.exports.vir_obj_usize_value(obj) >>> 0;
      case INTERFACE_TAG.BYTE_ARRAY:
        return this.readObjectByteArray(obj);
      case INTERFACE_TAG.FLOAT:
        return this.exports.vir_obj_float_value(obj);
      case INTERFACE_TAG.FLOAT32:
        return Math.fround(this.exports.vir_obj_float32_value(obj));
      default:
        throw new Error(`${label} has unsupported object ABI result type`);
    }
  }

  readObjectNat(obj) {
    return BigInt(this.readObjectDecimal(obj, "vir_obj_nat_decimal"));
  }

  makeObjectByteArray(value, label) {
    const bytes = requireByteArrayBytes(value);
    const inputPtr = this.allocBytes(bytes);
    try {
      const argObj = this.exports.vir_obj_byte_array(
        inputPtr,
        bytes.byteLength,
      );
      if (argObj === 0) {
        throw new Error(
          `${label} could not be lowered to a Lean ByteArray object`,
        );
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
        throw new Error(
          `${label} could not be lowered to a Lean string object`,
        );
      }
      return argObj;
    });
  }

  makeObjectUint32(value, label) {
    const argObj = this.exports.vir_obj_uint32(normalizeUint32(value, label));
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean UInt32 object`);
    }
    return argObj;
  }

  makeObjectUint64(value, label) {
    const argObj = this.exports.vir_obj_uint64_scalar(
      normalizeBoundedUnsignedBigInt(value, label, MAX_UINT64, "UInt64"),
    );
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean UInt64 object`);
    }
    return argObj;
  }

  requireWasm32USize() {
    if (this.targetPointerBytes() !== 4) {
      throw new Error("direct USize transport requires a wasm32 runtime");
    }
  }

  makeObjectUSize(value, label) {
    this.requireWasm32USize();
    const argObj = this.exports.vir_obj_usize_scalar(
      Number(
        normalizeBoundedUnsignedBigInt(value, label, MAX_WASM32_USIZE, "USize"),
      ),
    );
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean USize object`);
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
    const argObj = this.exports.vir_obj_float32(
      Math.fround(normalizeFloat(value, label)),
    );
    if (argObj === 0) {
      throw new Error(`${label} could not be lowered to a Lean Float32 object`);
    }
    return argObj;
  }

  readObjectByteArray(obj) {
    return this.readWasmBytes(
      this.exports.vir_obj_byte_array_data(obj),
      this.exports.vir_obj_byte_array_size(obj),
    );
  }

  readBoundedObjectScalar(obj, label, max) {
    const value = this.readObjectScalar(obj, label);
    if (value > max) {
      throw new Error(`${label} scalar value ${value} exceeds ${max}`);
    }
    return value;
  }
}
