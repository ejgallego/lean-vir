/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { countLiveCallbacks } from "../support/lean-ownership.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { VIR_HOST_DISPOSE } from "../../web/src/vir-runtime.js";
import { registerHostCallRollback } from "../../web/src/host-boundary.js";
import { IR_PACKAGE_SECTION, readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";
const dir = await mkdtemp(join(tmpdir(), "vir-fatal-"));
try {
  const project = await createRuntimeModuleProject(join(dir, "modules"), {
    Fatal: `module
meta import Vir.Attributes
public import Vir.Js
public section
open Lean.Vir
namespace Fatal
@[vir_js "fatal.pure"] opaque hostPure (x : Js.Any) : Js.Any := x
@[vir_js "fatal.io"] opaque hostIO (x : Js.Any) : RuntimeM Js.Any
@[vir_js "fatal.record"] opaque record (x : Js.Any) : RuntimeM Unit
@[vir_js "fatal.invoke"] opaque invokeHost (fn : Js.Function1 Js.Any Unit) : RuntimeM Unit
@[vir_export] def pureCall (x : Js.Any) : Js.Any := hostPure x
@[vir_export] def ioCall (x : Js.Any) : RuntimeM Js.Any := hostIO x
@[vir_export] def afterPure (x : Js.Any) : RuntimeM Unit := record (hostPure x)
@[vir_export] def callback : RuntimeM (Js.Function1 Js.Any Unit) :=
  Js.Function.ofLeanVoid fun x => afterPure x
@[vir_export] def invoke (fn : Js.Function1 Js.Any Unit) : RuntimeM Unit := invokeHost fn
@[vir_export] def identity (x : Js.Any) : Js.Any := x
@[vir_js "fatal.init"] opaque initFailure (x : Unit) : Unit := x
@[vir_export] def initPure : IO Unit := pure (initFailure ())
@[vir_export] def leanError : IO Unit := throw (IO.userError "recoverable")
end Fatal`,
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const path = join(dir, "fatal.irpkg");
  const generated = project.runVirIrpkg([path, join(dir, "fatal.report.md"), "--target-marked-module", "Fatal"]);
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`);
  const bytes = await readFile(path);
  // Exercise the real initializer entry using compiler-produced IO IR, without
  // executing the JS-only host import during native package generation.
  const sectionIndex = readIrPackageInfo(bytes).package.sections.findIndex(s => s.kind === IR_PACKAGE_SECTION.INIT_GLOBALS);
  const section = readIrPackageInfo(bytes).package.sections[sectionIndex];
  const old = bytes.subarray(section.offset, section.offset + section.byteLength);
  const count = new DataView(old.buffer, old.byteOffset).getUint32(0, true);
  const contents = Uint8Array.from([...u32(count + 1), ...old.subarray(4),
    ...encodeName("Fatal.initialized"), ...encodeName("Fatal.initPure")]);
  const initBytes = Uint8Array.from([...bytes, ...contents]);
  const directory = new DataView(initBytes.buffer);
  const entryOffset = 4 + directory.getUint32(0, true) + 4 + 8 + 12 * sectionIndex;
  directory.setUint32(entryOffset + 4, bytes.length, true);
  directory.setUint32(entryOffset + 8, contents.length, true);
  const wasmBytes = await readFile(process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url));
  let failure = new Error("fatal original host error");
  let pureCalls = 0;
  let fail = true, effects = 0, caughtNested = false, releases = 0, rollbacks = 0;
  const sharedBindings = {
    "fatal.pure": value => { pureCalls++; if (fail) throw failure; return value; },
    "fatal.io": value => { if (fail) throw failure; return value; },
    "fatal.init": () => { throw failure; },
    "fatal.record": () => { effects++; },
    "fatal.invoke": callback => {
      registerHostCallRollback(() => { rollbacks++; });
      try { callback({ nested: true }); }
      catch (error) { assert.equal(error, failure); caughtNested = true; }
    },
    [VIR_HOST_DISPOSE]: () => { releases++; },
  };
  const factory = createVirRuntimeFactory({ wasmBytes, hostBindings: sharedBindings });
  const fresh = () => factory.createRuntime({ irPackageSet: [bytes] });
  await test("pure failures retire named, timed, closure and caught nested entries", async () => {
    for (const mode of ["named", "timed", "closure", "nested"]) {
      const runtime = await fresh();
      const hostState = runtime.hostState;
      const callback = runtime.call("Fatal.callback");
      const held = runtime.makeLeanObjectHandleResource(9 /* boxed Nat 4 */, "retained root");
      const exports = runtime.exports;
      assert.notEqual(exports.vir_obj_resource({ mode }), 0);
      assert.ok(exports.vir_resource_roots_active() > 0);
      const operation = mode === "named" ? () => runtime.call("Fatal.afterPure", {})
        : mode === "timed" ? () => runtime.callTimed("Fatal.afterPure", {})
        : mode === "closure" ? () => callback({}) : () => runtime.call("Fatal.invoke", callback);
      assert.throws(operation, error => error === failure, mode);
      assert.equal(runtime.failure, failure, `${mode} must retire the instance`);
      assert.equal(effects, 0, "no later host effect runs");
      assert.throws(() => runtime.call("Fatal.identity", {}), /fresh runtime/);
      assert.throws(() => callback({}), /fresh runtime/);
      assert.throws(() => runtime.loadIrPackageSetBytes([bytes]), /fresh runtime/);
      assert.throws(() => runtime.runStartupEntries(), /fresh runtime/);
      assert.throws(() => runtime.retainLeanObjectHandleValue(held, "old root"), /fresh runtime/);
      runtime.dispose(); runtime.dispose();
      assert.equal(exports.vir_resource_roots_active(), 0);
      assert.equal(exports.vir_resource_roots_reusable(), 0);
      assert.equal(hostState.leanObjectHandleCells.size, 0);
      assert.equal(countLiveCallbacks(runtime.hostState), 0);
      assert.equal(hostState.callTimings.length, 0);
    }
    assert.equal(caughtNested, true);
    assert.equal(rollbacks, 1, "a binding cannot commit resources after catching a nested fatal call");
    assert.equal(releases, 0, "retired runtimes preserve application-owned bindings");
  });
  await test("hostile thrown values cannot reopen a real Lean/Wasm generation", async () => {
    const originalFailure = failure;
    const nonStringifiable = { [Symbol.toPrimitive]() { throw this; } };
    let proxy;
    proxy = new Proxy({}, { getPrototypeOf() { throw proxy; }, get() { throw proxy; } });
    try {
      for (const thrown of [nonStringifiable, proxy]) {
        failure = thrown;
        const runtime = await fresh();
        const callsBefore = pureCalls;
        try {
          let caught;
          try { runtime.call("Fatal.pureCall", {}); }
          catch (error) { caught = error; }
          assert.ok(caught instanceof Error);
          assert.equal(runtime.failure, caught);
          assert.equal(caught.cause, thrown);
          assert.throws(() => runtime.call("Fatal.pureCall", {}), /fresh runtime/);
          assert.equal(pureCalls, callsBefore + 1);
        } finally { runtime.dispose(); }
      }
    } finally { failure = originalFailure; }
  });
  await test("ordinary IO failure remains reusable and other instances stay usable", async () => {
    const good = await fresh();
    const bad = await fresh();
    const value = { marker: true };
    try {
      assert.throws(() => good.call("Fatal.ioCall", value), error => error === failure);
      assert.equal(good.failure, null);
      assert.throws(() => good.call("Fatal.leanError"), /recoverable/);
      assert.equal(good.call("Fatal.identity", value), value);
      assert.throws(() => bad.call("Fatal.pureCall", value), error => error === failure);
      assert.equal(good.call("Fatal.identity", value), value);
      fail = false;
      const recovered = await fresh();
      try { assert.equal(recovered.call("Fatal.pureCall", value), value); }
      finally { recovered.dispose(); }
    } finally { good.dispose(); bad.dispose(); }
  });
  await test("a Wasm trap without a host exception also retires the instance", async () => {
    const runtime = await fresh();
    try {
      assert.throws(() => runtime.exports.vir_obj_nat(0xfffffff0, 32), WebAssembly.RuntimeError);
      assert.ok(runtime.failure instanceof WebAssembly.RuntimeError);
      assert.throws(() => runtime.call("Fatal.identity", {}), /fresh runtime/);
    } finally { runtime.dispose(); runtime.dispose(); }
  });
  await test("a trapped initializer preserves the host error and forbids rollback into Wasm", async () => {
    const runtime = await factory.createRuntime();
    try {
      assert.throws(() => runtime.loadIrPackageSetBytes([initBytes]), error => error === failure);
      assert.equal(runtime.failure, failure);
      assert.throws(() => runtime.loadIrPackageSetBytes([bytes]), /fresh runtime/);
    } finally { runtime.dispose(); runtime.dispose(); }
    await assert.rejects(() => factory.createRuntime({ irPackageSet: [initBytes] }), error => error === failure);
  });
  assert.equal(releases, 0, "failed creation and disposal preserve supplied bindings");
  sharedBindings[VIR_HOST_DISPOSE]();
  assert.equal(releases, 1, "the application disposes its shared services");
} finally { await rm(dir, { recursive: true, force: true }); }

function u32(n) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
}
function encodeName(name) {
  let encoded = [0];
  for (const part of name.split(".")) {
    const text = new TextEncoder().encode(part);
    encoded = [1, ...encoded, ...u32(text.length), ...text];
  }
  return encoded;
}
