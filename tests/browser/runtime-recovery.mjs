/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { basePath, evaluate, navigate, waitForReady, waitForStatus } from "./harness.mjs";
import { setInputValueAndDispatch, waitForBrowserState } from "./page-actions.mjs";
import { runSelectedEntry } from "./dev-runner.mjs";

// Inject at the exported-call boundary to exercise real page recovery controls.
// Runtime smoke tests separately exercise traps inside the actual Wasm engine.
async function installSyntheticCallTrap(cdp) {
  const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      globalThis.__virTestResolvedCalls = 0;
      globalThis.__virTestWasmInstances = 0;
      globalThis.__virTestTrapNextResolvedCall = new URLSearchParams(location.search).has("trapOnLoad");
      const OriginalInstance = WebAssembly.Instance;
      Object.defineProperty(WebAssembly, "Instance", {
        configurable: true,
        writable: true,
        value: new Proxy(OriginalInstance, {
          construct(target, args) {
            const instance = Reflect.construct(target, args, target);
            globalThis.__virTestWasmInstances += 1;
            const exports = instance.exports;
            const guardedExports = { ...exports };
            const call = exports.vir_call_resolved_objects;
            guardedExports.vir_call_resolved_objects = (...callArgs) => {
              globalThis.__virTestResolvedCalls += 1;
              if (globalThis.__virTestTrapNextResolvedCall) {
                globalThis.__virTestTrapNextResolvedCall = false;
                throw new WebAssembly.RuntimeError("synthetic page recovery trap");
              }
              return Reflect.apply(call, exports, callArgs);
            };
            return new Proxy(instance, {
              get(targetInstance, name) {
                return name === "exports"
                  ? guardedExports
                  : Reflect.get(targetInstance, name, targetInstance);
              },
            });
          },
        }),
      });
      let titleOwner = Document.prototype;
      let titleDescriptor = null;
      while (titleOwner !== null && titleDescriptor === null) {
        titleDescriptor = Object.getOwnPropertyDescriptor(titleOwner, "title");
        if (titleDescriptor === undefined) {
          titleDescriptor = null;
          titleOwner = Object.getPrototypeOf(titleOwner);
        }
      }
      globalThis.__virTestTitleSetterWrapped = Boolean(titleDescriptor?.set && titleDescriptor.configurable);
      if (globalThis.__virTestTitleSetterWrapped) {
        Object.defineProperty(titleOwner, "title", {
          ...titleDescriptor,
          set(value) {
            if (globalThis.__virTestRejectDocumentTitle) {
              throw new Error("synthetic recoverable document title error");
            }
            return Reflect.apply(titleDescriptor.set, this, [value]);
          },
        });
      }
    })();`,
  });
  return () => cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}

export async function smokeRunnerFatalRecovery(cdp, origin) {
  const removeTrap = await installSyntheticCallTrap(cdp);
  try {
    await navigate(cdp, `${origin}${basePath}dev.html?package=local-fib.irpkg&entry=fib`);
    await waitForReady(cdp);

    await setInputValueAndDispatch(cdp, "[data-input-index='0']", "invalid", "input");
    await evaluate(cdp, `document.querySelector("#dev-run-entry").click()`);
    const recoverable = await waitForBrowserState(cdp, `(() => {
      const status = document.querySelector("#status")?.textContent?.trim();
      if (status !== "Failed") return { ready: false, status };
      return {
        ready: true,
        runDisabled: document.querySelector("#dev-run-entry").disabled,
        reloadHidden: document.querySelector("#dev-reload-runtime").hidden,
        message: document.querySelector("#dev-result").textContent,
      };
    })()`, { timeoutMessage: "runner did not report its recoverable input error" });
    assert.equal(recoverable.runDisabled, false);
    assert.equal(recoverable.reloadHidden, true);
    assert.match(recoverable.message, /invalid Nat literal/);

    await setInputValueAndDispatch(cdp, "[data-input-index='0']", "9", "input");
    await evaluate(cdp, `(() => {
      window.__virTestTrapNextResolvedCall = true;
      document.querySelector("#dev-run-entry").click();
    })()`);
    await waitForStatus(cdp, "Trap");
    const failed = await evaluate(cdp, `({
      entry: document.querySelector("#dev-entry-select").value,
      input: document.querySelector("[data-input-index='0']").value,
      runDisabled: document.querySelector("#dev-run-entry").disabled,
      reloadHidden: document.querySelector("#dev-reload-runtime").hidden,
      calls: window.__virTestResolvedCalls,
    })`);
    assert.equal(failed.entry, "fib");
    assert.equal(failed.input, "9");
    assert.equal(failed.runDisabled, true);
    assert.equal(failed.reloadHidden, false);

    await evaluate(cdp, `document.querySelector("#dev-reload-runtime").click()`);
    const reloaded = await waitForBrowserState(cdp, `(() => {
      const status = document.querySelector("#status")?.textContent?.trim();
      const reload = document.querySelector("#dev-reload-runtime");
      const run = document.querySelector("#dev-run-entry");
      return {
        ready: status === "Ready" && reload.hidden && !run.disabled,
        entry: document.querySelector("#dev-entry-select").value,
        input: document.querySelector("[data-input-index='0']").value,
        calls: window.__virTestResolvedCalls,
      };
    })()`, { timeoutMessage: "runner did not create a fresh runtime" });
    assert.equal(reloaded.entry, failed.entry);
    assert.equal(reloaded.input, failed.input);
    assert.equal(reloaded.calls, failed.calls, "reload must not replay the failed entry");
    assert.equal(await runSelectedEntry(cdp), "34");
  } finally {
    await removeTrap();
  }
}

export async function smokeDemoRuntimeRecovery(cdp, origin) {
  const removeTrap = await installSyntheticCallTrap(cdp);
  try {
    await navigate(cdp, `${origin}${basePath}demo.html`);
    await waitForReady(cdp);
    await evaluate(cdp, `document.querySelector("[data-fixture-id='fib']").click()`);
    await setInputValueAndDispatch(cdp, "#fixture-input", "9", "input");
    const before = await evaluate(cdp, `({
      instances: window.__virTestWasmInstances,
      calls: window.__virTestResolvedCalls,
    })`);
    await evaluate(cdp, `(() => {
      window.__virTestTrapNextResolvedCall = true;
      document.querySelector("#fixture-run-selected").click();
    })()`);
    await waitForStatus(cdp, "Trap");
    const failed = await waitForBrowserState(cdp, `(() => {
      const reload = document.querySelector("#fixture-reload-runtime");
      const run = document.querySelector("#fixture-run-selected");
      const result = document.querySelector("#fixture-selected-result");
      return {
        ready: !reload.hidden && run.disabled && result.dataset.failed === "true",
        input: document.querySelector("#fixture-input").value,
        selected: document.querySelector(".fixture-item[data-selected='true']")?.dataset.fixtureId,
        instances: window.__virTestWasmInstances,
        calls: window.__virTestResolvedCalls,
      };
    })()`, { timeoutMessage: "demo did not retire the failed fixture runtime" });
    assert.equal(failed.selected, "fib");
    assert.equal(failed.input, "9");
    assert.equal(failed.instances, before.instances);
    assert.equal(failed.calls, before.calls + 1);

    await evaluate(cdp, `document.querySelector("#fixture-reload-runtime").click()`);
    const reloaded = await waitForBrowserState(cdp, `(() => {
      const reload = document.querySelector("#fixture-reload-runtime");
      const run = document.querySelector("#fixture-run-selected");
      return {
        ready: reload.hidden && !run.disabled,
        selected: document.querySelector(".fixture-item[data-selected='true']")?.dataset.fixtureId,
        input: document.querySelector("#fixture-input").value,
        instances: window.__virTestWasmInstances,
        calls: window.__virTestResolvedCalls,
      };
    })()`, { timeoutMessage: "demo did not replace its failed cached runtime" });
    assert.equal(reloaded.selected, failed.selected);
    assert.equal(reloaded.input, failed.input);
    assert.equal(reloaded.instances, before.instances + 1);
    assert.equal(reloaded.calls, failed.calls, "cache reload must not replay the failed fixture");

    await evaluate(cdp, `document.querySelector("#fixture-run-selected").click()`);
    const result = await waitForBrowserState(cdp, `(() => {
      const value = document.querySelector("#fixture-selected-result").textContent.trim();
      return { ready: value === "34", value };
    })()`, { timeoutMessage: "fresh demo runtime did not run after explicit reload" });
    assert.equal(result, "34");

    const beforeBatch = await evaluate(cdp, `(() => {
      const calls = window.__virTestResolvedCalls;
      const originalFrame = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => {
        window.__virTestFinishBatchFrame = () => {
          window.requestAnimationFrame = originalFrame;
          callback(performance.now());
        };
        return 0;
      };
      window.__virTestTrapNextResolvedCall = true;
      document.querySelector("#fixture-run-visible").click();
      return calls;
    })()`);
    await waitForStatus(cdp, "Trap");
    const duringBatch = await evaluate(cdp, `(() => {
      const reload = document.querySelector("#fixture-reload-runtime");
      reload.click();
      return { disabled: reload.disabled, calls: window.__virTestResolvedCalls };
    })()`);
    assert.equal(duringBatch.disabled, true, "reload must wait for the failed batch to exit");
    assert.equal(duringBatch.calls, beforeBatch + 1);
    await evaluate(cdp, "window.__virTestFinishBatchFrame()");
    const stopped = await waitForBrowserState(cdp, `({
      ready: !document.querySelector("#fixture-reload-runtime").disabled,
      calls: window.__virTestResolvedCalls,
      summary: document.querySelector("#fixture-run-status").textContent,
    })`, { timeoutMessage: "fatal fixture batch did not stop before reload" });
    assert.equal(stopped.calls, beforeBatch + 1, "a fatal batch must not run later fixtures");
    assert.equal(stopped.summary, "0 passed, 1 failed");
  } finally {
    await removeTrap();
  }
}

export async function smokeRunnerRecoverableHostError(cdp, origin) {
  const removeTrap = await installSyntheticCallTrap(cdp);
  try {
    await navigate(
      cdp,
      `${origin}${basePath}dev.html?package=demo-host.irpkg&entry=HostInterop.titleHandshake`,
    );
    await waitForReady(cdp);
    const installed = await evaluate(cdp, "window.__virTestTitleSetterWrapped");
    assert.equal(installed, true, "test must intercept the real document title host effect");
    const instances = await evaluate(cdp, "window.__virTestWasmInstances");
    await evaluate(cdp, "window.__virTestRejectDocumentTitle = true");
    const failedCall = await runSelectedEntry(cdp, ["recoverable"]);
    assert.match(failedCall, /synthetic recoverable document title error/);
    const state = await evaluate(cdp, `({
      runDisabled: document.querySelector("#dev-run-entry").disabled,
      reloadHidden: document.querySelector("#dev-reload-runtime").hidden,
      instances: window.__virTestWasmInstances,
    })`);
    assert.equal(state.runDisabled, false, "effectful IO error should leave the runtime retryable");
    assert.equal(state.reloadHidden, true);
    assert.equal(state.instances, instances);

    await evaluate(cdp, "window.__virTestRejectDocumentTitle = false");
    assert.equal(await runSelectedEntry(cdp, ["recovered"]), "Lean VIR host: recovered");
    assert.equal(await evaluate(cdp, "window.__virTestWasmInstances"), instances);
  } finally {
    await removeTrap();
  }
}

export async function smokeDemoPetRecovery(cdp, origin) {
  const removeTrap = await installSyntheticCallTrap(cdp);
  try {
    await navigate(cdp, `${origin}${basePath}demo.html?trapOnLoad=1`);
    await waitForStatus(cdp, "Trap");
    const failed = await evaluate(cdp, `({
      reloadHidden: document.querySelector("#fixture-reload-runtime").hidden,
      initializeHidden: document.querySelector("#pet-reinitialize-runtime").hidden,
      initializeDisabled: document.querySelector("#pet-reinitialize-runtime").disabled,
      petActionDisabled: document.querySelector("[data-action='feed']").disabled,
      calls: window.__virTestResolvedCalls,
      instances: window.__virTestWasmInstances,
    })`);
    assert.equal(failed.reloadHidden, false);
    assert.equal(failed.initializeHidden, false);
    assert.equal(failed.initializeDisabled, true);
    assert.equal(failed.petActionDisabled, true);
    assert.equal(failed.calls, 1);

    await evaluate(cdp, `document.querySelector("#fixture-reload-runtime").click()`);
    const reloaded = await waitForBrowserState(cdp, `(() => {
      const initialize = document.querySelector("#pet-reinitialize-runtime");
      return {
        ready: document.querySelector("#fixture-reload-runtime").hidden && !initialize.disabled,
        initializeHidden: initialize.hidden,
        petActionDisabled: document.querySelector("[data-action='feed']").disabled,
        calls: window.__virTestResolvedCalls,
        instances: window.__virTestWasmInstances,
      };
    })()`, { timeoutMessage: "pet runtime reload did not leave initialization explicit" });
    assert.equal(reloaded.initializeHidden, false);
    assert.equal(reloaded.petActionDisabled, true);
    assert.equal(reloaded.calls, failed.calls, "reload must not repeat a failed pet mount");
    assert.equal(reloaded.instances, failed.instances + 1);

    await evaluate(cdp, `document.querySelector("#pet-reinitialize-runtime").click()`);
    const initialized = await waitForBrowserState(cdp, `(() => {
      const initialize = document.querySelector("#pet-reinitialize-runtime");
      const feed = document.querySelector("[data-action='feed']");
      return {
        ready: initialize.hidden && !feed.disabled,
        calls: window.__virTestResolvedCalls,
      };
    })()`, { timeoutMessage: "explicit pet initialization did not attach fresh controls" });
    assert.equal(initialized.calls, failed.calls + 1);
  } finally {
    await removeTrap();
  }
}

export async function smokeFormatRuntimeRecovery(cdp, origin) {
  const removeTrap = await installSyntheticCallTrap(cdp);
  try {
    await navigate(cdp, `${origin}${basePath}format.html?case=fill&width=28&trapOnLoad=1`);
    await waitForStatus(cdp, "Trap", "#format-status");
    const failed = await evaluate(cdp, `({
      reloadHidden: document.querySelector("#format-reload-runtime").hidden,
      widthDisabled: document.querySelector("#format-width-input").disabled,
      selected: document.querySelector("[data-case][aria-pressed='true']")?.dataset.case,
      width: document.querySelector("#format-width-input").value,
      calls: window.__virTestResolvedCalls,
    })`);
    assert.equal(failed.reloadHidden, false);
    assert.equal(failed.widthDisabled, true);
    assert.equal(failed.selected, "fill");
    assert.equal(failed.width, "28");

    await evaluate(cdp, `document.querySelector("#format-reload-runtime").click()`);
    const reloaded = await waitForBrowserState(cdp, `(() => {
      const reload = document.querySelector("#format-reload-runtime");
      return {
        ready: document.querySelector("#format-status").textContent.trim() === "Ready" && reload.hidden,
        selected: document.querySelector("[data-case][aria-pressed='true']")?.dataset.case,
        width: document.querySelector("#format-width-input").value,
        output: document.querySelector("#format-output").textContent,
        calls: window.__virTestResolvedCalls,
      };
    })()`, { timeoutMessage: "format workbench did not render after explicit fresh-runtime reload" });
    assert.equal(reloaded.selected, failed.selected);
    assert.equal(reloaded.width, failed.width);
    assert.equal(reloaded.output, "lean ir runs format.pretty\ninside wasm");
    assert.equal(reloaded.calls, failed.calls + 1, "the pure selected format is rendered for the user");
  } finally {
    await removeTrap();
  }
}
