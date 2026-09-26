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
  assetCalls: 0,
  buildRevisions: [],
  buildEntries: [],
  packageBase64: null,
  buildGate: null,
  failNextBuild: false,
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

function RemovalLayoutProbe({ onCleanup, children }) {
  React.useLayoutEffect(() => () => onCleanup(), [onCleanup]);
  return children;
}

function shellWidget(config, onRemovalLayoutCleanup) {
  const widget = React.createElement(VirInfoviewWidget, config);
  return onRemovalLayoutCleanup === null
    ? widget
    : React.createElement(
        RemovalLayoutProbe,
        { onCleanup: onRemovalLayoutCleanup },
        widget,
      );
}

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

function observeDiagnostics() {
  const unexpectedStart = unexpectedConsole.length;
  const unhandledStart = unhandled.length;
  const consoleError = console.error,
    consoleWarn = console.warn;
  const onUnhandled = (event) => {
    unhandled.push(String(event.reason));
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  console.error = (...args) => {
    recordConsoleDiagnostic("error", args);
    consoleError(...args);
  };
  console.warn = (...args) => {
    recordConsoleDiagnostic("warn", args);
    consoleWarn(...args);
  };
  return () => {
    console.error = consoleError;
    console.warn = consoleWarn;
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    check(
      unexpectedConsole.length === unexpectedStart,
      `unexpected console diagnostic: ${unexpectedConsole
        .slice(unexpectedStart)
        .map(({ level, message }) => `${level}: ${message}`)
        .join("; ")}`,
    );
    check(
      unhandled.length === unhandledStart,
      `unexpected unhandled rejection: ${unhandled
        .slice(unhandledStart)
        .join("; ")}`,
    );
  };
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

async function untilBare(predicate, label) {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    factoryCalls: 0,
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
  afterLoadRuntimeService: (service) => service,
  widgetPassiveCleanup: () => {},
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
      if (args[0] === prefix + "createComponent") state.factoryCalls++;
      const value = call(...args);
      if (state.throwComponentRender && args[0] === prefix + "createComponent") {
        return function ThrowingComponent() {
          throw new Error("render sentinel");
        };
      }
      return state.invalidComponent && args[0] === prefix + "createComponent"
        ? null
        : value;
    };
  },
});

function packageDescription(fingerprint) {
  return { entry: prefix + "createComponent", fingerprint };
}

async function mountShell(props = {}, { onRemovalLayoutCleanup = null } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: (error) => failures.push(String(error)),
  });
  const config = {
    wasmPath: "shell.wasm",
    irPackage: packageDescription("initial"),
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
          shellWidget(config, onRemovalLayoutCleanup),
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
              shellWidget(config, onRemovalLayoutCleanup),
            ),
          ),
        ),
      );
    },
    removeTransition() {
      React.startTransition(() => root.render(null));
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
  const shell = await mountShell();
  await shell.ready();
  const state = states.at(-1);
  check(
    state.contexts.includes(inheritedContextValue),
    "Lean render node inherits the arbitrary outer React context",
  );
  const success = pending(state),
    rejection = pending(state);
  await shell.unmount();
  check(
    harness.loadedRef.current === null,
    "normal cleanup detaches shell reference",
  );
  check(
    state.cleanups === 1 && state.disposed === 0,
    "normal cleanup runs the Lean effect once without shutdown",
  );
  check(transport.stats === 0, "ordinary shell lifetime makes no package stat calls");
  check(shellIntervalCount === 0, "shell owns no polling interval");
  await tick();
  check(transport.stats === 0, "shell cleanup does not start package polling");
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
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("initial") });
  await shell.ready();
  const old = states.at(-1);

  const ordinaryBuilds = transport.builds;
  await shell.update({ setupHint: "ordinary prop update" });
  await tick();
  check(
    transport.builds === ordinaryBuilds && states.at(-1) === old,
    "ordinary prop changes with an unchanged fingerprint do not acquire",
  );

  const fingerprintBuilds = transport.builds;
  await shell.update({
    irPackage: {
      entry: prefix + "createComponent",
      fingerprint: "generated-shell-lifetime-fingerprint-1",
    },
  });
  await until(
    () =>
      transport.builds === fingerprintBuilds + 1 &&
      shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "generated package fingerprint acquires once",
  );
  check(
    states.at(-1) === old && old.cleanups === 0 &&
      transport.buildEntries.at(-1) === prefix + "createComponent",
    "a generated fingerprint change with identical entry preserves the runtime",
  );

  transport.revision++;
  const revisionOnly = transport.revision;
  const revisionBuilds = transport.builds;
  await shell.update({ irPackage: packageDescription("fingerprint-only") });
  await until(
    () =>
      transport.builds === revisionBuilds + 1 &&
      shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "same-byte fingerprint refresh completes",
  );
  check(
    states.at(-1) === old && old.cleanups === 0 &&
      transport.buildRevisions.at(-1) === String(revisionOnly),
    "a changed server revision with identical bytes preserves the runtime",
  );

  const late = pending(old);
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("manifest-only") });
  await until(
    () => states.at(-1) !== old &&
      shell.container.textContent.includes(states.at(-1).label),
    "G2 mounted refresh",
  );
  const fresh = states.at(-1);
  check(
    transport.buildRevisions.at(-1) === String(revisionOnly),
    "manifest-only bytes replace the runtime without a server revision change",
  );
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
  transport.packageBase64 = transport.basePackageBase64;
}

