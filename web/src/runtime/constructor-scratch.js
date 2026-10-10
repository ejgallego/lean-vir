/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Temporary argument buffers for one lowering operation. Constructors consume
// their object fields; these buffers never own those fields or outlive the call.
export class ConstructorScratch {
  constructor(runtime) {
    this.runtime = runtime;
    this.regions = [];
  }

  reserve(index, size) {
    if (size === 0) return 0;
    const region = (this.regions[index] ??= { ptr: 0, capacity: 0 });
    if (size > region.capacity) {
      const capacity = Math.max(size, region.capacity * 2);
      const ptr = this.runtime.allocByteLength(capacity, "constructor scratch");
      if (region.ptr !== 0) this.runtime.freeBytes(region.ptr);
      region.ptr = ptr;
      region.capacity = capacity;
      region.view = undefined;
    }
    return region.ptr;
  }

  writeObjects(ptr, fields) {
    if (fields.length === 0) return;
    const region = this.regions[0];
    const buffer = this.runtime.exports.memory.buffer;
    // Allocation or memory.grow invalidates a previous view. It is retained
    // only inside this lowering operation, alongside its owned scratch region.
    if (region.view === undefined || region.view.buffer !== buffer)
      region.view = new DataView(buffer, ptr, region.capacity);
    for (let i = 0; i < fields.length; i++)
      region.view.setUint32(i * 4, fields[i], true);
  }

  createObjects(tag, fields, label) {
    const ptr = this.reserve(0, fields.length * 4);
    this.writeObjects(ptr, fields);
    const result = this.runtime.exports.vir_obj_ctor(tag, ptr, fields.length);
    if (result === 0)
      throw new Error(
        `${label} could not be lowered to a Lean constructor object`,
      );
    fields.length = 0;
    return result;
  }

  create(tag, layout, label) {
    const runtime = this.runtime;
    const fields = layout.objectFields;
    if (layout.usizeFields.length === 0 && layout.scalarBytes.byteLength === 0)
      return this.createObjects(tag, fields, label);
    const objectsPtr = this.reserve(0, fields.length * 4);
    this.writeObjects(objectsPtr, fields);
    const pointerBytes = runtime.targetPointerBytes();
    const usizePtr = this.reserve(1, layout.usizeFields.length * pointerBytes);
    const scalarPtr = this.reserve(2, layout.scalarBytes.byteLength);
    // reserve can grow memory. Obtain every view after all allocations.
    const buffer = runtime.exports.memory.buffer;
    const usize = new DataView(
      buffer,
      usizePtr,
      layout.usizeFields.length * pointerBytes,
    );
    for (let i = 0; i < layout.usizeFields.length; i++) {
      if (pointerBytes === 4)
        usize.setUint32(i * 4, Number(layout.usizeFields[i]), true);
      else usize.setBigUint64(i * 8, layout.usizeFields[i], true);
    }
    new Uint8Array(buffer, scalarPtr, layout.scalarBytes.byteLength).set(
      layout.scalarBytes,
    );
    const result = runtime.exports.vir_obj_ctor_layout(
      tag,
      objectsPtr,
      fields.length,
      usizePtr,
      layout.usizeFields.length,
      scalarPtr,
      layout.scalarBytes.byteLength,
    );
    if (result === 0)
      throw new Error(
        `${label} could not be lowered to a Lean constructor object`,
      );
    fields.length = 0;
    return result;
  }

  dispose() {
    for (const region of this.regions) {
      if (region === undefined) continue;
      if (region.ptr !== 0) this.runtime.freeBytes(region.ptr);
      region.ptr = region.capacity = 0;
    }
  }
}
