/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { isHostResource } from "../host-resource.js";
import { createJsValueHostBindings } from "../host/vir-js-value-bindings.js";

export function createBrowserReactHookRuntime(resources, React) {
  const setters = new WeakMap();
  let currentComponent = null;
  return {
    createComponentState() {
      return { hookIndex: 0, hooks: [], pendingReducers: [], refs: new Set(), setters: new Set() };
    },
    withComponentRender(componentState, render) {
      const previous = currentComponent;
      currentComponent = componentState;
      componentState.hookIndex = 0;
      componentState.pendingReducers.length = 0;
      try {
        return render();
      } finally {
        currentComponent = previous;
      }
    },
    disposeComponent(componentState) {
      for (const hook of componentState?.hooks ?? []) {
        if (hook?.kind === "reducer") {
          disposeReducerHook(resources, hook);
        }
      }
      for (const ref of componentState?.refs ?? []) {
        resources.releaseValueResource(ref);
      }
      for (const setter of componentState?.setters ?? []) {
        resources.releaseValueResource(setter);
      }
      if (Array.isArray(componentState?.hooks)) {
        componentState.hooks.length = 0;
      }
      if (Array.isArray(componentState?.pendingReducers)) {
        componentState.pendingReducers.length = 0;
      }
      componentState?.refs?.clear();
      componentState?.setters?.clear();
    },
    cancelComponentRender(componentState) {
      releasePendingReducerCallbacks(componentState);
    },
    commitComponentRender(componentState) {
      commitPendingReducerCallbacks(componentState);
    },
    useState(initial) {
      if (typeof React?.useState !== "function") {
        throw new Error("React.useState is not available");
      }
      nextBrowserHook(currentComponent, "state", "useState");
      const [value, setState] = React.useState(initial);
      const setter = stateSetterFor(setters, setState);
      currentComponent?.setters?.add(setter);
      return stateResult(resources, value, setter);
    },
    useReducer(reducer, initial) {
      if (typeof React?.useReducer !== "function") {
        releaseLeanCallback(reducer);
        throw new Error("React.useReducer is not available");
      }
      let hook;
      try {
        hook = nextBrowserHook(currentComponent, "reducer", "useReducer", () => createBrowserReducerHook(resources));
        stagePendingReducerCallback(currentComponent, hook, reducer);
      } catch (error) {
        releaseLeanCallback(reducer);
        throw error;
      }
      let rendered = false;
      try {
        const [value, dispatch] = React.useReducer(hook.reducerProxy, initial);
        hook.dispatchTarget = dispatch;
        rendered = true;
        return reducerStateResult(resources, value, hook.dispatcher);
      } finally {
        if (!rendered) {
          releasePendingReducerHook(hook);
        }
      }
    },
    useRef(initial) {
      if (typeof React?.useRef !== "function") {
        throw new Error("React.useRef is not available");
      }
      nextBrowserHook(currentComponent, "ref", "useRef");
      const ref = React.useRef(initial);
      currentComponent?.refs?.add(ref);
      return resources.resourceForValue(ref);
    },
    useEffect(setup, cleanup) {
      if (typeof React?.useEffect !== "function") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffect is not available");
      }
      try {
        nextBrowserHook(currentComponent, "effect", "useEffect");
      } catch (error) {
        releaseEffectCallbacks(setup, cleanup);
        throw error;
      }
      let registered = false;
      try {
        React.useEffect(createBrowserEffect(setup, cleanup));
        registered = true;
      } finally {
        if (!registered) {
          releaseEffectCallbacks(setup, cleanup);
        }
      }
      return undefined;
    },
    useEffectWithDeps(deps, setup, cleanup) {
      if (typeof React?.useEffect !== "function" || typeof React?.useRef !== "function") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffectWithDeps requires React.useEffect and React.useRef");
      }
      try {
        nextBrowserHook(currentComponent, "effect", "useEffectWithDeps");
      } catch (error) {
        releaseEffectCallbacks(setup, cleanup);
        throw error;
      }
      const dependencyList = normalizeDependencyListOrRelease(resources, deps, setup, cleanup);
      const ref = React.useRef({ initialized: false, deps: null });
      const changed = !ref.current.initialized || !dependencyListsEqual(ref.current.deps, dependencyList);
      const effect = changed ? createBrowserEffect(setup, cleanup) : () => undefined;
      if (changed) {
        ref.current.initialized = true;
        ref.current.deps = dependencyList.slice();
      } else {
        releaseEffectCallbacks(setup, cleanup);
      }
      let registered = false;
      try {
        React.useEffect(effect, dependencyList);
        registered = true;
      } finally {
        if (!registered && changed) {
          releaseEffectCallbacks(setup, cleanup);
        }
      }
      return undefined;
    },
  };
}

