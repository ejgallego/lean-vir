/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { registerHostResourcePayloadLifetime } from "../../web/src/host-resource.js";
import { createHostResourceState } from "../../web/src/host/vir-host-resources.js";
import { createBrowserReactHookRuntime } from "../../web/src/react/vir-react-hooks.js";

const resultKey = "__leanVirReactStrictModeSmoke";
const stateKey = "__leanVirReactStrictModeLifetimeState";
const cleanupKey = "__leanVirReactStrictModeLifetimeCleanup";
const liveResourceStates = [];

const lifetimeState = {
  strict: {
    renders: 0,
    setups: 0,
    cleanups: 0,
    payloads: lifetimeCounter(),
    setupCallbacks: lifetimeCounter(),
    cleanupCallbacks: lifetimeCounter(),
  },
  abandoned: {
    renders: 0,
    payloads: lifetimeCounter(),
  },
  lanes: {
    renders: [],
    initialPayloads: lifetimeCounter(),
    urgentPayloads: lifetimeCounter(),
    transitionPayloads: lifetimeCounter(),
  },
};
globalThis[stateKey] = lifetimeState;
globalThis[cleanupKey] = () => {
  const errors = [];
  for (const resources of liveResourceStates.splice(0)) {
    try {
      resources.dispose();
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "React lifetime smoke cleanup failed");
};
globalThis[resultKey] = runReactLifetimeSmoke().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  }),
);

async function runReactLifetimeSmoke() {
  return {
    strict: await runStrictModeEffectProbe(),
    lanes: await runInterleavedStateLaneProbe(),
    abandoned: await runAbandonedSuspenseProbe(),
  };
}

async function runStrictModeEffectProbe() {
  const state = lifetimeState.strict;
  const resources = createHostResourceState();
  const hooks = createBrowserReactHookRuntime(resources, React);
  const component = hooks.createComponentState();
  const container = document.createElement("div");
  container.id = "react-strict-mode-lifetime-smoke-root";
  document.body.append(container);
  const root = createRoot(container);
  let unmounted = false;
  let componentDisposed = false;
  let resourcesPreserved = false;

  function Probe() {
    state.renders++;
    return hooks.withComponentRender(component, () => {
      const payload = createPayloadLease(state.payloads, `Strict Mode render ${state.renders}`);
      const ref = hooks.useRef(payload);
      resources.releaseResource(ref);
      hooks.useEffect(
        createCallbackLease(state.setupCallbacks, () => {
          state.setups++;
          return null;
        }),
        createCallbackLease(state.cleanupCallbacks, () => {
          state.cleanups++;
        }),
      );
      hooks.commitComponentRender(component);
      return null;
    });
  }

  try {
    flushSync(() => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
    });
    await waitFor(() => state.setups === 2, "Strict Mode effect setup replay");
    flushSync(() => root.unmount());
    unmounted = true;
    await waitFor(() => state.cleanups === 2, "Strict Mode effect cleanup replay");
    hooks.disposeComponent(component);
    componentDisposed = true;
    liveResourceStates.push(resources);
    resourcesPreserved = true;
    return {
      renders: state.renders,
      setups: state.setups,
      cleanups: state.cleanups,
    };
  } finally {
    if (!unmounted) flushSync(() => root.unmount());
    if (!componentDisposed) hooks.disposeComponent(component);
    if (!resourcesPreserved) resources.dispose();
    container.remove();
  }
}

async function runAbandonedSuspenseProbe() {
  const state = lifetimeState.abandoned;
  const resources = createHostResourceState();
  const hooks = createBrowserReactHookRuntime(resources, React);
  const component = hooks.createComponentState();
  const container = document.createElement("div");
  container.id = "react-suspense-lifetime-smoke-root";
  document.body.append(container);
  const root = createRoot(container);
  const neverSettles = new Promise(() => undefined);
  let unmounted = false;
  let componentDisposed = false;
  let resourcesPreserved = false;

  function SuspendedProbe() {
    state.renders++;
    return hooks.withComponentRender(component, () => {
      const payload = createPayloadLease(state.payloads, `suspended render ${state.renders}`);
      const ref = hooks.useRef(payload);
      resources.releaseResource(ref);
      hooks.commitComponentRender(component);
      throw neverSettles;
    });
  }

  try {
    flushSync(() => {
      root.render(React.createElement(
        React.Suspense,
        { fallback: React.createElement("div", { id: "react-suspense-fallback" }, "waiting") },
        React.createElement(SuspendedProbe),
      ));
    });
    requireState(
      container.querySelector("#react-suspense-fallback") !== null,
      "the suspended render must commit its fallback",
      state,
    );
    flushSync(() => {
      root.render(React.createElement("div", { id: "react-suspense-replacement" }, "replacement"));
    });
    requireState(
      container.querySelector("#react-suspense-replacement") !== null,
      "the replacement must retire the suspended render",
      state,
    );
    flushSync(() => root.unmount());
    unmounted = true;
    hooks.disposeComponent(component);
    componentDisposed = true;
    liveResourceStates.push(resources);
    resourcesPreserved = true;
    return { renders: state.renders };
  } finally {
    if (!unmounted) flushSync(() => root.unmount());
    if (!componentDisposed) hooks.disposeComponent(component);
    if (!resourcesPreserved) resources.dispose();
    container.remove();
  }
}

