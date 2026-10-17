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

const directory = await mkdtemp(join(tmpdir(), "vir-json-safe-writer-"));
try {
  const path = join(directory, "writer.irpkg");
  await generateIrPackage("JsonSafeWriterValues", new URL("../../fixtures/runtime/JsonSafeWriterValues.lean", import.meta.url), path, "marked");
  const bytes = await readFile(path);
  const expected = {
    text: "λ\n🦀\"\\", natural: "900719925474099312345",
    integer: "-12345678901234567890123456789000", unsigned: "18446744073709551615",
    bytes: [0, 127, 255], unit: null, hidden: { value: "42" }, foo_bar: "preserved",
    names: { foo_bar: "9", arg1: "17" }, letter: { val: 0x1f980 }, priority: { val: "99" },
    constantRecord: { key: "3", value: "record" },
    constantCtor: { kind: "mk", fields: { key: "4", value: "ctor" } },
    tree: { kind: "branch", value: [{ kind: "none" },
      { kind: "some", value: { kind: "leaf", value: "900719925474099312345" } },
      { kind: "some", value: { kind: "fork", fields: {
        left: { kind: "leaf", value: "7" }, right: { kind: "branch", value: [] },
      } } }] },
    store: [{ fst: "1", snd: "α" }, { fst: "900719925474099312345", snd: "last" }],
  };
  for (const wasm of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    for (const representation of ["native", "json-safe-v1"]) {
      const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${wasm}`, import.meta.url)) }).createRuntime({ irPackageSet: [bytes] });
      try {
        const call = (name, ...args) => runtime.callWith({
          argumentRepresentation: representation, resultRepresentation: representation,
        }, `JsonSafeWriterValues.${name}`, ...args);
        assert.equal(runtime.interfaceManifest.exports.length, 6);
        assert.equal(runtime.interfaceManifest.codecOperations.length, 2);
        assert.ok(runtime.interfaceManifest.exports.every(entry => !entry.entry.includes("_codec")));
        for (const entry of runtime.interfaceManifest.codecOperations)
          assert.equal(runtime.findManifestEntry(entry.entry), null);
        const text = call("fixtureText");
        assert.deepEqual(JSON.parse(text), expected);
        assert.deepEqual(JSON.parse(call("numericText")), {
          natural: "3", integer: "-4", large: "18446744073709551615",
          small8: 255, small16: 65535, small32: 4294967295,
        });
        assert.equal(JSON.parse(JSON.stringify({ jsonrpc: "2.0", id: 1, result: text })).result, text);
        const input = structuredClone(expected);
        if (representation === "native") {
          for (const key of ["natural", "integer", "unsigned"]) input[key] = BigInt(input[key]);
          input.hidden.value = 42n;
          input.names = { foo_bar: 9n, arg1: 17n };
          input.priority.val = 99n;
          input.constantRecord.key = 3n;
          input.constantCtor.fields.key = 4n;
          input.tree.value[1].value.value = 900719925474099312345n;
          input.store = input.store.map(entry => ({ ...entry, fst: BigInt(entry.fst) }));
          input.unit = undefined;
          input.bytes = new Uint8Array(input.bytes);
        }
        assert.equal(call("agrees", input), true);
        assert.deepEqual(JSON.parse(call("write", input)), expected);
        // Per-call selection keeps ordinary reference results usable
        // while consuming JSON-safe input, including byte number arrays.
        const selected = (name, args, options) => runtime.callWith(
          options, `JsonSafeWriterValues.${name}`, ...args);
        if (representation === "native") {
          const wireArgs = { argumentRepresentation: "json-safe-v1" };
          assert.equal(selected("agrees", [expected], wireArgs), true);
          const ref = selected("retain", [expected], wireArgs);
          try { assert.equal(call("retainedNatural", ref), 900719925474099312345n); }
          finally { runtime.releaseLeanObjectHandleCell(runtime.leanObjectHandleCell(ref, "test result")); }
          const enter = runtime.callResolvedObjects;
          let entered = 0;
          runtime.callResolvedObjects = function (...args) { entered++; return enter.apply(this, args); };
          try {
            assert.throws(() => selected("retain", [expected], {
              argumentRepresentation: "json-safe-v1", resultRepresentation: "json-safe-v1",
            }), /unsupported by json-safe-v1/);
            assert.equal(entered, 0, "selected result rejects before effects or adapter construction");
            assert.throws(() => selected("fixtureText", [], { argumentRepresentation: "unknown" }), /unsupported value representation/);
            for (const options of [null, [], { representation: "json-safe-v1" },
              { [Symbol("representation")]: "json-safe-v1" }])
              assert.throws(() => selected("fixtureText", [], options), /callWith options/);
            assert.equal(entered, 0);
          } finally { runtime.callResolvedObjects = enter; }
          assert.equal(selected("agrees", [expected], wireArgs), true);
        }
        const changed = structuredClone(input);
        changed.foo_bar = "different";
        assert.equal(call("agrees", changed), false);
        assert.equal(JSON.parse(call("write", changed)).foo_bar, "different");
        const changedField = structuredClone(input);
        changedField.names.arg1 = representation === "native" ? 99n : "99";
        assert.equal(call("agrees", changedField), false);
        assert.deepEqual(JSON.parse(call("write", changedField)).names,
          { foo_bar: "9", arg1: "99" });
        const invalid = structuredClone(input);
        invalid.natural = "not-a-number";
        assert.throws(() => call("write", invalid));
        assert.equal(call("agrees", input), true);
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        assert.equal(runtime.hostState.leanObjectHandleCells.size, 0);
      } finally { runtime.dispose(); }
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("generated typed JSON-safe writers, private constructors and recursive/adapted values: both-profile PASS");
