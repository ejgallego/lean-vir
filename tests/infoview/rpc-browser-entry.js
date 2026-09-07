/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { RpcSessions } from "@leanprover/infoview-api";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";

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
async function until(predicate) {
  for (let i = 0; i < 2000; i++) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(
    `RPC browser condition timed out: ${JSON.stringify(globalThis.rpcObservations)}`,
  );
}

globalThis.rpcAcceptance = run().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: { message: error.message, stack: error.stack },
  }),
);

async function run() {
  const config = await (await fetch("/config")).json();
  let nextId = 0;
  let cancellations = 0;
  const sessions = new RpcSessions({
    async createRpcSession() {
      return (await post("/connect", {})).sessionId;
    },
    closeRpcSession(sessionId) {
      void post("/close", { sessionId });
    },
    release(params) {
      void post("/release", params);
    },
    async call(params, options) {
      const id = ++nextId;
      const promise = post("/call", { id, params });
      // ClientRequestOptions cancels LSP work, not the transport Promise.
      const cancel = () => {
        cancellations++;
        void post("/cancel", { id });
      };
      options?.abortSignal?.addEventListener("abort", cancel, { once: true });
      if (options?.abortSignal?.aborted) cancel();
      try {
        return await promise;
      } finally {
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
  let runtime = await makeRuntime();
  let component = runtime.call("RpcReferenceWidget.View");
  const root = createRoot(document.getElementById("app"));
  let rootUnmounted = false;
  const unmount = () => {
    if (!rootUnmounted) {
      flushSync(() => root.unmount());
      rootUnmounted = true;
    }
  };
  const observations = {
    effects: 0,
    cleanups: 0,
    commits: [],
    errors: [],
    settled: 0,
  };
  globalThis.rpcObservations = observations;
  let currentReply;

  // Ordinary application effect: sessions, AbortController and React own the
  // asynchronous work. No pending Promise ever captures a Lean callback.
  function App({ session, query, activeRuntime, view }) {
    const [reply, setReply] = React.useState({ message: "loading" });
    React.useEffect(() => {
      observations.effects++;
      const abort = new AbortController();
      let active = true;
      const promise = activeRuntime.call(
        "RpcReferenceWidget.request",
        session,
        "RpcBrowserServer.create",
        query,
        { abortSignal: abort.signal },
      );
      promise
        .then(
          (value) => {
            if (active) {
              currentReply = value;
              observations.commits.push(value.message);
              setReply(value);
            }
          },
          (error) => {
            if (active) observations.errors.push(error);
          },
        )
        .finally(() => {
          observations.settled++;
        });
      return () => {
        active = false;
        observations.cleanups++;
        abort.abort();
      };
    }, [session, query, activeRuntime]);
    return activeRuntime.call("RpcReferenceWidget.render", view, reply);
  }
  const render = (session, query) =>
    flushSync(() =>
      root.render(
        React.createElement(App, {
          session,
          query: { delayMs: 0, fail: false, ...query },
          activeRuntime: runtime,
          view: component,
        }),
      ),
    );
  try {
    render(a, { message: "first" });
    await until(() => document.body.textContent.includes("first / local 0"));
    check(
      runtime.call("RpcReferenceWidget.reference", currentReply) ===
        currentReply.ref,
      "nested RPC reference identity",
    );
    check(
      (await runtime.call(
        "RpcReferenceWidget.readReference",
        a,
        currentReply,
      )) === "first",
      "real server WithRpcRef round trip through Lean",
    );
    flushSync(() => document.getElementById("rpc-reference-view").click());
    check(
      document.body.textContent.includes("local 1"),
      "Lean hook state update",
    );
    render(a, { message: "superseded", delayMs: 600 });
    await sleep(80);
    render(b, { message: "second" });
    await until(() => document.body.textContent.includes("second / local 1"));
    await until(() => observations.settled >= 3);
    check(
      !observations.commits.includes("superseded"),
      "superseded response must not replace the current position",
    );

    const abort = new AbortController();
    const cancelled = runtime
      .call(
        "RpcReferenceWidget.request",
        b,
        "RpcBrowserServer.create",
        { message: "cancel", delayMs: 1000, fail: false },
        { abortSignal: abort.signal },
      )
      .then(
        () => null,
        (error) => error,
      );
    await sleep(80);
    abort.abort();
    check(
      (await cancelled)?.code === -32800,
      "native request options reach Lean cancellation token",
    );
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const preCancelled = await runtime
      .call(
        "RpcReferenceWidget.request",
        b,
        "RpcBrowserServer.create",
        { message: "already cancelled", delayMs: 1000, fail: false },
        { abortSignal: alreadyAborted.signal },
      )
      .then(
        () => null,
        (error) => error,
      );
    check(
      preCancelled?.code === -32800,
      "an already-aborted signal must cancel even before bridge registration",
    );
    const rejection = await runtime
      .call(
        "RpcReferenceWidget.request",
        b,
        "RpcBrowserServer.create",
        { message: "error", delayMs: 0, fail: true },
        {},
      )
      .then(
        () => null,
        (error) => error,
      );
    check(
      rejection?.message.includes("RPC example rejection"),
      "server rejection remains a Promise rejection",
    );

    // Existing expression reference consumer, using the same official session.
    const saved = await b.call(
      "Lean.Vir.Infoview.createProofWidgetsExprWithCtxAtPos",
      { pos: config.b, packageRevision: "rpc-browser" },
    );
    check(saved?.ref !== undefined, "real goal produces a WithRpcRef");
    const info = await b.call(
      "Lean.Vir.Infoview.resolveProofWidgetsExprWithCtxRef",
      { ref: saved.ref, pos: config.b, packageRevision: "rpc-browser" },
    );
    check(
      info.expression.includes("p") && info.context.includes("h"),
      "existing goal reference resolves in real context",
    );

    render(b, { message: "old package", delayMs: 500 });
    await sleep(80);
    const old = runtime;
    // React cleanup precedes package disposal, as it must in an ordinary host.
    flushSync(() => root.render(null));
    old.dispose();
    check(
      old.liveCallbacks.size === 0,
      "replacement releases every old Lean closure root",
    );
    runtime = await makeRuntime();
    component = runtime.call("RpcReferenceWidget.View");
    render(a, { message: "replacement" });
    await until(() =>
      document.body.textContent.includes("replacement / local 0"),
    );
    await until(() => observations.settled >= 5);
    check(
      !observations.commits.includes("old package"),
      "disposed generation cannot publish a stale reply",
    );
    render(a, { message: "after unmount", delayMs: 500 });
    await sleep(80);
    unmount();
    runtime.dispose();
    check(
      runtime.liveCallbacks.size === 0,
      "unmount/disposal releases every Lean closure root",
    );
    await until(() => observations.settled >= 6);
    check(
      observations.errors.length === 0,
      "no disposed Lean callback or spurious cancellation error",
    );
    check(
      observations.cleanups === observations.effects,
      "every application effect is cleaned up",
    );
    return {
      commits: observations.commits,
      cancellations,
      realReference: info.expression,
      effects: observations.effects,
    };
  } finally {
    try {
      unmount();
    } finally {
      runtime.dispose();
      sessions.dispose();
    }
  }
}
