/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { assert, generateIrPackage, join, readFile, writeRuntimeFixture } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-recursive-owner-"));
try {
  const source = join(directory, "RecursiveOwnerContainers.lean");
  const packagePath = join(directory, "recursive-owner.irpkg");
  await writeRuntimeFixture(source, "RecursiveOwnerContainers.lean");
  await generateIrPackage("RecursiveOwnerContainers", source, packagePath);
  const packageBytes = await readFile(packagePath);
  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const runtime = await createVirRuntimeFactory({
      wasmBytes: await readFile(new URL(`../../web/public/${profile}`, import.meta.url)),
    }).createRuntime({ irPackageSet: [packageBytes] });
    try {
      const leaf = { kind: "leaf", value: 5n };
      const sum = { kind: "viaSum", value: { kind: "inl", value: leaf } };
      const except = { kind: "viaExcept", value: { kind: "ok", value: { kind: "leaf", value: 7n } } };
      for (const value of [
        leaf,
        { kind: "viaSum", value: { kind: "inr", value: false } },
        { kind: "viaExcept", value: { kind: "error", value: "done" } },
        sum,
        except,
        { kind: "viaSum", value: { kind: "inl", value: except } },
      ]) {
        assert.deepEqual(runtime.call("recursiveContainersIdentity", value), value, profile);
      }
      assert.deepEqual(runtime.call("recursiveContainersSumValue"), sum, profile);
      assert.deepEqual(runtime.call("recursiveContainersExceptValue"), except, profile);
      assert.throws(() => runtime.call("recursiveContainersIdentity", {
        kind: "viaSum", value: { kind: "inl", value: { kind: "leaf", value: -1 } },
      }), /Nat|non-negative/);
      assert.equal(runtime.failure, null, "ordinary conversion failure leaves runtime usable");
      assert.deepEqual(runtime.call("recursiveContainersIdentity", sum), sum);
    } finally { runtime.dispose(); }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("recursive owner through Sum/Except: both-profile lowering/lifting/cleanup PASS");
