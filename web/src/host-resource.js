/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const EXTERNREF_TABLE_INITIAL_LENGTH = 1;
const HOST_RESOURCE_RETENTION = Object.freeze({
  MOVE_ONLY: "move-only",
  PASSIVE: "passive",
  RETAINABLE: "retainable",
});
export const VIR_HOST_DISPOSE = Symbol.for("lean-vir.hostDispose");
export const VIR_HOST_RESOLVE_BINDING = Symbol.for("lean-vir.hostResolveBinding");
const hostResourceState = new WeakMap();
const hostResourceTicketState = new WeakMap();
const hostResourceOwnerState = new WeakMap();
const hostResourcePayloadLifetimes = new WeakMap();
const hostResourceFinalizer = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((ticket) => finalizeHostResourceTicket(ticket))
  : null;
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

export function hasHostResourceFinalizationSupport() {
  return hostResourceFinalizer !== null && typeof WeakRef === "function";
}

class HostResource {
  constructor(value, label, {
    dispose = null,
    owner = null,
    onAbandon = null,
    onFinalize = null,
    onRelease = null,
    onTake = null,
    reportFinalizerError = null,
    retainResource = null,
    retentionPolicy = null,
    revocationGroup = null,
  } = {}) {
    const ticket = Object.freeze({});
    const metadata = Object.freeze({
      retentionPolicy: normalizeHostResourceRetentionPolicy(value, retentionPolicy, {
        dispose,
        onAbandon,
        onFinalize,
        onRelease,
        onTake,
      }),
      retainResource,
      revocationGroup,
    });
    const state = {
      value,
      label,
      dispose,
      owner,
      onAbandon,
      onFinalize,
      onRelease,
      onTake,
      reportFinalizerError,
      ticket,
      metadata,
    };
    hostResourceState.set(this, state);
    hostResourceTicketState.set(ticket, state);
    if (typeof dispose === "function" || typeof onFinalize === "function") {
      hostResourceFinalizer?.register(this, ticket, ticket);
    }
    Object.freeze(this);
  }

  release() {
    return releaseHostResource(this);
  }

  dispose() {
    return releaseHostResource(this);
  }

  [VIR_HOST_DISPOSE]() {
    return releaseHostResource(this);
  }
}

if (typeof Symbol.dispose === "symbol") {
  Object.defineProperty(HostResource.prototype, Symbol.dispose, {
    configurable: true,
    value() {
      return releaseHostResource(this);
    },
  });
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
  if (state.metadata.retentionPolicy === HOST_RESOURCE_RETENTION.MOVE_ONLY) {
    throw new Error(`${label ?? state.label ?? "host resource"} does not support independent retain()`);
  }
  if (state.metadata.retentionPolicy === HOST_RESOURCE_RETENTION.PASSIVE) {
    return createHostResource(value, label ?? state.label, {
      owner: state.owner,
      retentionPolicy: HOST_RESOURCE_RETENTION.PASSIVE,
    });
  }
  if (typeof state.metadata.retainResource === "function") {
    return state.metadata.retainResource(value, label ?? state.label);
  }
  const retained = retainHostResourcePayload(value);
  try {
    return createHostResource(retained, label ?? state.label, {
      owner: state.owner,
      dispose: () => releaseHostResourcePayload(retained),
      reportFinalizerError: state.reportFinalizerError,
    });
  } catch (error) {
    const errors = [asError(error)];
    try {
      releaseHostResourcePayload(retained);
    } catch (cleanupError) {
      errors.push(asError(cleanupError));
    }
    throwHostResourceErrors(errors, "host resource retain failed during ownership rollback");
  }
}

export function releaseHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || state.value === null || state.value === undefined) return false;
  hostResourceFinalizer?.unregister(state.ticket);
  return releaseHostResourceState(state, resource);
}

// Host bindings may install an active registration before its result wrapper
// has been lowered into Lean. That ownership is provisional until complete
// result conversion succeeds. Abandonment rolls back the provisional action
// and then invalidates the wrapper; ordinary release only invalidates it.
export function abandonHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || state.value === null || state.value === undefined) return false;
  const onAbandon = state.onAbandon;
  state.onAbandon = null;
  const errors = [];
  if (typeof onAbandon === "function") {
    try {
      onAbandon(state.value);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  try {
    releaseHostResource(resource);
  } catch (error) {
    errors.push(asError(error));
  }
  throwHostResourceErrors(errors, "host resource abandonment failed");
  return true;
}

export function commitHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || state.value === null || state.value === undefined) return false;
  state.onAbandon = null;
  return true;
}

// An opaque release ticket names the same idempotent obligation as its public
// wrapper without directly retaining that wrapper. Runtime owners keep tickets,
// not WeakRefs to wrappers, so deterministic teardown does not depend on GC or
// FinalizationRegistry scheduling. Payload-to-wrapper back-edges remain an
// unsupported mixed ownership cycle documented in HOST_BINDINGS.md.
export function hostResourceReleaseTicket(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || state.value === null || state.value === undefined) return null;
  return state.ticket;
}

export function releaseHostResourceTicket(ticket) {
  const state = hostResourceTicketState.get(ticket);
  if (state === undefined || state.value === null || state.value === undefined) return false;
  hostResourceFinalizer?.unregister(ticket);
  return releaseHostResourceState(state, null);
}

export function transferHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state === undefined || state.value === null || state.value === undefined) return false;
  const onTake = state.onTake;
  if (typeof onTake === "function") onTake(resource);
  state.onTake = null;
  return true;
}

