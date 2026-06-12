/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const hostResourceState = new WeakMap();

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
  if (typeof value !== "object" && typeof value !== "function") {
    throw new Error("host resource value must be an object");
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

export function releaseHostResource(resource) {
  const state = hostResourceState.get(resource);
  if (state !== undefined) {
    state.value = null;
  }
}
