/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const statuses = new Set(["pass", "unsupported"]);
const keys = new Set(["status", "host", "wasm", "reason"]);

function natExpectation(fixture, target) {
  const value = fixture.expect?.[target];
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${fixture.id}: expect.${target} must be a decimal Nat string`);
  }
  return value;
}

export function fixtureExpectation(fixture) {
  const raw = fixture.expect;
  if (raw === undefined) {
    return { status: "pass", host: null, wasm: null, reason: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${fixture.id}: expect must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!keys.has(key)) throw new Error(`${fixture.id}: unknown expect field ${key}`);
  }

  const status = raw.status === undefined ? "pass" : raw.status;
  if (!statuses.has(status)) {
    throw new Error(`${fixture.id}: unknown expect.status ${JSON.stringify(status)}`);
  }
  const host = natExpectation(fixture, "host");
  const wasm = natExpectation(fixture, "wasm");
  const hasTargetResults = host !== null || wasm !== null;
  if (hasTargetResults && (host === null || wasm === null)) {
    throw new Error(`${fixture.id}: target-specific expectations require both expect.host and expect.wasm`);
  }
  if (hasTargetResults && host === wasm) {
    throw new Error(`${fixture.id}: equal host and Wasm results should use the default host-oracle comparison`);
  }

  const reason = raw.reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.trim() === "")) {
    throw new Error(`${fixture.id}: expect.reason must be a non-empty string`);
  }
  if (hasTargetResults && reason === undefined) {
    throw new Error(`${fixture.id}: target-specific expectations require expect.reason`);
  }
  if (status === "unsupported" && hasTargetResults) {
    throw new Error(`${fixture.id}: unsupported fixtures cannot declare host and Wasm results`);
  }
  return { status, host, wasm, reason: reason ?? null };
}
