/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const EXTERNREF_TABLE_INITIAL_LENGTH = 1;
const hostResourceState = new WeakMap();
let externrefTableSupport = null;

export function hasExternrefTableSupport() {
  if (externrefTableSupport !== null) {
    return externrefTableSupport;
  }
  try {
    const table = new WebAssembly.Table({
      element: "externref",
      initial: EXTERNREF_TABLE_INITIAL_LENGTH,
    });
    const marker = { kind: "lean-vir.externref-table-probe" };
    table.set(0, marker);
    externrefTableSupport = table.get(0) === marker;
  } catch {
    externrefTableSupport = false;
  }
  return externrefTableSupport;
}

export function requireExternrefTableSupport() {
  if (!hasExternrefTableSupport()) {
    throw new Error("Lean VIR React/browser host resources require WebAssembly externref support");
  }
}

class HostResource {
  constructor(value, label) {
    hostResourceState.set(this, { value, label });
    Object.freeze(this);
  }
}

export function createHostResource(value, label = null) {
  if (value === null || value === undefined) {
    throw new Error("host resource value must not be null");
  }
  return new HostResource(value, label);
}

export function isHostResource(resource) {
  return hostResourceState.has(resource);
}

export function hostResourceValue(resource) {
  return hostResourceState.get(resource)?.value;
}

export function hostResourceLabel(resource) {
  return hostResourceState.get(resource)?.label ?? null;
}

export function hostResourceExternref(resource) {
  return isHostResource(resource) && hostResourceValue(resource) !== null ? resource : null;
}

export function normalizeHostResource(resource, label = "host resource") {
  if (hostResourceExternref(resource) === null) {
    throw new Error(`${label} must be a live host resource`);
  }
  return resource;
}

export function releaseHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state !== undefined) {
    state.value = null;
  }
}

export class ExternrefResourceRoots {
  constructor({ initial = EXTERNREF_TABLE_INITIAL_LENGTH } = {}) {
    requireExternrefTableSupport();
    this.table = new WebAssembly.Table({ element: "externref", initial });
    this.freeRootIds = [];
  }

  root(value) {
    const resource = hostResourceExternref(value);
    if (resource === null) {
      return 0;
    }
    const rootId = this.freeRootIds.pop() ?? this.table.grow(1);
    if (rootId <= 0 || rootId > 0xffffffff) {
      throw new Error("Lean VIR externref resource root table exceeded the 32-bit root id range");
    }
    this.table.set(rootId, resource);
    return rootId;
  }

  get(rootId) {
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId >= this.table.length) {
      return null;
    }
    return this.table.get(rootId);
  }

  release(rootId) {
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId >= this.table.length) {
      return undefined;
    }
    if (this.table.get(rootId) !== null) {
      this.table.set(rootId, null);
      this.freeRootIds.push(rootId);
    }
    return undefined;
  }

  clear() {
    for (let rootId = 1; rootId < this.table.length; rootId += 1) {
      this.table.set(rootId, null);
    }
    this.freeRootIds.length = 0;
  }
}
