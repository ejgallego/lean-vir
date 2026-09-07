/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { RpcSessions } from "@leanprover/infoview-api";
import { RpcReferenceWidget } from "../../examples/tutorials/rpc-reference-widget.js";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { describeError, until, withCleanup } from "./rpc-test-support.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (value.error) throw value.error;
  return value.result;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.rpcAcceptance = run().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: describeError(error),
  }),
);

async function run() {
  const config = await (await fetch("/config")).json();
  const requests = [];
  const unexpected = [];
  const notifications = new Set();
  const onUnhandled = (event) => unexpected.push(event.reason);
  const onError = (event) => unexpected.push(event.error ?? event.message);
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  globalThis.addEventListener("error", onError);
  // Keep test-transport failures visible, including session cleanup notifications.
  const notify = (path, body) => {
    const task = post(path, body).catch((error) => unexpected.push(error));
    notifications.add(task);
    void task.then(() => notifications.delete(task));
  };
  let nextId = 0;
  let sessions, runtime, root;
  let rootUnmounted = false;
  const unmount = () => {
    if (root && !rootUnmounted) {
      React.act(() => root.unmount());
      rootUnmounted = true;
    }
  };
  return withCleanup(async () => {
    sessions = new RpcSessions({
      async createRpcSession() {
        return (await post("/connect", {})).sessionId;
      },
      closeRpcSession(sessionId) {
        notify("/close", { sessionId });
      },
      release(params) {
        notify("/release", params);
      },
      async call(params, options) {
        const id = ++nextId;
        const record = {
          message: params.params?.message,
          cancelled: false,
          settled: false,
        };
        requests.push(record);
        const promise = post("/call", { id, params });
        const cancel = () => {
          record.cancelled = true;
          notify("/cancel", { id });
        };
        options?.abortSignal?.addEventListener("abort", cancel, { once: true });
        if (options?.abortSignal?.aborted) cancel();
        try {
          record.value = await promise;
          return record.value;
        } catch (error) {
          // Observe every rejection, even if the application's effect is inactive.
          record.error = error;
          throw error;
        } finally {
          record.settled = true;
          options?.abortSignal?.removeEventListener("abort", cancel);
        }
      },
    });
    const sessionAt = (position) =>
      sessions.connect(
        { textDocument: { uri: config.uri }, position },
        config.capabilities,
      );
    const a = sessionAt(config.a),
      b = sessionAt(config.b);
    check(
      a === sessionAt(config.a) && a !== b,
      "official sessions cache by position",
    );
    const [wasmBytes, packageBytes] = await Promise.all(
      ["/runtime.wasm", "/rpc.irpkg"].map(
        async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer()),
      ),
    );
    const makeRuntime = () =>
      createVirRuntime({
        wasmBytes,
        irPackageSetBytes: [packageBytes],
        defaultHostBindings: () =>
          createBrowserHostBindings({
            reactHostBindings: createBrowserReactHostBindings,
          }),
      });
    runtime = await makeRuntime();
    let component = runtime.call("RpcReferenceWidget.View");
    root = createRoot(document.getElementById("app"));
    const query = (message, extra = {}) => ({
      message,
      fail: false,
      waitForCancellation: false,
      ...extra,
    });
    const render = (session, params) =>
      React.act(() =>
        root.render(
          React.createElement(RpcReferenceWidget, {
            session,
            query: params,
            runtime,
            view: component,
          }),
        ),
      );
    const request = (message) =>
      requests.find((record) => record.message === message);
    const settle = (message) =>
      React.act(async () => {
        await until(
          `request settled: ${message}`,
          () => request(message)?.settled,
        );
      });
    const gate = (action, message) => post("/gate", { action, message });
    const ready = (message) =>
      until(`server response gated: ${message}`, () => gate("status", message));
    const release = (message) =>
      React.act(async () => {
        await gate("open", message);
        await until(
          `released request settled: ${message}`,
          () => request(message)?.settled,
        );
      });
    const text = () => document.body.textContent;
    const status = () =>
      document.querySelector("[data-rpc-status]")?.dataset.rpcStatus;
    let goal;
    // Also exercise loading before the first genuine reply: no placeholder Reply.
    await gate("arm", "first");
    render(a, query("first"));
    await ready("first");
    check(
      status() === "loading" && !document.getElementById("rpc-reference-view"),
      "initial loading has no fabricated RPC response",
    );
    await release("first");
    check(
      text().includes("first / local 0") && status() === "ready",
      "first response",
    );
    const reply = request("first").value;
    check(
      runtime.call("RpcReferenceWidget.reference", reply) === reply.ref,
      "nested RPC reference identity",
    );
    check(
      (await runtime.call("RpcReferenceWidget.readReference", a, reply)) ===
        "first",
      "real server WithRpcRef round trip through Lean",
    );
    React.act(() => document.getElementById("rpc-reference-view").click());
    check(text().includes("local 1"), "Lean hook state update");

    await gate("arm", "superseded");
    render(a, query("superseded"));
    await ready("superseded");
    check(
      status() === "loading" &&
        text().includes("previous response") &&
        text().includes("first / local 1"),
      "refresh labels retained response",
    );
    render(b, query("second"));
    await settle("second");
    check(
      text().includes("second / local 1"),
      "position rerender preserves hook state",
    );
    await release("superseded");
    check(
      request("superseded").value?.message === "superseded" &&
        request("superseded").cancelled,
      "late success really arrives after cancellation",
    );
    check(
      text().includes("second / local 1") && !text().includes("superseded"),
      "successful stale response cannot replace the current position",
    );

    const abort = new AbortController();
    const cancelled = runtime
      .call(
        "RpcReferenceWidget.request",
        b,
        "RpcBrowserServer.create",
        query("cancel", { waitForCancellation: true }),
        { abortSignal: abort.signal },
      )
      .then(
        () => null,
        (error) => error,
      );
    await until("cancellable request registered", () =>
      post("/started", { message: "cancel" }),
    );
    abort.abort();
    check(
      (await cancelled)?.code === -32800,
      "native options reach Lean cancellation token",
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const preCancelled = await runtime
      .call(
        "RpcReferenceWidget.request",
        b,
        "RpcBrowserServer.create",
        query("already cancelled", { waitForCancellation: true }),
        { abortSignal: alreadyAborted.signal },
      )
      .then(
        () => null,
        (error) => error,
      );
    check(
      preCancelled?.code === -32800,
      "pre-aborted signal cancels before registration",
    );

    render(b, query("visible error", { fail: true }));
    await settle("visible error");
    check(
      status() === "error" &&
        text().includes("RPC example rejection") &&
        text().includes("second / local 1"),
      "failure is visible without destroying last reply",
    );

    // Real goal snapshots belong to the test server, not a public VIR protocol.
    const ref = await b.call("RpcBrowserServer.goalAt", { pos: config.b });
    check(ref !== undefined && ref !== null, "real goal produces a WithRpcRef");
    goal = await b.call("RpcBrowserServer.readGoal", { ref });
    check(
      goal.target === "p" && goal.hypotheses.includes("h : p"),
      "goal snapshot resolves in real context",
    );

    await gate("arm", "old package");
    render(b, query("old package"));
    await ready("old package");
    const old = runtime;
    React.act(() => root.render(null));
    old.dispose();
    check(
      old.liveCallbacks.size === 0,
      "replacement releases old Lean closure roots",
    );
    runtime = await makeRuntime();
    component = runtime.call("RpcReferenceWidget.View");
    render(a, query("replacement"));
    await settle("replacement");
    await release("old package");
    check(
      request("old package").value?.message === "old package",
      "disposed generation's request actually succeeds",
    );
    check(
      text().includes("replacement / local 0") &&
        !text().includes("old package"),
      "disposed generation cannot publish a late success",
    );

    await gate("arm", "after unmount");
    render(a, query("after unmount"));
    await ready("after unmount");
    unmount();
    runtime.dispose();
    check(
      runtime.liveCallbacks.size === 0,
      "unmount releases every Lean closure root",
    );
    await release("after unmount");
    check(
      request("after unmount").value?.message === "after unmount" &&
        !text().includes("after unmount"),
      "late success after unmount is inert",
    );

    const failures = requests.filter(
      (record) =>
        record.error &&
        !(record.cancelled && record.error.code === -32800) &&
        !(
          record.message === "visible error" &&
          record.error.message.includes("RPC example rejection")
        ),
    );
    check(
      failures.length === 0,
      `unexpected RPC failures: ${JSON.stringify(failures.map((record) => ({ ...record, error: describeError(record.error) })))}`,
    );
    return {
      lateSuccesses: requests
        .filter((record) => record.cancelled && record.value)
        .map((r) => r.message),
      cancellations: requests.filter((record) => record.error?.code === -32800)
        .length,
      realReference: goal.target,
      requests: requests.length,
    };
  }, [
    ["React root", unmount],
    ["VIR runtime", () => runtime?.dispose()],
    ["RPC sessions", () => sessions?.dispose()],
    [
      "transport notifications",
      async () => {
        // RpcSessions schedules closeRpcSession via the session-id Promise.
        await Promise.resolve();
        while (notifications.size > 0) await Promise.all(notifications);
        // Allow detached Promise/error events to report before asserting success.
        await sleep(0);
      },
    ],
    [
      "rejection listener",
      () => globalThis.removeEventListener("unhandledrejection", onUnhandled),
    ],
    ["error listener", () => globalThis.removeEventListener("error", onError)],
    [
      "browser errors",
      () =>
        check(
          unexpected.length === 0,
          `unhandled browser/transport errors: ${JSON.stringify(unexpected.map(describeError))}`,
        ),
    ],
  ]);
}
