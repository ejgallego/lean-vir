/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createJsValueHostBindings() {
  const bindings = {};
  for (const [target, codec] of Object.entries(jsValueCodecs)) {
    bindings[target] = (value) => codec.toJs(value);
    bindings[`${target}.value`] = (value) => codec.fromJs(value);
  }
  bindings["js.string.owned"] = jsStringValue;
  bindings["js.string.length"] = (value) => value.length;
  bindings["js.string.equal"] = (left, right) => left === right;
  bindings["js.string.concat"] = (value, suffix) => value.concat(suffix);
  bindings["js.string.interpolate"] = (prefix, value) => `${prefix}${value}`;
  bindings["js.number.toString"] = (value, radix) => value.toString(radix);
  bindings["js.nat.toString"] = (value, radix) => value.toString(radix);
  bindings["js.string.slice"] = (value, start, end) => value.slice(start, end);
  bindings["js.string.includes"] = (value, search) => value.includes(search);
  bindings["js.string.startsWith"] = (value, search) => value.startsWith(search);
  bindings["js.string.endsWith"] = (value, search) => value.endsWith(search);
  bindings["js.string.trim"] = (value) => value.trim();
  bindings["js.string.toLowerCase"] = (value) => value.toLowerCase();
  bindings["js.string.toUpperCase"] = (value) => value.toUpperCase();
  bindings["js.nat.add"] = (left, right) => left + right;
  bindings["js.nat.mul"] = (left, right) => left * right;
  bindings["js.nat.equal"] = (left, right) => left === right;
  bindings["js.nat.lt"] = (left, right) => left < right;
  bindings["js.nat.le"] = (left, right) => left <= right;
  bindings["js.number.add"] = (left, right) => left + right;
  bindings["js.number.sub"] = (left, right) => left - right;
  bindings["js.number.mul"] = (left, right) => left * right;
  bindings["js.number.div"] = (left, right) => left / right;
  bindings["js.number.rem"] = (left, right) => left % right;
  bindings["js.number.neg"] = (value) => -value;
  bindings["js.number.equal"] = (left, right) => left === right;
  bindings["js.number.lt"] = (left, right) => left < right;
  bindings["js.number.le"] = (left, right) => left <= right;
  bindings["js.number.isNaN"] = (value) => Number.isNaN(value);
  bindings["js.number.isFinite"] = (value) => Number.isFinite(value);
  bindings["js.number.isInteger"] = (value) => Number.isInteger(value);
  bindings["js.boolean.not"] = (value) => !value;
  bindings["js.boolean.equal"] = (left, right) => left === right;
  bindings["js.string.isString"] = (value) => typeof value === "string";
  bindings["js.number.isNumber"] = (value) => typeof value === "number";
  bindings["js.boolean.isBoolean"] = (value) => typeof value === "boolean";
  bindings["js.number.fromAny"] = (value) => {
    if (typeof value !== "number") throw new TypeError("js.number.fromAny expects a primitive JavaScript number");
    return value;
  };
  bindings["js.boolean.fromAny"] = (value) => {
    if (typeof value !== "boolean") throw new TypeError("js.boolean.fromAny expects a primitive JavaScript boolean");
    return value;
  };
  bindings["js.string.fromAny"] = (value) => {
    if (typeof value !== "string") {
      throw new TypeError("js.string.fromAny expects a primitive JavaScript string");
    }
    return value;
  };
  bindings["js.float.owned"] = jsFloatValue;
  bindings["js.undefined"] = () => undefined;
  bindings["js.undefinedOr.isUndefined"] = (value) => value === undefined;
  bindings["js.undefinedOr.value"] = (value) => {
    if (value === undefined) {
      throw new TypeError("js.undefinedOr.value expects a defined value");
    }
    return value;
  };
  bindings["js.nullable.null"] = () => null;
  bindings["js.nullable.of"] = (value) => value;
  bindings["js.nullable.isNull"] = (value) => value === null;
  bindings["js.nullable.value"] = (value) => {
    if (value === null) {
      throw new Error("js.nullable.value expects a non-null nullable value");
    }
    return value;
  };
  return bindings;
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
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
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