async function unchangedInputsNoAcquisition() {
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell();
  await shell.ready();
  const state = states.at(-1);
  const runtime = state.runtime;
  const builds = transport.builds;
  const stats = transport.stats;
  const assetCalls = transport.assetCalls;
  await shell.update({
    setupHint: "ordinary prop update",
    goals: [{ userName: "ordinary goal" }],
    pos: { uri: "file:///ShellLifetime.lean", line: 4, character: 2 },
  });
  await tick();
  check(
    transport.builds === builds &&
      transport.stats === stats &&
      transport.assetCalls === assetCalls &&
      states.at(-1) === state &&
      state.runtime.deref() === runtime.deref(),
    "ordinary props, goals, and position do not acquire",
  );
  const session = harness.rpc;
  harness.rpc = {
    call(...args) {
      return session.call(...args);
    },
  };
  const sessionBuilds = transport.builds;
  const sessionStats = transport.stats;
  const sessionAssetCalls = transport.assetCalls;
  await shell.update({ setupHint: "RPC session wrapper update" });
  await tick();
  check(
    transport.builds === sessionBuilds &&
      transport.stats === sessionStats &&
      transport.assetCalls === sessionAssetCalls &&
      states.at(-1) === state &&
      state.runtime.deref() === runtime.deref(),
    "an RPC session wrapper change with the same fingerprint does not acquire",
  );
  await shell.unmount();
  state.captured = null;
  await collectUntil(
    () => !state.runtime.deref(),
    "unchanged-input shell generation released",
  );
}

async function applicationListenerRetention() {
  const shell = await mountShell();
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
    "caller-owned listener survives owned UI cleanup",
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
  runtimeFault = { throwComponentRender: true };
  allowConsoleDiagnostic("render sentinel", 2);
  const renderFailure = await mountShell();
  await until(
    () =>
      renderFailure.container.querySelector(
        '[data-shell-error-boundary="true"]',
      ),
    "factory component render failure reaches the ancestor boundary",
  );
  const rendered = states.at(-1);
  check(
    boundaryErrors.at(-1)?.includes("render sentinel") &&
      renderFailure.container.textContent.includes("render sentinel"),
    "factory component render failure is owned by the React error boundary",
  );
  check(
    rendered.disposed === 0 &&
      rendered.cleanups === 0 &&
      harness.loadedRef.current === null,
    "factory component render failure detaches without hard disposal or invented cleanup",
  );
  rendered.captured.success(undefined);
  checkContinuation(rendered, "success", false);
  check(
    readJsl(rendered.runtime.deref(), rendered.captured.payload) ===
      rendered.label,
    "factory component render failure leaves captured JSL on the live generation",
  );
  rendered.captured = null;
  await renderFailure.unmount();

  runtimeFault = { throwDispose: true };
  const setupFailure = await mountShell({
    irPackage: { ...packageDescription("missing"), entry: "Missing.component" },
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
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("cleanup-initial") });
  await shell.ready();
  const old = states.at(-1);
  old.throwCleanup = true;
  allowConsoleDiagnostic("normal cleanup sentinel", 2);
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("cleanup-refresh") });
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
  transport.packageBase64 = transport.basePackageBase64;
}

