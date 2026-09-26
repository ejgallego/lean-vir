/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { RpcSessions, Widget_getWidgets } from "@leanprover/infoview-api";
import { EditorConnection, EditorContext } from "@leanprover/infoview";
import VirInfoviewWidget from "../../web/app/vir-infoview-widget.js";
import { describeError, until, withCleanup } from "./rpc-test-support.js";

const prefix = "Vir.Fixtures.ShellLifetime.";
const states = [];
const inheritedContext = React.createContext(null);
const inheritedContextValue = { source: "outer infoview tree" };
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
// all execute in the interpreted ShellLifetime Lean fixture.
globalThis.__rpcShell = {
  session: null,
  observe(options) {
    const state = { label: `G${states.length + 1}`, events: [], contexts: [] };
    states.push(state);
    return {
      state,
      options: {
        ...options,
        defaultHostBindings: () =>
          Object.assign(options.defaultHostBindings(), {
            "test.shell.label": () => state.label,
            "test.shell.context": () => {
              state.contexts.push(React.useContext(inheritedContext));
            },
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
  const consoleDiagnostics = [];
  const originalConsole = { error: console.error, warn: console.warn };
  for (const level of ["error", "warn"]) {
    console[level] = (...args) => {
      consoleDiagnostics.push(args.map((arg) =>
        typeof arg === "object" ? JSON.stringify(describeError(arg)) : String(arg)).join(" "));
      originalConsole[level].apply(console, args);
    };
  }
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
  let failNextPackageTransport = null;
  let invalidEntryCall;
  const expectedLivePackageFailures = new Set();
  const container = document.getElementById("app");
  const tick = () =>
    React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  async function waitFor(label, predicate) {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
      await tick();
      if (predicate()) return;
    }
    throw new Error(`timed out: ${label}`);
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
          if (failNextPackageTransport !== null &&
              params.method === "Lean.Vir.Infoview.buildIRPackage") {
            const error = new Error(failNextPackageTransport);
            error.code = -32603;
            failNextPackageTransport = null;
            throw error;
          }
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
    const baseDescriptor = await generatedProps(a, config.a, "Vir.Fixtures.RegisteredLifetime.createComponent");
    const entry = baseDescriptor.irPackage.entry;
    function renderWidget(session, position, entryName = entry, {
      setupHint = "",
      editorConnection = editor,
      irPackage = { ...baseDescriptor.irPackage, entry: entryName },
    } = {}) {
      globalThis.__rpcShell.session = session;
      return React.act(async () =>
        root.render(
          React.createElement(inheritedContext.Provider, { value: inheritedContextValue },
          React.createElement(EditorContext.Provider, { value: editorConnection }, React.createElement(VirInfoviewWidget, {
            wasmPath: "web/public/vir-upstream.wasm",
            irPackage,
            pos: { uri: config.uri, ...position },
            setupHint,
          }))),
        ),
      );
    }
    async function mount(session, position, entryName = entry, options = {}) {
      const count = states.length;
      await renderWidget(session, position, entryName, options);
      await waitFor("real-server shell ready", () => {
        if (unexpected.length !== 0) throw unexpected[0];
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
    const liveText = () =>
      container.querySelector("#rpc-live-edit")?.textContent ?? null;
    async function waitForLiveText(label, text) {
      await waitFor(label, () =>
        container.querySelector('[data-vir-infoview-state="ready"]') &&
        liveText() === text,
      );
    }
    async function editText(before, after) {
      await React.act(async () => {
        const change = await post("/edit", { replace: { before, after } });
        for (const handler of [...notificationHandlers])
          handler(["textDocument/didChange", change]);
      });
    }
    async function generatedProps(session, position, entry) {
      const result = await Widget_getWidgets(session, position);
      const props = result.widgets.find((widget) => widget.props.irPackage.entry === entry)?.props;
      check(typeof props?.irPackage.fingerprint === "string", `generated fingerprint for ${entry}: ${JSON.stringify(result)}`);
      return props;
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
    check(first.contexts.length > 0 && first.contexts.every((value) => value === inheritedContextValue),
      "Lean render inherits an arbitrary outer context without a shell bridge");
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
    const alternate = await generatedProps(b, config.b, "Vir.Fixtures.AlternateLifetime.createComponent");
    const current = await mount(b, config.b, alternate.irPackage.entry, alternate);
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
            fingerprint: call.value.fingerprint,
            byteSize: bytes.length,
            sha256: [...new Uint8Array(digest)]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          };
        }),
    );
    const lifetimeStates = states.slice();

    // A server-side package-entry failure must survive the shell's presentation
    // boundary, including its original text/code and the configured setup hint.
    const invalidEntry = "Vir.Fixtures.ShellLifetime.MissingStartupRoot";
    const setupHint = "Build the widget module and check its factory entry.";
    await renderWidget(a, config.a, invalidEntry, { setupHint });
    await waitFor("invalid package entry error UI", () =>
      container.querySelector('[data-vir-infoview-state="error"]'),
    );
    invalidEntryCall = calls.find((call) =>
      call.params.method === "Lean.Vir.Infoview.buildIRPackage" &&
      call.params.params?.package?.entry === invalidEntry,
    );
    const errorText = container.querySelector(".vir-infoview-widget-status").textContent;
    check(invalidEntryCall?.error?.code === -32602, "real invalid-entry RPC code");
    check(
      invalidEntryCall.error.message.includes("fingerprint is unavailable") &&
        errorText.includes(invalidEntryCall.error.message) &&
        errorText.includes("(-32602)"),
      `original package error message and code rendered: ${errorText}`,
    );
    check(errorText.includes(setupHint), "setup hint remains visible");
    check(!errorText.includes("[object Object]"), "plain RPC error is readable");
    check(states.length === 3, "invalid package entry installs no runtime");
    await unmountUI();

    let missingIdentityError;
    try {
      await a.call("Lean.Vir.Infoview.buildIRPackage", {
        package: { entry }, pos: config.a,
      });
    } catch (error) {
      missingIdentityError = error;
      expectedLivePackageFailures.add(calls.at(-1));
    }
    check(missingIdentityError?.code === -32602,
      "server rejects a request without a fingerprint instead of building current-snapshot code");

    const startup = [];
    {
      const firstCall = calls.length;
      const phaseCalls = (method) => calls.slice(firstCall).filter((call) =>
        call.params.method === `Lean.Vir.Infoview.${method}`,
      );
      packageReplyDelayMs = 2250;
      const state = await mount(a, config.a, entry);
      packageReplyDelayMs = 0;
      const packageCall = phaseCalls("buildIRPackage")[0];
      check(packageCall?.replyDelayMs >= 2200, "genuine package reply delayed at least 2.2s");
      await renderWidget(a, config.a, entry);
      await tick();
      check(phaseCalls("statIRPackage").length === 0, "shell never polls package revisions");
      check(phaseCalls("buildIRPackage").length === 1, "stable props request one package");
      check(states.at(-1) === state, "stable props preserve the runtime");
      startup.push({ replyDelayMs: packageCall.replyDelayMs,
        builds: phaseCalls("buildIRPackage").length, stats: phaseCalls("statIRPackage").length });
      await unmountUI();
      check(!state.runtime.disposed && state.events.includes(`cleanup:${state.label}`),
        "startup control preserves normal UI cleanup policy");
    }
    // A result abandoned by the UI is never published and must be disposed.
    const beforeAbandon = states.length;
    const abandonedCallStart = calls.length;
    packageReplyDelayMs = 2250;
    await renderWidget(a, config.a, entry);
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

    // Exercise inherited upstream context with the all-Lean tutorial in the
    // actual shell, not a second root with a manually forwarded provider.
    packageReplyDelayMs = 0;
    const tutorialEntry = "RpcReferenceWidget.createComponent";
    const tutorialOptions = await generatedProps(a, config.a, tutorialEntry);
    await renderWidget(a, config.a, tutorialEntry, tutorialOptions);
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
      "Lean component inherits upstream EditorContext through the shell");
    await renderWidget(a, config.a, tutorialEntry, tutorialOptions);
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
    await renderWidget(a, config.a, tutorialEntry,
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

    // Actual unsaved edits acquire the descriptions published by widget elaboration.
    const generatedEntry = "Vir.Fixtures.RpcShellLifetime.createComponent";
    let descriptor = await generatedProps(a, config.a, generatedEntry);
    await renderWidget(a, config.a, descriptor.irPackage.entry, descriptor);
    await waitForLiveText("initial editable implementation", "implementation-v1");
    const liveInitial = states.at(-1);
    async function editGenerated(before, after) {
      await editText(before, after);
      descriptor = await generatedProps(a, config.a, generatedEntry);
      await renderWidget(a, config.a, descriptor.irPackage.entry, descriptor);
    }
    await editGenerated('"implementation-v1"', '"implementation-v2"');
    await waitForLiveText("first unsaved implementation edit", "implementation-v2");
    check(states.at(-1) !== liveInitial, "an implementation edit installs a fresh generation");

    // Hold the older build response, publish a newer generation, then release it.
    packageReplyDelayMs = 2250;
    const heldBuildStart = calls.length;
    await editGenerated('"implementation-v2"', '"implementation-v3"');
    await waitFor("held implementation package reply", () =>
      calls.slice(heldBuildStart).some((call) =>
        call.params.method === "Lean.Vir.Infoview.buildIRPackage" &&
        call.value && !call.settled));
    packageReplyDelayMs = 0;
    await editGenerated('"implementation-v3"', '"implementation-v4"');
    await waitForLiveText("latest rapid implementation edit", "implementation-v4");
    const heldBuild = calls.slice(heldBuildStart).find((call) =>
      call.params.method === "Lean.Vir.Infoview.buildIRPackage");
    await waitFor("older implementation reply settles", () => heldBuild?.settled);
    check(heldBuild?.replyDelayMs >= 2200, "the older implementation reply was held");
    check(liveText() === "implementation-v4", "rapid edits converge to the latest valid implementation");
    check(states.at(-1).runtime.disposed, "late obsolete candidate is disposed");
    await editGenerated('"implementation-v4"', '"implementation-v5"');
    await waitForLiveText("next implementation edit", "implementation-v5");

    const beforePosition = states.at(-1);
    const positionStart = calls.length;
    await renderWidget(a, config.b, descriptor.irPackage.entry, descriptor);
    await tick();
    check(states.at(-1) === beforePosition && calls.length === positionStart,
      "position changes do not acquire package code");
    const reconnectNode = container.querySelector("#rpc-live-edit");
    sessions.closeSessionForFile(config.uri);
    const reconnected = sessionAt(config.a);
    check(reconnected !== a, "reconnect supplies a distinct official session");
    const reconnectStart = calls.length;
    await renderWidget(reconnected, config.a, descriptor.irPackage.entry, descriptor);
    await tick();
    check(states.at(-1) === beforePosition && container.querySelector("#rpc-live-edit") === reconnectNode &&
      calls.length === reconnectStart,
      "session replacement preserves the runtime without a package request");
    const generatedState = states.at(-1);
    const generatedNode = container.querySelector("#rpc-live-edit");
    const generationCount = states.length;
    const packageCalls = () => calls.filter((call) =>
      ["Lean.Vir.Infoview.buildIRPackage", "Lean.Vir.Infoview.statIRPackage", "Lean.Vir.Infoview.statAsset", "Lean.Vir.Infoview.readAsset"].includes(call.params.method));
    const beforeProofEdits = packageCalls().length;
    for (let i = 0; i < 3; i++) {
      await editText(i === 0 ? "  exact h" : `  exact (h) -- edit ${i - 1}`, `  exact (h) -- edit ${i}`);
      const next = await generatedProps(reconnected, config.b, generatedEntry);
      check(next.irPackage.fingerprint === descriptor.irPackage.fingerprint,
        "proof edits preserve the elaborated code fingerprint");
      await renderWidget(sessionAt(config.b), config.b, next.irPackage.entry, next);
    }
    await tick();
    const proofEditPackageRequests = packageCalls().length - beforeProofEdits;
    check(packageCalls().length === beforeProofEdits && states.length === generationCount &&
      container.querySelector("#rpc-live-edit") === generatedNode,
      "real proof edits, new props and cursor sessions cause zero package or asset requests");
    await editText('"implementation-v5"', '"implementation-v6"');
    const changedDescriptor = await generatedProps(reconnected, config.a, generatedEntry);
    check(changedDescriptor.irPackage.fingerprint !== descriptor.irPackage.fingerprint,
      "transitive helper edit changes the elaborated fingerprint");
    let staleFingerprintError;
    try {
      await reconnected.call("Lean.Vir.Infoview.buildIRPackage", {
        package: descriptor.irPackage, pos: config.a,
      });
    } catch (error) {
      staleFingerprintError = error;
      expectedLivePackageFailures.add(calls.at(-1));
    }
    check(staleFingerprintError?.code === -32602 &&
      staleFingerprintError.message.includes("fingerprint is unavailable"),
      "stale descriptor is rejected instead of packaging different code");
    await renderWidget(reconnected, config.a, changedDescriptor.irPackage.entry, changedDescriptor);
    await waitForLiveText("generated fingerprint publishes changed helper code", "implementation-v6");
    check(states.at(-1) !== generatedState, "generated widget helper edit replaces the runtime");
    descriptor = changedDescriptor;
    const beforeWhitespace = packageCalls().length;
    await editText(':= "implementation-v6"', ':=  "implementation-v6"');
    const whitespaceDescriptor = await generatedProps(reconnected, config.a, generatedEntry);
    check(whitespaceDescriptor.irPackage.fingerprint === descriptor.irPackage.fingerprint,
      "declaration re-elaboration with identical inputs preserves fingerprint");
    await renderWidget(reconnected, config.a, whitespaceDescriptor.irPackage.entry, whitespaceDescriptor);
    await tick();
    const whitespacePackageRequests = packageCalls().length - beforeWhitespace;
    check(whitespacePackageRequests === 0, "equivalent source requests no package bytes");
    const generatedLiveState = states.at(-1);

    // An invalid generated helper is removed from Widget_getWidgets. Repairing
    // the same source restores its original fingerprint and descriptor; the
    // next implementation edit then reappears through the generated fingerprint
    // from its restored description.
    const generatedContinuation = await begin(
      generatedLiveState,
      reconnected,
      "success",
      "generated-invalid",
    );
    await editText(
      '"implementation-v6"',
      '"implementation-v6" ++ missingGeneratedImplementation',
    );
    const invalidGenerated = await Widget_getWidgets(reconnected, config.a);
    check(
      !invalidGenerated.widgets.some((widget) =>
        widget.props?.irPackage?.entry === generatedEntry),
      "invalid generated helper is removed from Widget_getWidgets",
    );
    await unmountUI();
    check(
      liveText() === null && !generatedLiveState.runtime.disposed,
      "invalid generated helper removes the UI without hard-disposing its runtime",
    );
    await release(generatedContinuation, true);

    await editText(
      '"implementation-v6" ++ missingGeneratedImplementation',
      '"implementation-v6"',
    );
    const repairedDescriptor = await generatedProps(reconnected, config.a, generatedEntry);
    check(
      repairedDescriptor.irPackage.fingerprint === descriptor.irPackage.fingerprint,
      "repair restores the original generated fingerprint",
    );
    await renderWidget(reconnected, config.a, repairedDescriptor.irPackage.entry, {
      ...repairedDescriptor,
    });
    await waitForLiveText("repaired generated helper", "implementation-v6");
    const repairedState = states.at(-1);

    await editText(
      '"implementation-v6"',
      '"implementation-v6" ++ missingChangedRepairImplementation',
    );
    const invalidChangedRepair = await Widget_getWidgets(reconnected, config.a);
    check(
      !invalidChangedRepair.widgets.some((widget) =>
        widget.props?.irPackage?.entry === generatedEntry),
      "changed-code repair starts from a removed generated helper",
    );
    await unmountUI();
    check(
      liveText() === null && !repairedState.runtime.disposed,
      "removed changed-code helper leaves its prior runtime usable",
    );
    await editText(
      '"implementation-v6" ++ missingChangedRepairImplementation',
      '"implementation-v7"',
    );
    const repairedChangedDescriptor = await generatedProps(reconnected, config.a, generatedEntry);
    check(
      repairedChangedDescriptor.irPackage.fingerprint !==
        repairedDescriptor.irPackage.fingerprint,
      "changed repaired helper receives a new generated fingerprint",
    );
    await renderWidget(
      reconnected,
      config.a,
      repairedChangedDescriptor.irPackage.entry,
      repairedChangedDescriptor,
    );
    await waitForLiveText("changed repaired generated helper", "implementation-v7");
    check(
      states.at(-1) !== repairedState,
      "changed repaired helper reappears from its restored description",
    );
    descriptor = repairedChangedDescriptor;

    // A failed initial package acquisition can recover on a new official RPC
    // session while keeping the generated descriptor and fingerprint stable.
    await unmountUI();
    const failedInitialStart = calls.length;
    failNextPackageTransport = "generated initial package transport sentinel";
    await renderWidget(reconnected, config.a, descriptor.irPackage.entry, {
      ...descriptor,
    });
    await waitFor("failed generated initial acquisition", () =>
      container.querySelector('[data-vir-infoview-state="error"]'),
    );
    const failedInitialCall = calls.slice(failedInitialStart).find((call) =>
      call.params.method === "Lean.Vir.Infoview.buildIRPackage",
    );
    check(
      failedInitialCall?.error?.code === -32603,
      "generated initial acquisition transport failure is observed",
    );
    expectedLivePackageFailures.add(failedInitialCall);
    sessions.closeSessionForFile(config.uri);
    const recoveredSession = sessionAt(config.a);
    check(recoveredSession !== reconnected, "failed acquisition reconnects with a new official session");
    await renderWidget(recoveredSession, config.a, descriptor.irPackage.entry, {
      ...descriptor,
    });
    await waitForLiveText("recovered generated initial acquisition", "implementation-v7");
    check(
      calls.slice(failedInitialStart).filter((call) =>
        call.params.method === "Lean.Vir.Infoview.buildIRPackage",
      ).length === 2,
      "reconnected generated descriptor retries one failed initial acquisition",
    );
    check(!calls.some((call) => call.params.method === "Lean.Vir.Infoview.statIRPackage"),
      "the entire shell lifecycle uses no package stat requests");
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
      invalidPackage: { error: invalidEntryCall.error, rendered: errorText },
      startup,
      obsoleteInitial: {
        replyDelayMs: abandonedCall.replyDelayMs,
        disposed: obsoleteState.runtime.disposed,
        events: obsoleteState.events,
      },
      allLeanEditRefresh: { requests: tutorialCalls().length, subscriptionsAfterUnmount: subscriptions },
      liveImplementationEdits: {
        initial: "implementation-v1",
        final: "implementation-v7",
        proofEditPackageRequests,
        whitespacePackageRequests,
        heldReplyDelayMs: heldBuild?.replyDelayMs ?? null,
      },
      generatedInvalidRepair: true,
      generatedInitialRecovery: true,
      consoleDiagnostics,
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
        Object.assign(console, originalConsole);
        check(consoleDiagnostics.length === 0,
          `unexpected browser diagnostics: ${JSON.stringify(consoleDiagnostics)}`);
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
            call !== invalidEntryCall &&
            !expectedLivePackageFailures.has(call) &&
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