export function createVirtualReactHookRuntime(resources) {
  let currentComponent = null;
  return {
    createComponentState(scheduleRender) {
      return {
        hookIndex: 0,
        hooks: [],
        pendingEffects: [],
        pendingReducers: [],
        scheduleRender,
      };
    },
    withComponentRender(componentState, render) {
      const previous = currentComponent;
      currentComponent = componentState;
      componentState.hookIndex = 0;
      componentState.pendingReducers.length = 0;
      try {
        return render();
      } finally {
        currentComponent = previous;
      }
    },
    disposeComponent(componentState) {
      for (const hook of componentState?.hooks ?? []) {
        if (hook?.kind === "state") {
          resources.releaseValueResource(hook.setter);
        } else if (hook?.kind === "reducer") {
          disposeReducerHook(resources, hook);
        } else if (hook?.kind === "ref") {
          resources.releaseValueResource(hook.ref);
        } else if (hook?.kind === "effect") {
          disposeVirtualEffectHook(hook);
        }
      }
      if (Array.isArray(componentState?.hooks)) {
        componentState.hooks.length = 0;
      }
      if (Array.isArray(componentState?.pendingEffects)) {
        componentState.pendingEffects.length = 0;
      }
      if (Array.isArray(componentState?.pendingReducers)) {
        componentState.pendingReducers.length = 0;
      }
    },
    cancelComponentRender(componentState) {
      releasePendingReducerCallbacks(componentState);
      for (const hook of componentState?.pendingEffects ?? []) {
        releasePendingEffectCallbacks(hook);
      }
      if (Array.isArray(componentState?.pendingEffects)) {
        componentState.pendingEffects.length = 0;
      }
    },
    commitComponentRender(componentState) {
      commitPendingReducerCallbacks(componentState);
      const effects = componentState?.pendingEffects?.splice(0) ?? [];
      for (let index = 0; index < effects.length; index++) {
        try {
          runVirtualEffectHook(effects[index]);
        } catch (error) {
          for (const hook of effects.slice(index + 1)) {
            releasePendingEffectCallbacks(hook);
          }
          throw error;
        }
      }
    },
    useState(initial) {
      if (currentComponent === null) {
        throw new Error("React.useState can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualStateHook(initial, currentComponent.scheduleRender);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "state") {
        throw new Error("React hook order changed: expected useState");
      }
      return stateResult(resources, hook.value, hook.setter);
    },
    useReducer(reducer, initial) {
      if (currentComponent === null) {
        releaseLeanCallback(reducer);
        throw new Error("React.useReducer can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualReducerHook(resources, initial, currentComponent.scheduleRender);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "reducer") {
        releaseLeanCallback(reducer);
        throw new Error("React hook order changed: expected useReducer");
      }
      stagePendingReducerCallback(currentComponent, hook, reducer);
      return reducerStateResult(resources, hook.value, hook.dispatcher);
    },
    useRef(initial) {
      if (currentComponent === null) {
        throw new Error("React.useRef can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualRefHook(initial);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "ref") {
        throw new Error("React hook order changed: expected useRef");
      }
      return resources.resourceForValue(hook.ref);
    },
    useEffect(setup, cleanup) {
      if (currentComponent === null) {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffect can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualEffectHook();
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "effect") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React hook order changed: expected useEffect");
      }
      releasePendingEffectCallbacks(hook);
      hook.nextSetup = setup;
      hook.nextCleanup = cleanup;
      currentComponent.pendingEffects.push(hook);
      return undefined;
    },
    useEffectWithDeps(deps, setup, cleanup) {
      if (currentComponent === null) {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffectWithDeps can only be called while rendering a component");
      }
      const dependencyList = normalizeDependencyListOrRelease(resources, deps, setup, cleanup);
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualEffectHook();
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "effect") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React hook order changed: expected useEffectWithDeps");
      }
      if (hook.dependencyList !== null && dependencyListsEqual(hook.dependencyList, dependencyList)) {
        releaseEffectCallbacks(setup, cleanup);
        return undefined;
      }
      releasePendingEffectCallbacks(hook);
      hook.nextDependencyList = dependencyList;
      hook.nextSetup = setup;
      hook.nextCleanup = cleanup;
      currentComponent.pendingEffects.push(hook);
      return undefined;
    },
  };
}

