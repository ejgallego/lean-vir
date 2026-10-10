/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { normalizeUint32 } from "./vir-codec.js";
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
const MAX_WASM32_SCALAR_NAT = 0x7fffffffn;

const primitiveViews = new Set(["bigint", "safeInteger", "number", "string", "bytes", "unit", "boolean", "jsReference", "leanReference"]);

export class PrimitiveObjectRuntime extends ObjectRuntime {
  objectArgumentSupported(pair) { return primitiveViews.has(pair?.value?.tag); }
  objectResultSupported(pair) { return primitiveViews.has(pair?.value?.tag); }
  nativeValueCodec(pair) {
    this.nativeValueCodecs ??= new WeakMap();
    let codec = this.nativeValueCodecs.get(pair);
    if (codec === undefined) {
      codec = compilePrimitiveValueCodec(this, pair.native, pair.value);
      if (codec === null) throw new Error("value interface requires optional object conversion");
      this.nativeValueCodecs.set(pair, codec);
    }
    return codec;
  }
  makeObjectValue(pair, value, label) { return this.nativeValueCodec(pair).lower(value, label); }
  liftObjectValue(pair, obj, label) { return this.nativeValueCodec(pair).lift(obj, label); }

  readObjectNat(obj) {
    if (this.targetPointerBytes() === 4 && this.exports.vir_obj_is_scalar(obj) !== 0)
      return BigInt(this.exports.vir_obj_scalar_value(obj) >>> 0);
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

// Scalar operations and exact resource/reference passage belong to the managed
// composition too. Structural traversal remains in optional object conversion.
export function compilePrimitiveValueCodec(runtime, native, view) {
  if (native.ref !== undefined) return null;
  const type = native.type, codec = {};
  const expect = tag => { if (view.tag !== tag) throw new Error(`${type.tag} requires ${tag} view`); };
  switch (type.tag) {
    case "nat":
    case "int": {
      if (!["bigint", "safeInteger"].includes(view.tag)) throw new Error("integer view required");
      const safe = view.tag === "safeInteger", signed = type.tag === "int";
      codec.lower = (value, label) => {
        if (safe && !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
        // Use the native scalar operation for exactly representable wasm32 Nats.
        // Heap naturals and textual inputs keep arbitrary-precision conversion.
        if (!signed && runtime.targetPointerBytes() === 4 && (
          (typeof value === "bigint" && value >= 0n && value <= MAX_WASM32_SCALAR_NAT) ||
          (Number.isInteger(value) && value >= 0 && value <= Number(MAX_WASM32_SCALAR_NAT))))
          return runtime.makeObjectScalar(Number(value), label);
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
      if (view.tag === "leanReference") {
        codec.lower = (value, label) => runtime.retainLeanObjectHandleValue(value, label);
        codec.lift = (obj, label) => runtime.makeLeanObjectHandleResource(obj, label);
      } else if (["unit", "boolean", "enum"].includes(view.tag)) {
        const constructors = native.metadata.constructors;
        const scalar = immediateView(constructors, view);
        const objects = constructors.map((_ctor, index) => runtime.makeObjectScalar(index, "immediate constructor binding"));
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
      } else return null;
      break;
    }
    default: return null;
  }
  return Object.freeze(codec);
}

function immediateView(constructors, view) {
  const count = constructors.length;
  let encode, decode;
  if (view.tag === "unit") {
    encode = (value, label) => { if (value !== undefined && value !== null) throw new Error(`${label} must be Unit`); return 0; };
    decode = () => undefined;
  } else if (view.tag === "boolean") {
    const no = view.false, yes = view.true;
    encode = (value, label) => { if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`); return value ? yes : no; };
    decode = value => value === yes;
  } else {
    const names = [...view.cases], ordinals = new Map(names.map((name, index) => [name, index]));
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
        const n = normalizeBoundedUnsignedBigInt(value, label, max, "UInt64");
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
