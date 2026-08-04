/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const EXTERNREF_TABLE_INITIAL_LENGTH = 1;
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");
export const VIR_HOST_RESOLVE_BINDING = Symbol.for("lean-vir.hostResolveBinding");
const hostResourceState = new WeakMap();
const hostResourceOwnerState = new WeakMap();
const hostResourcePayloadLifetimes = new WeakMap();
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
  constructor(value, label, { dispose = null, owner = null } = {}) {
    hostResourceState.set(this, { value, label, dispose, owner });
    Object.freeze(this);
  }
}

export function createHostResourceOwner(label = "host resource owner") {
  const owner = Object.freeze({});
  hostResourceOwnerState.set(owner, { label, phase: "active" });
  return owner;
}

export function beginHostResourceOwnerDisposal(owner) {
  const state = requireHostResourceOwnerState(owner);
  if (state.phase === "active") {
    state.phase = "disposing";
  }
  return state.phase;
}

export function finishHostResourceOwnerDisposal(owner) {
  const state = requireHostResourceOwnerState(owner);
  state.phase = "disposed";
  return state.phase;
}

export function hostResourceOwnerPhase(owner) {
  return hostResourceOwnerState.get(owner)?.phase ?? null;
}

export function createHostResource(value, label = null, options = {}) {
  if (value === null || value === undefined) {
    throw new Error("host resource value must not be null");
  }
  return new HostResource(value, label, options);
}

export function registerHostResourcePayloadLifetime(value, { retain, release, children = [] }) {
  if (!isWeakMapKey(value) || typeof retain !== "function" || typeof release !== "function") {
    throw new Error("host resource payload lifetime requires an object with retain and release functions");
  }
  if (hostResourcePayloadLifetimes.has(value)) {
    throw new Error("host resource payload lifetime is already registered");
  }
  const ownedChildren = normalizeOwnedPayloadChildren(children);
  assertNoPayloadOwnershipCycle(value, ownedChildren);
  hostResourcePayloadLifetimes.set(value, { retain, release, children: ownedChildren });
  return value;
}

export function addHostResourcePayloadChild(owner, child) {
  const lifetime = hostResourcePayloadLifetimes.get(owner);
  if (lifetime === undefined) {
    throw new Error("host resource payload owner has no registered lifetime");
  }
  if (!isRetainableHostResourcePayload(child) || lifetime.children.has(child)) return false;
  assertNoPayloadOwnershipCycle(owner, [child]);
  lifetime.children.add(child);
  return true;
}

export function removeHostResourcePayloadChild(owner, child) {
  return hostResourcePayloadLifetimes.get(owner)?.children.delete(child) ?? false;
}

export function isRetainableHostResourcePayload(value) {
  return isWeakMapKey(value) && hostResourcePayloadLifetimes.has(value);
}

export function retainHostResourcePayload(value) {
  const lifetime = isWeakMapKey(value) ? hostResourcePayloadLifetimes.get(value) : undefined;
  return lifetime === undefined ? value : lifetime.retain();
}

export function releaseHostResourcePayload(value) {
  const lifetime = isWeakMapKey(value) ? hostResourcePayloadLifetimes.get(value) : undefined;
  return lifetime === undefined ? false : lifetime.release();
}

export function isHostResource(resource) {
  return hostResourceState.has(resource);
}

export function hostResourceValue(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || !hostResourceOwnerIsUsable(state.owner)) {
    return null;
  }
  return state.value;
}

export function hostResourceLabel(resource) {
  return hostResourceState.get(resource)?.label ?? null;
}