export function createReactStateHostBindings(resources, hookRuntime) {
  return {
    "react.useState": (initial) => resources.resourceForValue(hookRuntime.useState(reactStatePayload(resources, initial))),
    "react.state.value": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactState").value),
    "react.state.setter": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactState").setter),
    "react.useReducer": (reducer, initial) =>
      resources.resourceForValue(hookRuntime.useReducer(reducer, reactStatePayload(resources, initial))),
    "react.reducerState.value": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactReducerState").value),
    "react.reducerState.dispatch": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactReducerState").dispatch),
    "react.useRef": (initial) => hookRuntime.useRef(reactStatePayload(resources, initial)),
    "react.useEffect": (setup, cleanup) => hookRuntime.useEffect(setup, cleanup),
    "react.useEffectWithDeps": (deps, setup, cleanup) => hookRuntime.useEffectWithDeps(deps, setup, cleanup),
    "react.ref.get": (ref) => resources.resourceForValue(resources.resolveResource(ref, "ReactRef").current),
    "react.ref.set": (ref, value) => {
      resources.resolveResource(ref, "ReactRef").current = reactStatePayload(resources, value);
      return undefined;
    },
    "react.state.set": (setter, value) => setStateValue(resources, setter, value),
    "react.state.modify": (setter, update) => modifyStateValue(resources, setter, update),
    "react.reducer.dispatch": (dispatch, action) => dispatchReducerAction(resources, dispatch, action),
  };
}

export function createReactJsValueHostBindings(resources) {
  return createJsValueHostBindings(resources);
}

function stateSetterFor(setters, setState) {
  let setter = setters.get(setState);
  if (setter === undefined) {
    setter = {
      set: (next) => setState(next),
    };
    setters.set(setState, setter);
  }
  return setter;
}

function nextBrowserHook(componentState, expectedKind, hookName, createHook = null) {
  if (componentState === null) {
    throw new Error(`React.${hookName} can only be called while rendering a component`);
  }
  const index = componentState.hookIndex++;
  let hook = componentState.hooks[index];
  if (hook === undefined) {
    hook = typeof createHook === "function" ? createHook() : { kind: expectedKind };
    componentState.hooks[index] = hook;
  } else if (hook.kind !== expectedKind) {
    throw new Error(`React hook order changed: expected ${hookName}`);
  }
  return hook;
}

function createBrowserReducerHook(resources) {
  const hook = {
    kind: "reducer",
    reducer: null,
    nextReducer: null,
    reducerPending: false,
    reducerProxy: null,
    dispatcher: null,
    dispatchTarget: null,
  };
  hook.reducerProxy = (state, action) => callReducerHook(resources, hook, state, action);
  hook.dispatcher = {
    dispatch(action) {
      if (typeof hook.dispatchTarget !== "function") {
        throw new Error("React reducer dispatch is not available");
      }
      hook.dispatchTarget(action);
      return undefined;
    },
  };
  return hook;
}

function normalizeDependencyList(resources, deps) {
  if (!Array.isArray(deps)) {
    throw new Error("React dependency list must be an array");
  }
  return deps.map((dep, index) => {
    const value = resources.resolveResource(dep, `React dependency[${index}]`);
    if (typeof value !== "string") {
      throw new Error(`React dependency[${index}] must be a Js String`);
    }
    return value;
  });
}

