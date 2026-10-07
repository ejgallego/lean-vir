/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  createVirRuntime,
  createVirRuntimeFactory,
} from "../../web/src/vir-runtime.js";
import {
  check,
  collectUntil,
  makeJsl,
  readJsl,
  runGenerationGcCases,
} from "../runtime/generation-gc-cases.js";

import {
  runGenerationLifecycleCases,
  runSharedBindingGcCases,
} from "../runtime/generation-lifecycle-cases.js";

globalThis.runVirGenerationGc = async (wasm, pkg) => {
  const wasmModule = new WebAssembly.Module(new Uint8Array(wasm));
  const irPackageSet = [new Uint8Array(pkg)];
  const createRuntime = (hostBindings) =>
    createVirRuntime({ wasmModule, irPackageSet, hostBindings });
  const gc = await runGenerationGcCases(createRuntime);
  const lifecycle = await runGenerationLifecycleCases(
    createRuntime,
    irPackageSet[0],
    () => createVirRuntime({ wasmModule }),
  );
  const sharedBindings = {};
  const shared = await runSharedBindingGcCases(
    createVirRuntimeFactory({ wasmModule, hostBindings: sharedBindings }),
    sharedBindings,
    irPackageSet[0],
  );
  const react = await runReactChurn(createRuntime);
  const fatal = await runFatalRecovery(wasmModule, irPackageSet);
  return { gc, lifecycle, shared, react, fatal };
};

async function runFatalRecovery(wasmModule, irPackageSet) {
  let captured;
  const factory = createVirRuntimeFactory({ wasmModule, hostBindings: {
    "test.callNatCallback": (input, callback) => {
      captured = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  } });
  const bad = await factory.createRuntime({ irPackageSet });
  const good = await factory.createRuntime({ irPackageSet });
  let recovered;
  try {
    bad.call("HostInterop.callbackRoundTrip", 3);
    const oldCallback = captured;
    const state = bad.hostState;
    const held = makeJsl(bad, "retained across trap");
    const exports = bad.exports;
    check(exports.vir_obj_resource({ label: "retained browser payload" }) !== 0,
      "browser payload acquires a Wasm root");
    check(exports.vir_resource_roots_active() > 0,
      "browser table has live roots before trap");
    let failure;
    try { bad.exports.vir_obj_nat(0xfffffff0, 32); }
    catch (error) { failure = error; }
    check(failure instanceof WebAssembly.RuntimeError, "real browser Wasm trap");
    check(bad.failure === failure, "browser runtime remembers original trap");
    for (const action of [
      () => oldCallback(4n),
      () => readJsl(bad, held),
      () => bad.loadIrPackageSetBytes(irPackageSet),
    ]) {
      let rejected = false;
      try { action(); } catch (error) { rejected = /fresh runtime/.test(error.message); }
      check(rejected, "trapped generation rejects callback, handle and installation");
    }
    bad.dispose(); bad.dispose();
    check(exports.vir_resource_roots_active() === 0 &&
      exports.vir_resource_roots_reusable() === 0,
      "browser disposal clears the Wasm table after trap");
    check(state.leanObjectHandleCells.size === 0 && bad.liveCallbackCount() === 0,
      "browser disposal releases JavaScript roots after trap");
    for (const runtime of [good, recovered = await factory.createRuntime({ irPackageSet })]) {
      runtime.call("HostInterop.callbackRoundTrip", 3);
      check(captured(4n) === 11n, "other and fresh generations execute after trap");
    }
    return { retired: true, recovered: true };
  } finally {
    bad.dispose(); good.dispose(); recovered?.dispose(); captured = null;
  }
}

async function runReactChurn(createRuntime) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const capture = { callback: null };
  const runtime = await createRuntime({
    "test.callNatCallback": (input, callback) => {
      capture.callback = callback;
      return callback(input);
    },
    "test.recordNat": () => undefined,
  });
  const counts = { renders: 0, suspended: 0, setups: 0, cleanups: 0 };
  const never = new Promise(() => {});
  function Component({ label, suspend }) {
    counts.renders++;
    const jsl = makeJsl(runtime, label);
    runtime.call("HostInterop.callbackRoundTrip", 3);
    const callback = capture.callback;
    capture.callback = null;
    React.useEffect(() => {
      counts.setups++;
      check(callback(4n) === 11n, "React effect retains actual Lean callback");
      check(
        readJsl(runtime, jsl) === label,
        "React effect retains exact JSL payload",
      );
      return () => {
        counts.cleanups++;
      };
    }, [jsl, callback]);
    if (suspend) {
      counts.suspended++;
      throw never;
    }
    return React.createElement(
      "button",
      { onClick: () => callback(4n) },
      label,
    );
  }
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const render = (label, suspend = false) =>
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            React.Suspense,
            { fallback: "waiting" },
            React.createElement(Component, { label, suspend }),
          ),
        );
      try {
        await React.act(async () => root.render(render("mount")));
        await React.act(async () => root.render(render("update")));
        await React.act(async () => root.render(render("abandoned", true)));
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    }
    check(counts.suspended >= 3, "React attempted abandoned renders");
    check(
      counts.setups === counts.cleanups && counts.setups >= 6,
      "Strict Mode replay and ordinary effect cleanup observed",
    );
    await collectUntil(
      () =>
        runtime.liveCallbackCount() === 0 &&
        runtime.hostState.leanObjectHandleCells.size === 0,
      "React render foreign-root recovery",
    );
    check(
      runtime.hostState.resourceRootCounts().active === 0,
      "React externrefs return to zero",
    );
    return counts;
  } finally {
    runtime.dispose();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}
