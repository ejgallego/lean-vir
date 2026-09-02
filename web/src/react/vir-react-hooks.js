/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createBrowserReactHookRuntime(React) {
  return {
    useState(initial) {
      return requireReactHook(React, "useState")(initial);
    },

    useReducer(reducer, initial) {
      if (typeof reducer !== "function") {
        throw new Error("React reducer must be a JavaScript function");
      }
      return requireReactHook(React, "useReducer")(reducer, initial);
    },

    useRef(initial) {
      return requireReactHook(React, "useRef")(initial);
    },

    useMemo(calculate, deps) {
      if (typeof calculate !== "function") {
        throw new Error("React memo calculation must be a JavaScript function");
      }
      return requireReactHook(React, "useMemo")(
        calculate,
        requireDependencyList(deps),
      );
    },

    useEffect(setup, cleanup) {
      return useReactEffect(React, setup, cleanup);
    },

    useEffectWithDeps(deps, setup, cleanup) {
      return useReactEffect(React, setup, cleanup, requireDependencyList(deps));
    },
  };
}

export function createReactStateHostBindings(hookRuntime) {
  return {
    "react.useState": (initial) => hookRuntime.useState(initial),
    "react.state.value": (state) => requireReactPair(state, "ReactState")[0],
    "react.state.setter": (state) => requireReactPair(state, "ReactState")[1],
    "react.useReducer": (reducer, initial) =>
      hookRuntime.useReducer(reducer, initial),
    "react.reducerState.value": (state) =>
      requireReactPair(state, "ReactReducerState")[0],
    "react.reducerState.dispatch": (state) =>
      requireReactPair(state, "ReactReducerState")[1],
    "react.useRef": (initial) => hookRuntime.useRef(initial),
    "react.useMemo": (calculate, deps) => hookRuntime.useMemo(calculate, deps),
    "react.useEffect": (setup, cleanup) =>
      hookRuntime.useEffect(setup, cleanup),
    "react.deps.empty": () => [],
    "react.deps.push": (deps, value) => {
      requireDependencyList(deps).push(value);
      return undefined;
    },
    "react.useEffectWithDeps": (deps, setup, cleanup) =>
      hookRuntime.useEffectWithDeps(deps, setup, cleanup),
    "react.ref.get": (ref) => requireObject(ref, "ReactRef").current,
    "react.ref.set": (ref, value) => {
      requireObject(ref, "ReactRef").current = value;
      return undefined;
    },
    "react.state.set": (setter, value) => {
      requireFunction(setter, "ReactStateSetter")(value);
      return undefined;
    },
    "react.state.modify": (setter, update) => {
      requireFunction(
        setter,
        "ReactStateSetter",
      )((previous) => requireFunction(update, "React state updater")(previous));
      return undefined;
    },
    "react.reducer.dispatch": (dispatch, action) => {
      requireFunction(dispatch, "ReactReducerDispatch")(action);
      return undefined;
    },
  };
}

export function createReactJsValueHostBindings() {
  return {
    "js.value.react.property": (value) => value,
    "js.value.react.eventHandler": (value) => {
      const eventHandler = requireObject(value, "React event handler");
      requireFunction(eventHandler.callback, "React event handler callback");
      return eventHandler;
    },
  };
}

function useReactEffect(React, setup, cleanup, deps = undefined) {
  const runSetup = requireFunction(setup, "React effect setup");
  const runCleanup = requireFunction(cleanup, "React effect cleanup");
  const effect = () => {
    const value = runSetup();
    return () => runCleanup(value);
  };
  if (deps === undefined) {
    requireReactHook(React, "useEffect")(effect);
  } else {
    requireReactHook(React, "useEffect")(effect, deps);
  }
  return undefined;
}

function requireReactHook(React, name) {
  const hook = React?.[name];
  if (typeof hook !== "function") {
    throw new Error(`React.${name} is not available`);
  }
  return hook;
}

function requireDependencyList(value) {
  if (!Array.isArray(value)) {
    throw new Error("React dependency list must be a JavaScript Array");
  }
  return value;
}

function requireReactPair(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} must be a JavaScript pair`);
  }
  return value;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label} must be a JavaScript object`);
  }
  return value;
}

function requireFunction(value, label) {
  if (typeof value !== "function") {
    throw new Error(`${label} must be a JavaScript function`);
  }
  return value;
}
