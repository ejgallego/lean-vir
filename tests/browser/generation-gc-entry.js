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
  );
  const sharedBindings = {};
  const shared = await runSharedBindingGcCases(
    createVirRuntimeFactory({ wasmModule, hostBindings: sharedBindings }),
    sharedBindings,
    irPackageSet[0],
  );
  const react = await runReactChurn(createRuntime);
  return { gc, lifecycle, shared, react };
};

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
        runtime.liveCallbacks.size === 0 &&
        runtime.hostState.leanObjectHandleCells.size === 0,
      "React render foreign-root recovery",
    );
    check(
      runtime.hostState.resourceRoots.debugCounts().active === 0,
      "React externrefs return to zero",
    );
    return counts;
  } finally {
    runtime.dispose();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
}
