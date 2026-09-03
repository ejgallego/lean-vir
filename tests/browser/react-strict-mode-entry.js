/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { createBrowserReactHookBindings } from "../../web/src/react/vir-react-hooks.js";
import { createBrowserLeanComponentNode } from "../../web/src/react/vir-react-node.js";
import { createHostLifecycle } from "../../web/src/host/vir-active-host-bindings.js";
import { createReactRootHostBindings } from "../../web/src/react/vir-react-root.js";

const resultKey = "__leanVirReactStrictModeSmoke";

globalThis[resultKey] = runReactSmoke().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  }),
);

async function runReactSmoke() {
  return {
    strict: await runStrictModeEffectProbe(),
    lanes: await runInterleavedStateLaneProbe(),
    reducer: await runReducerIdentityProbe(),
    memo: await runMemoIdentityProbe(),
    component: await runRepeatedComponentSubmissionProbe(),
    nestedComponent: await runNestedComponentIdentityProbe(),
    abandoned: await runAbandonedSuspenseProbe(),
  };
}

async function runNestedComponentIdentityProbe() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const state = { mounts: 0, cleanups: 0 };
  let setter = null;
  const component = ({ leanProps: { label } }) => {
    const [count, setCount] = React.useState(0);
    setter = setCount;
    React.useEffect(() => {
      state.mounts++;
      return () => state.cleanups++;
    }, []);
    return React.createElement("div", null, `${label}:${count}`);
  };
  const replacement = ({ leanProps }) => component({ leanProps });

  try {
    flushSync(() =>
      root.render(
        createBrowserLeanComponentNode(
          React.createElement,
          component,
          { label: "first" },
          "stable",
        ),
      ),
    );
    flushSync(() => setter(1));
    flushSync(() =>
      root.render(
        createBrowserLeanComponentNode(
          React.createElement,
          component,
          { label: "second" },
          "stable",
        ),
      ),
    );
    requireState(
      container.textContent === "second:1" &&
        state.mounts === 1 &&
        state.cleanups === 0,
      "the same nested component function and key must preserve hook state",
    );
    flushSync(() =>
      root.render(
        createBrowserLeanComponentNode(
          React.createElement,
          replacement,
          { label: "replacement" },
          "stable",
        ),
      ),
    );
    requireState(
      container.textContent === "replacement:0" &&
        state.mounts === 2 &&
        state.cleanups === 1,
      "changing the nested component function must remount it",
    );
    return { ...state, text: container.textContent };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

async function runRepeatedComponentSubmissionProbe() {
  const lifecycle = createHostLifecycle();
  const container = document.createElement("div");
  document.body.append(container);
  const bindings = createReactRootHostBindings(lifecycle, createRoot, {
    createLeanComponentNode: (component, props, key) =>
      createBrowserLeanComponentNode(
        React.createElement,
        component,
        props,
        key,
      ),
  });
  let root = bindings["react.root.create"](container);
  const state = { mounts: 0, cleanups: 0 };
  let setter = null;

  const component = ({ leanProps: { label } }) => {
    const [count, setCount] = React.useState(0);
    setter = setCount;
    React.useEffect(() => {
      state.mounts++;
      return () => state.cleanups++;
    }, []);
    return React.createElement("div", null, `${label}:${count}`);
  };
  const replacement = ({ leanProps }) => component({ leanProps });

  function render(valueComponent, props) {
    const node = bindings["react.node.component"](valueComponent, props);
    bindings["react.root.renderNode"](root, node);
  }

  try {
    flushSync(() => render(component, { label: "first" }));
    flushSync(() => setter(1));
    flushSync(() => render(component, { label: "second" }));
    requireState(
      container.textContent === "second:1",
      "the same component function must preserve hook state",
    );
    requireState(
      state.mounts === 1 && state.cleanups === 0,
      "an exact component-function update must not remount",
    );

    flushSync(() => render(replacement, { label: "replacement" }));
    requireState(
      container.textContent === "replacement:0" &&
        state.mounts === 2 &&
        state.cleanups === 1,
      "changing the component function must remount the component",
    );
    return { ...state, text: container.textContent };
  } finally {
    flushSync(() => bindings["react.root.unmount"](root));
    lifecycle.dispose();
    container.remove();
  }
}

async function runStrictModeEffectProbe() {
  const bindings = createBrowserReactHookBindings(React);
  const state = { renders: 0, setups: 0, cleanups: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Probe() {
    state.renders++;
    bindings["react.useEffect"](() => {
      state.setups++;
      const token = { setup: state.setups };
      return () => {
        if (token.setup === undefined)
          throw new Error("effect cleanup lost its exact setup closure");
        state.cleanups++;
      };
    });
    return null;
  }

  try {
    flushSync(() => {
      root.render(
        React.createElement(React.StrictMode, null, React.createElement(Probe)),
      );
    });
    await waitFor(
      () => state.setups === 2,
      "Strict Mode effect setup replay",
      state,
    );
    flushSync(() => root.unmount());
    await waitFor(
      () => state.cleanups === 2,
      "Strict Mode effect cleanup replay",
      state,
    );
    return state;
  } finally {
    container.remove();
  }
}

async function runReducerIdentityProbe() {
  const bindings = createBrowserReactHookBindings(React);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const initial = { label: "initial" };
  const action = { label: "action" };
  const calls = [];
  let dispatch = null;

  function reducer(state, nextAction) {
    calls.push({ state, action: nextAction });
    return nextAction;
  }

  function Probe() {
    const result = bindings["react.useReducer"](reducer, initial);
    if (!Array.isArray(result))
      throw new Error("useReducer must return React's array pair");
    dispatch ??= result[1];
    return React.createElement(
      "div",
      { id: "react-reducer-value" },
      result[0].label,
    );
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    flushSync(() => dispatch(action));
    requireState(calls.length >= 1, "React must invoke the supplied reducer");
    requireState(
      calls[0].state === initial,
      "the reducer must receive the exact state value",
    );
    requireState(
      calls[0].action === action,
      "the reducer must receive the exact action value",
    );
    requireState(
      container.textContent === action.label,
      "React must store the reducer result",
    );
    return { calls: calls.length, exact: true };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

async function runInterleavedStateLaneProbe() {
  const bindings = createBrowserReactHookBindings(React);
  const state = { renders: [] };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const initial = { label: "initial" };
  const urgent = { label: "urgent" };
  const transition = { label: "transition" };
  let setter = null;

  function Probe() {
    const result = bindings["react.useState"](initial);
    if (!Array.isArray(result))
      throw new Error("useState must return React's array pair");
    setter ??= result[1];
    state.renders.push(result[0].label);
    return React.createElement(
      "div",
      { id: "react-state-lane-value" },
      result[0].label,
    );
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    flushSync(() => {
      setter(urgent);
      React.startTransition(() => setter(transition));
    });
    await waitFor(
      () =>
        container.querySelector("#react-state-lane-value")?.textContent ===
        "transition",
      "transition state commit",
      state,
    );
    return {
      renders: state.renders,
      initialExact: state.renders[0] === initial.label,
      finalExact: container.textContent === transition.label,
    };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

async function runMemoIdentityProbe() {
  const bindings = createBrowserReactHookBindings(React);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const singleton = { exact: true };
  const dependencies = [];
  const seen = [];

  function Probe({ dependency }) {
    const value = bindings["react.useMemo"](() => singleton, dependency);
    seen.push(value);
    return null;
  }

  try {
    flushSync(() =>
      root.render(React.createElement(Probe, { dependency: dependencies })),
    );
    flushSync(() =>
      root.render(React.createElement(Probe, { dependency: [1] })),
    );
    return {
      exactDependencies: dependencies.length === 0,
      exactResult: seen.every((value) => value === singleton),
      renders: seen.length,
    };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

async function runAbandonedSuspenseProbe() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const neverSettles = new Promise(() => undefined);
  let renders = 0;

  function SuspendedProbe() {
    renders++;
    throw neverSettles;
  }

  try {
    flushSync(() => {
      root.render(
        React.createElement(
          React.Suspense,
          {
            fallback: React.createElement(
              "div",
              { id: "react-suspense-fallback" },
              "waiting",
            ),
          },
          React.createElement(SuspendedProbe),
        ),
      );
    });
    if (container.querySelector("#react-suspense-fallback") === null) {
      throw new Error("the suspended render must commit its fallback");
    }
    flushSync(() => {
      root.render(
        React.createElement(
          "div",
          { id: "react-suspense-replacement" },
          "replacement",
        ),
      );
    });
    return { renders, replaced: container.textContent === "replacement" };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

async function waitFor(ready, label, details) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`${label} did not complete: ${JSON.stringify(details)}`);
}

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}
