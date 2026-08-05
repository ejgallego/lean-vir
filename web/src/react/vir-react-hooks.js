/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  hostResourceValue,
  isHostResource,
  isRetainableHostResourcePayload,
  registerHostResourcePayloadLifetime,
  releaseHostResource,
  releaseHostResourcePayload,
  retainHostResourcePayload,
} from "../host-resource.js";
import { createJsValueHostBindings } from "../host/vir-js-value-bindings.js";
import { takeCallbackLease } from "../runtime/callbacks.js";
import { collectCleanupError, throwCollectedErrors, throwWithCleanup } from "../runtime/cleanup.js";

const NO_STORED_VALUE = Symbol("lean-vir.no-stored-react-value");
const browserEffectStates = new WeakMap();
// React owns the mutable ref object, but it does not own VIR payload leases
// merely because it writes the payload into ref.current. Keep committed ref
// ownership separate from the slot so React may replace .current safely.
const browserRefHooks = new WeakMap();
const browserEffectFinalizer = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((state) => releaseBrowserEffectState(state, true))
  : null;
// A retainable payload may return itself from retain(), so payload identity is
// not lease identity. Keep one record per acquired lease and use this weak
// index only to move leases between speculative React render generations.
const browserRenderPayloadLeases = new WeakMap();
const browserRenderFinalizer = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((state) => releaseBrowserRenderState(state, true))
  : null;
const browserQueuedStateFinalizer = typeof FinalizationRegistry === "function"
  ? new FinalizationRegistry((record) => releaseBrowserQueuedStateRecord(record, true))
  : null;

