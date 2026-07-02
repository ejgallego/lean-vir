/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { VIR_HOST_RESOLVE_BINDING } from "../host-resource.js";

export function createJsValueHostBindings(resources) {
  const bindings = {
    [VIR_HOST_RESOLVE_BINDING]: (target) => jsValueConversionBinding(resources, target),
  };
  for (const [target, codec] of Object.entries(jsValueCodecs)) {
    bindings[target] = (value) => resources.resourceForValue(codec.toJs(value));
    bindings[`${target}.value`] = (value) => codec.fromJs(resources.resolveResource(value, "Js"));
  }
  return bindings;
}

const explicitJsValuePrefix = "js.value.";

function jsValueConversionBinding(resources, target) {
  if (!target.startsWith(explicitJsValuePrefix) || target === "js.value.value") {
    return undefined;
  }
  if (target.endsWith(".value")) {
    return (value) => resources.resolveResource(value, "Js");
  }
  return (value) => resources.resourceForValue(value);
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
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("js.float expects a finite number");
  }
  return value;
}

function jsFloatPayload(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("js.float.value expects a finite JS number");
  }
  return value;
}
