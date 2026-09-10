/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import * as React from "react";
import { createRoot } from "react-dom/client";
import VirInfoviewWidget from "../../web/app/vir-infoview-widget.js";
import { VIR_HOST_DISPOSE } from "../../web/src/host-boundary.js";
import {
  check,
  collectUntil,
  readJsl,
} from "../runtime/generation-gc-cases.js";

const prefix = "Vir.Fixtures.ShellLifetime.";
const states = [];
const transport = {
  revision: 1,
  builds: 0,
  stats: 0,
  buildGate: null,
  statGate: null,
};
const failures = [];
const unhandled = [];
let lastCreated;
let runtimeFault = null;
let shellIntervalCount = 0;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function tick() {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    await tick();
    if (predicate()) return;
  }
  throw new Error(`shell observation timed out: ${label}`);
}

function fixtureState() {
  const state = {
    label: `G${states.length + 1}`,
    events: [],
    disposed: 0,
    unmounts: 0,
    schedules: 0,
    cancellations: 0,
    captured: null,
    ...runtimeFault,
  };
  runtimeFault = null;
  states.push(state);
  return state;
}

const harness = (globalThis.__shellTest = {
  rpc: null,
  loadedRef: null,
  runtimeOptions(options) {
    const state = fixtureState();
    // Wrap only test host observations. The actual shell still creates a fresh
    // runtime factory and fresh browser/React bindings for every service.
    return {
      state,
      options: {
        ...options,
        defaultHostBindings: () => {
          const bindings = options.defaultHostBindings();
          bindings["test.shell.label"] = () => state.label;
          bindings["test.shell.record"] = (event) => {
            state.events.push(event);
          };
          bindings["test.shell.capture"] = (
            success,
            failure,
            schedule,
            payload,
          ) => {
            state.captured = { success, failure, schedule, payload };
          };
          for (const [target, count] of [
            ["browser.timer.setTimeout", "schedules"],
            ["browser.timer.clearTimeout", "cancellations"],
          ]) {
            const original = bindings[target];
            bindings[target] = (...args) => {
              state[count]++;
              return original(...args);
            };
          }
          const dispose = bindings[VIR_HOST_DISPOSE];
          bindings[VIR_HOST_DISPOSE] = () => {
            dispose();
            if (state.throwDispose)
              throw new Error("candidate disposal sentinel");
          };
          return bindings;
        },
      },
    };
  },
  created(runtime, state) {
    state.runtime = new WeakRef(runtime);
    state.memory = new WeakRef(runtime.exports.memory);
    const dispose = runtime.dispose.bind(runtime);
    runtime.dispose = () => {
      state.disposed++;
      return dispose();
    };
    if (state.invalidComponent) {
      const call = runtime.call.bind(runtime);
      runtime.call = (...args) => {
        const value = call(...args);
        return args[0] === prefix + "createComponent" ? null : value;
      };
    }
    lastCreated = state;
  },
  createdRoot(root) {
    const state = lastCreated;
    state.root = new WeakRef(root);
    const unmount = root.unmount.bind(root);
    root.unmount = () => {
      state.unmounts++;
      unmount();
      if (state.throwUnmount) throw new Error("normal unmount sentinel");
    };
    const render = root.render.bind(root);
    root.render = (...args) => {
      if (state.throwRender) throw new Error("render sentinel");
      return render(...args);
    };
  },
});

async function mountShell(props = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => failures.push(String(error)),
  });
  const config = {
    wasmPath: "shell.wasm",
    irPackage: { roots: [prefix + "createComponent", prefix + "mount"] },
    componentEntry: prefix + "createComponent",
    entry: prefix + "mount",
    pos: { uri: "file:///ShellLifetime.lean", line: 0, character: 0 },
    ...props,
  };
  await React.act(async () =>
    root.render(React.createElement(VirInfoviewWidget, config)),
  );
  return {
    container,
    async ready() {
      await until(
        () => container.querySelector('[data-vir-infoview-state="ready"]'),
        "mounted shell ready",
      );
    },
    async update(next) {
      Object.assign(config, next);
      await React.act(async () =>
        root.render(React.createElement(VirInfoviewWidget, config)),
      );
    },
    async unmount() {
      try {
        await React.act(async () => root.unmount());
      } finally {
        container.remove();
      }
    },
  };
}

function pending(state) {
  const request = deferred();
  const completion = request.promise.then(
    state.captured.success,
    state.captured.failure,
  );
  // Observe any failure immediately without suppressing the awaited assertion.
  void completion.catch(() => {});
  return { ...request, completion };
}