export function createBrowserReactHookRuntime(resources, React) {
  const setters = new WeakMap();
  let currentComponent = null;
  let currentRender = null;
  return {
    createComponentState() {
      return { hookIndex: 0, hooks: [], refs: new Set(), setters: new Set() };
    },
    withComponentRender(componentState, render) {
      const previous = currentComponent;
      const previousRender = currentRender;
      const generation = createBrowserRenderGeneration(resources, componentState);
      currentComponent = componentState;
      currentRender = generation;
      componentState.hookIndex = 0;
      try {
        return render();
      } catch (error) {
        if (!generation.handedOff) {
          throwWithCleanup(
            error,
            () => releaseBrowserRenderGeneration(generation),
            "browser React render failed during ownership cleanup",
          );
        }
        throw error;
      } finally {
        if (!generation.handedOff) {
          releaseBrowserRenderGeneration(generation);
        }
        currentComponent = previous;
        currentRender = previousRender;
      }
    },
    disposeComponent(componentState) {
      const hooks = Array.isArray(componentState?.hooks) ? componentState.hooks.splice(0) : [];
      const refs = Array.from(componentState?.refs ?? []);
      const componentSetters = Array.from(componentState?.setters ?? []);
      componentState?.refs?.clear();
      componentState?.setters?.clear();
      const errors = [];
      for (const hook of hooks) {
        if (hook?.kind === "state" || hook?.kind === "memo") {
          collectCleanupError(errors, () => disposeBrowserStoredValueHook(hook));
        } else if (hook?.kind === "reducer") {
          collectCleanupError(errors, () => disposeReducerHook(resources, hook));
        } else if (hook?.kind === "ref") {
          collectCleanupError(errors, () => disposeReactRefHook(hook));
        } else if (hook?.kind === "effect") {
          const effect = hook.effect;
          hook.effect = null;
          hook.dependencyList = null;
          collectCleanupError(errors, () => releaseBrowserEffect(effect));
        }
      }
      for (const ref of refs) {
        collectCleanupError(errors, () => resources.releaseValueResource(ref));
      }
      for (const setter of componentSetters) {
        collectCleanupError(errors, () => resources.releaseValueResource(setter));
      }
      throwCollectedErrors(errors, "browser React component disposal failed");
    },
    cancelComponentRender(componentState) {
      if (currentRender?.componentState === componentState) {
        releaseBrowserRenderGeneration(currentRender);
      }
    },
    commitComponentRender(componentState, commitOwnership = null) {
      const generation = currentRender;
      if (generation?.componentState !== componentState) {
        throw new Error("browser React commit registration must occur during its component render");
      }
      if (typeof React?.useLayoutEffect !== "function") {
        throw new Error("React.useLayoutEffect is required for commit-phase resource ownership");
      }
      handOffBrowserRenderGeneration(generation);
      try {
        React.useLayoutEffect(() => {
          commitBrowserRenderGeneration(generation, commitOwnership);
          return undefined;
        });
      } catch (error) {
        throwWithCleanup(
          error,
          () => releaseBrowserRenderGeneration(generation),
          "browser React commit registration failed during ownership cleanup",
        );
      }
    },
    useState(initial) {
      if (typeof React?.useState !== "function") {
        releaseReactStatePayload(initial);
        throw new Error("React.useState is not available");
      }
      let hook;
      try {
        hook = nextBrowserHook(
          currentComponent,
          "state",
          "useState",
          () => createBrowserStoredValueHook("state"),
        );
      } catch (error) {
        releaseReactStatePayload(initial);
        throw error;
      }
      const initialLease = stageBrowserRenderPayload(currentRender, initial);
      const [value, setState] = React.useState(initial);
      stageBrowserStateCandidate(currentRender, hook, initial, initialLease, value);
      const setter = stateSetterFor(resources, setters, setState, hook);
      currentRender.setters.add(setter);
      return stateResult(value, setter);
    },
    useReducer(reducer, initial) {
      if (typeof React?.useState !== "function") {
        releaseLeanCallback(reducer);
        releaseReactStatePayload(initial);
        throw new Error("React.useState is required for replay-safe VIR reducers");
      }
      let hook;
      let ownedReducer = null;
      try {
        hook = nextBrowserHook(currentComponent, "reducer", "useReducer", () => createBrowserReducerHook(resources));
        ownedReducer = takeCallbackLease(reducer, "React reducer callback");
        stageBrowserReducerCallback(currentRender, hook, ownedReducer);
      } catch (error) {
        releaseLeanCallback(ownedReducer ?? reducer);
        releaseReactStatePayload(initial);
        throw error;
      }
      const initialLease = stageBrowserRenderPayload(currentRender, initial);
      const [value, setState] = React.useState(initial);
      stageBrowserStateCandidate(currentRender, hook, initial, initialLease, value);
      hook.dispatchTarget = setState;
      return reducerStateResult(value, hook.dispatcher);
    },
    useRef(initial) {
      if (typeof React?.useRef !== "function") {
        releaseReactStatePayload(initial);
        throw new Error("React.useRef is not available");
      }
      let hook;
      try {
        hook = nextBrowserHook(currentComponent, "ref", "useRef", createBrowserRefHook);
      } catch (error) {
        releaseReactStatePayload(initial);
        throw error;
      }
      const initialLease = stageBrowserRenderPayload(currentRender, initial);
      const ref = React.useRef(initial);
      if (!Object.is(ref.current, initial)) releaseBrowserRenderPayload(currentRender, initialLease);
      currentRender.refs.set(hook, ref);
      return resources.revocableResourceForValue(ref);
    },
    useMemo(calculate, deps) {
      if (typeof React?.useMemo !== "function") {
        releaseLeanCallback(calculate);
        throw new Error("React.useMemo is not available");
      }
      let hook;
      try {
        hook = nextBrowserHook(
          currentComponent,
          "memo",
          "useMemo",
          () => createBrowserStoredValueHook("memo"),
        );
      } catch (error) {
        releaseLeanCallback(calculate);
        throw error;
      }
      const dependencyList = normalizeCallbackDependencyListOrRelease(resources, deps, calculate);
      try {
        const value = React.useMemo(
          () => {
            const result = takeReactStatePayload(resources, calculate());
            stageBrowserRenderPayload(currentRender, result);
            return result;
          },
          dependencyList,
        );
        stageBrowserStoredValueCandidate(currentRender, hook, value);
        return value;
      } finally {
        releaseLeanCallback(calculate);
      }
    },
    useEffect(setup, cleanup) {
      if (typeof React?.useEffect !== "function") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffect is not available");
      }
      let hook;
      try {
        hook = nextBrowserHook(currentComponent, "effect", "useEffect", createBrowserEffectHook);
      } catch (error) {
        releaseEffectCallbacks(setup, cleanup);
        throw error;
      }
      [setup, cleanup] = takeEffectCallbackLeases(setup, cleanup);
      const effect = createBrowserEffect(resources, setup, cleanup);
      let registered = false;
      try {
        React.useEffect(effect);
        stageBrowserEffect(currentRender, hook, effect, null);
        registered = true;
      } finally {
        if (!registered) {
          releaseBrowserEffect(effect);
        }
      }
      return undefined;
    },
    useEffectWithDeps(deps, setup, cleanup) {
      if (typeof React?.useEffect !== "function") {
        releaseEffectCallbacks(setup, cleanup);
        throw new Error("React.useEffectWithDeps requires React.useEffect");
      }
      let hook;
      try {
        hook = nextBrowserHook(currentComponent, "effect", "useEffectWithDeps", createBrowserEffectHook);
      } catch (error) {
        releaseEffectCallbacks(setup, cleanup);
        throw error;
      }
      const dependencyList = normalizeDependencyListOrRelease(resources, deps, setup, cleanup);
      [setup, cleanup] = takeEffectCallbackLeases(setup, cleanup);
      const effect = createBrowserEffect(resources, setup, cleanup);
      let registered = false;
      try {
        React.useEffect(effect, dependencyList);
        stageBrowserEffect(currentRender, hook, effect, dependencyList);
        registered = true;
      } finally {
        if (!registered) {
          releaseBrowserEffect(effect);
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
      const hooks = Array.isArray(componentState?.hooks) ? componentState.hooks.splice(0) : [];
      if (Array.isArray(componentState?.pendingEffects)) componentState.pendingEffects.length = 0;
      if (Array.isArray(componentState?.pendingReducers)) componentState.pendingReducers.length = 0;
      const errors = [];
      for (const hook of hooks) {
        if (hook?.kind === "state") {
          const value = hook.value;
          const setter = hook.setter;
          hook.value = null;
          hook.setter = null;
          collectCleanupError(errors, () => releaseReactStatePayload(value));
          collectCleanupError(errors, () => resources.releaseValueResource(setter));
        } else if (hook?.kind === "reducer") {
          collectCleanupError(errors, () => disposeReducerHook(resources, hook));
        } else if (hook?.kind === "ref") {
          const ref = hook.ref;
          collectCleanupError(errors, () => disposeReactRefHook(hook));
          collectCleanupError(errors, () => resources.releaseValueResource(ref));
        } else if (hook?.kind === "memo") {
          const value = hook.value;
          hook.value = null;
          collectCleanupError(errors, () => releaseReactStatePayload(value));
        } else if (hook?.kind === "effect") {
          collectCleanupError(errors, () => disposeVirtualEffectHook(hook));
        }
      }
      throwCollectedErrors(errors, "virtual React component disposal failed");
    },
    cancelComponentRender(componentState) {
      const effects = componentState?.pendingEffects?.splice(0) ?? [];
      const errors = [];
      collectCleanupError(errors, () => releasePendingReducerCallbacks(componentState));
      for (const hook of effects) {
        collectCleanupError(errors, () => releasePendingEffectCallbacks(hook));
      }
      throwCollectedErrors(errors, "virtual React render cancellation failed");
    },
    commitComponentRender(componentState, commitOwnership = null) {
      const effects = componentState?.pendingEffects?.splice(0) ?? [];
      const errors = [];
      const reducersCommitted = collectCleanupError(errors, () => commitPendingReducerCallbacks(componentState));
      if (!reducersCommitted.ok) {
        for (const hook of effects) {
          collectCleanupError(errors, () => releasePendingEffectCallbacks(hook));
        }
      } else {
        for (let index = 0; index < effects.length; index++) {
          const attempted = collectCleanupError(errors, () => runVirtualEffectHook(effects[index]));
          if (!attempted.ok) {
            for (const hook of effects.slice(index + 1)) {
              collectCleanupError(errors, () => releasePendingEffectCallbacks(hook));
            }
            break;
          }
        }
      }
      if (errors.length === 0) {
        collectCleanupError(errors, () => commitOwnership?.());
      }
      throwCollectedErrors(errors, "virtual React render commit failed");
    },
    useState(initial) {
      if (currentComponent === null) {
        releaseReactStatePayload(initial);
        throw new Error("React.useState can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualStateHook(initial, currentComponent.scheduleRender);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "state") {
        releaseReactStatePayload(initial);
        throw new Error("React hook order changed: expected useState");
      } else {
        releaseReactStatePayload(initial);
      }
      return stateResult(hook.value, hook.setter);
    },
    useReducer(reducer, initial) {
      if (currentComponent === null) {
        releaseLeanCallback(reducer);
        releaseReactStatePayload(initial);
        throw new Error("React.useReducer can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualReducerHook(resources, initial, currentComponent.scheduleRender);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "reducer") {
        releaseLeanCallback(reducer);
        releaseReactStatePayload(initial);
        throw new Error("React hook order changed: expected useReducer");
      } else {
        releaseReactStatePayload(initial);
      }
      const ownedReducer = takeCallbackLease(reducer, "React reducer callback");
      try {
        stagePendingReducerCallback(currentComponent, hook, ownedReducer);
      } catch (error) {
        releaseLeanCallback(ownedReducer);
        throw error;
      }
      return reducerStateResult(hook.value, hook.dispatcher);
    },
    useRef(initial) {
      if (currentComponent === null) {
        releaseReactStatePayload(initial);
        throw new Error("React.useRef can only be called while rendering a component");
      }
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        hook = createVirtualRefHook(initial);
        currentComponent.hooks[index] = hook;
      } else if (hook.kind !== "ref") {
        releaseReactStatePayload(initial);
        throw new Error("React hook order changed: expected useRef");
      } else {
        releaseReactStatePayload(initial);
      }
      return resources.revocableResourceForValue(hook.ref);
    },
    useMemo(calculate, deps) {
      if (currentComponent === null) {
        releaseLeanCallback(calculate);
        throw new Error("React.useMemo can only be called while rendering a component");
      }
      const dependencyList = normalizeCallbackDependencyListOrRelease(resources, deps, calculate);
      const index = currentComponent.hookIndex++;
      let hook = currentComponent.hooks[index];
      if (hook === undefined) {
        const value = callMemoCalculation(resources, calculate);
        hook = {
          kind: "memo",
          value,
          dependencyList: dependencyList.slice(),
        };
        currentComponent.hooks[index] = hook;
        return value;
      }
      if (hook.kind !== "memo") {
        releaseLeanCallback(calculate);
        throw new Error("React hook order changed: expected useMemo");
      }
      if (dependencyListsEqual(hook.dependencyList, dependencyList)) {
        releaseLeanCallback(calculate);
        return hook.value;
      }
      const value = callMemoCalculation(resources, calculate);
      const previous = hook.value;
      hook.value = value;
      hook.dependencyList = dependencyList.slice();
      releaseReactStatePayload(previous);
      return value;
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
      stagePendingEffectCallbacks(currentComponent, hook, setup, cleanup);
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
      stagePendingEffectCallbacks(currentComponent, hook, setup, cleanup, dependencyList);
      return undefined;
    },
  };
}

export function createReactStateHostBindings(resources, hookRuntime) {
  return {
    "react.useState": (initial) =>
      resources.resourceForValue(hookRuntime.useState(retainReactStatePayload(resources, initial))),
    "react.state.value": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactState").value),
    "react.state.setter": (state) =>
      resources.revocableResourceForValue(resources.resolveResource(state, "ReactState").setter),
    "react.useReducer": (reducer, initial) =>
      resources.resourceForValue(hookRuntime.useReducer(reducer, retainReactStatePayload(resources, initial))),
    "react.reducerState.value": (state) =>
      resources.resourceForValue(resources.resolveResource(state, "ReactReducerState").value),
    "react.reducerState.dispatch": (state) =>
      resources.revocableResourceForValue(resources.resolveResource(state, "ReactReducerState").dispatch),
    "react.useRef": (initial) => hookRuntime.useRef(retainReactStatePayload(resources, initial)),
    "react.useMemo": (calculate, deps) => resources.resourceForValue(hookRuntime.useMemo(calculate, deps)),
    "react.useEffect": (setup, cleanup) => hookRuntime.useEffect(setup, cleanup),
    "react.deps.empty": () => resources.resourceForValue(createReactDependencyListResource()),
    "react.deps.push": (deps, value) => {
      pushReactDependency(resources, deps, value);
      return undefined;
    },
    "react.useEffectWithDeps": (deps, setup, cleanup) => hookRuntime.useEffectWithDeps(deps, setup, cleanup),
    "react.ref.get": (ref) => resources.resourceForValue(resources.resolveResource(ref, "ReactRef").current),
    "react.ref.set": (ref, value) => {
      const target = resources.resolveResource(ref, "ReactRef");
      replaceReactRefValue(target, retainReactStatePayload(resources, value));
      return undefined;
    },
    "react.state.set": (setter, value) => setStateValue(resources, setter, value),
    "react.state.modify": (setter, update) => modifyStateValue(resources, setter, update),
    "react.reducer.dispatch": (dispatch, action) => dispatchReducerAction(resources, dispatch, action),
  };
}

export function createReactJsValueHostBindings(resources) {
  return {
    ...createJsValueHostBindings(resources),
    "js.value.react.property": (value) => resources.resourceForValue(value),
    "js.value.react.eventHandler": (value) =>
      resources.adoptResourceForValue(createReactEventHandlerPayload(value)),
  };
}

function createReactEventHandlerPayload(value, { transfer = true } = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("React event handler payload must be an object");
  }
  const callback = value.callback;
  if (typeof callback !== "function" || typeof callback.release !== "function") {
    throw new Error("React Node event handler callback must be a releasable function");
  }
  const ownedCallback = transfer
    ? takeCallbackLease(callback, "React event handler callback")
    : retainReactEventCallback(callback);
  let live = true;
  const payload = Object.freeze({ ...value, callback: ownedCallback });
  try {
    registerHostResourcePayloadLifetime(payload, {
      retain: () => {
        if (!live) throw new Error("cannot retain a released React event handler payload");
        return createReactEventHandlerPayload(payload, { transfer: false });
      },
      release: () => {
        if (!live) return false;
        live = false;
        return ownedCallback.release();
      },
    });
    return payload;
  } catch (error) {
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => ownedCallback.release());
    throwCollectedErrors(errors, "React event handler payload creation failed");
  }
}