async function obsoleteCandidateAndFingerprintUpdate() {
  runtimeFault = { throwDispose: true };
  allowConsoleDiagnostic("candidate disposal sentinel", 1);
  const buildGate = deferred();
  transport.buildGate = buildGate;
  const before = states.length;
  const shell = await mountShell();
  await until(() => transport.buildGate === null, "candidate build pending");
  await shell.unmount();
  buildGate.resolve();
  await until(() => states.length > before, "obsolete candidate finished");
  const obsolete = states.at(-1);
  check(
    obsolete.disposed === 1,
    "obsolete candidate disposal attempted once even when cleanup throws",
  );
  check(
    harness.loadedRef.current === null && shellIntervalCount === 0 &&
      transport.stats === 0,
    "obsolete result installs no UI or package polling",
  );

  {
    const mounted = await mountShell();
    await mounted.ready();
    const state = states.at(-1);
    const fingerprintGate = deferred();
    const beforeBuild = states.length;
    const builds = transport.builds;
    transport.buildGate = fingerprintGate;
    await mounted.update({ irPackage: packageDescription("obsolete-same-bytes") });
    await until(() => transport.buildGate === null, "same-byte fingerprint build in flight");
    await mounted.unmount();
    fingerprintGate.resolve();
    await tick();
    await tick();
    check(
      transport.builds === builds + 1 &&
        states.length === beforeBuild &&
        state.disposed === 0 &&
        shellIntervalCount === 0 &&
        harness.loadedRef.current === null,
      "obsolete same-byte fingerprint reuses its runtime without creating a candidate",
    );
    state.captured = null;
  }

  for (const rejectBuild of [false, true]) {
    const mounted = await mountShell();
    await mounted.ready();
    const state = states.at(-1);
    const fingerprintGate = deferred();
    const beforeBuild = states.length;
    const builds = transport.builds;
    transport.packageBase64 = transport.manifestPackageBase64;
    transport.buildGate = fingerprintGate;
    await mounted.update({ irPackage: packageDescription(`obsolete-${rejectBuild}`) });
    await until(() => transport.buildGate === null, "fingerprint build in flight");
    await mounted.unmount();
    if (rejectBuild) {
      allowConsoleDiagnostic("obsolete fingerprint sentinel", 1);
      fingerprintGate.reject(new Error("obsolete fingerprint sentinel"));
    } else {
      fingerprintGate.resolve();
    }
    await tick();
    await tick();
    check(
      transport.builds === builds + 1 &&
        shellIntervalCount === 0 &&
        harness.loadedRef.current === null,
      "late fingerprint acquisition cannot install after removal",
    );
    if (rejectBuild) {
      check(states.length === beforeBuild, "failed obsolete fingerprint creates no runtime");
    } else {
      await until(() => states.length === beforeBuild + 1,
        "obsolete fingerprint candidate finishes");
      check(states.at(-1).disposed === 1,
        "obsolete fingerprint candidate is hard-disposed");
      states.at(-1).captured = null;
    }
    state.captured = null;
    transport.packageBase64 = transport.basePackageBase64;
  }
}

async function failedRefresh() {
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("failure-initial") });
  await shell.ready();
  const old = states.at(-1);
  transport.packageBase64 = transport.manifestPackageBase64;
  runtimeFault = { invalidComponent: true };
  await shell.update({ irPackage: packageDescription("failed-refresh") });
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="error"]'),
    "failed refresh status",
  );
  const candidate = states.at(-1);
  const failedStateCount = states.length;
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
  const failedBuilds = transport.builds;
  await shell.update({ setupHint: "ordinary update after failure" });
  await tick();
  check(transport.builds === failedBuilds,
    "ordinary props do not retry a failed fingerprint acquisition");
  transport.packageBase64 = transport.basePackageBase64;
  await shell.update({ irPackage: packageDescription("restore-installed") });
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "restoring installed source clears failed build status",
  );
  check(transport.builds === failedBuilds + 1 && old.cleanups === 0 &&
      states.length === failedStateCount &&
      harness.loadedRef.current?.service.runtime === old.runtime.deref(),
    "restoring installed source preserves its component");
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("source-edit") });
  await until(
    () => old.cleanups === 1 &&
      shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "source edit recovers failed refresh automatically",
  );
  const fresh = states.at(-1);
  check(fresh !== candidate && old.cleanups === 1, "fixed edit replaces the old component");
  await shell.unmount();
  fresh.captured = null;
  candidate.captured = null;
  old.captured = null;
  transport.packageBase64 = transport.basePackageBase64;
}

