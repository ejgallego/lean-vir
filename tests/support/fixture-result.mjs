/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const phases = new Set(["host", "package", "wasm"]);

function resultBase(fixture, expectation, host, timing) {
  return { fixture, expectation, host, timing };
}

function generatedResultBase(fixture, expectation, host, generated, timing) {
  return {
    ...resultBase(fixture, expectation, host, timing),
    diagnostics: generated.diagnostics,
  };
}

export function evaluateFixtureRun({
  phase,
  fixture,
  expectation,
  host,
  generated,
  wasm,
  timing,
}) {
  if (!phases.has(phase)) {
    throw new Error(`unknown fixture run phase ${JSON.stringify(phase)}`);
  }

  const base = resultBase(fixture, expectation, host, timing);
  if (expectation.host !== null && host !== expectation.host) {
    return {
      ...base,
      status: "failed",
      detail: `host=${host} expected-host=${expectation.host}`,
    };
  }
  if (phase === "host") return null;
  if (generated === undefined) {
    throw new Error(`${fixture.id}: package result is required after the host phase`);
  }

  const generatedBase = generatedResultBase(fixture, expectation, host, generated, timing);
  if (!generated.ok) {
    return {
      ...generatedBase,
      status: "failed",
      detail: `${generated.failure.kind}: ${generated.failure.detail}`,
    };
  }
  if (phase === "package") return null;

  const wasmBase = { ...generatedBase, wasm };
  if (expectation.wasm !== null && wasm !== expectation.wasm) {
    return {
      ...wasmBase,
      status: "failed",
      detail: `host=${host} wasm=${wasm} expected-wasm=${expectation.wasm}`,
    };
  }
  if (expectation.wasm === null && wasm !== host) {
    return {
      ...wasmBase,
      status: "failed",
      detail: `host=${host} wasm=${wasm}`,
    };
  }
  return { ...wasmBase, status: "passed" };
}
