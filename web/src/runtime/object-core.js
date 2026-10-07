/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  directJsArgumentSupported,
  directJsResultSupported,
} from "./js-value-support.js";
import { OBJECT_VALUE_EXPORTS } from "./object-abi-exports.js";
const textEncoder = new TextEncoder();

// A JSL value is an ordinary JavaScript object. Its Lean root lives only in
// this out-of-band cell, and ordinary JavaScript reachability controls when
// that root is released.
const leanObjectHandleStates = new WeakMap();
const leanObjectHandleFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((weakCell) => {
        const cell = weakCell.deref();
        if (cell === undefined) return;
        try {
          releaseLeanObjectHandleCell(cell, true);
        } catch (error) {
          cell?.runtime?.hostState?.recordFinalizerError(error);
        }
      })
    : null;

function normalizeObjectPointer(value, label) {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a live Lean object pointer`);
  }
  return value >>> 0;
}

function releaseLeanObjectHandleCell(cell, fromFinalizer = false) {
  const onRelease = cell?.onRelease;
  if (cell !== null && cell !== undefined) {
    cell.onRelease = null;
  }
  if (cell?.live !== true) {
    if (typeof onRelease === "function") onRelease();
    return false;
  }
  cell.live = false;
  if (!fromFinalizer) {
    leanObjectHandleFinalizer?.unregister(cell);
  }
  try {
    cell.runtime.exports.vir_obj_dec(cell.object);
  } finally {
    if (typeof onRelease === "function") onRelease();
  }
  return true;
}

function createLeanObjectHandle(cell) {
  if (cell?.live !== true) {
    throw new Error("cannot create a released Lean object handle");
  }
  const handle = {};
  leanObjectHandleStates.set(handle, cell);
  // Weakening the entire cleanup record also avoids rooting the generation
  // through cell.onRelease. The live handle and host tracking set still own it.
  leanObjectHandleFinalizer?.register(handle, new WeakRef(cell), cell);
  return handle;
}

function requireLeanObjectHandle(resource, runtime, label) {
  const cell = leanObjectHandleStates.get(resource);
  if (cell?.runtime !== runtime || cell.live !== true) {
    throw new Error(`${label} must be a live Lean object handle resource`);
  }
  normalizeObjectPointer(cell.object, label);
  return cell;
}

export function requireString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

export class ObjectRuntime {
  hasObjectValueExports() {
    return ["vir_call_resolved_objects", ...OBJECT_VALUE_EXPORTS].every(
      (name) => typeof this.exports[name] === "function",
    );
  }

  makeJsObjectValue(type, value, label) {
    if (!directJsResultSupported(type)) {
      throw new Error(`${label} has unsupported direct JavaScript result type`);
    }
    return this.makeObjectValue(type, value, label);
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

  withWasmString(value, label, callback) {
    const bytes = textEncoder.encode(requireString(value, label));
    const inputPtr = this.allocBytes(bytes);
    try {
      return callback(inputPtr, bytes.byteLength);
    } finally {
      this.freeBytes(inputPtr);
    }
  }

  makeObjectResource(value, label) {
    const argObj = this.exports.vir_obj_resource(value);
    if (argObj === 0) {
      throw new Error(
        `${label} could not be lowered to a Lean host resource object`,
      );
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
    try {
      if (typeof this.hostState?.trackLeanObjectHandleCell !== "function") {
        throw new Error(
          `${label} requires deterministic Lean object handle tracking`,
        );
      }
      this.hostState.trackLeanObjectHandleCell(cell);
      return createLeanObjectHandle(cell);
    } catch (error) {
      releaseLeanObjectHandleCell(cell);
      throw error;
    }
  }

  leanObjectHandleCell(resource, label) {
    return requireLeanObjectHandle(resource, this, label);
  }

  releaseLeanObjectHandleCell(cell) {
    return releaseLeanObjectHandleCell(cell);
  }

  releaseOwnedObjects(objects) {
    for (const obj of objects) {
      if (obj !== 0) {
        this.exports.vir_obj_dec(obj);
      }
    }
    objects.length = 0;
  }

  callResolvedObjects(entry, cache, argObjs, liftResult, timing = null) {
    const callSlot = this.resolveCallSlot(entry, cache);
    let argvPtr = 0;
    let resultObj = 0;
    let decodeStarted;
    try {
      if (this.hostState?.callError) throw this.hostState.callError;
      if (argObjs.length !== 0) {
        const marshalStarted = timing?.beginPhase();
        try {
          argvPtr = this.allocByteLength(
            argObjs.length * 4,
            `${entry.entry} argv pointer array`,
          );
          this.writePointerArray(argvPtr, argObjs);
        } finally {
          if (timing !== null) timing.endMarshal(marshalStarted);
        }
      }

      try {
        const argc = argObjs.length;
        // Wasm consumes these references even when execution traps.
        argObjs.length = 0;
        if (timing === null) {
          resultObj = this.exports.vir_call_resolved_objects(
            callSlot,
            argvPtr,
            argc,
          );
        } else {
          this.hostState?.beginCallTiming(timing);
          const executeStarted = timing.beginPhase();
          try {
            resultObj = this.exports.vir_call_resolved_objects(
              callSlot,
              argvPtr,
              argc,
            );
          } finally {
            try {
              timing.endExecute(executeStarted);
            } finally {
              this.hostState?.endCallTiming(timing);
            }
          }
        }
      } catch (error) {
        throw this.hostState?.takeCallError() ?? error;
      }

      decodeStarted = timing?.beginPhase();
      const hostError = this.hostState?.takeCallError();
      if (hostError) {
        throw hostError;
      }
      if (resultObj === 0) {
        // A caught reentrant call can leave its diagnostic behind even when
        // this call succeeds. The ABI signals failure with a null result.
        const error = this.lastCallError();
        throw new Error(error || `object call failed: ${entry.entry}`);
      }
      return liftResult(resultObj);
    } finally {
      if (argvPtr !== 0) {
        this.freeBytes(argvPtr);
      }
      if (resultObj !== 0) {
        this.exports.vir_obj_dec(resultObj);
      }
      if (timing !== null && decodeStarted !== undefined) {
        timing.endDecode(decodeStarted);
      }
    }
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

  readObjectScalar(obj, label) {
    if (this.exports.vir_obj_is_scalar(obj) === 0) {
      throw new Error(`${label} is not a Lean scalar object`);
    }
    return this.exports.vir_obj_scalar_value(obj) >>> 0;
  }

  liftJsObjectValue(type, obj, label) {
    if (!directJsArgumentSupported(type)) {
      throw new Error(
        `${label} has unsupported direct JavaScript argument type`,
      );
    }
    return this.liftObjectValue(type, obj, label);
  }

  liftObjectResource(obj, label) {
    if (this.exports.vir_obj_resource_is_valid(obj) !== 0) {
      return this.exports.vir_obj_resource_externref(obj);
    }
    throw new Error(`${label} did not lift to a live host resource`);
  }

  retainLeanObjectHandleValue(resource, label) {
    const cell = requireLeanObjectHandle(resource, this, label);
    const object = normalizeObjectPointer(cell.object, label);
    this.exports.vir_obj_inc(object);
    return object;
  }
}
