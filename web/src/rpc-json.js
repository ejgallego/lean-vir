/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/** Map an ordinary JSON value to the recursive VIR `RpcJson` ABI shape. */
export function rpcJsonFromValue(value, path = "RPC result") {
  if (value === null) {
    return { kind: "null" };
  }
  if (typeof value === "boolean") {
    return { kind: "bool", value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number`);
    }
    return rpcJsonNumber(value, path);
  }
  if (typeof value === "string") {
    return { kind: "string", value };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      value: value.map((item, index) =>
        rpcJsonFromValue(item, `${path}[${index}]`),
      ),
    };
  }
  if (typeof value === "object") {
    return {
      kind: "object",
      value: Object.entries(value).map(([key, item]) => ({
        fst: key,
        snd: rpcJsonFromValue(item, `${path}.${key}`),
      })),
    };
  }
  throw new Error(`${path} contains unsupported ${typeof value}`);
}

function rpcJsonNumber(value, path) {
  const source = String(Object.is(value, -0) ? 0 : value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/u.exec(source);
  if (match === null) {
    throw new Error(`${path} contains unsupported JSON number ${source}`);
  }
  const [, sign, whole, fraction = "", scientific = "0"] = match;
  const decimalPlaces = fraction.length - Number(scientific);
  let mantissa = BigInt(`${sign}${whole}${fraction}`);
  let exponent = decimalPlaces;
  if (decimalPlaces < 0) {
    mantissa *= 10n ** BigInt(-decimalPlaces);
    exponent = 0;
  }
  return {
    kind: "number",
    fields: { mantissa: mantissa.toString(), exponent },
  };
}