// A context is position-specific: healthy/pending work must survive its change,
// while a failed attempt can use a fresh context without a new code fingerprint.
async function failedAcquisitionNewContext() {
  for (const installed of [false, true]) {
    for (const changeWhilePending of [false, true]) {
      const originalRpc = harness.rpc;
      const fingerprint = (value) => ({ entry: prefix + "createComponent", fingerprint: value });
      transport.packageBase64 = transport.basePackageBase64;
      const gate = deferred();
      if (!installed) transport.buildGate = gate;
      const shell = await mountShell({ irPackage: fingerprint("recovery-original") });
      let old = null;
      if (installed) {
        await shell.ready();
        old = states.at(-1);
        transport.buildGate = gate;
        await shell.update({ irPackage: fingerprint("recovery-changed") });
      }
      await until(() => transport.buildGate === null, "failed acquisition is pending");
      const builds = transport.builds;
      const changeContext = async () => {
        harness.rpc = { call: (...args) => originalRpc.call(...args) };
        await shell.update({ pos: { uri: "file:///ShellLifetime.lean", line: 3, character: 1 } });
      };
      if (changeWhilePending) {
        await changeContext();
        await tick();
        check(transport.builds === builds, "new context does not cancel or duplicate pending work");
      }
      await React.act(async () => gate.reject(new Error("recovery transport sentinel")));
      if (!changeWhilePending) {
        await until(() => shell.container.querySelector('[data-vir-infoview-state="error"]'),
          "failed acquisition status");
        await shell.update({ setupHint: "same context after failure" });
        await tick();
        check(transport.builds === builds, "failure does not retry without a new context");
        await changeContext();
      }
      await shell.ready();
      check(transport.builds === builds + 1, "fresh context recovers failed attempt exactly once");
      const recovered = states.at(-1);
      if (old) check(recovered === old && old.cleanups === 0,
        "failed refresh recovery preserves the installed equal-byte component");
      await changeContext();
      await tick();
      check(transport.builds === builds + 1, "healthy recovery does not acquire on later context changes");
      await shell.unmount();
      recovered.captured = null;
      harness.rpc = originalRpc;
    }
  }

  const originalRpc = harness.rpc;
  const gate = deferred();
  transport.buildGate = gate;
  const shell = await mountShell();
  await until(() => transport.buildGate === null, "healthy initial acquisition pending");
  const builds = transport.builds;
  harness.rpc = { call: (...args) => originalRpc.call(...args) };
  await shell.update({ setupHint: "context changed during healthy load" });
  await React.act(async () => gate.resolve());
  await shell.ready();
  check(transport.builds === builds, "pending successful acquisition survives a context change");
  const state = states.at(-1);
  await shell.unmount();
  state.captured = null;
  harness.rpc = originalRpc;
}

async function failedConnectionDoesNotReconnectItself() {
  const originalRpc = harness.rpc;
  let contextReads = 0;
  let failedCalls = 0;
  // Model the upstream hook replacing a failed connection each time it runs.
  // Let a third request succeed so the negative control cannot loop forever.
  Object.defineProperty(harness, "rpc", {
    configurable: true,
    get() {
      contextReads++;
      return {
        call(method, params) {
          if (method.endsWith("buildIRPackage") && failedCalls++ < 2)
            throw new Error("connection unavailable sentinel");
          return originalRpc.call(method, params);
        },
      };
    },
  });
  let shell;
  try {
    shell = await mountShell({});
    await tick();
    check(contextReads === 1 && failedCalls === 1 &&
      shell.container.querySelector('[data-vir-infoview-state="error"]'),
      "loading-state renders do not manufacture replacement RPC contexts");
    await shell.update({ setupHint: "external context update" });
    await tick();
    check(contextReads === 2 && failedCalls === 2 &&
      shell.container.querySelector('[data-vir-infoview-state="error"]'),
      "another failed connection gets one attempt per external update");
  } finally {
    await shell?.unmount();
    Object.defineProperty(harness, "rpc", { configurable: true, writable: true, value: originalRpc });
  }
}

