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
const boundaryErrors = [];
const consoleMessages = [];
const unexpectedConsole = [];
const expectedConsole = [];
const unhandled = [];
let runtimeFault = null;
let shellIntervalCount = 0;
const inheritedContext = React.createContext(null);
const inheritedContextValue = "outer infoview context";

class ShellErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    boundaryErrors.push(String(error));
  }

  render() {
    return this.state.error === null
      ? this.props.children
      : React.createElement(
          "pre",
          { "data-shell-error-boundary": "true" },
          String(this.state.error),
        );
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function consoleMessage(args) {
  return args
    .map((value) => {
      if (value instanceof Error) return value.stack ?? value.message;
      try {
        return String(value);
      } catch {
        return "[unprintable console value]";
      }
    })
    .join(" ");
}

function allowConsoleDiagnostic(sentinel, count) {
  expectedConsole.push({ sentinel, remaining: count });
}

function recordConsoleDiagnostic(level, args) {
  const message = consoleMessage(args);
  consoleMessages.push({ level, message });
  const expected = expectedConsole.find(
    ({ sentinel, remaining }) => remaining > 0 && message.includes(sentinel),
  );
  if (expected !== undefined) {
    expected.remaining--;
  } else {
    unexpectedConsole.push({ level, message });
  }
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
    cleanups: 0,
    contexts: [],
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
            if (event === `cleanup:${state.label}`) {
              state.cleanups++;
              if (state.throwCleanup)
                throw new Error("normal cleanup sentinel");
            }
          };
          bindings["test.shell.capture"] = (
            success,
            failure,
            schedule,
            payload,
          ) => {
            state.captured = { success, failure, schedule, payload };
          };
          bindings["test.shell.context"] = () => {
            state.contexts.push(React.useContext(inheritedContext));
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
    const call = runtime.call.bind(runtime);
    runtime.call = (...args) => {
      if (state.throwRender && args[0] === prefix + "renderComponent") {
        throw new Error("render sentinel");
      }
      const value = call(...args);
      return state.invalidComponent && args[0] === prefix + "createComponent"
        ? null
        : value;
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
    irPackage: {
      roots: [prefix + "createComponent", prefix + "renderComponent"],
    },
    componentEntry: prefix + "createComponent",
    entry: prefix + "renderComponent",
    pos: { uri: "file:///ShellLifetime.lean", line: 0, character: 0 },
    ...props,
  };
  await React.act(async () =>
    root.render(
      React.createElement(
        inheritedContext.Provider,
        { value: inheritedContextValue },
        React.createElement(
          ShellErrorBoundary,
          null,
          React.createElement(VirInfoviewWidget, config),
        ),
      ),
    ),
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
        root.render(
          React.createElement(
            inheritedContext.Provider,
            { value: inheritedContextValue },
            React.createElement(
              ShellErrorBoundary,
              null,
              React.createElement(VirInfoviewWidget, config),
            ),
          ),
        ),
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
  check(
    state.contexts.includes(inheritedContextValue),
    "Lean render node inherits the arbitrary outer React context",
  );
  const success = pending(state),
    rejection = pending(state);
  await until(() => transport.stats > 1, "polling ran");
  await shell.unmount();
  check(
    harness.loadedRef.current === null,
    "normal cleanup detaches shell reference",
  );
  check(
    state.cleanups === 1 && state.disposed === 0,
    "normal cleanup runs the Lean effect once without shutdown",
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
    old.cleanups === 1 && old.disposed === 0,
    "refresh cleans up G1 once without shutdown",
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
  let shell = await mountShell();
  await shell.ready();
  const state = states.at(-1),
    late = pending(state);
  state.throwCleanup = true;
  allowConsoleDiagnostic("normal cleanup sentinel", 2);
  const before = failures.length;
  let cleanupError = "";
  try {
    await shell.unmount();
  } catch (error) {
    if (!String(error).includes("normal cleanup sentinel")) throw error;
    cleanupError = String(error);
    failures.push(String(error));
  }
  check(
    cleanupError === "Error: normal cleanup sentinel" &&
      failures.length === before + 1 &&
      failures.at(-1).includes("normal cleanup sentinel"),
    "normal unmount surfaces only the injected cleanup error",
  );
  check(
    harness.loadedRef.current === null &&
      state.cleanups === 1 &&
      state.disposed === 0,
    "throwing Lean cleanup records once and detaches without shutdown",
  );
  late.resolve("still callable");
  await late.completion;
  checkContinuation(state, "success", true);
  state.captured = null;
  shell = null;
  // React can retain its failed commit's fiber graph, including cleanup
  // callbacks. Do not require stronger collection than native React here;
  // successful cleanup and refresh have separate collection assertions.
}

async function failedCandidates() {
  runtimeFault = { throwRender: true };
  allowConsoleDiagnostic("render sentinel", 2);
  const renderFailure = await mountShell();
  await until(
    () =>
      renderFailure.container.querySelector(
        '[data-shell-error-boundary="true"]',
      ),
    "render entry failure reaches the ancestor boundary",
  );
  const rendered = states.at(-1);
  check(
    boundaryErrors.at(-1)?.includes("render sentinel") &&
      renderFailure.container.textContent.includes("render sentinel"),
    "render entry failure is owned by the React error boundary",
  );
  check(
    rendered.disposed === 0 &&
      rendered.cleanups === 0 &&
      harness.loadedRef.current === null,
    "render entry failure detaches without hard disposal or invented cleanup",
  );
  rendered.captured.success(undefined);
  checkContinuation(rendered, "success", false);
  check(
    readJsl(rendered.runtime.deref(), rendered.captured.payload) ===
      rendered.label,
    "render-entry failure leaves captured JSL on the live generation",
  );
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

function effectCount(state, event) {
  return state.events.filter((value) => value === `${event}:${state.label}`).length;
}

async function replacementCleanupFailure() {
  const shell = await mountShell({ autoReloadMs: 100 });
  await shell.ready();
  const old = states.at(-1);
  old.throwCleanup = true;
  allowConsoleDiagnostic("normal cleanup sentinel", 2);
  transport.revision++;
  await until(
    () =>
      shell.container.querySelector('[data-shell-error-boundary="true"]'),
    "replacement cleanup reaches the ancestor boundary",
  );
  const successor = states.at(-1);
  check(successor !== old, "refresh publishes a distinct successor generation");
  check(
    boundaryErrors.at(-1)?.includes("normal cleanup sentinel"),
    "replacement cleanup failure is owned by the React error boundary",
  );
  check(
    old.cleanups === 1 && effectCount(old, "cleanup") === 1 && old.disposed === 0,
    "replaced component runs one Lean cleanup without hard disposal",
  );
  check(
    successor.cleanups === effectCount(successor, "setup") &&
      successor.disposed === 0 &&
      harness.loadedRef.current === null,
    "published successor has only matching React cleanup and no hard disposal",
  );
  old.captured.success(undefined);
  checkContinuation(old, "success", true);
  successor.captured.success(undefined);
  check(
    successor.events.includes(`body:success:${successor.label}`),
    "published successor callback remains live after boundary recovery",
  );
  check(
    readJsl(old.runtime.deref(), old.captured.payload) === old.label &&
      readJsl(successor.runtime.deref(), successor.captured.payload) ===
        successor.label,
    "replacement cleanup failure retains both original JSL generations",
  );
  old.captured = null;
  successor.captured = null;
  await shell.unmount();
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
    obsolete.disposed === 1,
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
      candidate.disposed === 1,
    "invalid refresh candidate hard-disposed",
  );
  check(
    old.cleanups === 0 &&
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

async function singlePendingRefresh() {
  const shell = await mountShell({ autoReloadMs: 10 });
  await shell.ready();
  const old = states.at(-1);
  const builds = transport.builds;
  const gate = deferred();
  transport.buildGate = gate;
  transport.revision++;
  await until(() => transport.buildGate === null, "refresh build pending");
  for (let i = 0; i < 5; i++) await tick();
  check(
    transport.builds === builds + 1,
    "polling admits only one refresh while its package build is pending",
  );
  gate.resolve();
  await until(
    () =>
      states.at(-1) !== old &&
      shell.container.textContent.includes(states.at(-1).label),
    "pending refresh eventually installs its successor",
  );
  const fresh = states.at(-1);
  check(
    old.cleanups === 1 && old.disposed === 0 && fresh.disposed === 0,
    "completed pending refresh replaces one live generation without shutdown",
  );
  old.captured = null;
  fresh.captured = null;
  await shell.unmount();
}

async function obsoleteConfigurationCandidate() {
  const gate = deferred();
  const before = states.length;
  transport.buildGate = gate;
  const shell = await mountShell({ autoReloadMs: 0 });
  await until(() => transport.buildGate === null, "initial configuration build pending");
  await shell.update({ wasmPath: "reconfigured-shell.wasm" });
  await until(
    () =>
      states.length === before + 1 &&
      shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "changed configuration installs its own generation",
  );
  const current = states.at(-1);
  gate.resolve();
  await until(
    () => states.length === before + 2,
    "obsolete configuration candidate finishes",
  );
  const obsolete = states.at(-1);
  check(
    current.disposed === 0 &&
      obsolete.disposed === 1 &&
      harness.loadedRef.current !== null,
    "changed props retain their live generation and hard-dispose the obsolete candidate",
  );
  current.captured = null;
  obsolete.captured = null;
  await shell.unmount();
}

globalThis.runShellLifetime = async (wasmBase64, packageBase64) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const onUnhandled = (event) => {
    unhandled.push(String(event.reason));
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  const consoleError = console.error,
    consoleWarn = console.warn;
  console.error = (...args) => {
    recordConsoleDiagnostic("error", args);
    consoleError(...args);
  };
  console.warn = (...args) => {
    recordConsoleDiagnostic("warn", args);
    consoleWarn(...args);
  };
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
    await replacementCleanupFailure();
    await singlePendingRefresh();
    await obsoleteConfigurationCandidate();
    await obsoleteCandidateAndPoll();
    await tick();
    check(
      failures.every((failure) => failure.includes("normal cleanup sentinel")),
      "only the injected React cleanup error is observed when React forwards it",
    );
    check(
      unexpectedConsole.length === 0,
      `unexpected console diagnostic: ${unexpectedConsole
        .map(({ level, message }) => `${level}: ${message}`)
        .join("; ")}`,
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
      renderBoundary: true,
      singlePendingRefresh: true,
      obsoleteConfigurationCandidate: true,
      consoleDiagnostics: consoleMessages.length,
      obsoleteLoadAndPoll: true,
      unhandled: unhandled.length,
    };
  } finally {
    globalThis.setInterval = setIntervalOriginal;
    globalThis.clearInterval = clearIntervalOriginal;
    console.error = consoleError;
    console.warn = consoleWarn;
    for (const id of intervals) clearIntervalOriginal(id);
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
};