function checkContinuation(state, kind, stale) {
  check(
    state.events.includes(`body:${kind}:${state.label}`),
    `Lean ${kind} body entered ${state.label}`,
  );
  check(
    state.events.includes(
      `${stale ? "stale" : "mutation"}:${kind}:${state.label}`,
    ),
    "Lean application guard ran",
  );
  if (stale)
    check(
      !state.events.includes(`mutation:${kind}:${state.label}`),
      "retired UI was not mutated",
    );
}

async function normalUnmount() {
  const shell = await mountShell({ autoReloadMs: 10 });
  await shell.ready();
  const state = states.at(-1);
  const success = pending(state),
    rejection = pending(state);
  await until(() => transport.stats > 1, "polling ran");
  await shell.unmount();
  check(
    harness.loadedRef.current === null,
    "normal cleanup detaches shell reference",
  );
  check(
    state.unmounts === 1 && state.disposed === 0,
    "normal cleanup unmounts only owned root",
  );
  check(shellIntervalCount === 0, "shell-owned polling stopped");
  const stats = transport.stats;
  await tick();
  check(transport.stats === stats, "no later poll after shell cleanup");
  success.resolve("late success");
  rejection.reject("late rejection");
  await Promise.all([success.completion, rejection.completion]);
  checkContinuation(state, "success", true);
  checkContinuation(state, "failure", true);
  check(
    readJsl(state.runtime.deref(), state.captured.payload) === state.label,
    "JSL stays on original heap",
  );
  state.captured.schedule(undefined);
  check(
    state.schedules === 1 && state.cancellations === 1,
    "retained Lean callback schedules and cancels active work",
  );
  check(
    state.events.includes(`scheduled:${state.label}`),
    "late schedule body finished",
  );
  state.captured = null;
  await collectUntil(
    () => !state.runtime.deref() && !state.memory.deref(),
    "unmounted shell generation released",
  );
}

async function mountedRefresh() {
  const shell = await mountShell({ autoReloadMs: 10 });
  await shell.ready();
  const old = states.at(-1);
  const late = pending(old);
  transport.revision++;
  await until(
    () =>
      states.at(-1) !== old &&
      shell.container.textContent.includes(states.at(-1).label),
    "G2 mounted refresh",
  );
  const fresh = states.at(-1);
  check(
    old.unmounts === 1 && old.disposed === 0,
    "refresh detached G1 without shutdown",
  );
  check(
    old.runtime.deref() !== fresh.runtime.deref(),
    "refresh uses distinct instances",
  );
  check(
    old.runtime.deref().hostState.defaultBindings !==
      fresh.runtime.deref().hostState.defaultBindings,
    "fresh service binding maps",
  );
  late.resolve("G1 completes after G2 mount");
  await late.completion;
  checkContinuation(old, "success", true);
  fresh.captured.success("G2 completes while mounted");
  checkContinuation(fresh, "success", false);
  check(
    readJsl(old.runtime.deref(), old.captured.payload) === old.label,
    "G1 payload retained",
  );
  check(
    readJsl(fresh.runtime.deref(), fresh.captured.payload) === fresh.label,
    "G2 payload retained",
  );
  let rejected = false;
  try {
    readJsl(fresh.runtime.deref(), old.captured.payload);
  } catch {
    rejected = true;
  }
  check(rejected, "G2 rejects G1 JSL");
  await shell.unmount();
  old.captured = null;
  fresh.captured = null;
  await collectUntil(
    () => !old.runtime.deref() && !fresh.runtime.deref(),
    "refreshed shell generations released",
  );
}

async function applicationListenerRetention() {
  const shell = await mountShell({ autoReloadMs: 10 });
  await shell.ready();
  const state = states.at(-1);
  const target = new EventTarget();
  let listener = state.captured.schedule;
  target.addEventListener("late", listener);
  const listenerRef = new WeakRef(listener);
  listener = null;
  await shell.unmount();
  state.captured = null;
  await collectUntil(() => true, "application listener retention control");
  check(
    state.runtime.deref() !== undefined &&
      state.disposed === 0 &&
      shellIntervalCount === 0,
    "caller-owned listener survives owned UI/polling cleanup",
  );
  target.dispatchEvent(new Event("late"));
  check(
    state.schedules === 1 && state.cancellations === 1,
    "retained listener enters Lean and schedules active work",
  );
  target.removeEventListener("late", listenerRef.deref());
  await collectUntil(
    () => !state.runtime.deref(),
    "application listener removed and generation collected",
  );
}