function retainReactEventCallback(callback) {
  if (typeof callback.retain !== "function") return callback;
  const retained = callback.retain();
  if (retained === callback || typeof retained !== "function" || typeof retained.release !== "function") {
    if (retained !== callback && typeof retained?.release === "function") retained.release();
    throw new Error("React event handler callback retain() must return a distinct releasable function");
  }
  return retained;
}

function createBrowserRenderGeneration(resources, componentState) {
  const ownership = {
    kind: "render",
    resources,
    reducers: new Map(),
    effects: new Map(),
    candidates: new Map(),
    refs: new Map(),
    setters: new Set(),
    payloadLeases: new Set(),
    closed: false,
  };
  return {
    componentState,
    token: {},
    handedOff: false,
    ownership,
    reducers: ownership.reducers,
    effects: ownership.effects,
    candidates: ownership.candidates,
    refs: ownership.refs,
    setters: ownership.setters,
  };
}

function stageBrowserRenderPayload(generation, ownedValue, value = ownedValue) {
  if (!isRetainableHostResourcePayload(ownedValue)) return null;
  if (generation === null || generation === undefined || generation.ownership.closed) {
    releaseReactStatePayload(ownedValue);
    throw new Error("browser React render ownership is unavailable");
  }
  return createBrowserPayloadLease(generation.ownership, value, ownedValue);
}

function releaseBrowserRenderPayload(generation, lease) {
  if (lease === null || lease === undefined) return false;
  const owner = generation?.ownership;
  if (owner === undefined || lease.owner !== owner) return false;
  return releaseBrowserPayloadLease(lease);
}

function stageBrowserStoredValueCandidate(generation, hook, value) {
  generation.candidates.set(hook, value);
}

