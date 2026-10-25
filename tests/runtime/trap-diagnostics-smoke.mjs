/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const dir = await mkdtemp(join(tmpdir(), "vir-trap-diagnostics-"));
try {
  const project = await createRuntimeModuleProject(join(dir, "modules"), {
    TrapDiagnostics: `module
meta import Vir.Attributes
public section
namespace TrapDiagnostics
def go : Nat → Nat
  | 0 => 0
  | n + 1 => go n + 1
@[vir_export] def depth (n : Nat) : Nat := go n
-- Its IR body is unreachable code, which the interpreter rejects.
@[vir_export] unsafe def unreachableBody (n : Nat) : Nat := (unsafeCast n : Empty).elim
end TrapDiagnostics`,
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const path = join(dir, "trap-diagnostics.irpkg");
  const generated = project.runVirIrpkg([
    path, join(dir, "trap-diagnostics.report.md"), "--target-marked-module", "TrapDiagnostics",
  ]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const bytes = await readFile(path);
  const wasmBytes = await readFile(process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url));
  const factory = createVirRuntimeFactory({ wasmBytes });
  const fresh = () => factory.createRuntime({ irPackageSet: [bytes] });

  const assertLeanFailure = (runtime, call, pattern) => {
    assert.throws(call, error => error === runtime.failure &&
      error.message.startsWith("Lean runtime error: ") && pattern.test(error.message) &&
      error.cause instanceof WebAssembly.RuntimeError, "the trap reports the Lean exception");
    assert.throws(call, /fresh runtime/);
  };

  await test("deep recursion reports exhausted stack space instead of an anonymous trap", async () => {
    const runtime = await fresh();
    try {
      assert.equal(runtime.call("TrapDiagnostics.depth", 100n), 100n);
      assertLeanFailure(runtime, () => runtime.call("TrapDiagnostics.depth", 1000000n),
        /deep recursion was detected at 'interpreter': the \d+ KiB Wasm stack is nearly exhausted/);
    } finally { runtime.dispose(); }
  });

  await test("an upstream interpreter exception reports its text", async () => {
    const runtime = await fresh();
    try {
      assertLeanFailure(runtime, () => runtime.call("TrapDiagnostics.unreachableBody", 1n),
        /^Lean runtime error: unreachable code$/);
    } finally { runtime.dispose(); }
  });

  await test("a fresh instance is unaffected by a retired one", async () => {
    const runtime = await fresh();
    try {
      assert.equal(runtime.call("TrapDiagnostics.depth", 10n), 10n);
    } finally { runtime.dispose(); }
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
