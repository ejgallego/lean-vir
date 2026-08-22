/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const fixtureManifestVersion = 1;

const manifestKeys = new Set(["version", "fixtures"]);
const fixtureKeys = new Set(["id", "source", "entry", "roots", "result", "unsafe", "expect"]);
const resultKeys = new Set(["type"]);
const expectationKeys = new Set(["host", "wasm", "reason"]);
const fixtureIdPattern = /^[a-z0-9][a-z0-9._-]*$/;

function rejectUnknownFields(value, allowedKeys, label, fieldLabel = "field") {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${label}: unknown ${fieldLabel} ${key}`);
  }
}

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
    return { host: null, wasm: null, reason: null };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${fixture.id}: expect must be an object`);
  }
  rejectUnknownFields(raw, expectationKeys, fixture.id, "expect field");

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
  if (!hasTargetResults && reason !== undefined) {
    throw new Error(`${fixture.id}: expect.reason requires target-specific host and Wasm results`);
  }
  return { host, wasm, reason: reason ?? null };
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function fixtureRoots(fixture) {
  return [fixture.entry, ...(fixture.roots ?? [])];
}

function validateFixture(fixture, index, ids) {
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw new Error(`fixture at index ${index} must be an object`);
  }
  rejectUnknownFields(fixture, fixtureKeys, `fixture at index ${index}`);
  if (typeof fixture.id !== "string" || !fixtureIdPattern.test(fixture.id)) {
    throw new Error(`fixture at index ${index} id must be a lowercase filename-safe identifier`);
  }
  if (ids.has(fixture.id)) {
    throw new Error(`duplicate fixture id ${JSON.stringify(fixture.id)}`);
  }
  ids.add(fixture.id);

  requireNonEmptyString(fixture.source, `${fixture.id}: source`);
  requireNonEmptyString(fixture.entry, `${fixture.id}: entry`);
  if (fixture.roots !== undefined) {
    if (!Array.isArray(fixture.roots) || fixture.roots.length === 0) {
      throw new Error(`${fixture.id}: roots must be a non-empty array`);
    }
    const roots = new Set();
    for (const root of fixture.roots) {
      requireNonEmptyString(root, `${fixture.id}: root`);
      if (root === fixture.entry) {
        throw new Error(`${fixture.id}: roots must not repeat entry`);
      }
      if (roots.has(root)) {
        throw new Error(`${fixture.id}: duplicate root ${JSON.stringify(root)}`);
      }
      roots.add(root);
    }
  }
  if (fixture.result === null || typeof fixture.result !== "object" || Array.isArray(fixture.result)) {
    throw new Error(`${fixture.id}: result must be an object`);
  }
  rejectUnknownFields(fixture.result, resultKeys, `${fixture.id}: result`);
  if (fixture.result.type !== "Nat") {
    throw new Error(`${fixture.id}: result.type must be Nat`);
  }
  if (fixture.unsafe !== undefined && typeof fixture.unsafe !== "boolean") {
    throw new Error(`${fixture.id}: unsafe must be a boolean`);
  }
  fixtureExpectation(fixture);
}

export function validateFixtureManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("fixture manifest must be an object");
  }
  rejectUnknownFields(manifest, manifestKeys, "fixture manifest");
  if (manifest.version !== fixtureManifestVersion) {
    throw new Error(
      `fixture manifest version must be ${fixtureManifestVersion}, got ${JSON.stringify(manifest.version)}`,
    );
  }
  if (!Array.isArray(manifest.fixtures)) {
    throw new Error("fixture manifest fixtures must be an array");
  }

  const ids = new Set();
  for (const [index, fixture] of manifest.fixtures.entries()) validateFixture(fixture, index, ids);
  return manifest.fixtures;
}