async function failedRefreshThenConfigurationChange() {
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("configuration-failure-initial") });
  await shell.ready();
  const old = states.at(-1);
  transport.packageBase64 = transport.manifestPackageBase64;
  runtimeFault = { invalidComponent: true };
  await shell.update({ irPackage: packageDescription("configuration-failure") });
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="error"]'),
    "refresh failure before configuration change",
  );
  const failed = states.at(-1);
  check(failed !== old && failed.disposed === 1,
    "failed refresh candidate hard-disposed once");
  const builds = transport.builds;
  await shell.update({ wasmPath: "after-failed-refresh.wasm" });
  await shell.ready();
  const fresh = states.at(-1);
  check(
    transport.builds === builds + 1,
    "changed configuration starts exactly one acquisition after failed refresh",
  );
  check(
    old.cleanups === 1 && old.disposed === 0 &&
      failed.disposed === 1 && fresh.disposed === 0,
    "configuration replacement retains old runtime and disposes only the failed candidate",
  );
  old.captured.success(undefined);
  checkContinuation(old, "success", true);
  old.captured = null;
  failed.captured = null;
  fresh.captured = null;
  await shell.unmount();
  transport.packageBase64 = transport.basePackageBase64;
}

async function temporaryBuildFailure() {
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("temporary-failure-initial") });
  await shell.ready();
  const old = states.at(-1);
  transport.failNextBuild = true;
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("temporary-failure") });
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="error"]'),
    "temporary package acquisition failure",
  );
  check(
    states.at(-1) === old && old.cleanups === 0 && old.disposed === 0,
    "temporary acquisition failure preserves installed component",
  );
  const failedBuilds = transport.builds;
  await shell.update({ setupHint: "ordinary update while failed" });
  await tick();
  check(
    transport.builds === failedBuilds &&
      shell.container.querySelector('[data-vir-infoview-state="error"]') !== null,
    "unchanged fingerprint suppresses another build after temporary acquisition failure",
  );
  transport.packageBase64 = transport.basePackageBase64;
  await shell.update({ irPackage: packageDescription("temporary-recovery-same-bytes") });
  await until(
    () => shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "same bytes recover temporary failure",
  );
  check(states.at(-1) === old && old.cleanups === 0,
    "same bytes recover without replacing the installed component");
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("temporary-recovery-new-bytes") });
  await until(
    () => old.cleanups === 1 &&
      shell.container.querySelector('[data-vir-infoview-state="ready"]'),
    "source edit after temporary failure recovers",
  );
  const fresh = states.at(-1);
  check(fresh !== old && fresh.disposed === 0,
    "new revision installs after temporary failure");
  old.captured = null;
  fresh.captured = null;
  await shell.unmount();
  transport.packageBase64 = transport.basePackageBase64;
}

async function singlePendingRefresh() {
  transport.packageBase64 = transport.basePackageBase64;
  const shell = await mountShell({ irPackage: packageDescription("pending-initial") });
  await shell.ready();
  const old = states.at(-1);
  const builds = transport.builds;
  const gate = deferred();
  transport.buildGate = gate;
  transport.packageBase64 = transport.manifestPackageBase64;
  await shell.update({ irPackage: packageDescription("pending-refresh") });
  await until(() => transport.buildGate === null, "refresh build pending");
  for (let i = 0; i < 5; i++) await tick();
  check(
    transport.builds === builds + 1,
    "one fingerprint admits only one refresh while its package build is pending",
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
  transport.packageBase64 = transport.basePackageBase64;
}

async function obsoleteConfigurationCandidate() {
  const gate = deferred();
  const before = states.length;
  transport.buildGate = gate;
  const shell = await mountShell();
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
      harness.loadedRef.current?.service.runtime === current.runtime.deref(),
    "newer configuration remains published after older request completes; obsolete candidate is disposed once",
  );
  current.captured = null;
  obsolete.captured = null;
  await shell.unmount();
}

