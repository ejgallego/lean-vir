/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { RpcSessions } from "@leanprover/infoview-api";
import { EditorConnection, EditorContext } from "@leanprover/infoview";
import VirInfoviewWidget from "../../web/app/vir-infoview-widget.js";
import { describeError, until, withCleanup } from "./rpc-test-support.js";

const prefix = "Vir.Fixtures.ShellLifetime.";
const states = [];
const check = (condition, label) => {
  if (!condition) throw new Error(label);
};
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (value.error) throw value.error;
  return value.result;
}

// Test observations only. Stale state, body entry, and the conditional mutation
// all execute in the unchanged interpreted ShellLifetime Lean fixture.
globalThis.__rpcShell = {
  session: null,
  observe(options) {
    const state = { label: `G${states.length + 1}`, events: [] };
    states.push(state);
    return {
      state,
      options: {
        ...options,
        defaultHostBindings: () =>
          Object.assign(options.defaultHostBindings(), {
            "test.shell.label": () => state.label,
            "test.shell.record": (event) => {
              state.events.push(event);
            },
            "test.shell.capture": (success, failure, schedule, payload) => {
              state.captured = { success, failure, schedule, payload };
            },
          }),
      },
    };
  },
  created(runtime, state) {
    state.runtime = runtime;
  },
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.rpcAcceptance = run().then(
  (value) => ({ ok: true, value }),
  (error) => ({ ok: false, error: describeError(error) }),
);

async function run() {
  const config = await (await fetch("/config")).json();
  const unexpected = [],
    calls = [],
    tasks = [],
    notifications = new Set();
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
  const onError = (event) => unexpected.push(event.error ?? event.message);
  const onUnhandled = (event) => unexpected.push(event.reason);
  globalThis.addEventListener("error", onError);
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  const notify = (path, body) => {
    const task = post(path, body).catch((error) => unexpected.push(error));
    notifications.add(task);
    void task.then(() => notifications.delete(task));
  };
  let nextId = 0,
    sessions,
    root;
  let packageReplyDelayMs = 0;
  let invalidRootCall;
  const container = document.getElementById("app");
  const tick = () =>
    React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  async function waitFor(label, predicate) {
    await until(label, async () => {
      await tick();
      return predicate();
    });
  }
  const gate = (action, message) => post("/gate", { action, message });
  const unmountUI = () => React.act(async () => root.render(null));

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
        const id = ++nextId,
          call = { id, params, startedAt: performance.now() };
        calls.push(call);
        const replyDelay = params.method === "Lean.Vir.Infoview.buildIRPackage"
          ? packageReplyDelayMs
          : 0;
        const signal = options?.abortSignal;
        const cancel = () => {
          call.cancelled = true;
          notify("/cancel", { id });
        };
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        try {
          call.value = await post("/call", { id, params });
          // Delay delivery of a genuine server reply, not package generation or
          // its contents. The official RpcSessions client still receives it.
          if (replyDelay > 0) {
            const started = performance.now();
            await new Promise((resolve) => setTimeout(resolve, replyDelay));
            call.replyDelayMs = performance.now() - started;
          }
          return call.value;
        } catch (error) {
          call.error = error;
          throw error;
        } finally {
          call.settled = true;
          call.settledAt = performance.now();
          signal?.removeEventListener("abort", cancel);
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
      "official position-specific sessions",
    );
    root = createRoot(container, {
      onUncaughtError: (error) => unexpected.push(error),
    });
    const roots = [prefix + "createComponent", prefix + "mount"];
    function renderWidget(session, position, entries = roots, {
      autoReloadMs = 0,
      setupHint = "",
      componentEntry = prefix + "createComponent",
      entry = prefix + "mount",
      editorConnection = editor,
    } = {}) {
      globalThis.__rpcShell.session = session;
      return React.act(async () =>
        root.render(
          React.createElement(EditorContext.Provider, { value: editorConnection }, React.createElement(VirInfoviewWidget, {
            wasmPath: "web/public/vir-upstream.wasm",
            irPackage: { roots: entries },
            componentEntry,
            entry,
            pos: { uri: config.uri, ...position },
            autoReloadMs,
            setupHint,
          })),
        ),
      );
    }
    async function mount(session, position, entries = roots, options = {}) {
      const count = states.length;
      await renderWidget(session, position, entries, options);
      await waitFor("real-server shell ready", () => {
        const error = container.querySelector(
          '[data-vir-infoview-state="error"]',
        );
        if (error) throw new Error(error.textContent);
        const ready = (
          states.length === count + 1 &&
          states.at(-1).events.includes(`setup:${states.at(-1).label}`) &&
          container.querySelector('[data-vir-infoview-state="ready"]')
        );
        if (!ready) options.checkLoading?.();
        return ready;
      });
      return states.at(-1);
    }
    async function begin(state, session, kind, suffix, held = true) {
      const message = `${state.label}:${kind}:${suffix}`;
      if (held) await gate("arm", message);
      const abort = new AbortController();
      const promise = session.call(
        "RpcBrowserServer.create",
        {
          message,
          fail: kind === "failure",
          waitForCancellation: false,
        },
        { abortSignal: abort.signal },
      );
      const task = { message, kind, state, abort, held };
      tasks.push(task);
      // Attach the exact Lean functions directly to the real native RPC Promise.
      // Only the chained outcome observer below is JavaScript-authored.
      task.done = promise
        .then(state.captured.success, state.captured.failure)
        .then(
          () => {
            task.completed = true;
          },
          (error) => {
            task.bridgeError = error;
            task.completed = true;
          },
        );
      if (held) {
        await until(`actual server outcome held: ${message}`, () =>
          gate("status", message),
        );
        check(
          !task.completed,
          "Lean continuation is still pending behind actual server outcome gate",
        );
      }
      return task;
    }
    const serverCall = (task) =>
      calls.find((call) => call.params.params?.message === task.message);
    async function release(task, stale, hard = false) {
      const before = task.state.events.length;
      await React.act(async () => {
        if (task.held) await gate("open", task.message);
        await task.done;
      });
      const call = serverCall(task);
      check(call?.settled, "real transport outcome observed");
      if (task.kind === "success") {
        check(
          call.value?.message === task.message && call.value.ref,
          "genuine WithRpcRef reply",
        );
      } else {
        check(
          call.error?.code === -32602 &&
            /RPC example rejection/.test(call.error.message),
          "genuine server rejection preserved",
        );
      }
      if (hard) {
        check(
          /disposed runtime/.test(task.bridgeError?.message),
          "hard disposal rejects before Lean entry",
        );
        check(
          task.state.events.length === before,
          "no Lean body entry after hard disposal",
        );
      } else {
        check(
          !task.bridgeError,
          JSON.stringify(describeError(task.bridgeError)),
        );
        const expected = [
          `body:${task.kind}:${task.state.label}`,
          `${stale ? "stale" : "mutation"}:${task.kind}:${task.state.label}`,
        ];
        // Ungated controls may settle before this function; still require one
        // exact body/branch pair for each kind in that generation.
        check(
          expected.every(
            (event) =>
              task.state.events.filter((value) => value === event).length === 1,
          ),
          `original Lean body and branch: ${expected.join(", ")}`,
        );
        if (task.held)
          check(
            JSON.stringify(task.state.events.slice(before)) ===
              JSON.stringify(expected),
            "held outcome enters exactly one body/branch pair after release",
          );
        if (stale)
          check(
            !task.state.events.some((event) => event.startsWith("mutation:")),
            "stale generation never takes the mutation branch",
          );
      }
    }
    async function pendingPair(state, session, suffix) {
      return [
        await begin(state, session, "success", suffix),
        await begin(state, session, "failure", suffix),
      ];
    }

    const first = await mount(a, config.a);
    const unmounted = await pendingPair(first, a, "unmount");
    await unmountUI();
    check(
      !first.runtime.disposed && first.events.includes("cleanup:G1"),
      "UI cleanup preserves runtime",
    );
    for (const task of unmounted) {
      task.abort.abort();
      await release(task, true);
    }
    const reply = serverCall(unmounted[0]).value;
    check(
      (await a.call("RpcBrowserServer.read", { ref: reply.ref })) ===
        unmounted[0].message,
      "exact server reference remains usable after original UI cleanup",
    );

    const previous = await mount(a, config.a);
    const refreshed = await pendingPair(
      previous,
      a,
      "configuration-replacement",
    );
    const current = await mount(b, config.b, [...roots].reverse());
    check(
      previous.runtime !== current.runtime &&
        !previous.runtime.disposed &&
        previous.events.includes("cleanup:G2"),
      "configuration replacement keeps distinct original generation",
    );
    for (const task of refreshed) {
      task.abort.abort();
      await release(task, true);
    }
    for (const kind of ["success", "failure"]) {
      const task = await begin(current, b, kind, "live", false);
      await release(task, false);
    }

    const stopped = await pendingPair(current, b, "hard-dispose");
    await unmountUI();
    check(
      !current.runtime.disposed && current.events.includes("cleanup:G3"),
      "normal cleanup before explicit shutdown",
    );
    current.runtime.dispose();
    check(
      current.runtime.liveCallbacks.size === 0,
      "hard disposal releases Lean closure roots",
    );
    for (const task of stopped) await release(task, true, true);
    check(states.length === 3, "three exact shell generations");
    check(
      calls.filter(
        (call) => call.params.method === "Lean.Vir.Infoview.buildIRPackage",
      ).length === 3,
      "all three packages came from actual server snapshots",
    );
    check(
      calls.some(
        (call) => call.params.method === "Lean.Vir.Infoview.readAsset",
      ),
      "actual server supplies Wasm asset",
    );

    const packages = await Promise.all(
      calls
        .filter(
          (call) => call.params.method === "Lean.Vir.Infoview.buildIRPackage",
        )
        .map(async (call) => {
          const bytes = Uint8Array.from(atob(call.value.dataBase64), (char) =>
            char.charCodeAt(0),
          );
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          return {
            revision: call.value.revision,
            byteSize: bytes.length,
            sha256: [...new Uint8Array(digest)]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          };
        }),
    );
    const lifetimeStates = states.slice();

    // A server-side package-root failure must survive the shell's presentation
    // boundary, including its original text/code and the configured setup hint.
    const invalidRoot = "Vir.Fixtures.ShellLifetime.MissingStartupRoot";
    const setupHint = "Build the widget module and check its export roots.";
    await renderWidget(a, config.a, [invalidRoot], { setupHint });
    await waitFor("invalid package root error UI", () =>
      container.querySelector('[data-vir-infoview-state="error"]'),
    );
    invalidRootCall = calls.find((call) =>
      call.params.method === "Lean.Vir.Infoview.buildIRPackage" &&
      call.params.params?.package?.roots?.includes(invalidRoot),
    );
    const errorText = container.querySelector(".vir-infoview-widget-status").textContent;
    check(invalidRootCall?.error?.code === -32602, "real invalid-root RPC code");
    check(
      invalidRootCall.error.message.includes(invalidRoot) &&
        errorText.includes(invalidRootCall.error.message) &&
        errorText.includes("(-32602)"),
      `original package error message and code rendered: ${errorText}`,
    );
    check(errorText.includes(setupHint), "setup hint remains visible");
    check(!errorText.includes("[object Object]"), "plain RPC error is readable");
    check(states.length === 3, "invalid package root installs no runtime");
    await unmountUI();

    const startup = [];
    for (const autoReloadMs of [0, 1000]) {
      const firstCall = calls.length;
      const phaseCalls = (method) => calls.slice(firstCall).filter((call) =>
        call.params.method === `Lean.Vir.Infoview.${method}`,
      );
      // Leave margin for browser timer resolution while requiring >= 2.2s.
      packageReplyDelayMs = 2250;
      const state = await mount(a, config.a, roots, {
        autoReloadMs,
        checkLoading() {
          check(
            phaseCalls("statIRPackage").length <= 1,
            "initial package polling must not supersede the pending installation",
          );
        },
      });
      packageReplyDelayMs = 0;
      const packageCall = phaseCalls("buildIRPackage")[0];
      check(packageCall?.replyDelayMs >= 2200, "genuine package reply delayed at least 2.2s");
      check(phaseCalls("buildIRPackage").length === 1, "one initial package build");
      check(
        phaseCalls("statIRPackage").filter((call) =>
          call.startedAt < packageCall.settledAt,
        ).length === 1,
        "only initial acquisition stats the package before reply delivery",
      );
      if (autoReloadMs > 0) {
        await waitFor("polling resumes after installation", () =>
          phaseCalls("statIRPackage").some((call) =>
            call.settled && call.startedAt > packageCall.settledAt,
          ),
        );
      } else {
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        });
        check(phaseCalls("statIRPackage").length === 1, "disabled polling stays off");
      }
      check(states.at(-1) === state, "unchanged revision does not replace the runtime");
      check(phaseCalls("buildIRPackage").length === 1, "polling does not rebuild an unchanged package");
      startup.push({
        autoReloadMs,
        replyDelayMs: packageCall.replyDelayMs,
        packageRevision: packageCall.value.revision,
        builds: phaseCalls("buildIRPackage").length,
        stats: phaseCalls("statIRPackage").length,
        resumedAfterInstall: phaseCalls("statIRPackage").some((call) =>
          call.settled && call.startedAt > packageCall.settledAt,
        ),
      });
      await unmountUI();
      check(
        !state.runtime.disposed && state.events.includes(`cleanup:${state.label}`),
        "startup control preserves normal UI cleanup policy",
      );
    }
    // An initial result abandoned by the UI must still take the hard teardown
    // path; the polling fix must not turn it into an installed generation.
    const beforeAbandon = states.length;
    const abandonedCallStart = calls.length;
    packageReplyDelayMs = 2250;
    await renderWidget(a, config.a, roots, { autoReloadMs: 1000 });
    let abandonedCall;
    await waitFor("obsolete initial package reply held", () => {
      abandonedCall = calls.slice(abandonedCallStart).find((call) =>
        call.params.method === "Lean.Vir.Infoview.buildIRPackage",
      );
      return abandonedCall?.value && !abandonedCall.settled;
    });
    await unmountUI();
    await waitFor("obsolete initial candidate disposed", () =>
      states.length === beforeAbandon + 1 && states.at(-1).runtime?.disposed,
    );
    check(abandonedCall.replyDelayMs >= 2200, "obsolete reply was genuinely delayed");
    check(states.at(-1).events.length === 0, "obsolete candidate never enters Lean setup");
    check(!container.querySelector("[data-vir-infoview-state]"), "obsolete result cannot reinstall UI");
    const obsoleteState = states.at(-1);

    // Exercise the actual shell context bridge with the all-Lean tutorial, not
    // only a manually provided context around an independent browser root.
    packageReplyDelayMs = 0;
    const tutorialEntries = ["RpcReferenceWidget.createComponent", "RpcReferenceWidget.mount"];
    const tutorialOptions = { componentEntry: tutorialEntries[0], entry: tutorialEntries[1] };
    await renderWidget(a, config.a, tutorialEntries, tutorialOptions);
    await waitFor("all-Lean tutorial ready in actual shell", () => {
      const error = container.querySelector('[data-vir-infoview-state="error"]');
      if (error) throw new Error(error.textContent);
      return container.querySelector('[data-rpc-status="ready"]');
    });
    const tutorialState = states.at(-1);
    const tutorialCalls = () => calls.filter((call) =>
      call.params.method === "RpcBrowserServer.create" &&
      call.params.params?.message === "Hello from Lean");
    const tutorialFirst = tutorialCalls().length;
    const button = container.querySelector("#rpc-reference-view");
    React.act(() => button.click());
    check(subscriptions === 1 && notificationHandlers.size === 1,
      "actual shell forwards upstream EditorContext into the Lean root");
    await renderWidget(a, config.a, tutorialEntries, tutorialOptions);
    await tick();
    check(tutorialCalls().length === tutorialFirst, "unchanged shell render does not request");
    const replacementHandlers = new Set();
    let replacementSubscriptions = 0;
    const replacementEditor = new EditorConnection({
      async subscribeClientNotifications() { replacementSubscriptions++; },
      async unsubscribeClientNotifications() { replacementSubscriptions--; },
    }, {
      sentClientNotification: {
        on(handler) {
          replacementHandlers.add(handler);
          return { dispose() { replacementHandlers.delete(handler); } };
        },
      },
    });
    await renderWidget(a, config.a, tutorialEntries,
      { ...tutorialOptions, editorConnection: replacementEditor });
    check(subscriptions === 0 && notificationHandlers.size === 0 &&
      replacementSubscriptions === 1 && replacementHandlers.size === 1,
      "editor replacement moves the native subscription to the current connection");
    check(tutorialCalls().length === tutorialFirst,
      "editor replacement alone does not restart RPC");
    const change = await post("/edit", {});
    React.act(() => {
      for (const handler of [...notificationHandlers])
        handler(["textDocument/didChange", change]);
    });
    await tick();
    check(tutorialCalls().length === tutorialFirst, "old editor notifications are inert");
    await React.act(async () => {
      for (const handler of [...replacementHandlers])
        handler(["textDocument/didChange", change]);
    });
    await waitFor("actual shell same-position edit response", () =>
      tutorialCalls().length === tutorialFirst + 1 && tutorialCalls().at(-1).settled &&
      container.querySelector('[data-rpc-status="ready"]'));
    check(tutorialCalls().at(-1).params.position.line === config.a.line &&
      tutorialCalls().at(-1).params.position.character === config.a.character,
      "edit refresh uses the same official RPC position");
    check(states.at(-1) === tutorialState &&
      container.querySelector("#rpc-reference-view") === button && button.textContent.includes("local 1"),
      "edit refresh preserves runtime, native component, DOM and Lean hook state");
    await unmountUI();
    check(subscriptions === 0 && notificationHandlers.size === 0 &&
      replacementSubscriptions === 0 && replacementHandlers.size === 0 &&
      !tutorialState.runtime.disposed,
      "shell UI cleanup unsubscribes without hard runtime disposal");

    return {
      generations: lifetimeStates.map((state) => ({
        label: state.label,
        events: state.events,
      })),
      outcomes: tasks.map((task) => ({
        message: task.message,
        rpcCode: serverCall(task).error?.code,
        cancelled: !!serverCall(task).cancelled,
        bridgeError: task.bridgeError?.message ?? null,
      })),
      packages,
      invalidPackage: { error: invalidRootCall.error, rendered: errorText },
      startup,
      obsoleteInitial: {
        replyDelayMs: abandonedCall.replyDelayMs,
        disposed: obsoleteState.runtime.disposed,
        events: obsoleteState.events,
      },
      allLeanEditRefresh: { requests: tutorialCalls().length, subscriptionsAfterUnmount: subscriptions },
    };
  }, [
    [
      "held outcomes",
      async () => {
        for (const task of tasks)
          if (task.held) await gate("open", task.message);
      },
    ],
    [
      "React root",
      async () => {
        if (root) await React.act(async () => root.unmount());
      },
    ],
    [
      "continuations",
      async () => {
        await Promise.all(tasks.map((task) => task.done));
      },
    ],
    [
      "runtimes",
      () =>
        withCleanup(
          async () => {},
          states.map((state) => [state.label, () => state.runtime?.dispose()]),
        ),
    ],
    ["RPC sessions", () => sessions?.dispose()],
    [
      "notifications",
      async () => {
        await Promise.resolve();
        while (notifications.size) await Promise.all(notifications);
      },
    ],
    [
      "browser errors",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        globalThis.removeEventListener("error", onError);
        globalThis.removeEventListener("unhandledrejection", onUnhandled);
        check(
          unexpected.length === 0,
          JSON.stringify(unexpected.map(describeError)),
        );
        const deliberateFailures = new Set(
          tasks
            .filter((task) => task.kind === "failure")
            .map((task) => task.message),
        );
        const failures = calls.filter(
          (call) =>
            call.error &&
            call !== invalidRootCall &&
            !(
              call.params.method === "RpcBrowserServer.create" &&
              deliberateFailures.has(call.params.params?.message) &&
              call.error.code === -32602
            ),
        );
        check(
          failures.length === 0,
          `unexpected RPC failures: ${JSON.stringify(failures)}`,
        );
      },
    ],
  ]);
}
