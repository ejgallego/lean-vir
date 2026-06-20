/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { isHostResource } from "../host-resource.js";

export function createBrowserReactHookRuntime(resources, React) {
  const setters = new WeakMap();
  let currentComponent = null;
  return {
    createComponentState() {
      return { refs: new Set(), setters: new Set() };
    },
    withComponentRender(componentState, render) {
      const previous = currentComponent;
      currentComponent = componentState;
      try {
        return render();
      } finally {
        currentComponent = previous;
      }
    },
    disposeComponent(componentState) {
      for (const ref of componentState?.refs ?? []) {
        resources.releaseValueResource(ref);
      }
      for (const setter of componentState?.setters ?? []) {
        resources.releaseValueResource(setter);
      }
      componentState?.refs?.clear();
      componentState?.setters?.clear();
    },
    useState(initial) {
      if (typeof React?.useState !== "function") {
        throw new Error("React.useState is not available");
      }
      const [value, setState] = React.useState(initial);
      const setter = stateSetterFor(setters, setState);
      currentComponent?.setters?.add(setter);
      return stateResult(resources, value, setter);
    },
    useRef(initial) {
      if (typeof React?.useRef !== "function") {
        throw new Error("React.useRef is not available");
      }
      const ref = React.useRef(initial);
      currentComponent?.refs?.add(ref);
      return resources.resourceForValue(ref);
    },
    useEffect(setup, cleanup) {
      if (typeof React?.useEffect !== "function") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffect is not available");
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
      const dependencyList = normalizeDependencyListOrRelease(deps, setup, cleanup);
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
        scheduleRender,
      };
    },
    withComponentRender(componentState, render) {
      const previous = currentComponent;
      currentComponent = componentState;
      componentState.hookIndex = 0;
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
    },
    cancelComponentRender(componentState) {
      for (const hook of componentState?.pendingEffects ?? []) {
        releasePendingEffectCallbacks(hook);
      }
      if (Array.isArray(componentState?.pendingEffects)) {
        componentState.pendingEffects.length = 0;
      }
    },
    commitComponentRender(componentState) {
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
      const dependencyList = normalizeDependencyListOrRelease(deps, setup, cleanup);
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
    "react.useState": (initial) => hookRuntime.useState(reactStatePayload(resources, initial)),
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
  };
}

export function createReactJsValueHostBindings(resources) {
  const bindings = {};
  for (const [target, codec] of Object.entries(jsValueCodecs)) {
    bindings[target] = (value) => resources.resourceForValue(codec.toJs(value));
    bindings[`${target}.value`] = (value) => codec.fromJs(resources.resolveResource(value, "Js"));
  }
  return bindings;
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

function normalizeDependencyList(deps) {
  if (!Array.isArray(deps)) {
    throw new Error("React dependency list must be an array");
  }
  return deps.map((dep) => String(dep));
}

function normalizeDependencyListOrRelease(deps, setup, cleanup) {
  try {
    return normalizeDependencyList(deps);
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

function releaseLeanCallback(callback) {
  if (typeof callback?.release === "function") {
    callback.release();
  }
}

function stateResult(resources, value, setter) {
  return {
    value: resources.resourceForValue(value),
    setter: resources.resourceForValue(setter),
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

const jsValueCodecs = {
  "js.string": {
    toJs: jsStringValue,
    fromJs: jsStringPayload,
  },
  "js.nat": {
    toJs: jsNatValue,
    fromJs: jsNatPayload,
  },
  "js.bool": {
    toJs: jsBoolValue,
    fromJs: jsBoolPayload,
  },
};

function jsStringValue(value) {
  if (typeof value !== "string") {
    throw new Error("js.string expects a string");
  }
  return value;
}

function jsStringPayload(value) {
  if (typeof value !== "string") {
    throw new Error("js.string.value expects a JS string");
  }
  return value;
}

function jsNatValue(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("js.nat expects a natural number");
  }
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new Error("js.nat expects a natural number");
  }
  return BigInt(text);
}

function jsNatPayload(value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("js.nat.value expects a JS natural number");
  }
  return value;
}

function jsBoolValue(value) {
  if (typeof value !== "boolean") {
    throw new Error("js.bool expects a boolean");
  }
  return value;
}

function jsBoolPayload(value) {
  if (typeof value !== "boolean") {
    throw new Error("js.bool.value expects a JS boolean");
  }
  return value;
}