function stageBrowserStateCandidate(generation, hook, initial, initialLease, value) {
  if (!Object.is(value, initial)) {
    releaseBrowserRenderPayload(generation, initialLease);
    if (isRetainableHostResourcePayload(value)) {
      const staged = findBrowserPayloadLease(generation?.ownership, value);
      const queued = staged === null ? takeBrowserQueuedStateResultLease(hook, value) : null;
      if (queued !== null) {
        transferBrowserPayloadLease(queued, generation.ownership);
      } else if (staged === null && findBrowserPayloadLease(hook, value) === null) {
        throw new Error("React state candidate has no matching queued or committed ownership lease");
      }
    }
  }
  stageBrowserStoredValueCandidate(generation, hook, value);
}

function createBrowserPayloadLease(owner, value, ownedValue = value) {
  const lease = { owner, value, ownedValue, active: true };
  attachBrowserPayloadLease(lease, owner);
  return lease;
}

function attachBrowserPayloadLease(lease, owner) {
  lease.owner = owner;
  owner.payloadLeases.add(lease);
  if (owner.kind === "render") {
    let leases = browserRenderPayloadLeases.get(lease.value);
    if (leases === undefined) {
      leases = new Set();
      browserRenderPayloadLeases.set(lease.value, leases);
    }
    leases.add(lease);
  }
}

function transferBrowserPayloadLease(lease, owner) {
  if (lease?.active !== true || lease.owner === null || lease.owner === undefined) return false;
  detachBrowserPayloadLease(lease);
  attachBrowserPayloadLease(lease, owner);
  return true;
}

function releaseBrowserPayloadLease(lease) {
  if (lease?.active !== true || lease.owner === null || lease.owner === undefined) return false;
  const ownedValue = lease.ownedValue;
  detachBrowserPayloadLease(lease);
  lease.owner = null;
  lease.ownedValue = NO_STORED_VALUE;
  lease.active = false;
  return releaseReactStatePayload(ownedValue);
}

function detachBrowserPayloadLease(lease) {
  const owner = lease.owner;
  owner?.payloadLeases?.delete(lease);
  if (owner?.kind !== "render") return;
  const leases = browserRenderPayloadLeases.get(lease.value);
  if (leases === undefined) return;
  leases.delete(lease);
  if (leases.size === 0) browserRenderPayloadLeases.delete(lease.value);
}

function findBrowserPayloadLease(owner, value) {
  for (const lease of owner?.payloadLeases ?? []) {
    if (lease.active && Object.is(lease.value, value)) return lease;
  }
  return null;
}

function takeBrowserRenderPayloadLease(generation, value) {
  const current = findBrowserPayloadLease(generation?.ownership, value);
  if (current !== null) return current;
  for (const lease of browserRenderPayloadLeases.get(value) ?? []) {
    if (lease.active && lease.owner?.kind === "render" && lease.owner.closed !== true) {
      return lease;
    }
  }
  return null;
}

function createBrowserQueuedStateAction(resources, hook, value) {
  if (browserQueuedStateFinalizer === null) {
    const error = new Error("browser React queued state ownership requires FinalizationRegistry support");
    throwWithCleanup(
      error,
      () => releaseReactStatePayload(value),
      "browser React queued state ownership failed during cleanup",
    );
  }
  const record = {
    kind: "queue",
    value,
    payloadLeases: new Set(),
    active: true,
    ownerRef: typeof WeakRef === "function" ? new WeakRef(hook) : null,
    report: (error) => resources.recordGcFinalizerError?.(error),
  };
  const action = () => {
    if (!record.active) {
      throw new Error("React invoked a released queued state action");
    }
    if (!isRetainableHostResourcePayload(record.value)) return record.value;
    const result = retainHostResourcePayload(record.value);
    createBrowserPayloadLease(record, result);
    return result;
  };
  hook.pendingActions.add(record);
  try {
    browserQueuedStateFinalizer.register(action, record, record);
  } catch (error) {
    hook.pendingActions.delete(record);
    record.active = false;
    record.value = NO_STORED_VALUE;
    throwWithCleanup(
      error,
      () => releaseReactStatePayload(value),
      "browser React queued state registration failed during cleanup",
    );
  }
  return { action, record };
}

function releaseBrowserQueuedStateRecord(record, fromFinalizer = false) {
  if (record?.active !== true) return false;
  record.active = false;
  if (!fromFinalizer) browserQueuedStateFinalizer?.unregister(record);
  const value = record.value;
  const payloadLeases = Array.from(record.payloadLeases);
  const owner = record.ownerRef?.deref();
  const report = record.report;
  record.value = NO_STORED_VALUE;
  record.payloadLeases.clear();
  record.ownerRef = null;
  record.report = null;
  owner?.pendingActions?.delete(record);
  const errors = [];
  for (const lease of payloadLeases) {
    collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
  }
  collectCleanupError(errors, () => releaseReactStatePayload(value));
  if (errors.length !== 0) {
    if (!fromFinalizer) {
      throwCollectedErrors(errors, "browser React queued state release failed");
    }
    reportReactFinalizerErrors(report, errors);
  }
  return true;
}

function hasBrowserQueuedStateValue(hook, value) {
  for (const record of hook?.pendingActions ?? []) {
    if (record.active && Object.is(record.value, value)) return true;
  }
  return false;
}

function takeBrowserQueuedStateResultLease(hook, value) {
  for (const record of hook?.pendingActions ?? []) {
    if (!record.active) continue;
    const lease = findBrowserPayloadLease(record, value);
    if (lease !== null) return lease;
  }
  return null;
}

function browserStoredValueForUpdate(hook) {
  const optimistic = hook.optimisticValue;
  if (optimistic === NO_STORED_VALUE) return hook.committedValue;
  if (Object.is(optimistic, hook.committedValue) || hasBrowserQueuedStateValue(hook, optimistic)) {
    return optimistic;
  }
  hook.optimisticValue = NO_STORED_VALUE;
  return hook.committedValue;
}

function enqueueBrowserStoredValue(resources, hook, setState, value) {
  const previousOptimistic = hook.optimisticValue;
  const { action, record } = createBrowserQueuedStateAction(resources, hook, value);
  hook.optimisticValue = value;
  try {
    setState(action);
  } catch (error) {
    hook.optimisticValue = previousOptimistic;
    throwWithCleanup(
      error,
      () => releaseBrowserQueuedStateRecord(record),
      "browser React state enqueue failed during ownership cleanup",
    );
  }
  return undefined;
}

function stageBrowserReducerCallback(generation, hook, reducer) {
  const previous = generation.reducers.get(hook);
  if (previous !== undefined && previous !== reducer) releaseLeanCallback(previous);
  generation.reducers.set(hook, reducer);
}

function createBrowserEffectHook() {
  return {
    kind: "effect",
    effect: null,
    dependencyList: null,
  };
}

