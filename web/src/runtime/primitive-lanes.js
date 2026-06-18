/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { WIRE } from "./wire-tags.js";

export const PRIMITIVE_LANE = Object.freeze({
  UNIT: 0,
  U32: 1,
  F64: 2,
  STRING: 3,
});

export function primitiveLaneForTag(tag) {
  if (tag === WIRE.UNIT) return PRIMITIVE_LANE.UNIT;
  if (tag === WIRE.BOOL || tag === WIRE.UINT8 || tag === WIRE.UINT16 || tag === WIRE.UINT32) {
    return PRIMITIVE_LANE.U32;
  }
  if (tag === WIRE.FLOAT || tag === WIRE.FLOAT32) return PRIMITIVE_LANE.F64;
  if (tag === WIRE.STRING) return PRIMITIVE_LANE.STRING;
  return null;
}

export function readPrimitiveResult(runtime, lane, tag) {
  if (lane === PRIMITIVE_LANE.UNIT) {
    return undefined;
  }
  if (lane === PRIMITIVE_LANE.U32) {
    if (typeof runtime.exports.vir_call_primitive_u32_result !== "function") {
      throw new Error("vir_call_primitive_u32_result export is missing");
    }
    const value = runtime.exports.vir_call_primitive_u32_result();
    return tag === WIRE.BOOL ? value !== 0 : value;
  }
  if (lane === PRIMITIVE_LANE.F64) {
    if (typeof runtime.exports.vir_call_primitive_f64_result !== "function") {
      throw new Error("vir_call_primitive_f64_result export is missing");
    }
    const value = runtime.exports.vir_call_primitive_f64_result();
    return tag === WIRE.FLOAT32 ? Math.fround(value) : value;
  }
  if (lane === PRIMITIVE_LANE.STRING) {
    return runtime.readWasmString(
      runtime.exports.vir_call_primitive_string_result(),
      runtime.exports.vir_call_result_size(),
    );
  }
  throw new Error(`unsupported primitive result lane ${lane}`);
}
