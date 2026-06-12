/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const RESOURCE_HANDLE = Symbol("lean-vir.resourceHandle");

export function createResourceHandle(handle) {
  if (!isValidResourceHandle(handle)) {
    throw new Error("resource handle must be a positive 32-bit integer");
  }
  const resource = {};
  Object.defineProperty(resource, RESOURCE_HANDLE, { value: handle });
  return Object.freeze(resource);
}

export function resourceHandleValue(resource) {
  return resource?.[RESOURCE_HANDLE];
}

export function isResourceHandle(resource) {
  return isValidResourceHandle(resourceHandleValue(resource));
}

function isValidResourceHandle(handle) {
  return Number.isInteger(handle) && handle > 0 && handle <= 0xffffffff;
}