function stageBrowserEffect(generation, hook, effect, dependencyList) {
  const previous = generation.effects.get(hook);
  if (previous !== undefined && previous.effect !== effect) releaseBrowserEffect(previous.effect);
  generation.effects.set(hook, {
    effect,
    dependencyList: dependencyList === null ? null : dependencyList.slice(),
  });
}

function handOffBrowserRenderGeneration(generation) {
  if (generation.handedOff) {
    throw new Error("browser React render ownership was already handed off");
  }
  if (browserRenderFinalizer === null) {
    releaseBrowserRenderGeneration(generation);
    throw new Error("browser React render ownership requires FinalizationRegistry support");
  }
  generation.handedOff = true;
  browserRenderFinalizer.register(generation.token, generation.ownership, generation.token);
}

function releaseBrowserRenderGeneration(generation) {
  if (generation === null || generation === undefined) return false;
  if (generation.handedOff) browserRenderFinalizer?.unregister(generation.token);
  return releaseBrowserRenderState(generation.ownership);
}

function releaseBrowserRenderState(state, fromFinalizer = false) {
  if (state?.closed === true) return false;
  state.closed = true;
  const reducers = Array.from(state.reducers.values());
  const effects = Array.from(state.effects.values(), (record) => record.effect);
  const payloadLeases = Array.from(state.payloadLeases);
  state.reducers.clear();
  state.effects.clear();
  state.candidates.clear();
  state.refs.clear();
  state.setters.clear();
  state.payloadLeases.clear();
  const errors = [];
  for (const reducer of reducers) collectCleanupError(errors, () => releaseLeanCallback(reducer));
  for (const effect of effects) collectCleanupError(errors, () => releaseBrowserEffect(effect));
  for (const lease of payloadLeases) {
    collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
  }
  if (errors.length !== 0) {
    if (!fromFinalizer) throwCollectedErrors(errors, "browser React render ownership cleanup failed");
    reportReactFinalizerErrors(
      (error) => state.resources.recordGcFinalizerError?.(error),
      errors,
    );
  }
  return true;
}

function commitBrowserRenderGeneration(generation, commitOwnership) {
  const state = generation.ownership;
  if (state.closed) return false;
  browserRenderFinalizer?.unregister(generation.token);
  const errors = [];

  for (const [hook, reducer] of state.reducers) {
    state.reducers.delete(hook);
    const previous = hook.reducer;
    hook.reducer = reducer;
    hook.nextReducer = null;
    hook.reducerPending = false;
    if (previous !== null && previous !== undefined && previous !== reducer) {
      collectCleanupError(errors, () => releaseLeanCallback(previous));
    }
  }

  for (const [hook, record] of state.effects) {
    state.effects.delete(hook);
    const unchanged = hook.effect !== null && record.dependencyList !== null &&
      dependencyListsEqual(hook.dependencyList, record.dependencyList);
    if (unchanged) {
      collectCleanupError(errors, () => releaseBrowserEffect(record.effect));
      continue;
    }
    const previous = hook.effect;
    hook.effect = record.effect;
    hook.dependencyList = record.dependencyList;
    if (previous !== null && previous !== record.effect) {
      collectCleanupError(errors, () => releaseBrowserEffect(previous));
    }
  }

  for (const [hook, candidate] of state.candidates) {
    reconcileBrowserStoredValueLease(generation, hook, candidate, errors);
    hook.committedValue = candidate;
    if (Object.is(hook.optimisticValue, candidate)) {
      hook.optimisticValue = NO_STORED_VALUE;
    }
  }

  for (const [hook, ref] of state.refs) {
    commitBrowserRef(generation, hook, ref, errors);
  }
  for (const setter of state.setters) generation.componentState.setters.add(setter);

  if (typeof commitOwnership === "function") {
    collectCleanupError(errors, commitOwnership);
  }

  const remainingPayloadLeases = Array.from(state.payloadLeases);
  state.closed = true;
  state.reducers.clear();
  state.effects.clear();
  state.candidates.clear();
  state.refs.clear();
  state.setters.clear();
  state.payloadLeases.clear();
  for (const lease of remainingPayloadLeases) {
    collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
  }
  throwCollectedErrors(errors, "browser React commit ownership failed");
  return true;
}

function reconcileBrowserStoredValueLease(generation, hook, candidate, errors) {
  let kept = isRetainableHostResourcePayload(candidate)
    ? findBrowserPayloadLease(hook, candidate)
    : null;
  if (isRetainableHostResourcePayload(candidate) && kept === null) {
    const staged = takeBrowserRenderPayloadLease(generation, candidate);
    if (staged === null) {
      errors.push(new Error("React stored value has no matching ownership lease"));
    } else {
      transferBrowserPayloadLease(staged, hook);
      kept = staged;
    }
  }
  for (const lease of Array.from(hook.payloadLeases)) {
    if (lease !== kept) {
      collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
    }
  }
}

function commitBrowserRef(generation, hook, ref, errors) {
  const value = ref.current;
  let kept = isRetainableHostResourcePayload(value)
    ? findBrowserPayloadLease(hook, value)
    : null;
  if (isRetainableHostResourcePayload(value) && kept === null) {
    const staged = takeBrowserRenderPayloadLease(generation, value);
    if (staged === null || !transferBrowserPayloadLease(staged, hook)) {
      errors.push(new Error("React ref value has no matching ownership lease"));
      return;
    }
    kept = staged;
  }

  const previous = hook.ref;
  if (previous !== ref) {
    if (previous !== null && previous !== undefined && browserRefHooks.get(previous) === hook) {
      browserRefHooks.delete(previous);
    }
    hook.ref = ref;
    browserRefHooks.set(ref, hook);
    if (previous !== null && previous !== undefined) {
      collectCleanupError(errors, () => { previous.current = null; });
    }
  } else {
    browserRefHooks.set(ref, hook);
  }
  generation.componentState.refs.add(ref);

  for (const lease of Array.from(hook.payloadLeases)) {
    if (lease !== kept) {
      collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
    }
  }
}

function stateSetterFor(resources, setters, setState, hook) {
  let setter = setters.get(setState);
  if (setter === undefined) {
    setter = {
      set: (next) => queueBrowserStateUpdate(resources, hook, setState, next),
    };
    setters.set(setState, setter);
  }
  return setter;
}

function queueBrowserStateUpdate(resources, hook, setState, next) {
  if (hook?.disposed === true) {
    if (typeof next !== "function") {
      releaseReactStatePayload(next);
    }
    throw new Error("React state setter belongs to a disposed component");
  }
  if (typeof next !== "function") {
    return enqueueBrowserStoredValue(resources, hook, setState, next);
  }
  const previous = browserStoredValueForUpdate(hook);
  if (previous === NO_STORED_VALUE) {
    throw new Error("React state updater has no committed state");
  }
  const value = next(previous);
  return enqueueBrowserStoredValue(resources, hook, setState, value);
}

