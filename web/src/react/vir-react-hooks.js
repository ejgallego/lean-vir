/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createBrowserReactHookBindings(React) {
  return {
    "react.useState": (initial) => {
      return requireReactHook(React, "useState")(initial);
    },
    "react.stateTuple.value": (state) =>
      requireReactPair(state, "React.useState result")[0],
    "react.stateTuple.setter": (state) =>
      requireReactPair(state, "React.useState result")[1],
    "react.useReducer": (reducer, initial) => {
      return requireReactHook(React, "useReducer")(
        requireFunction(reducer, "React reducer"),
        initial,
      );
    },
    "react.reducerTuple.value": (state) =>
      requireReactPair(state, "React.useReducer result")[0],
    "react.reducerTuple.dispatch": (state) =>
      requireReactPair(state, "React.useReducer result")[1],
    "react.useRef": (initial) => {
      return requireReactHook(React, "useRef")(initial);
    },
    "react.useMemo": (calculate, deps) => {
      return requireReactHook(React, "useMemo")(
        requireFunction(calculate, "React memo calculation"),
        requireDependencyList(deps),
      );
    },
    "react.useCallback": (callback, deps) => {
      return requireReactHook(React, "useCallback")(
        requireFunction(callback, "React callback"),
        requireDependencyList(deps),
      );
    },
    "react.useContext": (context) => {
      return requireReactHook(
        React,
        "useContext",
      )(requireObject(context, "React context"));
    },
    "react.useEffect": (setup) => {
      const effect = requireFunction(setup, "React effect setup");
      requireReactHook(React, "useEffect")(effect);
      return undefined;
    },
    "react.useEffectWithDeps": (setup, deps) => {
      requireReactHook(React, "useEffect")(
        requireFunction(setup, "React effect setup"),
        requireDependencyList(deps),
      );
      return undefined;
    },
    "react.deps.empty": () => [],
    "react.deps.push": (deps, value) => {
      requireDependencyList(deps).push(value);
      return undefined;
    },
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
      )(requireFunction(update, "React state updater"));
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
    "js.value.react.effectCallback": (effect) => {
      const descriptor = requireObject(effect, "Lean React effect");
      const runSetup = requireFunction(descriptor.setup, "React effect setup");
      const runCleanup = requireFunction(
        descriptor.cleanup,
        "React effect cleanup",
      );
      return () => {
        const value = runSetup();
        return () => runCleanup(value);
      };
    },
    "js.value.react.component": (render) => {
      const runRender = requireFunction(render, "Lean component render");
      return function LeanComponent(props) {
        return runRender(requireLeanComponentProps(props));
      };
    },
  };
}

function requireLeanComponentProps(props) {
  if (props === null || typeof props !== "object" || !("leanProps" in props)) {
    throw new Error("Lean component props must contain leanProps");
  }
  return props.leanProps;
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
