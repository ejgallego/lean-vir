/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import { generateIrPackage } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-descriptor-regressions-"));
try {
  const path = join(directory, "regressions.irpkg");
  await generateIrPackage("DescriptorRegressions", new URL("../../fixtures/runtime/DescriptorRegressions.lean", import.meta.url), path, "marked");
  const bytes = await readFile(path), info = readIrPackageInfo(bytes);
  const identitySource = join(directory, "NameOnly.lean"), identityPath = join(directory, "name-only.irpkg");
  await writeFile(identitySource, `module
public import Lean.Data.Name
public meta import Vir.Attributes
public section
@[vir_export] def identityNameOnly (value : Lean.Name) : Lean.Name := value
`);
  await generateIrPackage("NameOnly", identitySource, identityPath, "marked");
  const identityBytes = await readFile(identityPath);
  for (const [name, location] of [["wrapperEntry", "scalar"], ["boolWrapperEntry", "scalar"], ["usizeWrapperEntry", "usize"]]) {
    const pair = info.manifest.exports.find(entry => entry.entry === `DescriptorRegressions.${name}`).result;
    const field = pair.native.metadata.constructors[0].fields[1];
    assert.equal(field.location.tag, location, "compiler actually packs the wrapper");
    assert.equal(field.type.metadata.constructors[0].representation, "identity");
  }
  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${profile}`, import.meta.url)) }).createRuntime({ irPackageSet: [bytes] });
    const host = runtime.hostState;
    const call = (name, ...values) => runtime.call(`DescriptorRegressions.${name}`, ...values);
    let callback;
    try {
      assert.equal(runtime.interfaceManifest.constructorOperations.length, 3);
      for (const entry of runtime.interfaceManifest.constructorOperations)
        assert.equal(runtime.findManifestEntry(entry.entry), null);
      const anonymous = { kind: "anonymous" };
      const stringName = { kind: "str", fields: { pre: { kind: "str", fields: { pre: anonymous, str: "" } }, str: "λ🦀" } };
      const numberName = { kind: "num", fields: { pre: { kind: "str", fields: { pre: anonymous, str: "λ🦀" } }, i: 900719925474099312345n } };
      const identityRuntime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${profile}`, import.meta.url)) }).createRuntime({ irPackageSet: [identityBytes] });
      try {
        assert.equal(identityRuntime.interfaceManifest.exports.length, 1);
        assert.equal(identityRuntime.interfaceManifest.constructorOperations.length, 2);
        assert.deepEqual(identityRuntime.call("identityNameOnly", numberName), numberName,
          "a signature-only constructor dependency must retain its executable operation");
      } finally { identityRuntime.dispose(); }
      assert.deepEqual(call("nameIdentity", stringName), stringName);
      assert.deepEqual(call("nameIdentity", numberName), numberName);
      assert.equal(call("matchesStringName", stringName), true);
      assert.equal(call("matchesNumericName", numberName), true);
      assert.equal(call("matchesStringName", numberName), false);
      const cached = { kind: "mk", value: 900719925474099312345n % (1n << 64n) };
      assert.deepEqual(call("scalarIdentity", cached), cached);
      assert.equal(call("scalarComputed", cached), cached.value + 1n);
      assert.equal(call("ordinaryEntry", 41n), 42n, "valid packed metadata must not block sibling exports");
      for (const [name, value] of [["wrapperEntry", 42], ["boolWrapperEntry", true], ["usizeWrapperEntry", 42]]) {
        const entry = runtime.findManifestEntry(`DescriptorRegressions.${name}`);
        assert.equal(runtime.objectArgumentSupported(entry.args[0].type), true);
        assert.equal(runtime.objectResultSupported(entry.result), true);
        const input = { label: "packed", wrapped: { value } };
        assert.deepEqual(call(name, input), input);
        assert.throws(() => call(name, {}), /missing/);
        assert.equal(runtime.failure, null);
        assert.equal(call("ordinaryEntry", 41n), 42n);
      }
      const nested = [[], [0n, 42n], [900719925474099312345n]];
      assert.deepEqual(call("nestedAlias", nested), nested);
      const deeper = [[], nested, [[], [7n]]];
      assert.deepEqual(call("deeperAlias", deeper), deeper);
      const packedCallback = call("wrapperCallback", undefined);
      assert.deepEqual(packedCallback({ label: "callback", wrapped: { value: 42 } }), { label: "callback", wrapped: { value: 42 } });
      assert.throws(() => packedCallback({}), /missing/);
      assert.equal(runtime.failure, null);
      assert.equal(call("ordinaryEntry", 41n), 42n);

      let compiled = 0;
      const bind = runtime.nativeValueCodec;
      runtime.nativeValueCodec = function (pair) {
        if (!this.nativeValueCodecs?.has(pair)) compiled++;
        return bind.call(this, pair);
      };
      callback = call("listCallback", undefined);
      const before = compiled;
      assert.deepEqual(callback([]), []);
      assert.equal(compiled - before, 2, "argument/result codecs bind during the first invocation");
      const warm = compiled;
      for (let i = 0; i < 20; i++) assert.deepEqual(callback([]), []);
      const rows = [{ first: 1n, second: 2n, third: 3n }];
      assert.deepEqual(callback(rows), rows);
      assert.equal(compiled, warm, "even empty structural collections reuse their codecs");
      assert.equal(runtime.exports.vir_resource_roots_active(), 0);
    } finally { runtime.dispose(); }
    assert.throws(() => callback([]), /disposed runtime/);
    assert.equal(host.leanObjectHandleCells.size, 0);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("packed wrappers, alias descent, callback cache and compiler constructor operations: both-profile PASS");