function createBrowserStoredValueHook(kind) {
  return {
    kind,
    committedValue: NO_STORED_VALUE,
    optimisticValue: NO_STORED_VALUE,
    payloadLeases: new Set(),
    pendingActions: new Set(),
    disposed: false,
  };
}

function createBrowserRefHook() {
  return {
    kind: "ref",
    ref: null,
    payloadLeases: new Set(),
    disposed: false,
  };
}

function disposeBrowserStoredValueHook(hook) {
  if (hook?.disposed === true) return;
  hook.disposed = true;
  const leases = Array.from(hook?.payloadLeases ?? []);
  const pendingActions = Array.from(hook?.pendingActions ?? []);
  hook?.payloadLeases?.clear();
  hook?.pendingActions?.clear();
  hook.committedValue = NO_STORED_VALUE;
  hook.optimisticValue = NO_STORED_VALUE;
  const errors = [];
  for (const lease of leases) {
    collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
  }
  for (const record of pendingActions) {
    collectCleanupError(errors, () => releaseBrowserQueuedStateRecord(record));
  }
  throwCollectedErrors(errors, "React stored value disposal failed");
}

function disposeReactRefHook(hook) {
  if (hook?.payloadLeases instanceof Set) {
    if (hook.disposed === true) return;
    hook.disposed = true;
    const ref = hook.ref;
    const leases = Array.from(hook.payloadLeases);
    hook.ref = null;
    hook.payloadLeases.clear();
    if (ref !== null && ref !== undefined && browserRefHooks.get(ref) === hook) {
      browserRefHooks.delete(ref);
    }
    const errors = [];
    if (ref !== null && ref !== undefined) {
      collectCleanupError(errors, () => { ref.current = null; });
    }
    for (const lease of leases) {
      collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
    }
    throwCollectedErrors(errors, "React ref disposal failed");
    return;
  }
  const ref = hook?.ref;
  if (ref === null || ref === undefined) return;
  const value = ref.current;
  hook.ref = null;
  ref.current = null;
  releaseReactStatePayload(value);
}

function replaceReactRefValue(ref, value) {
  const hook = browserRefHooks.get(ref);
  if (hook !== undefined && hook.disposed !== true) {
    replaceBrowserReactRefValue(hook, ref, value);
    return;
  }
  const previous = ref.current;
  ref.current = value;
  if (Object.is(previous, value)) {
    releaseReactStatePayload(value);
  } else {
    releaseReactStatePayload(previous);
  }
}

function replaceBrowserReactRefValue(hook, ref, value) {
  const previousLease = isRetainableHostResourcePayload(value)
    ? findBrowserPayloadLease(hook, value)
    : null;
  const incomingLease = isRetainableHostResourcePayload(value)
    ? createBrowserPayloadLease(hook, value)
    : null;
  const errors = [];
  const assigned = collectCleanupError(errors, () => { ref.current = value; });
  if (!assigned.ok) {
    if (incomingLease !== null) {
      collectCleanupError(errors, () => releaseBrowserPayloadLease(incomingLease));
    }
    throwCollectedErrors(errors, "React ref update failed during ownership rollback");
    return;
  }

  const kept = previousLease ?? incomingLease;
  for (const lease of Array.from(hook.payloadLeases)) {
    if (lease !== kept) {
      collectCleanupError(errors, () => releaseBrowserPayloadLease(lease));
    }
  }
  // Passive values do not carry a lease. The old slot value is deliberately
  // not released by identity: its lease, if any, was released from the hook's
  // explicit ownership set above.
  throwCollectedErrors(errors, "React ref update cleanup failed");
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
    payloadLeases: new Set(),
    pendingActions: new Set(),
    committedValue: NO_STORED_VALUE,
    optimisticValue: NO_STORED_VALUE,
    reducer: null,
    nextReducer: null,
    reducerPending: false,
    dispatcher: null,
    dispatchTarget: null,
  };
  hook.dispatcher = {
    dispatch(action) {
      if (typeof hook.dispatchTarget !== "function" || typeof hook.reducer !== "function") {
        releaseReactStatePayload(action);
        throw new Error("React reducer dispatch is not available");
      }
      const previous = browserStoredValueForUpdate(hook);
      if (previous === NO_STORED_VALUE) {
        releaseReactStatePayload(action);
        throw new Error("React reducer dispatch has no committed state");
      }
      const value = withReactStateResultOwnership(
        (own) => own(callReducerHook(resources, hook, previous, action)),
        () => releaseReactStatePayload(action),
        "React reducer dispatch result ownership failed",
      );
      return enqueueBrowserStoredValue(resources, hook, hook.dispatchTarget, value);
    },
  };
  return hook;
}

function createReactDependencyListResource() {
  return { kind: "ReactDependencyList", values: [] };
}

function pushReactDependency(resources, deps, value) {
  const dependencyList = resolveReactDependencyListResource(resources, deps);
  dependencyList.values.push(resources.resolveResource(value, `React dependency[${dependencyList.values.length}]`));
}

function normalizeDependencyList(resources, deps) {
  const dependencyList = resolveReactDependencyListResource(resources, deps);
  if (!Array.isArray(dependencyList.values)) {
    throw new Error("React dependency list values must be an array");
  }
  return dependencyList.values.slice();
}

function resolveReactDependencyListResource(resources, deps) {
  const dependencyList = resources.resolveResource(deps, "ReactDependencyList");
  if (dependencyList?.kind !== "ReactDependencyList") {
    throw new Error("ReactDependencyList resource has invalid value");
  }
  return dependencyList;
}

function normalizeDependencyListOrRelease(resources, deps, setup, cleanup) {
  try {
    return normalizeDependencyList(resources, deps);
  } catch (error) {
    releaseEffectCallbacks(setup, cleanup);
    throw error;
  }
}