function installMockRpc(wasmBase64, packageBase64, manifestPackageBase64) {
  transport.basePackageBase64 = packageBase64;
  transport.packageBase64 = packageBase64;
  transport.manifestPackageBase64 = manifestPackageBase64;
  harness.rpc = {
    async call(method, params) {
      if (method.endsWith("statIRPackage")) {
        transport.stats++;
        throw new Error("statIRPackage is obsolete under fingerprint acquisition");
      }
      if (method.endsWith("buildIRPackage")) {
        transport.builds++;
        const revision = transport.revision;
        transport.buildRevisions.push(String(revision));
        transport.buildEntries.push(params.package.entry);
        if (transport.failNextBuild) {
          transport.failNextBuild = false;
          throw new Error("temporary package transport sentinel");
        }
        if (transport.buildGate) {
          const gate = transport.buildGate;
          transport.buildGate = null;
          await gate.promise;
        }
        return {
          entry: params.package.entry,
          fingerprint: params.package.fingerprint,
          dataBase64: transport.packageBase64,
        };
      }
      check(
        method.endsWith("statAsset") || method.endsWith("readAsset"),
        "only mocked shell transport methods expected",
      );
      transport.assetCalls++;
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
}

async function pendingCandidateAfterCommittedRemoval(wasmBase64, packageBase64) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installMockRpc(wasmBase64, packageBase64);
  const finishDiagnostics = observeDiagnostics();
  const gate = deferred();
  const timing = {
    loadReady: false,
    removalLayoutCleanups: 0,
    passiveCleanups: 0,
    passiveCleanupsAtHandoff: null,
    shellRemovedAtHandoff: false,
  };
  const before = states.length;
  let shell = null;
  let unmounted = false;
  harness.afterLoadRuntimeService = async (servicePromise) => {
    const service = await servicePromise;
    timing.loadReady = true;
    await gate.promise;
    timing.passiveCleanupsAtHandoff = timing.passiveCleanups;
    timing.shellRemovedAtHandoff =
      shell !== null &&
      shell.container.querySelector(".vir-infoview-widget-shell") === null;
    return service;
  };
  harness.widgetPassiveCleanup = () => {
    timing.passiveCleanups = (timing.passiveCleanups ?? 0) + 1;
  };
  try {
    shell = await mountShell({}, {
      onRemovalLayoutCleanup: () => {
        timing.removalLayoutCleanups++;
        gate.resolve();
      },
    });
    await until(() => timing.loadReady, "candidate load held at source await");
    // Keep the root alive and let React schedule this transition normally.
    // `act` would synchronously flush the passive cleanup we need to observe.
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    shell.removeTransition();
    await untilBare(
      () => timing.removalLayoutCleanups === 1,
      "shell removal layout cleanup committed",
    );
    await untilBare(
      () => timing.passiveCleanupsAtHandoff !== null,
      "candidate source await returned during shell removal",
    );
    check(
      timing.removalLayoutCleanups === 1 &&
        timing.shellRemovedAtHandoff &&
        timing.passiveCleanupsAtHandoff === 0,
      "candidate source await returns after committed removal and before passive cleanup",
    );
    check(states.length === before + 1, "one held candidate creates one runtime");
    const candidate = states.at(-1);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await shell.unmount();
    unmounted = true;
    return {
      timing,
      candidate: {
        disposed: candidate.disposed,
        factoryCalls: candidate.factoryCalls,
        cleanups: candidate.cleanups,
      },
      loaded: harness.loadedRef.current !== null,
    };
  } finally {
    harness.afterLoadRuntimeService = (service) => service;
    harness.widgetPassiveCleanup = () => {};
    if (shell !== null && !unmounted) {
      // The successful unmount above has already released this root; this is
      // only a failure-path attempt to keep the focused control isolated.
      try {
        await shell.unmount();
      } catch {}
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    finishDiagnostics();
  }
}

globalThis.runPendingCandidateAfterCommittedRemoval = pendingCandidateAfterCommittedRemoval;

globalThis.runShellLifetime = async (
  wasmBase64,
  packageBase64,
  manifestPackageBase64,
) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const finishDiagnostics = observeDiagnostics();
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
  installMockRpc(wasmBase64, packageBase64, manifestPackageBase64);
  try {
    await normalUnmount();
    await unchangedInputsNoAcquisition();
    await mountedRefresh();
    await applicationListenerRetention();
    await explicitShutdown();
    await normalUnmountFailure();
    await failedCandidates();
    await failedRefresh();
    await failedAcquisitionNewContext();
    await failedConnectionDoesNotReconnectItself();
    await failedRefreshThenConfigurationChange();
    await temporaryBuildFailure();
    await replacementCleanupFailure();
    await singlePendingRefresh();
    await obsoleteConfigurationCandidate();
    await obsoleteCandidateAndFingerprintUpdate();
    await tick();
    check(
      failures.every((failure) => failure.includes("normal cleanup sentinel")),
      "only the injected React cleanup error is observed when React forwards it",
    );
    return {
      ok: true,
      generations: states.length,
      normalUnmount: true,
      unchangedInputs: true,
      failedAcquisitionRecovery: true,
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
      obsoleteLoadAndFingerprintUpdate: true,
      unhandled: unhandled.length,
    };
  } finally {
    globalThis.setInterval = setIntervalOriginal;
    globalThis.clearInterval = clearIntervalOriginal;
    for (const id of intervals) clearIntervalOriginal(id);
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    finishDiagnostics();
  }
};
