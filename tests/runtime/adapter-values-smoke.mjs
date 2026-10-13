/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { generateIrPackage } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-adapter-values-"));
try {
  const path = join(directory, "adapter.irpkg");
  await generateIrPackage("AdapterValues", new URL("../../fixtures/runtime/AdapterValues.lean", import.meta.url), path, "marked");
  const bytes = await readFile(path);
  for (const wasm of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    for (const representation of ["native", "json-safe-v1"]) {
      const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${wasm}`, import.meta.url)) }).createRuntime({ irPackageSet: [bytes] });
      try {
        if (representation !== "native") {
          const bind = runtime.nativeValueCodec;
          runtime.nativeValueCodec = function (pair) { return bind.call(this, pair, { representation }); };
        }
        const nat = value => representation === "native" ? BigInt(value) : String(value);
        const call = (name, ...args) => runtime.call(`AdapterValues.${name}`, ...args);
        const large = nat("900719925474099312345"), small = nat(1);
        const input = [{ fst: large, snd: "first" }, { fst: small, snd: "α🦀" }, { fst: large, snd: "last" }];
        const expected = [{ fst: small, snd: "α🦀" }, { fst: large, snd: "last" }];
        assert.equal(runtime.interfaceManifest.codecOperations.length, 2);
        for (const entry of runtime.interfaceManifest.codecOperations)
          assert.equal(runtime.findManifestEntry(entry.entry), null);
        assert.equal(call("count", []), nat(0));
        for (let i = 0; i < 20; i++) {
          assert.deepEqual(call("identity", input), expected);
          assert.equal(call("count", input), nat(2));
          assert.deepEqual(call("lookup", input, large), { kind: "some", value: "last" });
          assert.deepEqual(call("lookup", input, nat(3)), { kind: "none" });
          assert.deepEqual(call("wrapperIdentity", { label: "nested", store: input }), { label: "nested", store: expected });
        }
        assert.throws(() => call("identity", [{ fst: small }]));
        assert.deepEqual(call("identity", input), expected);
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        assert.equal(runtime.hostState.leanObjectHandleCells.size, 0);
      } finally { runtime.dispose(); }
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("generated library adapters, precise wire integers and native map observations: both-profile PASS");