function normalizeCallbackDependencyListOrRelease(resources, deps, callback) {
  try {
    return normalizeDependencyList(resources, deps);
  } catch (error) {
    releaseLeanCallback(callback);
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
      const previous = hook.value;
      const value = typeof next === "function" ? next(previous) : next;
      hook.value = value;
      if (Object.is(previous, value)) {
        releaseReactStatePayload(value);
      } else {
        releaseReactStatePayload(previous);
      }
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
      try {
        const previous = hook.value;
        const value = callReducerHook(resources, hook, previous, action);
        hook.value = value;
        if (Object.is(previous, value)) {
          releaseReactStatePayload(value);
        } else {
          releaseReactStatePayload(previous);
        }
        scheduleRender?.();
        return undefined;
      } finally {
        releaseReactStatePayload(action);
      }
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

function callMemoCalculation(resources, calculate) {
  return withReactStateResultOwnership(
    (own) => own(takeReactStatePayload(resources, calculate())),
    () => releaseLeanCallback(calculate),
    "React memo result ownership failed",
  );
}

function createBrowserEffect(resources, setup, cleanup) {
  const state = {
    setup,
    cleanup,
    released: false,
    report: (error) => resources.recordGcFinalizerError?.(error),
  };
  const effect = () => {
    const setupInvocation = retainReactEventCallback(setup);
    let cleanupInvocation = null;
    let resource = null;
    try {
      cleanupInvocation = retainReactEventCallback(cleanup);
      resource = setupInvocation();
    } catch (error) {
      const errors = [error instanceof Error ? error : new Error(String(error))];
      collectCleanupError(errors, () => releaseHostResource(resource));
      collectCleanupError(errors, () => setupInvocation.release());
      collectCleanupError(errors, () => releaseLeanCallback(cleanupInvocation));
      throwCollectedErrors(errors, "React effect setup failed during ownership cleanup");
    }
    const setupReleaseErrors = [];
    collectCleanupError(setupReleaseErrors, () => setupInvocation.release());
    if (setupReleaseErrors.length !== 0) {
      collectCleanupError(setupReleaseErrors, () => releaseHostResource(resource));
      collectCleanupError(setupReleaseErrors, () => releaseLeanCallback(cleanupInvocation));
      throwCollectedErrors(setupReleaseErrors, "React effect setup lease release failed during ownership cleanup");
    }
    let disposed = false;
    return () => {
      if (disposed) return undefined;
      disposed = true;
      const ownedCleanup = cleanupInvocation;
      const ownedResource = resource;
      cleanupInvocation = null;
      resource = null;
      const errors = [];
      const cleaned = collectCleanupError(errors, () => ownedCleanup(ownedResource));
      collectCleanupError(errors, () => releaseHostResource(ownedResource));
      collectCleanupError(errors, () => ownedCleanup.release());
      throwCollectedErrors(errors, "React effect invocation cleanup failed");
      return cleaned.value;
    };
  };
  browserEffectStates.set(effect, state);
  if (browserEffectFinalizer === null) {
    releaseBrowserEffectState(state);
    throw new Error("browser React effects require FinalizationRegistry support");
  }
  browserEffectFinalizer.register(effect, state, effect);
  return effect;
}

function releaseBrowserEffect(effect) {
  const state = browserEffectStates.get(effect);
  if (state === undefined) return false;
  browserEffectFinalizer?.unregister(effect);
  return releaseBrowserEffectState(state);
}

function releaseBrowserEffectState(state, fromFinalizer = false) {
  if (state?.released === true) return false;
  state.released = true;
  const setup = state.setup;
  const cleanup = state.cleanup;
  state.setup = null;
  state.cleanup = null;
  const errors = [];
  collectCleanupError(errors, () => releaseLeanCallback(setup));
  collectCleanupError(errors, () => releaseLeanCallback(cleanup));
  if (errors.length !== 0) {
    if (!fromFinalizer) {
      throwCollectedErrors(errors, "React effect base callback releases failed");
    }
    reportReactFinalizerErrors(state.report, errors);
  }
  return true;
}

function reportReactFinalizerErrors(report, errors) {
  if (typeof report !== "function") return;
  for (const error of errors.slice(0, 16)) {
    try {
      report(error);
    } catch {
      // Finalization must never surface an exception through the host job queue.
    }
  }
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
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => releaseEffectCallbacks(setup, cleanup));
    throwCollectedErrors(errors, "virtual React effect replacement failed during callback cleanup");
  }
  hook.setup = setup;
  hook.cleanup = cleanup;
  hook.dependencyList = dependencyList;
  try {
    hook.resource = setup();
  } catch (error) {
    hook.setup = null;
    hook.cleanup = null;
    hook.resource = null;
    hook.dependencyList = null;
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => releaseEffectCallbacks(setup, cleanup));
    throwCollectedErrors(errors, "virtual React effect setup failed during callback cleanup");
  }
  return undefined;
}

function disposeVirtualEffectHook(hook) {
  const errors = [];
  collectCleanupError(errors, () => releasePendingEffectCallbacks(hook));
  collectCleanupError(errors, () => cleanupVirtualEffectInstance(hook));
  throwCollectedErrors(errors, "virtual React effect disposal failed");
}

function cleanupVirtualEffectInstance(hook) {
  const setup = hook.setup;
  const cleanup = hook.cleanup;
  const resource = hook.resource;
  hook.setup = null;
  hook.cleanup = null;
  hook.resource = null;
  hook.dependencyList = null;
  const errors = [];
  const cleaned = typeof setup === "function" && typeof cleanup === "function"
    ? collectCleanupError(errors, () => cleanup(resource))
    : { value: undefined };
  collectCleanupError(errors, () => releaseHostResource(resource));
  collectCleanupError(errors, () => releaseEffectCallbacks(setup, cleanup));
  throwCollectedErrors(errors, "React effect invocation cleanup failed");
  return cleaned.value;
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
  const errors = [];
  collectCleanupError(errors, () => releaseLeanCallback(setup));
  collectCleanupError(errors, () => releaseLeanCallback(cleanup));
  throwCollectedErrors(errors, "React effect callback releases failed");
}

function takeEffectCallbackLeases(setup, cleanup) {
  const ownedSetup = takeCallbackLease(setup, "React effect setup callback");
  try {
    return [ownedSetup, takeCallbackLease(cleanup, "React effect cleanup callback")];
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, () => ownedSetup.release());
    throwCollectedErrors(errors, "React effect callback lease transfer failed");
  }
}

function stagePendingEffectCallbacks(componentState, hook, setup, cleanup, dependencyList = null) {
  try {
    releasePendingEffectCallbacks(hook);
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, () => releaseEffectCallbacks(setup, cleanup));
    throwCollectedErrors(errors, "React pending effect replacement failed during callback cleanup");
  }
  [setup, cleanup] = takeEffectCallbackLeases(setup, cleanup);
  try {
    hook.nextDependencyList = dependencyList;
    hook.nextSetup = setup;
    hook.nextCleanup = cleanup;
    componentState.pendingEffects.push(hook);
  } catch (error) {
    const errors = [error];
    hook.nextDependencyList = null;
    hook.nextSetup = null;
    hook.nextCleanup = null;
    collectCleanupError(errors, () => releaseEffectCallbacks(setup, cleanup));
    throwCollectedErrors(errors, "React pending effect registration failed during callback cleanup");
  }
}

function stagePendingReducerCallback(componentState, hook, reducer) {
  releasePendingReducerHook(hook);
  hook.nextReducer = reducer;
  hook.reducerPending = true;
  componentState.pendingReducers.push(hook);
}

function commitPendingReducerCallbacks(componentState) {
  const reducers = componentState?.pendingReducers?.splice(0) ?? [];
  const errors = [];
  for (const hook of reducers) {
    collectCleanupError(errors, () => commitPendingReducerHook(hook));
  }
  throwCollectedErrors(errors, "React reducer commit cleanup failed");
}

