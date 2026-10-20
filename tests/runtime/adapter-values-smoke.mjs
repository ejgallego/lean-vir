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
import { inputDefault, parseInputValue } from "../../web/app/pages/interface-inputs.js";

const directory = await mkdtemp(join(tmpdir(), "vir-adapter-values-"));
try {
  const path = join(directory, "adapter.irpkg");
  await generateIrPackage("AdapterValues", new URL("../../fixtures/runtime/AdapterValues.lean", import.meta.url), path, "marked");
  const bytes = await readFile(path);
  for (const wasm of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    for (const representation of ["native", "json-safe-v1"]) {
      const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${wasm}`, import.meta.url)) }).createRuntime({ irPackageSet: [bytes] });
      try {
        const nat = value => representation === "native" ? BigInt(value) : String(value);
        const call = (name, ...args) => runtime.callWith({
          argumentRepresentation: representation, resultRepresentation: representation,
        }, `AdapterValues.${name}`, ...args);
        const large = nat("900719925474099312345"), small = nat(1);
        const input = [{ fst: large, snd: "first" }, { fst: small, snd: "α🦀" }, { fst: large, snd: "last" }];
        const expected = [{ fst: small, snd: "α🦀" }, { fst: large, snd: "last" }];
        assert.equal(runtime.interfaceManifest.codecOperations.length, 6);
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
        if (representation === "native") {
          // Exercise the same parser used by the development runner, then the
          // public runtime call. Inputs come from admitted generated descriptors.
          const parse = (name, text) => {
            const arg = runtime.findManifestEntry(`AdapterValues.${name}`).args[0];
            return parseInputValue(arg, { value: text ?? inputDefault(arg) });
          };
          assert.equal(runtime.call("AdapterValues.count", parse("count")), 0n);
          assert.equal(runtime.call("AdapterValues.count", parse("count", '[{"fst":1,"snd":"one"}]')), 1n);
          assert.equal(runtime.call("AdapterValues.textLength", parse("textLength")), 0n);
          assert.equal(runtime.call("AdapterValues.textLength", parse("textLength", '"λ🦀"')), 2n);
          assert.equal(runtime.call("AdapterValues.bytesLength", parse("bytesLength")), 0n);
          const parsedBytes = parse("bytesLength", "[0,127,255]");
          assert.ok(parsedBytes instanceof Uint8Array);
          assert.equal(runtime.call("AdapterValues.bytesLength", parsedBytes), 3n);
          assert.equal(runtime.call("AdapterValues.byteAt", parsedBytes, 2n), 255n);
          for (const text of ["[-1]", "[256]", '["1"]'])
            assert.throws(() => parse("bytesLength", text), /byte/);
        }
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        assert.equal(runtime.hostState.leanObjectHandleCells.size, 0);
      } finally { runtime.dispose(); }
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("generated library adapters, precise wire integers and native map observations: both-profile PASS");