function normalizeDependencyListOrRelease(resources, deps, setup, cleanup) {
  try {
    return normalizeDependencyList(resources, deps);
  } catch (error) {
    releaseEffectCallbacks(setup, cleanup);
    throw error;
  }
}

function dependencyListsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) {
      return false;
    }
  }
  return true;
}

function createVirtualStateHook(initial, scheduleRender) {
  const hook = {
    kind: "state",
    value: initial,
    setter: null,
  };
  hook.setter = {
    set(next) {
      hook.value = typeof next === "function" ? next(hook.value) : next;
      scheduleRender();
    },
  };
  return hook;
}

function createVirtualReducerHook(resources, initial, scheduleRender) {
  const hook = {
    kind: "reducer",
    value: initial,
    reducer: null,
    nextReducer: null,
    reducerPending: false,
    dispatcher: null,
  };
  hook.dispatcher = {
    dispatch(action) {
      hook.value = callReducerHook(resources, hook, hook.value, action);
      scheduleRender?.();
      return undefined;
    },
  };
  return hook;
}

function createVirtualRefHook(initial) {
  return {
    kind: "ref",
    ref: { current: initial },
  };
}

function createBrowserEffect(setup, cleanup) {
  return () => {
    let resource = null;
    let ready = false;
    try {
      resource = setup();
      ready = true;
    } finally {
      if (!ready) {
        releaseEffectCallbacks(setup, cleanup);
      }
    }
    let disposed = false;
    return () => {
      if (disposed) return undefined;
      disposed = true;
      try {
        return cleanup(resource);
      } finally {
        releaseEffectCallbacks(setup, cleanup);
      }
    };
  };
}

function createVirtualEffectHook() {
  return {
    kind: "effect",
    setup: null,
    cleanup: null,
    resource: null,
    dependencyList: null,
    nextDependencyList: null,
    nextSetup: null,
    nextCleanup: null,
  };
}

function runVirtualEffectHook(hook) {
  const setup = hook.nextSetup;
  const cleanup = hook.nextCleanup;
  const dependencyList = hook.nextDependencyList;
  hook.nextSetup = null;
  hook.nextCleanup = null;
  hook.nextDependencyList = null;
  if (typeof setup !== "function" || typeof cleanup !== "function") {
    releaseEffectCallbacks(setup, cleanup);
    return undefined;
  }
  try {
    cleanupVirtualEffectInstance(hook);
  } catch (error) {
    releaseEffectCallbacks(setup, cleanup);
    throw error;
  }
  hook.setup = setup;
  hook.cleanup = cleanup;
  hook.dependencyList = dependencyList;
  let ready = false;
  try {
    hook.resource = setup();
    ready = true;
  } finally {
    if (!ready) {
      releaseEffectCallbacks(setup, cleanup);
      hook.setup = null;
      hook.cleanup = null;
      hook.resource = null;
      hook.dependencyList = null;
    }
  }
  return undefined;
}

function disposeVirtualEffectHook(hook) {
  releasePendingEffectCallbacks(hook);
  cleanupVirtualEffectInstance(hook);
}

function cleanupVirtualEffectInstance(hook) {
  const setup = hook.setup;
  const cleanup = hook.cleanup;
  const resource = hook.resource;
  hook.setup = null;
  hook.cleanup = null;
  hook.resource = null;
  hook.dependencyList = null;
  if (typeof setup !== "function" || typeof cleanup !== "function") {
    releaseEffectCallbacks(setup, cleanup);
    return undefined;
  }
  try {
    return cleanup(resource);
  } finally {
    releaseEffectCallbacks(setup, cleanup);
  }
}

function releasePendingEffectCallbacks(hook) {
  const setup = hook?.nextSetup ?? null;
  const cleanup = hook?.nextCleanup ?? null;
  if (hook !== null && hook !== undefined) {
    hook.nextSetup = null;
    hook.nextCleanup = null;
    hook.nextDependencyList = null;
  }
  releaseEffectCallbacks(setup, cleanup);
}

function releaseEffectCallbacks(setup, cleanup) {
  releaseLeanCallback(setup);
  releaseLeanCallback(cleanup);
}