function releasePendingReducerCallbacks(componentState) {
  const reducers = componentState?.pendingReducers?.splice(0) ?? [];
  const errors = [];
  for (const hook of reducers) {
    collectCleanupError(errors, () => releasePendingReducerHook(hook));
  }
  throwCollectedErrors(errors, "React pending reducer callback releases failed");
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
  const reducer = hook.nextReducer;
  hook.nextReducer = null;
  hook.reducerPending = false;
  releaseLeanCallback(reducer);
}

function disposeReducerHook(resources, hook) {
  const reducer = hook?.reducer;
  const nextReducer = hook?.nextReducer;
  const dispatcher = hook?.dispatcher;
  if (hook !== null && hook !== undefined) {
    hook.reducer = null;
    hook.nextReducer = null;
    hook.reducerPending = false;
    hook.dispatcher = null;
    hook.dispatchTarget = null;
  }
  const errors = [];
  collectCleanupError(errors, () => releaseLeanCallback(reducer));
  collectCleanupError(errors, () => releaseLeanCallback(nextReducer));
  if (hook?.payloadLeases instanceof Set) {
    collectCleanupError(errors, () => disposeBrowserStoredValueHook(hook));
  } else if (Object.hasOwn(hook ?? {}, "value")) {
    const value = hook.value;
    hook.value = null;
    collectCleanupError(errors, () => releaseReactStatePayload(value));
  }
  if (dispatcher !== null && dispatcher !== undefined) {
    collectCleanupError(errors, () => resources.releaseValueResource(dispatcher));
  }
  throwCollectedErrors(errors, "React reducer disposal failed");
}

function callReducerHook(resources, hook, state, action) {
  const reducer = hook?.nextReducer ?? hook?.reducer;
  if (typeof reducer !== "function") {
    throw new Error("React reducer callback is not available");
  }
  return withReactStateResultOwnership(
    (own) => withStateUpdaterResourceScope(resources, () => {
      const stateResource = resources.temporaryResourceForValue(state);
      const actionResource = resources.temporaryResourceForValue(action);
      return own(takeReactStatePayload(resources, reducer(stateResource, actionResource)));
    }),
    null,
    "React reducer result ownership failed",
  );
}

function releaseLeanCallback(callback) {
  if (typeof callback?.release === "function") {
    callback.release();
  }
}

function stateResult(value, setter) {
  return {
    value,
    setter,
  };
}

function reducerStateResult(value, dispatcher) {
  return {
    value,
    dispatch: dispatcher,
  };
}

function setStateValue(resources, setter, value) {
  const stateSetter = resources.resolveResource(setter, "ReactStateSetter");
  if (typeof stateSetter?.set !== "function") {
    throw new Error("ReactStateSetter resource has invalid value");
  }
  stateSetter.set(retainReactStatePayload(resources, value));
  return undefined;
}

function modifyStateValue(resources, setter, update) {
  const stateSetter = resources.resolveResource(setter, "ReactStateSetter");
  update = takeCallbackLease(update, "react.state.modify callback");
  let released = false;
  const retainedUpdate = {
    remove() {
      if (released) return;
      released = true;
      resources.removeDisposable(retainedUpdate);
      update.release();
    },
  };
  resources.addDisposable(retainedUpdate);
  try {
    stateSetter.set((previous) => withReactStateResultOwnership(
      (own) => withStateUpdaterResourceScope(resources, () => {
        const previousResource = resources.temporaryResourceForValue(previous);
        return own(takeReactStatePayload(resources, update(previousResource)));
      }),
      () => retainedUpdate.remove(),
      "React state updater result ownership failed",
    ));
  } catch (error) {
    throwWithCleanup(
      error,
      () => retainedUpdate.remove(),
      "React state updater failed during callback cleanup",
    );
  }
  return undefined;
}

function dispatchReducerAction(resources, dispatch, action) {
  const dispatcher = resources.resolveResource(dispatch, "ReactReducerDispatch");
  if (typeof dispatcher?.dispatch !== "function") {
    throw new Error("ReactReducerDispatch resource has invalid value");
  }
  dispatcher.dispatch(retainReactStatePayload(resources, action));
  return undefined;
}

function withStateUpdaterResourceScope(resources, run) {
  if (typeof resources.withTemporaryResourceScope !== "function" ||
      typeof resources.temporaryResourceForValue !== "function") {
    throw new Error("react.state.modify requires temporary host resource support");
  }
  return resources.withTemporaryResourceScope(run);
}

function withReactStateResultOwnership(acquire, cleanup, message) {
  let hasResult = false;
  let result;
  const errors = [];
  collectCleanupError(errors, () => {
    acquire((value) => {
      if (hasResult) throw new Error("React state result ownership was acquired more than once");
      hasResult = true;
      result = value;
      return value;
    });
    if (!hasResult) throw new Error("React state result ownership was not acquired");
  });
  if (typeof cleanup === "function") {
    collectCleanupError(errors, cleanup);
  }
  if (errors.length !== 0) {
    if (hasResult) {
      collectCleanupError(errors, () => releaseReactStatePayload(result));
    }
    throwCollectedErrors(errors, message);
  }
  return result;
}

function borrowReactStatePayload(resources, value) {
  if (!isHostResource(value)) return value;
  try {
    return resources.resolveResource(value, "Js");
  } catch (error) {
    // Runtime-owned LeanRef handles are live HostResources outside this store.
    const payload = hostResourceValue(value);
    if (payload !== null && payload !== undefined) {
      return payload;
    }
    throw error;
  }
}

function retainReactStatePayload(resources, value) {
  return retainHostResourcePayload(borrowReactStatePayload(resources, value));
}

function takeReactStatePayload(resources, value) {
  const payload = borrowReactStatePayload(resources, value);
  if (!isRetainableHostResourcePayload(payload)) return payload;
  let retained;
  try {
    retained = retainHostResourcePayload(payload);
  } catch (error) {
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => consumeTransferredReactStatePayload(value, payload));
    throwCollectedErrors(errors, "React stored value retain failed during ownership cleanup");
  }
  try {
    consumeTransferredReactStatePayload(value, payload);
    return retained;
  } catch (error) {
    const errors = [error instanceof Error ? error : new Error(String(error))];
    collectCleanupError(errors, () => releaseHostResourcePayload(retained));
    throwCollectedErrors(errors, "React stored value ownership transfer failed");
  }
}

function consumeTransferredReactStatePayload(value, payload) {
  if (isHostResource(value)) {
    releaseHostResource(value);
  } else {
    releaseHostResourcePayload(payload);
  }
}

function releaseReactStatePayload(value) {
  if (isRetainableHostResourcePayload(value)) {
    releaseHostResourcePayload(value);
  }
}
