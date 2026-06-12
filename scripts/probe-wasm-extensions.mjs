/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { hasExternrefTableSupport } from "../web/src/vir-runtime.js";

const EXTERNREF_IDENTITY_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x6f, 0x01, 0x6f,
  0x02, 0x0b, 0x01, 0x04, 0x68, 0x6f, 0x73, 0x74,
  0x02, 0x69, 0x64, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0d, 0x01, 0x09, 0x72, 0x6f, 0x75, 0x6e,
  0x64, 0x74, 0x72, 0x69, 0x70, 0x00, 0x01,
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x20, 0x00, 0x10,
  0x00, 0x0b,
]);

const JSPI_PROMISE_IMPORT_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x02, 0x0e, 0x01, 0x04, 0x68, 0x6f, 0x73, 0x74,
  0x05, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x08, 0x01, 0x04, 0x63, 0x61, 0x6c, 0x6c,
  0x00, 0x01,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x10, 0x00, 0x0b,
]);

const probes = [
  ["externref table", probeExternrefTable],
  ["externref identity", probeExternrefIdentity],
  ["JSPI Promise import", probeJspiPromiseImport],
];

let failures = 0;
for (const [name, probe] of probes) {
  const result = await probe();
  console.log(`wasm feature probe ${result.status}: ${name} - ${result.detail}`);
  if (result.error !== undefined) {
    console.error(result.error.stack ?? String(result.error));
  }
  if (result.status === "failed") {
    failures++;
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

function probeExternrefTable() {
  if (!hasExternrefTableSupport()) {
    return failed(
      "engine does not support WebAssembly.Table({ element: \"externref\" })",
      new Error("externref table support is required"),
    );
  }
  return passed("host objects can be stored in an externref WebAssembly.Table");
}

function probeExternrefIdentity() {
  let module;
  try {
    module = new WebAssembly.Module(EXTERNREF_IDENTITY_MODULE);
  } catch (error) {
    return failed("engine does not compile an externref module", error);
  }

  try {
    const marker = { kind: "lean-vir.externref-probe" };
    const instance = new WebAssembly.Instance(module, {
      host: {
        id: (value) => value,
      },
    });
    assert.equal(instance.exports.roundtrip(marker), marker);
    return passed("host object identity survived a Wasm import/export round-trip");
  } catch (error) {
    return failed("externref identity round-trip failed", error);
  }
}

async function probeJspiPromiseImport() {
  if (
    typeof WebAssembly.Suspending !== "function" ||
    typeof WebAssembly.promising !== "function"
  ) {
    return skipped("WebAssembly.Suspending/WebAssembly.promising are not available");
  }

  let module;
  try {
    module = new WebAssembly.Module(JSPI_PROMISE_IMPORT_MODULE);
  } catch (error) {
    return failed("JSPI probe module compilation failed", error);
  }

  try {
    const instance = new WebAssembly.Instance(module, {
      host: {
        value: new WebAssembly.Suspending(() => Promise.resolve(41)),
      },
    });
    const call = WebAssembly.promising(instance.exports.call);
    assert.equal(await call(), 41);
    return passed("Promise-returning import resumed into a promising Wasm export");
  } catch (error) {
    return failed("JSPI Promise import failed despite advertised API support", error);
  }
}

function passed(detail) {
  return { status: "passed", detail };
}

function skipped(detail) {
  return { status: "skipped", detail };
}

function failed(detail, error) {
  return { status: "failed", detail, error };
}