async function runInterleavedStateLaneProbe() {
  const state = lifetimeState.lanes;
  const resources = createHostResourceState();
  const hooks = createBrowserReactHookRuntime(resources, React);
  const component = hooks.createComponentState();
  const container = document.createElement("div");
  container.id = "react-state-lane-lifetime-smoke-root";
  document.body.append(container);
  const root = createRoot(container);
  let setter = null;
  let renderNumber = 0;
  let unmounted = false;
  let componentDisposed = false;
  let resourcesPreserved = false;

  function Probe() {
    renderNumber++;
    return hooks.withComponentRender(component, () => {
      const initial = createAliasedPayloadLease(state.initialPayloads, `lane initial ${renderNumber}`);
      const result = hooks.useState(initial);
      setter ??= result.setter;
      state.renders.push(result.value.label);
      hooks.commitComponentRender(component);
      return React.createElement("div", { id: "react-state-lane-value" }, result.value.label);
    });
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    requireState(setter !== null, "the initial state render must expose its setter", state);

    const urgent = createAliasedPayloadLease(state.urgentPayloads, "urgent");
    const transition = createAliasedPayloadLease(state.transitionPayloads, "transition");
    flushSync(() => {
      setter.set(urgent);
      React.startTransition(() => setter.set(transition));
    });
    requireState(state.renders.includes("urgent"), "the urgent state update must commit", state);
    requireState(
      state.transitionPayloads.active > 0,
      "an urgent commit must preserve the still-queued transition payload",
      state,
    );
    await waitFor(
      () => container.querySelector("#react-state-lane-value")?.textContent === "transition",
      "transition state commit",
      state,
    );

    flushSync(() => root.unmount());
    unmounted = true;
    hooks.disposeComponent(component);
    componentDisposed = true;
    requireState(state.initialPayloads.active === 0, "lane initial payloads must be released", state);
    requireState(state.urgentPayloads.active === 0, "lane urgent payloads must be released", state);
    requireState(state.transitionPayloads.active === 0, "lane transition payloads must be released", state);
    liveResourceStates.push(resources);
    resourcesPreserved = true;
    return { renders: state.renders.slice() };
  } finally {
    if (!unmounted) flushSync(() => root.unmount());
    if (!componentDisposed) hooks.disposeComponent(component);
    if (!resourcesPreserved) resources.dispose();
    container.remove();
  }
}

function createPayloadLease(counter, label) {
  const payload = { kind: "browser React lifetime payload", label };
  let leases = 1;
  counter.created++;
  counter.active++;
  registerHostResourcePayloadLifetime(payload, {
    retain() {
      if (leases === 0) throw new Error(`cannot retain released payload: ${label}`);
      leases++;
      counter.created++;
      counter.active++;
      return payload;
    },
    release() {
      if (leases === 0) return false;
      leases--;
      counter.active--;
      counter.releases++;
      return true;
    },
  });
  return payload;
}

function createAliasedPayloadLease(counter, label) {
  const cell = { live: true, aliases: new Set() };
  const createAlias = () => {
    if (!cell.live) throw new Error(`cannot retain released payload: ${label}`);
    let live = true;
    const alias = { kind: "browser React aliased lifetime payload", label };
    cell.aliases.add(alias);
    counter.created++;
    counter.active++;
    registerHostResourcePayloadLifetime(alias, {
      retain() {
        if (!live || !cell.live) throw new Error(`cannot retain released payload alias: ${label}`);
        return createAlias();
      },
      release() {
        if (!live) return false;
        live = false;
        cell.aliases.delete(alias);
        if (cell.aliases.size === 0) cell.live = false;
        counter.active--;
        counter.releases++;
        return true;
      },
    });
    return alias;
  };
  return createAlias();
}

function createCallbackLease(counter, invoke) {
  let released = false;
  const callback = Object.assign((...args) => {
    if (released) throw new Error("React lifetime callback lease has been released");
    return invoke(...args);
  }, {
    retain() {
      if (released) throw new Error("cannot retain a released React lifetime callback");
      return createCallbackLease(counter, invoke);
    },
    release() {
      if (released) return false;
      released = true;
      counter.active--;
      counter.releases++;
      return true;
    },
  });
  counter.created++;
  counter.active++;
  return callback;
}

function lifetimeCounter() {
  return { created: 0, active: 0, releases: 0 };
}

async function waitFor(ready, label, details = lifetimeState.strict) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`${label} did not complete: ${JSON.stringify(details)}`);
}

function requireState(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}
