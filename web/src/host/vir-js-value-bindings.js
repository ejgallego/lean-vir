/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  hostResourceValue,
  isRetainableHostResourcePayload,
  registerHostResourcePayloadLifetime,
  releaseHostResourcePayload,
  retainHostResourcePayload,
} from "../host-resource.js";
import { collectCleanupError, throwCollectedErrors } from "../runtime/cleanup.js";

export function createJsValueHostBindings(resources) {
  const bindings = {};
  for (const [target, codec] of Object.entries(jsValueCodecs)) {
    bindings[target] = (value) => resources.resourceForValue(codec.toJs(value));
    bindings[`${target}.value`] = (value) => codec.fromJs(resources.resolveResource(value, "Js"));
  }
  bindings["js.string.owned"] = (value) => resources.ownedResourceForValue(jsStringValue(value));
  bindings["js.float.owned"] = (value) => resources.ownedResourceForValue(jsFloatValue(value));
  bindings["js.nullable.null"] = () => resources.adoptResourceForValue(createNullableValue(null));
  bindings["js.nullable.of"] = (value) =>
    resources.adoptResourceForValue(createNullableValue(composableResourcePayload(resources, value, "Js")));
  bindings["js.nullable.isNull"] = (value) =>
    resources.resourceForValue(nullablePayload(resources, value) === null);
  bindings["js.nullable.value"] = (value) => {
    const payload = nullablePayload(resources, value);
    if (payload === null) {
      throw new Error("js.nullable.value expects a non-null nullable value");
    }
    return resources.resourceForValue(payload);
  };
  return bindings;
}

function composableResourcePayload(resources, resource, label) {
  try {
    return resources.resolveResource(resource, label);
  } catch (error) {
    const payload = hostResourceValue(resource);
    if (payload !== null && payload !== undefined && isRetainableHostResourcePayload(payload)) {
      return payload;
    }
    throw error;
  }
}

const nullableBrand = Symbol("lean-vir.jsNullable");

export function createNullableValue(value) {
  const payload = value === undefined ? null : value;
  if (!isRetainableHostResourcePayload(payload)) {
    return Object.freeze({
      [nullableBrand]: true,
      value: payload,
    });
  }
  const retained = retainHostResourcePayload(payload);
  let live = true;
  const nullable = Object.freeze({
    [nullableBrand]: true,
    value: retained,
  });
  try {
    registerHostResourcePayloadLifetime(nullable, {
      children: [retained],
      retain: () => {
        if (!live) throw new Error("cannot retain a released Js.Nullable payload");
        return createNullableValue(retained);
      },
      release: () => {
        if (!live) return false;
        live = false;
        return releaseHostResourcePayload(retained);
      },
    });
    return nullable;
  } catch (error) {
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => releaseHostResourcePayload(retained));
    throwCollectedErrors(errors, "Js.Nullable ownership failed during rollback");
  }
}

export function nullablePayload(resources, value) {
  const nullable = resources.resolveResource(value, "JsNullable");
  if (typeof nullable !== "object" || nullable === null || nullable[nullableBrand] !== true) {
    throw new Error("JsNullable resource must contain a nullable value");
  }
  return nullable.value === undefined ? null : nullable.value;
}

const jsValueCodecs = {
  "js.string": {
    toJs: jsStringValue,
    fromJs: jsStringPayload,
  },
  "js.nat": {
    toJs: jsNatValue,
    fromJs: jsNatPayload,
  },
  "js.bool": {
    toJs: jsBoolValue,
    fromJs: jsBoolPayload,
  },
  "js.float": {
    toJs: jsFloatValue,
    fromJs: jsFloatPayload,
  },
};

function jsStringValue(value) {
  if (typeof value !== "string") {
    throw new Error("js.string expects a string");
  }
  return value;
}

function jsStringPayload(value) {
  if (typeof value !== "string") {
    throw new Error("js.string.value expects a JS string");
  }
  return value;
}

function jsNatValue(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("js.nat expects a natural number");
  }
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error("js.nat expects a natural number");
  }
  return BigInt(text);
}

function jsNatPayload(value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("js.nat.value expects a JS natural number");
  }
  return value;
}

function jsBoolValue(value) {
  if (typeof value !== "boolean") {
    throw new Error("js.bool expects a boolean");
  }
  return value;
}

function jsBoolPayload(value) {
  if (typeof value !== "boolean") {
    throw new Error("js.bool.value expects a JS boolean");
  }
  return value;
}

function jsFloatValue(value) {
  if (typeof value !== "number") {
    throw new Error("js.float expects a number");
  }
  return value;
}

function jsFloatPayload(value) {
  if (typeof value !== "number") {
    throw new Error("js.float.value expects a JS number");
  }
  return value;
}