async function explicitShutdown() {
  const shell = await mountShell();
  await shell.ready();
  const state = states.at(-1),
    late = pending(state);
  await shell.unmount();
  state.runtime.deref().dispose();
  late.resolve("after hard shutdown");
  let rejected = false;
  try {
    await late.completion;
  } catch (error) {
    rejected = /disposed/.test(String(error));
  }
  check(rejected, "explicit shutdown rejects late Lean body");
  check(
    !state.events.some((event) => event.startsWith("body:")),
    "hard-shutdown body not entered",
  );
  state.captured = null;
}

async function normalUnmountFailure() {
  const shell = await mountShell();
  await shell.ready();
  const state = states.at(-1),
    late = pending(state);
  state.throwUnmount = true;
  const before = failures.length;
  try {
    await shell.unmount();
  } catch (error) {
    failures.push(String(error));
  }
  check(
    failures.length === before + 1 &&
      failures.at(-1).includes("normal unmount sentinel"),
    "normal unmount error surfaced",
  );
  check(
    harness.loadedRef.current === null && state.disposed === 0,
    "throwing normal cleanup detaches without shutdown",
  );
  late.resolve("still callable");
  await late.completion;
  checkContinuation(state, "success", true);
  state.captured = null;
  await collectUntil(
    () => !state.runtime.deref(),
    "throwing normal unmount generation released",
  );
}

async function failedCandidates() {
  runtimeFault = { throwRender: true, throwDispose: true };
  const renderFailure = await mountShell();
  await until(
    () =>
      renderFailure.container.querySelector(
        '[data-vir-infoview-state="error"]',
      ),
    "render failure reported",
  );
  const rendered = states.at(-1);
  check(
    renderFailure.container.textContent.includes("render sentinel") &&
      renderFailure.container.textContent.includes(
        "candidate disposal sentinel",
      ),
    "render and teardown errors both reported",
  );
  check(
    rendered.disposed === 1 &&
      rendered.unmounts === 1 &&
      harness.loadedRef.current === null,
    "render failure hard-cleans and detaches",
  );
  let rejected = false;
  try {
    rendered.captured.success(undefined);
  } catch (error) {
    rejected = /disposed/.test(String(error));
  }
  check(rejected, "render failure invalidates escaped callbacks");
  rendered.captured = null;
  await renderFailure.unmount();

  runtimeFault = { throwDispose: true };
  const setupFailure = await mountShell({
    componentEntry: "Missing.component",
  });
  await until(
    () =>
      setupFailure.container.querySelector('[data-vir-infoview-state="error"]'),
    "setup failure reported",
  );
  check(
    setupFailure.container.textContent.includes("not found") &&
      setupFailure.container.textContent.includes(
        "candidate disposal sentinel",
      ),
    "setup and disposal errors both reported",
  );
  check(states.at(-1).disposed === 1, "invalid setup hard-disposes candidate");
  await setupFailure.unmount();
}

async function obsoleteCandidateAndPoll() {
  const buildGate = deferred();
  transport.buildGate = buildGate;
  const before = states.length;
  const shell = await mountShell({ autoReloadMs: 10 });
  await until(() => transport.buildGate === null, "candidate build pending");
  await shell.unmount();
  buildGate.resolve();
  await until(() => states.length > before, "obsolete candidate finished");
  const obsolete = states.at(-1);
  check(
    obsolete.disposed === 1 && obsolete.root === undefined,
    "obsolete never-installed candidate hard-disposed",
  );
  check(
    harness.loadedRef.current === null && shellIntervalCount === 0,
    "obsolete result installs no UI or polling",
  );

  for (const rejectPoll of [false, true]) {
    const mounted = await mountShell({ autoReloadMs: 10 });
    await mounted.ready();
    const state = states.at(-1);
    const pollGate = deferred();
    transport.statGate = pollGate;
    await until(() => transport.statGate === null, "poll request in flight");
    await mounted.unmount();
    const builds = transport.builds;
    transport.revision++;
    if (rejectPoll) pollGate.reject(new Error("obsolete poll sentinel"));
    else pollGate.resolve();
    await tick();
    await tick();
    check(
      transport.builds === builds &&
        shellIntervalCount === 0 &&
        harness.loadedRef.current === null,
      "late poll cannot install or trigger reload",
    );
    state.captured = null;
  }
}