export class ExternrefResourceRoots {
  constructor({ initial = EXTERNREF_TABLE_INITIAL_LENGTH } = {}) {
    requireExternrefTableSupport();
    if (!Number.isInteger(initial) || initial < 1) {
      throw new Error("externref resource root table initial length must reserve root id 0");
    }
    this.table = new WebAssembly.Table({ element: "externref", initial }, null);
    this.freeRootIds = [];
    for (let rootId = initial - 1; rootId >= 1; rootId -= 1) {
      this.freeRootIds.push(rootId);
    }
    this.liveRootIds = new Set();
    this.ownedRootIds = new Set();
  }

  root(value, { owned = false } = {}) {
    const resource = hostResourceExternref(value);
    if (resource === null) {
      return 0;
    }
    const rootId = this.freeRootIds.pop() ?? this.table.grow(1, null);
    if (rootId <= 0 || rootId > 0xffffffff) {
      throw new Error("Lean VIR externref resource root table exceeded the 32-bit root id range");
    }
    this.table.set(rootId, resource);
    this.liveRootIds.add(rootId);
    if (owned) {
      this.ownedRootIds.add(rootId);
    }
    return rootId;
  }

  get(rootId, { take = false } = {}) {
    if (!Number.isInteger(rootId) || !this.liveRootIds.has(rootId)) {
      return null;
    }
    const resource = this.table.get(rootId);
    if (resource !== null && take && this.ownedRootIds.has(rootId)) {
      transferHostResource(resource);
      this.ownedRootIds.delete(rootId);
    }
    return resource;
  }

  release(rootId) {
    if (!Number.isInteger(rootId) || !this.liveRootIds.delete(rootId)) {
      return undefined;
    }
    const resource = this.table.get(rootId);
    const owned = this.ownedRootIds.delete(rootId);
    this.table.set(rootId, null);
    this.freeRootIds.push(rootId);
    if (owned) releaseHostResource(resource);
    return undefined;
  }

  clear() {
    const errors = [];
    for (const rootId of Array.from(this.liveRootIds)) {
      try {
        this.release(rootId);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "externref resource root cleanup failed");
  }

  debugCounts() {
    return {
      active: this.liveRootIds.size,
      capacity: this.table.length - 1,
      reusable: this.freeRootIds.length,
    };
  }

  isOwned(rootId) {
    return Number.isInteger(rootId) && this.liveRootIds.has(rootId) && this.ownedRootIds.has(rootId);
  }
}

function releaseHostResourceState(state, resource) {
  const value = state.value;
  const dispose = state.dispose;
  const onRelease = state.onRelease;
  const onFinalize = state.onFinalize;
  const ticket = state.ticket;
  state.value = null;
  state.dispose = null;
  state.onAbandon = null;
  state.onFinalize = null;
  state.onRelease = null;
  state.onTake = null;
  state.reportFinalizerError = null;
  hostResourceTicketState.delete(ticket);
  const errors = [];
  const transition = resource === null ? onFinalize : onRelease;
  if (typeof transition === "function") {
    try {
      transition(resource);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  if (typeof dispose === "function") {
    try {
      dispose(value);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  throwHostResourceErrors(errors, "host resource release failed");
  return true;
}

function finalizeHostResourceTicket(ticket) {
  const state = hostResourceTicketState.get(ticket);
  if (state?.value === null || state?.value === undefined) return;
  const value = state.value;
  const dispose = state.dispose;
  const onFinalize = state.onFinalize;
  const report = state.reportFinalizerError;
  state.value = null;
  state.dispose = null;
  state.onAbandon = null;
  state.onFinalize = null;
  state.onRelease = null;
  state.onTake = null;
  state.reportFinalizerError = null;
  hostResourceTicketState.delete(ticket);
  const errors = [];
  if (typeof onFinalize === "function") {
    try {
      onFinalize();
    } catch (error) {
      errors.push(asError(error));
    }
  }
  if (typeof dispose === "function") {
    try {
      dispose(value);
    } catch (error) {
      errors.push(asError(error));
    }
  }
  if (typeof report === "function") {
    for (const error of errors) {
      try {
        report(error);
      } catch {
        // Finalization must never surface an exception through the host job queue.
      }
    }
  }
}

function normalizeHostResourceRetentionPolicy(value, policy, lifecycle) {
  const normalized = policy ?? (
    isRetainableHostResourcePayload(value)
      ? HOST_RESOURCE_RETENTION.RETAINABLE
      : hostResourceHasOwnedLifecycle(lifecycle)
        ? HOST_RESOURCE_RETENTION.MOVE_ONLY
        : HOST_RESOURCE_RETENTION.PASSIVE
  );
  if (!Object.values(HOST_RESOURCE_RETENTION).includes(normalized)) {
    throw new Error(`unsupported host resource retention policy: ${String(normalized)}`);
  }
  if (normalized === HOST_RESOURCE_RETENTION.RETAINABLE && !isRetainableHostResourcePayload(value)) {
    throw new Error("retainable host resource policy requires a registered payload lifetime");
  }
  return normalized;
}

function hostResourceHasOwnedLifecycle(lifecycle) {
  return typeof lifecycle.dispose === "function" ||
    typeof lifecycle.onAbandon === "function" ||
    typeof lifecycle.onFinalize === "function" ||
    typeof lifecycle.onRelease === "function" ||
    typeof lifecycle.onTake === "function";
}

function throwHostResourceErrors(errors, message) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
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
