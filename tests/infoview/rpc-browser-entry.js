/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { RpcSessions } from "@leanprover/infoview-api";
import { EditorContext, EditorConnection, useClientNotificationEffect } from "@leanprover/infoview";
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
  const notificationHandlers = new Set();
  let subscriptions = 0;
  const editor = new EditorConnection({
    async subscribeClientNotifications(method) {
      check(method === "textDocument/didChange", "native subscription method");
      subscriptions++;
    },
    async unsubscribeClientNotifications() { subscriptions--; },
  }, {
    sentClientNotification: {
      on(handler) {
        notificationHandlers.add(handler);
        return { dispose() { notificationHandlers.delete(handler); } };
      },
    },
  });
  const emit = (method, params) => {
    for (const handler of [...notificationHandlers]) handler([method, params]);
  };
  // Hold the first replay's actual transport outcome until its successor renders.
  const replayGate = Promise.withResolvers();
  const editGate = Promise.withResolvers();
  let holdNextEdit = false;
  let heldEditId;
  let replayRequestId;
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
          id,
          message: params.params?.message,
          title: params.params?.title,
          cancelled: false,
          settled: false,
        };
        requests.push(record);
        if (holdNextEdit) { heldEditId = id; holdNextEdit = false; }
        if (record.message === "strict replay" && replayRequestId === undefined)
          replayRequestId = id;
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
          record.received = true;
          if (id === replayRequestId) await replayGate.promise;
          if (id === heldEditId) await editGate.promise;
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
    let renderedReply;
    const makeRuntime = () =>
      createVirRuntime({
        wasmBytes,
        irPackageSet: [packageBytes],
        defaultHostBindings: () => {
          const bindings = createBrowserHostBindings({
            reactHostBindings: createBrowserReactHostBindings,
            infoviewUseClientNotificationEffect: useClientNotificationEffect,
          });
          const get = bindings["js.object.get"];
          bindings["js.object.get"] = (object, key) => {
            if (key === "message" && object?.ref) renderedReply = object;
            return get(object, key);
          };
          return bindings;
        },
      });
    runtime = await makeRuntime();
    const typedMethod = "RpcBrowserServer.echoValue";
    const beforeInvalid = requests.length;
    const invalidEncoding = runtime.call("JsonValueCodec.call", b, typedMethod,
      "invalid encoding", {}, 9007199254740992n);
    check(invalidEncoding.kind === "error" && requests.length === beforeInvalid,
      "unsafe Lean request is rejected before any RPC dispatch");
    const typedRequest = (title, method = typedMethod, options = {}) => {
      const result = runtime.call("JsonValueCodec.call", b, method, title, options, 7);
      check(result.kind === "ok" && result.value instanceof Promise,
        "typed RPC returns a native Promise after checked request encoding");
      return result.value;
    };
    const typedResult = runtime.call("JsonValueCodec.resultSummary",
      await typedRequest("shared Foo"));
    check(typedResult.kind === "ok" && typedResult.value === "shared Foo replied:8:1",
      "shared Foo is encoded natively and decoded by the interpreted client");
    const malformedResult = runtime.call("JsonValueCodec.resultSummary",
      await typedRequest("typed malformed", "RpcBrowserServer.malformedValue"));
    check(malformedResult.kind === "error", "malformed Foo is a checked decoding error");
    for (const [title, fragment] of [["typed rejection", "typed example rejection"],
      ["typed overflow", "safe range"]]) {
      let rejection;
      try { await typedRequest(title); } catch (error) { rejection = error; }
      check(rejection?.message.includes(fragment),
        "native failure precedes emission of an invalid typed response");
    }
    const controller = new AbortController();
    const cancelledValue = typedRequest("typed cancellation", typedMethod,
      { abortSignal: controller.signal }).then(() => null, (error) => error);
    await until("typed request dispatched", () => requests.some(r => r.title === "typed cancellation"));
    controller.abort();
    check((await cancelledValue)?.code === -32800, "typed calls preserve native cancellation");
    const sampleWire = runtime.call("JsonValueCodec.sampleWire").value;
    for (const [title, params] of [
      ["typed bad shape", { title: "typed bad shape" }],
      ["typed fraction", { ...sampleWire, title: "typed fraction",
        primary: { ...sampleWire.primary, count: 1.5 } }],
      ["typed reference", { ...sampleWire, title: "typed reference", __rpcref: "7" }],
    ]) {
      let rejection;
      try { await b.call(typedMethod, params); } catch (error) { rejection = error; }
      check(rejection?.code === -32602, `${title}: native request decoding rejects invalid data`);
    }
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
          React.createElement(EditorContext.Provider, { value: editor },
            runtime.call("RpcReferenceWidget.render", component, {
              session, query: params, uri: config.uri,
            })),
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
    // Exercise the actual tutorial effect under official Strict Mode. Repeated
    // setups have identical query text but distinct request and response objects.
    React.act(() =>
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(EditorContext.Provider, { value: editor },
            runtime.call("RpcReferenceWidget.render", component, {
              session: a, query: query("strict replay"), uri: config.uri,
            })),
        ),
      ),
    );
    await React.act(async () => {
      await until("Strict Mode successor settled", () => {
        const replayed = requests.filter(
          (record) => record.message === "strict replay",
        );
        return (
          replayed.length === 2 && replayed[0].received && replayed[1].settled
        );
      });
    });
    const [abandoned, successor] = requests.filter(
      (record) => record.message === "strict replay",
    );
    check(
      abandoned.id !== successor.id &&
        abandoned.cancelled &&
        !abandoned.settled,
      "Strict Mode cleanup aborts its own outstanding request",
    );
    check(
      status() === "ready" && renderedReply === successor.value,
      "Strict Mode successor publishes its exact response",
    );
    check(subscriptions === 1 && notificationHandlers.size === 1,
      "Strict Mode retains one upstream notification subscription");
    React.act(() => document.getElementById("rpc-reference-view").click());
    await React.act(async () => {
      replayGate.resolve();
      await until(
        "abandoned Strict Mode outcome delivered",
        () => abandoned.settled,
      );
    });
    check(
      status() === "ready" &&
        renderedReply === successor.value &&
        text().includes("local 1"),
      "abandoned replay cannot publish a response or error over its successor",
    );
    React.act(() => root.render(null));
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
    const stableQuery = query("same-position edit");
    render(a, stableQuery);
    await settle("same-position edit");
    const beforeEdit = requests.length;
    const button = document.getElementById("rpc-reference-view");
    render(a, stableQuery);
    React.act(() => emit("textDocument/didChange", {
      textDocument: { uri: "file:///another.lean", version: 2 }, contentChanges: [],
    }));
    React.act(() => emit("textDocument/didSave", { textDocument: { uri: config.uri } }));
    await React.act(async () => { await sleep(20); });
    check(requests.length === beforeEdit,
      "unchanged rerender, other document and other method do not request");
    holdNextEdit = true;
    const changed = await post("/edit", {});
    React.act(() => emit("textDocument/didChange", changed));
    await React.act(async () => {
      await until("first edit's genuine response held", () =>
        requests.length === beforeEdit + 1 && requests.at(-1).received);
    });
    const firstEdit = requests.at(-1);
    const changedAgain = await post("/edit", {});
    React.act(() => emit("textDocument/didChange", changedAgain));
    await React.act(async () => {
      await until("same-position request settled", () =>
        requests.length === beforeEdit + 2 && requests.at(-1).settled);
    });
    const secondEdit = requests.at(-1);
    check(renderedReply === secondEdit.value && secondEdit.value?.message === "same-position edit" &&
      text().includes("local 1") && document.getElementById("rpc-reference-view") === button,
      "real edit refreshes the same position without resetting child state");
    await React.act(async () => {
      editGate.resolve();
      await until("obsolete edit delivered", () => firstEdit.settled);
    });
    check(firstEdit.cancelled && firstEdit.value !== secondEdit.value &&
      renderedReply === secondEdit.value && status() === "ready" &&
      document.getElementById("rpc-reference-view") === button && text().includes("local 1"),
      "late same-position edit cannot overwrite its successor");

    await gate("arm", "superseded");
    render(a, query("superseded"));
    await ready("superseded");
    check(
      status() === "loading" &&
        text().includes("previous response") &&
        text().includes("same-position edit / local 1"),
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
        text().includes("The request or response handler failed") &&
        text().includes("second / local 1"),
      "failure is visible without destroying last reply",
    );
    await gate("arm", "obsolete error");
    render(b, query("obsolete error", { fail: true }));
    await ready("obsolete error");
    render(b, query("recovered"));
    await settle("recovered");
    await release("obsolete error");
    check(request("obsolete error").error?.code === -32602 &&
      request("obsolete error").cancelled && status() === "ready" &&
      text().includes("recovered / local 1"),
      "genuine stale rejection cannot replace the current response or status");

    // Native Promise controls, not server-wire claims: rejection values need
    // not be Error objects or have a readable message property.
    for (const reason of [undefined, null, { get message() { throw new Error("unreadable"); } }]) {
      render({ call: () => Promise.reject(reason) }, query("arbitrary rejection"));
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      check(status() === "error" && text().includes("The request or response handler failed") &&
        text().includes("recovered / local 1"),
        "rejection display does not inspect an arbitrary error payload");
    }

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
    runtime = await makeRuntime();
    component = runtime.call("RpcReferenceWidget.View");
    render(a, query("replacement"));
    await settle("replacement");
    await release("old package");
    check(
      request("old package").value?.message === "old package",
      "unmounted generation's request actually succeeds",
    );
    check(
      text().includes("replacement / local 0") &&
        !text().includes("old package"),
      "unmounted generation's Lean stale guard prevents a late success",
    );
    old.dispose();
    check(old.liveCallbacks.size === 0, "explicit disposal releases old Lean roots");

    await gate("arm", "after unmount");
    render(a, query("after unmount"));
    await ready("after unmount");
    unmount();
    check(subscriptions === 0 && notificationHandlers.size === 0,
      "unmount removes the upstream subscription and callback");
    await release("after unmount");
    check(
      request("after unmount").value?.message === "after unmount" &&
        !text().includes("after unmount"),
      "late success after unmount is inert",
    );
    runtime.dispose();
    check(runtime.liveCallbacks.size === 0, "explicit disposal releases Lean closure roots");

    const failures = requests.filter(
      (record) =>
        record.error &&
        !(record.cancelled && record.error.code === -32800) &&
        !((record.title === "typed rejection" && record.error.message.includes("typed example rejection")) ||
          (record.title === "typed overflow" && record.error.message.includes("safe range"))) &&
        !(["typed bad shape", "typed fraction", "typed reference"].includes(record.title) && record.error.code === -32602) &&
        !(
          ["visible error", "obsolete error"].includes(record.message) &&
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
      strictReplayRequests: [abandoned.id, successor.id],
      samePositionEdits: 2,
      typedValueRequests: requests.filter(record => record.title !== undefined).length,
      requests: requests.length,
    };
  }, [
    ["replay response gate", () => replayGate.resolve()],
    ["edit response gate", () => editGate.resolve()],
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
