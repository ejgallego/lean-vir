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

    useCallback(callback, deps) {
      return requireReactHook(React, "useCallback")(
        requireFunction(callback, "React callback"),
        requireDependencyList(deps),
      );
    },

    useContext(context) {
      return requireReactHook(React, "useContext")(
        requireObject(context, "React context"),
      );
    },

    useEffect(setup, deps = undefined) {
      const effect = requireFunction(setup, "React effect setup");
      if (deps === undefined) {
        requireReactHook(React, "useEffect")(effect);
      } else {
        requireReactHook(React, "useEffect")(
          effect,
          requireDependencyList(deps),
        );
      }
      return undefined;
    },

    useLeanEffect(setup, cleanup, deps = undefined) {
      return useReactEffect(React, setup, cleanup, deps);
    },
  };
}

export function createReactStateHostBindings(hookRuntime) {
  return {
    "react.useState": (initial) => hookRuntime.useState(initial),
    "react.stateTuple.value": (state) =>
      requireReactPair(state, "React.useState result")[0],
    "react.stateTuple.setter": (state) =>
      requireReactPair(state, "React.useState result")[1],
    "react.useReducer": (reducer, initial) =>
      hookRuntime.useReducer(reducer, initial),
    "react.reducerTuple.value": (state) =>
      requireReactPair(state, "React.useReducer result")[0],
    "react.reducerTuple.dispatch": (state) =>
      requireReactPair(state, "React.useReducer result")[1],
    "react.useRef": (initial) => hookRuntime.useRef(initial),
    "react.useMemo": (calculate, deps) => hookRuntime.useMemo(calculate, deps),
    "react.useCallback": (callback, deps) =>
      hookRuntime.useCallback(callback, deps),
    "react.useContext": (context) => hookRuntime.useContext(context),
    "react.useEffect": (setup) => hookRuntime.useEffect(setup),
    "react.useLeanEffect": (setup, cleanup) =>
      hookRuntime.useLeanEffect(setup, cleanup),
    "react.deps.empty": () => [],
    "react.deps.push": (deps, value) => {
      requireDependencyList(deps).push(value);
      return undefined;
    },
    "react.useEffectWithDeps": (setup, deps) =>
      hookRuntime.useEffect(setup, deps),
    "react.useLeanEffectWithDeps": (deps, setup, cleanup) =>
      hookRuntime.useLeanEffect(setup, cleanup, requireDependencyList(deps)),
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
      requireFunction(setter, "ReactStateSetter")(
        requireFunction(update, "React state updater"),
      );
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
    "js.value.react.reducer": (reducer) =>
      requireFunction(reducer, "React reducer"),
    "js.value.react.memoCalculation": (calculate) =>
      requireFunction(calculate, "React memo calculation"),
    "js.value.react.callback": (callback) =>
      requireFunction(callback, "React callback"),
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
    requireReactHook(React, "useEffect")(effect, requireDependencyList(deps));
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