async function failedRefresh() {
  const shell = await mountShell({ autoReloadMs: 100 });
  await shell.ready();
  const old = states.at(-1);
  runtimeFault = { invalidComponent: true };
  transport.revision++;
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="error"]'),
    "failed refresh status",
  );
  await shell.update({ autoReloadMs: 0 });
  const candidate = states.at(-1);
  check(
    candidate !== old &&
      candidate.disposed === 1 &&
      candidate.root === undefined,
    "invalid refresh candidate hard-disposed",
  );
  check(
    old.unmounts === 0 &&
      old.disposed === 0 &&
      shell.container.textContent.includes(old.label),
    "failed refresh preserves mounted G1",
  );
  old.captured.success(undefined);
  checkContinuation(old, "success", false);
  await shell.unmount();
  candidate.captured = null;
  old.captured = null;
}

async function refreshUnmountFailure() {
  const shell = await mountShell({ autoReloadMs: 100 });
  await shell.ready();
  const old = states.at(-1),
    late = pending(old);
  old.throwUnmount = true;
  transport.revision++;
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="error"]'),
    "refresh unmount failure status",
  );
  await shell.update({ autoReloadMs: 0 });
  const candidate = states.at(-1);
  check(
    shell.container.textContent.includes("normal unmount sentinel"),
    "refresh unmount error reported",
  );
  check(
    old.disposed === 0 &&
      candidate !== old &&
      candidate.disposed === 1 &&
      harness.loadedRef.current === null,
    "refresh exception detaches old owner and hard-disposes uninstalled candidate",
  );
  late.resolve(undefined);
  await late.completion;
  checkContinuation(old, "success", true);
  await shell.unmount();
  old.captured = null;
  candidate.captured = null;
  await collectUntil(
    () => !old.runtime.deref() && !candidate.runtime.deref(),
    "failed refresh owners released",
  );
}

globalThis.runShellLifetime = async (wasmBase64, packageBase64) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const onUnhandled = (event) => {
    unhandled.push(String(event.reason));
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  const setIntervalOriginal = globalThis.setInterval,
    clearIntervalOriginal = globalThis.clearInterval;
  const intervals = new Set();
  globalThis.setInterval = (...args) => {
    const id = setIntervalOriginal(...args);
    intervals.add(id);
    shellIntervalCount = intervals.size;
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
    shellIntervalCount = intervals.size;
    return clearIntervalOriginal(id);
  };
  harness.rpc = {
    async call(method, params) {
      if (method.endsWith("statIRPackage")) {
        transport.stats++;
        if (transport.statGate) {
          const gate = transport.statGate;
          transport.statGate = null;
          await gate.promise;
        }
        return {
          source: "fixtures/runtime/ShellLifetime.lean",
          roots: params.package.roots,
          revision: String(transport.revision),
        };
      }
      if (method.endsWith("buildIRPackage")) {
        transport.builds++;
        const revision = transport.revision;
        if (transport.buildGate) {
          const gate = transport.buildGate;
          transport.buildGate = null;
          await gate.promise;
        }
        return {
          source: "fixtures/runtime/ShellLifetime.lean",
          roots: params.package.roots,
          revision: String(revision),
          byteSize: String(atob(packageBase64).length),
          dataBase64: packageBase64,
        };
      }
      check(
        method.endsWith("statAsset") || method.endsWith("readAsset"),
        "only mocked shell transport methods expected",
      );
      return {
        path: params.path,
        mime: "application/wasm",
        byteSize: String(atob(wasmBase64).length),
        modified: "1",
        revision: "wasm-1",
        dataBase64: wasmBase64,
      };
    },
  };
  try {
    await normalUnmount();
    await mountedRefresh();
    await applicationListenerRetention();
    await explicitShutdown();
    await normalUnmountFailure();
    await failedCandidates();
    await failedRefresh();
    await refreshUnmountFailure();
    await obsoleteCandidateAndPoll();
    await tick();
    check(
      failures.length === 1 && failures[0].includes("normal unmount sentinel"),
      "only the injected React cleanup error is observed",
    );
    check(
      unhandled.length === 0,
      `unexpected unhandled rejection: ${unhandled.join("; ")}`,
    );
    return {
      ok: true,
      generations: states.length,
      normalUnmount: true,
      refresh: true,
      lateLeanGuards: true,
      lateScheduling: true,
      applicationListenerRetention: true,
      hardShutdown: true,
      failurePaths: true,
      normalCleanupException: true,
      obsoleteLoadAndPoll: true,
      unhandled: unhandled.length,
    };
  } finally {
    globalThis.setInterval = setIntervalOriginal;
    globalThis.clearInterval = clearIntervalOriginal;
    for (const id of intervals) clearIntervalOriginal(id);
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
};
