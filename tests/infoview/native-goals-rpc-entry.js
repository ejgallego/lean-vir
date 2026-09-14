/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { RpcSessions, getInteractiveGoals, TaggedText_stripTags } from "@leanprover/infoview-api";
import { EditorContext, EditorConnection } from "@leanprover/infoview";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { withCleanup } from "./rpc-test-support.js";

const check = (ok, message) => { if (!ok) throw new Error(message); };
const SessionContext = React.createContext(null);
async function post(path, body) {
  const response = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  const reply = await response.json();
  if (reply.error) throw reply.error;
  return reply.result;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const inputs = [];
const replies = [];
globalThis.rpcAcceptance = run().then(value => ({ ok: true, value }), error => ({ ok: false, error: error.stack, inputs, replies }));

async function run() {
  const config = await (await fetch("/config")).json();
  const notifications = new Set();
  const errors = [];
  const calls = [];
  const notify = (path, body) => {
    const task = post(path, body).catch(error => errors.push(error));
    notifications.add(task);
    void task.then(() => notifications.delete(task));
  };
  let nextId = 0, runtime, reactRoot, sessions;
  const previousError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); previousError(...args); };
  return withCleanup(async () => {
    sessions = new RpcSessions({
      async createRpcSession() { return (await post("/connect", {})).sessionId; },
      closeRpcSession(sessionId) { notify("/close", { sessionId }); },
      release(params) { notify("/release", params); },
      async call(params, options) {
        const id = ++nextId;
        calls.push(params.method);
        const cancel = () => notify("/cancel", { id });
        const pending = post("/call", { id, params });
        options?.abortSignal?.addEventListener("abort", cancel, { once: true });
        if (options?.abortSignal?.aborted) cancel();
        try {
          const reply = await pending;
          if (params.method.endsWith("infoToInteractive")) replies.push(reply);
          return reply;
        }
        finally { options?.abortSignal?.removeEventListener("abort", cancel); }
      },
    });
    const [wasmBytes, irPackage] = await Promise.all(["/runtime.wasm", "/rpc.irpkg"].map(async path =>
      new Uint8Array(await (await fetch(path)).arrayBuffer())));
    runtime = await createVirRuntime({ wasmBytes, irPackageSet: [irPackage],
      hostBindings: createBrowserHostBindings({
        reactHostBindings: createBrowserReactHostBindings,
        infoviewEditorContext: EditorContext,
        infoviewStripTags: TaggedText_stripTags,
        // The production shell supplies upstream useRpcSession. This test injects
        // the exact official session at each tested position through a React context.
        infoviewUseRpcSession: () => React.useContext(SessionContext),
      }),
    });
    const component = runtime.call("VirNativeInfoview.createComponent");
    const editor = new EditorConnection({ async copyToClipboard() {} }, {});
    const container = document.getElementById("app");
    reactRoot = createRoot(container);
    const targets = [];
    for (const position of [config.a, config.b]) {
      const tdpp = { textDocument: { uri: config.uri }, position };
      const session = sessions.connect(tdpp, config.capabilities);
      const result = await getInteractiveGoals(session, tdpp);
      inputs.push(result);
      check(result?.goals.length > 0, "real server returned goals");
      await React.act(async () => reactRoot.render(
        React.createElement(React.StrictMode, null,
          React.createElement(EditorContext.Provider, { value: editor },
            React.createElement(SessionContext.Provider, { value: session },
              React.createElement(component, { pos: { uri: config.uri, ...position },
                goals: result.goals, selectedLocations: [] }))))));
      const target = container.querySelector(".vir-native-infoview-target-code");
      targets.push(target.textContent);
      const tag = target.querySelector(".vir-native-infoview-code-tag");
      check(tag, "real tagged target rendered natively");
      await React.act(async () => tag.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        await React.act(async () => new Promise(resolve => setTimeout(resolve, 20)));
        const popup = tag.querySelector('[role="tooltip"]');
        if (popup && !popup.textContent.includes("Loading")) break;
      }
      const popup = tag.querySelector('[role="tooltip"]');
      check(popup && !/Loading|Unable to load/.test(popup.textContent), "real type RPC populated native popup");
    }
    check(targets[0] !== targets[1], "cursor change updates native goals");
    check(calls.filter(method => method.endsWith("infoToInteractive")).length >= 2, "both positions issued actual type RPCs");
    return { positions: 2, calls, targets };
  }, [
    ["React root", async () => { if (reactRoot) await React.act(async () => reactRoot.unmount()); }],
    ["runtime", () => runtime?.dispose()],
    ["sessions", () => sessions?.dispose()],
    ["notifications", async () => {
      await Promise.resolve();
      while (notifications.size) await Promise.all(notifications);
      check(errors.length === 0, JSON.stringify(errors));
    }],
    ["console", () => { console.error = previousError; }],
  ]);
}
