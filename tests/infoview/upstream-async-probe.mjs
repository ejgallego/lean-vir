// Manual characterization probe, not a VIR correctness test. Execute the
// published hooks unchanged; do not make these upstream limitations our contract.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { launchChromium, openChromiumPage, evaluate } from "../browser/harness.mjs";

const source = `
import * as React from "react";
import { createRoot } from "react-dom/client";
import { useAsync, useAsyncPersistent } from "@leanprover/infoview";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.upstreamAsyncProbe = (async () => {
  const errors = [];
  window.addEventListener("error", e => errors.push(e.message));
  window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
  async function run(strict, persistent, rejectAborted = false) {
    const requests = [], effects = [], renders = [], snapshots = [];
    let state;
    function View({query}) {
      const useRequest = persistent ? useAsyncPersistent : useAsync;
      state = useRequest(signal => {
        const request = { query, signal, ...Promise.withResolvers() };
        requests.push(request);
        if (rejectAborted) signal.addEventListener("abort", () =>
          request.reject(new Error("request aborted")), {once: true});
        return request.promise;
      }, [query]);
      renders.push({query, state: state.state});
      React.useEffect(() => {
        effects.push("setup");
        return () => effects.push("cleanup");
      }, []);
      return React.createElement("pre", null, JSON.stringify(state));
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function snapshot(label) {
      snapshots.push({label, state: state.state, value: state.value?.label,
        error: state.error?.message, keys: Object.keys(state),
        requests: requests.map(r => ({query:r.query, aborted:r.signal.aborted,
          nativeSignal:r.signal instanceof AbortSignal}))});
    }
    async function render(query) {
      await React.act(async () => root.render(strict
        ? React.createElement(React.StrictMode, null, React.createElement(View, {query}))
        : React.createElement(View, {query})));
      snapshot("render " + query);
    }
    async function resolve(query, label) {
      await React.act(async () => requests.find(r => r.query === query).resolve({label}));
      snapshot("resolve " + query);
    }
    try {
      await render("a");
      if (strict && !rejectAborted) {
        await resolve("a", "strict-a");
      } else if (!strict) {
        await resolve("a", "current-a");
        await render("b");
        await render("c");
        await resolve("c", "current-c");
        await resolve("b", "stale-b");
        await render("d");
        await React.act(async () => requests.find(r => r.query === "d").reject(new Error("d failed")));
        snapshot("reject d");
        await render("e");
      }
    } finally {
      await React.act(async () => root.unmount());
      snapshot("unmount");
      container.remove();
    }
    return {strict, persistent, rejectAborted, effects, renders, snapshots};
  }
  return {normal: await run(false, true), strict: await run(true, true),
    strictAbort: await run(true, true, true), plain: await run(false, false),
    plainStrictAbort: await run(true, false, true), errors};
})();`;
const bundle = await build({
  stdin: {contents: source, resolveDir: fileURLToPath(new URL("../../", import.meta.url))},
  bundle: true, format: "iife", platform: "browser", write: false,
  conditions: ["browser", "default"],
  define: {"process.env.NODE_ENV": '"development"'},
});
const chrome = await launchChromium();
let cdp;
try {
  cdp = await openChromiumPage(chrome);
  await evaluate(cdp, bundle.outputFiles[0].text);
  const result = await evaluate(cdp, "globalThis.upstreamAsyncProbe");
  assert.deepEqual(result.errors, []);
  for (const run of Object.values(result).filter(value => value.snapshots)) {
    assert.ok(run.snapshots.every(snapshot =>
      snapshot.requests.every(request => request.nativeSignal)));
    assert.ok(run.snapshots.at(-1).requests.every(request => request.aborted));
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  cdp?.close();
  await chrome.close();
}
