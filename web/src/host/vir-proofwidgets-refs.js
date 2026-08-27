/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { hostResourceValue, isHostResource } from "../host-resource.js";

export function normalizeProofWidgetsRpcRef(ref) {
  if (ref === null || typeof ref !== "object") {
    return null;
  }
  const id = stringField(ref.id);
  if (id.length === 0) {
    return null;
  }
  const normalized = {
    id,
    label: stringField(ref.label),
    typeName: stringField(ref.typeName),
    summary: stringField(ref.summary),
    expression: stringField(ref.expression),
    typeText: stringField(ref.typeText),
    context: stringField(ref.context),
  };
  const serverRef = proofWidgetsServerRpcRef(ref);
  if (serverRef !== null) {
    normalized.serverRef = serverRef;
  }
  return normalized;
}

export function normalizeProofWidgetsResolvedRef(ref) {
  const value = ref !== null && typeof ref === "object" ? ref : {};
  return {
    id: stringField(value.id),
    label: stringField(value.label),
    typeName: stringField(value.typeName),
    summary: stringField(value.summary),
    expression: stringField(value.expression),
    typeText: stringField(value.typeText),
    context: stringField(value.context),
    source: stringField(value.source),
    position: stringField(value.position),
    packageRevision: stringField(value.packageRevision),
    storeKey: stringField(value.storeKey),
    knownConstant: value.knownConstant === true,
  };
}

function stringField(value) {
  return typeof value === "string" ? value : "";
}

function proofWidgetsServerRpcRef(ref) {
  if (isRpcRefObject(ref.serverRef)) {
    return ref.serverRef;
  }
  if (isHostResource(ref.serverRef)) {
    const value = hostResourceValue(ref.serverRef);
    return isRpcRefObject(value) ? value : null;
  }
  return null;
}

function isRpcRefObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.__rpcref === "number" || typeof value.p === "number");
}