export function hostResourceOwner(resource) {
  return hostResourceState.get(resource)?.owner ?? null;
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

export function retainHostResource(resource, label = null) {
  const source = normalizeHostResource(resource, label ?? "host resource");
  const state = hostResourceState.get(source);
  const value = state.value;
  if (!isRetainableHostResourcePayload(value)) {
    return createHostResource(value, label ?? state.label, { owner: state.owner });
  }
  const retained = retainHostResourcePayload(value);
  try {
    return createHostResource(retained, label ?? state.label, {
      owner: state.owner,
      dispose: () => releaseHostResourcePayload(retained),
    });
  } catch (error) {
    releaseHostResourcePayload(retained);
    throw error;
  }
}

export function releaseHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state !== undefined) {
    const value = state.value;
    state.value = null;
    const dispose = state.dispose;
    state.dispose = null;
    if (value !== null && value !== undefined && typeof dispose === "function") {
      dispose(value);
    }
  }
}

export class ExternrefResourceRoots {
  constructor({ initial = EXTERNREF_TABLE_INITIAL_LENGTH } = {}) {
    requireExternrefTableSupport();
    this.table = new WebAssembly.Table({ element: "externref", initial });
    this.freeRootIds = [];
    this.ownedRootIds = new Set();
    this.activeRoots = 0;
  }

  root(value, { owned = false } = {}) {
    const resource = hostResourceExternref(value);
    if (resource === null) {
      return 0;
    }
    const rootId = this.freeRootIds.pop() ?? this.table.grow(1);
    if (rootId <= 0 || rootId > 0xffffffff) {
      throw new Error("Lean VIR externref resource root table exceeded the 32-bit root id range");
    }
    this.table.set(rootId, resource);
    if (owned) {
      this.ownedRootIds.add(rootId);
    }
    this.activeRoots++;
    return rootId;
  }

  get(rootId, { take = false } = {}) {
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId >= this.table.length) {
      return null;
    }
    const resource = this.table.get(rootId);
    if (resource !== null && take) {
      this.ownedRootIds.delete(rootId);
    }
    return resource;
  }

  release(rootId) {
    if (!Number.isInteger(rootId) || rootId <= 0 || rootId >= this.table.length) {
      return undefined;
    }
    const resource = this.table.get(rootId);
    if (resource === null) return undefined;
    const owned = this.ownedRootIds.delete(rootId);
    this.table.set(rootId, null);
    this.freeRootIds.push(rootId);
    this.activeRoots--;
    if (owned) releaseHostResource(resource);
    return undefined;
  }

  clear() {
    const errors = [];
    for (let rootId = 1; rootId < this.table.length; rootId += 1) {
      try {
        this.release(rootId);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.freeRootIds.length = 0;
    this.ownedRootIds.clear();
    this.activeRoots = 0;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "externref resource root cleanup failed");
  }

  debugCounts() {
    return {
      active: this.activeRoots,
      capacity: this.table.length - 1,
      reusable: this.freeRootIds.length,
    };
  }
}

function hostResourceOwnerIsUsable(owner) {
  if (owner === null) return true;
  const phase = hostResourceOwnerState.get(owner)?.phase;
  return phase === "active" || phase === "disposing";
}

function isWeakMapKey(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function normalizeOwnedPayloadChildren(children) {
  if (children === null || children === undefined || typeof children[Symbol.iterator] !== "function") {
    throw new Error("host resource payload lifetime children must be iterable");
  }
  const ownedChildren = new Set();
  for (const child of children) {
    if (!isWeakMapKey(child)) {
      throw new Error("host resource payload lifetime children must be objects or functions");
    }
    ownedChildren.add(child);
  }
  return ownedChildren;
}

function assertNoPayloadOwnershipCycle(owner, children) {
  for (const child of children) {
    if (payloadOwnsTransitively(child, owner, new Set())) {
      throw new Error("host resource payload ownership cycle is not supported");
    }
  }
}

function payloadOwnsTransitively(value, target, seen) {
  if (value === target) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  const lifetime = hostResourcePayloadLifetimes.get(value);
  if (lifetime === undefined) return false;
  for (const child of lifetime.children) {
    if (payloadOwnsTransitively(child, target, seen)) return true;
  }
  return false;
}

function requireHostResourceOwnerState(owner) {
  const state = hostResourceOwnerState.get(owner);
  if (state === undefined) {
    throw new Error("host resource owner is invalid");
  }
  return state;
}
