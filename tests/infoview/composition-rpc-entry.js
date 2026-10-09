/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import * as React from "react";
import { InteractiveCode, renderInfoview, useRpcSession, EditorContext,
  TaggedText_stripTags, defaultInfoviewConfig } from "@leanprover/infoview";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { unmountInfoviewRoots } from "./react-dom-compat.js";

const check = (ok, message) => { if (!ok) throw new Error(message); };
async function post(path, body) {
  const response = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  const reply = await response.json();
  if (reply.error) throw reply.error;
  return reply.result;
}

// The shipped infoview runs with production React. Native renderer acceptance
// separately retains development act/StrictMode checks.
globalThis.IS_REACT_ACT_ENVIRONMENT = process.env.NODE_ENV === "development";
const act = process.env.NODE_ENV === "development" ? React.act :
  async action => { await action(); await new Promise(resolve => setTimeout(resolve, 0)); };
globalThis.rpcAcceptance = run().then(value => ({ ok: true, value }), error => ({ ok: false, error: error.stack }));

async function run() {
  const config = await (await fetch("/config")).json();
  const calls = [], errors = [], nativeElements = [], seenPanels = [];
  const sessions = new Set(), notifications = new Set();
  const subscriptions = new Set();
  const previousError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); previousError(...args); };
  let runtime, infoview, nextId = 0;
  const notify = (path, body) => {
    const task = post(path, body);
    notifications.add(task);
    void task.then(() => notifications.delete(task), error => {
      errors.push(String(error)); notifications.delete(task);
    });
    return task;
  };
  const waitFor = async (test, label) => {
    const deadline = performance.now() + 15000;
    while (!test() && performance.now() < deadline)
      await act(async () => new Promise(resolve => setTimeout(resolve, 25)));
    check(test(), `${label}; calls=${JSON.stringify(calls)}; errors=${JSON.stringify(errors)}; popup=${document.querySelector(".tooltip-code-content")?.textContent}; host=${document.getElementById("app").textContent.slice(0,500)}`);
  };
  try {
    const [wasmBytes, irPackage] = await Promise.all(["/runtime.wasm", "/rpc.irpkg"].map(async path =>
      new Uint8Array(await (await fetch(path)).arrayBuffer())));
    const bindings = createBrowserHostBindings({
      reactHostBindings: createBrowserReactHostBindings,
      infoviewInteractiveCode: InteractiveCode,
      infoviewEditorContext: EditorContext,
      infoviewUseRpcSession: useRpcSession,
      infoviewStripTags: TaggedText_stripTags,
    });
    check(bindings["infoview.interactiveCode"]() === InteractiveCode, "exact public component getter");
    const createElement = bindings["react.node.createElement"];
    bindings["react.node.createElement"] = (type, props, children) => {
      const element = createElement(type, props, children);
      if (type === InteractiveCode) {
        check(element.type === InteractiveCode && element.props.fmt === props.fmt,
          "React receives exact external component and fmt");
        nativeElements.push(element);
      }
      return element;
    };
    runtime = await createVirRuntime({ wasmBytes, irPackageSet: [irPackage], hostBindings: bindings });
    const Comparison = runtime.call("VirNativeInfoview.Comparison.createComponent");
    // Only widget discovery/source are synthetic. The public infoview mounts this
    // under its real private contexts; all goal and popup RPCs go to actual Lean.
    globalThis.virCompositionWidget = props => {
      seenPanels.push(props);
      return React.createElement(Comparison, props);
    };
    const editorApi = {
      async createRpcSession() {
        const { sessionId } = await post("/connect", {});
        sessions.add(sessionId); return sessionId;
      },
      async closeRpcSession(sessionId) { sessions.delete(sessionId); await notify("/close", { sessionId }); },
      async sendClientRequest(_uri, method, params, options) {
        check(method === "$/lean/rpc/call", `unexpected LSP request ${method}`);
        calls.push(params.method);
        if (params.method === "Lean.Widget.getWidgets")
          return { widgets: [{ id: "comparison", javascriptHash: "123456789", props: {} }] };
        if (params.method === "Lean.Widget.getWidgetSource")
          return { sourcetext: "export default globalThis.virCompositionWidget;" };
        const id = ++nextId;
        const cancel = () => { void notify("/cancel", { id }); };
        const pending = post("/call", { id, params });
        options?.abortSignal?.addEventListener("abort", cancel, { once: true });
        if (options?.abortSignal?.aborted) cancel();
        try { return await pending; }
        finally { options?.abortSignal?.removeEventListener("abort", cancel); }
      },
      async sendClientNotification(_uri, method, params) {
        if (method === "$/lean/rpc/release") await notify("/release", params);
      },
      async subscribeServerNotifications(method) { subscriptions.add(method); }, async unsubscribeServerNotifications() {},
      async subscribeClientNotifications() {}, async unsubscribeClientNotifications() {},
      async copyToClipboard() {}, async saveConfig() {}, async showDocument() {},
    };
    await act(async () => { infoview = renderInfoview(editorApi, document.getElementById("app")); });
    await waitFor(() => subscriptions.has("$/lean/fileProgress"), "upstream host effects initialized");
    await act(async () => {
      await infoview.serverRestarted({ capabilities: config.capabilities,
        serverInfo: { name: "Lean", version: "4.33.0" } });
      await infoview.changedInfoviewConfig({ ...defaultInfoviewConfig, debounceTime: 0 });
      await infoview.initialize({ uri: config.uri, range: { start: config.a, end: config.a } });
    });
    const targets = [];
    for (const position of [config.a, config.b]) {
      await act(async () => infoview.changedCursorLocation({ uri: config.uri,
        range: { start: position, end: position } }));
      await waitFor(() => seenPanels.at(-1)?.pos.line === position.line &&
        document.querySelectorAll(".vir-infoview-comparison .vir-native-infoview-target-code").length >= 2,
      "both Lean-authored panels mounted at cursor");
      const native = document.querySelector('[data-renderer="lean"]');
      const composed = document.querySelector('[data-renderer="upstream"]');
      const target = panel => panel.querySelector(".vir-native-infoview-target-code");
      check(target(native).textContent === target(composed).textContent, "both renderers display the same target");
      targets.push(target(composed).textContent);
      const fmt = seenPanels.at(-1).goals[0].type;
      check(nativeElements.some(element => element.props.fmt === fmt), "fmt is the original server object");
      // Exercise a leaf subexpression, not the outer Eq constant's large Markdown
      // documentation popup. Tooltip geometry is upstream behavior, not this gate.
      const tag = [...target(composed).querySelectorAll("[data-has-tooltip-on-hover]")].at(-1);
      check(tag, "official InteractiveCode rendered the tagged target");
      const before = calls.filter(method => method.endsWith("infoToInteractive")).length;
      const expectedType = targets.length === 1 ? "Nat" : "Prop";
      await act(async () => tag.click());
      await waitFor(() => calls.filter(method => method.endsWith("infoToInteractive")).length > before &&
        document.querySelector(".tooltip-code-content .font-code")?.textContent.includes(expectedType),
      "external component populated its real server type popup");
      await act(async () => tag.click());
      await waitFor(() => !document.querySelector(".tooltip-code-content"), "external popup closes");
    }
    check(targets[0] !== targets[1], "cursor updates both implementations");
    // Same goal-panel factory, but independently mounted settings on each side.
    const controls = [...document.querySelectorAll('[data-renderer="upstream"] label')];
    const input = controls.find(label => label.textContent.trim() === "Hide type assumptions").querySelector("input");
    await act(async () => input.click());
    check(document.querySelectorAll('[data-renderer="upstream"] .vir-native-infoview-hypothesis').length === 1,
      "composed panel retains Lean filtering");
    check(document.querySelectorAll('[data-renderer="lean"] .vir-native-infoview-hypothesis').length === 2,
      "side-by-side local settings remain independent");
    const ids = [...document.querySelectorAll(".vir-infoview-comparison .vir-native-infoview-goal [id]")].map(node => node.id);
    check(new Set(ids).size === ids.length, "comparison panels retain unique useId values");
    check(errors.length === 0, JSON.stringify(errors));
    return { reactMode: process.env.NODE_ENV, positions: 2, targets,
      externalElements: nativeElements.length, calls, warnings: errors };
  } finally {
    try {
      if (infoview) {
        await act(async () => {
          await infoview.changedCursorLocation(undefined);
          await infoview.sentClientNotification("textDocument/didClose", { textDocument: { uri: config.uri } });
        });
        await waitFor(() => !document.querySelector(".vir-infoview-comparison"), "comparison unmounted before runtime disposal");
      }
      await act(async () => unmountInfoviewRoots());
      runtime?.dispose();
      for (const sessionId of sessions) await notify("/close", { sessionId });
      while (notifications.size) await Promise.all([...notifications]);
      check(errors.length === 0, JSON.stringify(errors));
    } finally {
      delete globalThis.virCompositionWidget;
      console.error = previousError;
    }
  }
}
