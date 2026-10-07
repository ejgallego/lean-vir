/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import {
  createPrimitiveRuntimeFactory,
  VIR_HOST_DISPOSE,
} from "../../web/src/runtime/primitive-factory.js";
import { createCommonHostBindings } from "../../web/src/host/vir-common-host-bindings.js";
import { generateIrPackage } from "./shared.mjs";
import { collectUntil } from "./generation-gc-cases.js";

assert.equal(typeof globalThis.gc, "function", "run with --expose-gc");
const directory = await mkdtemp(join(tmpdir(), "vir-managed-core-"));
try {
  const packagePath = join(directory, "managed.irpkg");
  await generateIrPackage(
    "ManagedCore",
    new URL("../../fixtures/runtime/ManagedCore.lean", import.meta.url),
    packagePath,
    "marked",
  );
  const packageBytes = await readFile(packagePath);

  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const wasmBytes = await readFile(
      new URL(`../../web/public/${profile}`, import.meta.url),
    );
    const fatal = new Error("managed-core pure host failure");
    const fresh = (options = {}) => {
      const { onReenter = () => {}, ...factoryOptions } = options;
      return createPrimitiveRuntimeFactory({
        wasmBytes,
        defaultHostBindings: createCommonHostBindings,
        hostBindings: {
          "managedCore.reenter": onReenter,
          "managedCore.pureFailure": () => {
            throw fatal;
          },
        },
        ...factoryOptions,
      }).createRuntime({ irPackageSet: [packageBytes] });
    };

    await test(`${profile}: opaque state/functions avoid automatic conversion and reject unsupported entries`, async () => {
      const runtime = await fresh();
      try {
        runtime.exports.vir_closure_apply_objects = () => {
          throw new Error("unexpected callback conversion");
        };
        assert.throws(
          () => runtime.call("ManagedCore.buildPlain", 10),
          /object ABI does not support/,
        );
        const state = runtime.call("ManagedCore.buildHeld", 10_000);
        const branch = runtime.call("ManagedCore.advanceHeld", state, 1);
        const fn = runtime.call("ManagedCore.makeSummaryHeld", state);
        for (let n = 0; n < 250; n++) {
          assert.equal(
            runtime.call("ManagedCore.invokeSummaryHeld", fn),
            "10000:49995000",
          );
          assert.equal(
            runtime.call("ManagedCore.summarizeHeld", branch),
            "10000:50005000",
          );
        }
        assert.equal(runtime.failure, null);
        assert.equal(runtime.liveCallbackCount(), 0);
        assert.equal(runtime.hostState.leanObjectHandleCells.size, 3);
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        let fired = false;
        const callback = () => {
          fired = true;
          return runtime.call("ManagedCore.invokeSummaryHeld", fn);
        };
        const timer = setTimeout(callback, 0);
        clearTimeout(timer);
        await wait(20);
        assert.equal(fired, false);
        assert.equal(callback(), "10000:49995000");
        assert.equal(fired, true);
      } finally {
        runtime.dispose();
      }
    });

    await test(`${profile}: function capture outlives its collected state carrier`, async () => {
      const runtime = await fresh();
      try {
        let state = runtime.call("ManagedCore.buildHeld", 100);
        let fn = runtime.call("ManagedCore.makeSummaryHeld", state);
        const weakState = new WeakRef(state);
        state = null;
        await collectUntil(
          () =>
            weakState.deref() === undefined &&
            runtime.hostState.leanObjectHandleCells.size === 1,
          "state carrier released while captured function remains live",
        );
        assert.equal(
          runtime.call("ManagedCore.invokeSummaryHeld", fn),
          "100:4950",
        );
        const weakFn = new WeakRef(fn);
        fn = null;
        await collectUntil(
          () =>
            weakFn.deref() === undefined &&
            runtime.hostState.leanObjectHandleCells.size === 0,
          "function carrier and its capture released",
        );
      } finally {
        runtime.dispose();
      }
    });

    await test(`${profile}: foreign carriers reject without poisoning either generation`, async () => {
      const first = await fresh();
      let second;
      try {
        second = await fresh();
        const state = first.call("ManagedCore.buildHeld", 20);
        const fn = first.call("ManagedCore.makeSummaryHeld", state);
        assert.throws(
          () => second.call("ManagedCore.summarizeHeld", state),
          /live Lean object handle/,
        );
        assert.throws(
          () => second.call("ManagedCore.invokeSummaryHeld", fn),
          /live Lean object handle/,
        );
        assert.equal(second.failure, null);
        const own = second.call("ManagedCore.buildHeld", 3);
        assert.equal(second.call("ManagedCore.summarizeHeld", own), "3:3");
        assert.equal(first.call("ManagedCore.invokeSummaryHeld", fn), "20:190");
      } finally {
        first.dispose();
        second?.dispose();
      }
    });

    await test(`${profile}: reentrant carrier release preserves the active Lean invocation`, async () => {
      let runtime, fn;
      runtime = await fresh({
        onReenter: () => {
          // Private lifetime oracle; this adds no public per-value release API.
          const cell = runtime.leanObjectHandleCell(fn, "running function");
          assert.equal(runtime.releaseLeanObjectHandleCell(cell), true);
          assert.equal(runtime.releaseLeanObjectHandleCell(cell), false);
        },
      });
      try {
        const state = runtime.call("ManagedCore.buildHeld", 20);
        fn = runtime.call("ManagedCore.makeReentrantHeld", state);
        assert.equal(
          runtime.call("ManagedCore.invokeReentrantHeld", fn),
          "20:190",
        );
        assert.throws(
          () => runtime.call("ManagedCore.invokeReentrantHeld", fn),
          /live Lean object handle/,
        );
        assert.equal(runtime.failure, null);
        assert.equal(
          runtime.call("ManagedCore.summarizeHeld", state),
          "20:190",
        );
      } finally {
        runtime.dispose();
      }
    });

    for (const retirement of ["healthy", "provider failure", "trap"]) {
      await test(`${profile}: ${retirement} retirement clears the actual table and carriers`, async () => {
        const cleanupError = new Error("owned provider cleanup failure");
        let cleanups = 0;
        const runtime = await fresh({
          defaultHostBindings: () => ({
            ...createCommonHostBindings(),
            [VIR_HOST_DISPOSE]: () => {
              cleanups++;
              if (retirement === "provider failure") throw cleanupError;
            },
          }),
        });
        const wasm = runtime.exports;
        const host = runtime.hostState;
        try {
          const state = runtime.call("ManagedCore.buildHeld", 20);
          const fn = runtime.call("ManagedCore.makeSummaryHeld", state);
          assert.ok(wasm.vir_obj_resource({ retained: true }) !== 0);
          assert.ok(wasm.vir_resource_roots_active() > 0);
          if (retirement === "trap") {
            assert.throws(
              () => runtime.call("ManagedCore.triggerTrap", {}),
              (error) => error === fatal,
            );
            assert.equal(runtime.failure, fatal);
          }
          if (retirement === "provider failure") {
            assert.throws(
              () => runtime.dispose(),
              (error) => error === cleanupError,
            );
          } else runtime.dispose();
          assert.equal(cleanups, 1);
          assert.equal(host.leanObjectHandleCells.size, 0);
          assert.equal(wasm.vir_resource_roots_active(), 0);
          assert.equal(wasm.vir_resource_roots_reusable(), 0);
          assert.throws(
            () => runtime.call("ManagedCore.invokeSummaryHeld", fn),
            /disposed|fresh runtime/,
          );
        } finally {
          runtime.dispose();
        }
      });
    }
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
