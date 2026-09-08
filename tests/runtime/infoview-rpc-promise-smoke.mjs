/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createProofSurfaceFixture } from "../support/proof-surface-fixtures.mjs";
import {
  assert,
  join,
  readFile,
  readRuntimeArtifacts,
  runVirIrpkg,
  spawnSync,
} from "./shared.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "lean-vir-infoview-rpc-"));

try {
  const built = spawnSync("lake", ["build", "+InfoviewRpcPromise"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const packagePath = join(tempDir, "infoview-rpc-promise.irpkg");
  const generated = runVirIrpkg([
    packagePath,
    join(tempDir, "infoview-rpc-promise.report.md"),
    "--target-module",
    "InfoviewRpcPromise",
    "Vir.Fixtures.InfoviewRpcPromise.callExact",
    "Vir.Fixtures.InfoviewRpcPromise.callSurfaceExact",
    "Vir.Fixtures.InfoviewRpcPromise.callMessage",
    "Vir.Fixtures.InfoviewRpcPromise.recover",
    "Vir.Fixtures.InfoviewRpcPromise.eraseExact",
    "Vir.Fixtures.InfoviewRpcPromise.castElementOr",
    "Vir.Fixtures.InfoviewRpcPromise.settleIntoState",
    "Vir.Fixtures.InfoviewRpcPromise.thenPromiseExact",
    "Vir.Fixtures.InfoviewRpcPromise.thenBothValue",
    "Vir.Fixtures.InfoviewRpcPromise.thenBothVoid",
    "Vir.Fixtures.InfoviewRpcPromise.createAbortController",
    "Vir.Fixtures.InfoviewRpcPromise.abortSignal",
    "Vir.Fixtures.InfoviewRpcPromise.abort",
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const { wasmBytes } = await readRuntimeArtifacts();
  const runtime = await createVirRuntime({
    wasmBytes,
    irPackageSet: [await readFile(packagePath)],
    defaultHostBindings: createBrowserHostBindings(),
  });
  try {
    const controller = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.createAbortController",
    );
    assert.ok(controller instanceof AbortController);
    const signal = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.abortSignal",
      controller,
    );
    assert.equal(signal, controller.signal);
    assert.equal(signal.aborted, false);
    assert.equal(
      runtime.call("Vir.Fixtures.InfoviewRpcPromise.abort", controller),
      undefined,
    );
    assert.equal(signal.aborted, true);

    for (const suffix of ["Value", "Void"]) {
      const value = { reply: true };
      const reason = { rejected: true };
      const expected = suffix === "Value" ? value : undefined;
      const seen = [];
      const fulfilled = (input) => {
        seen.push(["fulfilled", input]);
        return expected;
      };
      const rejected = (input) => {
        seen.push(["rejected", input]);
        return expected;
      };
      const entry = `Vir.Fixtures.InfoviewRpcPromise.thenBoth${suffix}`;
      assert.equal(
        await runtime.call(entry, Promise.resolve(value), fulfilled, rejected),
        expected,
      );
      assert.equal(
        await runtime.call(entry, Promise.reject(reason), fulfilled, rejected),
        expected,
      );
      assert.deepEqual(seen, [
        ["fulfilled", value],
        ["rejected", reason],
      ]);
      const error = new Error(
        "do not catch fulfillment failures in the sibling handler",
      );
      await assert.rejects(
        runtime.call(
          entry,
          Promise.resolve(value),
          () => {
            throw error;
          },
          rejected,
        ),
        (actual) => actual === error,
      );
      assert.equal(seen.length, 2);
    }
    {
      // The checked cast rejects values without a native DOM brand. Native
      // Element success and iframe cases belong to the Chromium suite.
      const fallback = {};
      assert.equal(
        runtime.call(
          "Vir.Fixtures.InfoviewRpcPromise.castElementOr",
          "not an element",
          fallback,
        ),
        fallback,
      );
    }

    const requests = [];
    const calls = [];
    const response = { message: "exact Promise response" };
    const exactPromise = Promise.resolve(response);
    const session = {
      call(method, params) {
        calls.push({ method, params });
        if (params === requests[3]) {
          return Promise.reject(new Error("expected rejection"));
        }
        return exactPromise;
      },
    };

    requests.push({ message: "exact Promise request identity" });
    assert.equal(
      runtime.call("Vir.Fixtures.InfoviewRpcPromise.eraseExact", requests[0]),
      requests[0],
    );
    const exactResult = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.callExact",
      session,
      requests[0],
    );
    assert.equal(exactResult, exactPromise);

    requests.push({ message: "surface session request identity" });
    const surfaceResult = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.callSurfaceExact",
      createProofSurfaceFixture({ rpcSession: session }),
      requests[1],
    );
    assert.equal(surfaceResult, exactPromise);

    requests.push({ message: "continuation request identity" });
    const result = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.callMessage",
      session,
      requests[2],
    );
    assert.equal(result instanceof Promise, true);
    assert.equal(await result, response.message);

    requests.push({ message: "rejected request identity" });
    const fallback = { message: "exact fallback identity" };
    const recovered = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.recover",
      session,
      requests[3],
      fallback,
    );
    assert.equal(await recovered, fallback);

    assert.equal(calls.length, 4);
    for (const [index, call] of calls.entries()) {
      assert.equal(call.method, "Vir.Fixtures.InfoviewRpcPromise.echo");
      assert.equal(call.params, requests[index]);
    }

    assert.equal(
      await runtime.call(
        "Vir.Fixtures.InfoviewRpcPromise.thenPromiseExact",
        exactPromise,
        (value) => Promise.resolve(value.message),
      ),
      response.message,
    );

    let resolveAfterDispose;
    const lateValue = { message: "native callback after VIR disposal" };
    const stateUpdates = [];
    const latePromise = new Promise((resolve) => {
      resolveAfterDispose = resolve;
    });
    const lateChain = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.settleIntoState",
      latePromise,
      (value) => {
        stateUpdates.push(value);
      },
    );
    // Contrast native continuations with explicitly converted Lean closures.
    // Disposal invalidates the Lean closure before it could inspect a stale flag.
    const leanPending = Promise.withResolvers();
    const lateLeanChain = runtime.call(
      "Vir.Fixtures.InfoviewRpcPromise.callMessage",
      { call: () => leanPending.promise },
      {},
    );
    runtime.dispose();
    leanPending.resolve({ message: "too late to enter Lean" });
    await assert.rejects(lateLeanChain, /callback belongs to a disposed runtime/);
    resolveAfterDispose(lateValue);
    assert.equal(await lateChain, undefined);
    assert.deepEqual(stateUpdates, [lateValue]);
  } finally {
    runtime.dispose();
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