function stagePendingReducerCallback(componentState, hook, reducer) {
  releasePendingReducerHook(hook);
  hook.nextReducer = reducer;
  hook.reducerPending = true;
  componentState.pendingReducers.push(hook);
}

function commitPendingReducerCallbacks(componentState) {
  const reducers = componentState?.pendingReducers?.splice(0) ?? [];
  for (const hook of reducers) {
    commitPendingReducerHook(hook);
  }
}

function releasePendingReducerCallbacks(componentState) {
  const reducers = componentState?.pendingReducers?.splice(0) ?? [];
  for (const hook of reducers) {
    releasePendingReducerHook(hook);
  }
}

function commitPendingReducerHook(hook) {
  if (hook?.reducerPending !== true) return;
  const previous = hook.reducer;
  const next = hook.nextReducer;
  hook.reducer = next;
  hook.nextReducer = null;
  hook.reducerPending = false;
  if (previous !== null && previous !== undefined && previous !== next) {
    releaseLeanCallback(previous);
  }
}

function releasePendingReducerHook(hook) {
  if (hook?.reducerPending !== true) return;
  releaseLeanCallback(hook.nextReducer);
  hook.nextReducer = null;
  hook.reducerPending = false;
}

function disposeReducerHook(resources, hook) {
  releaseLeanCallback(hook?.reducer);
  releaseLeanCallback(hook?.nextReducer);
  hook.reducer = null;
  hook.nextReducer = null;
  hook.reducerPending = false;
  if (hook?.dispatcher !== null && hook?.dispatcher !== undefined) {
    resources.releaseValueResource(hook.dispatcher);
  }
}

function callReducerHook(resources, hook, state, action) {
  const reducer = hook?.nextReducer ?? hook?.reducer;
  if (typeof reducer !== "function") {
    throw new Error("React reducer callback is not available");
  }
  return withStateUpdaterResourceScope(resources, () => {
    const stateResource = resources.temporaryResourceForValue(state);
    const actionResource = resources.temporaryResourceForValue(action);
    return reactStatePayload(resources, reducer(stateResource, actionResource));
  });
}

function releaseLeanCallback(callback) {
  if (typeof callback?.release === "function") {
    callback.release();
  }
}

function stateResult(resources, value, setter) {
  return {
    value,
    setter,
  };
}

function reducerStateResult(resources, value, dispatcher) {
  return {
    value,
    dispatch: dispatcher,
  };
}

function setStateValue(resources, setter, value) {
  resources.resolveResource(setter, "ReactStateSetter").set(reactStatePayload(resources, value));
  return undefined;
}

function modifyStateValue(resources, setter, update) {
  const stateSetter = resources.resolveResource(setter, "ReactStateSetter");
  let released = false;
  const retainedUpdate = {
    remove() {
      if (released) return;
      released = true;
      update.release();
      resources.removeDisposable(retainedUpdate);
    },
  };
  resources.addDisposable(retainedUpdate);
  try {
    stateSetter.set((previous) => {
      try {
        return withStateUpdaterResourceScope(resources, () => {
          const previousResource = resources.temporaryResourceForValue(previous);
          return reactStatePayload(resources, update(previousResource));
        });
      } finally {
        retainedUpdate.remove();
      }
    });
  } catch (error) {
    retainedUpdate.remove();
    throw error;
  }
  return undefined;
}

function dispatchReducerAction(resources, dispatch, action) {
  const dispatcher = resources.resolveResource(dispatch, "ReactReducerDispatch");
  if (typeof dispatcher?.dispatch !== "function") {
    throw new Error("ReactReducerDispatch resource has invalid value");
  }
  dispatcher.dispatch(reactStatePayload(resources, action));
  return undefined;
}

function withStateUpdaterResourceScope(resources, run) {
  if (typeof resources.withTemporaryResourceScope !== "function" ||
      typeof resources.temporaryResourceForValue !== "function") {
    throw new Error("react.state.modify requires temporary host resource support");
  }
  return resources.withTemporaryResourceScope(run);
}

function reactStatePayload(resources, value) {
  return isHostResource(value) ? resources.resolveResource(value, "Js") : value;
}
