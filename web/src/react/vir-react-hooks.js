/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createBrowserReactHookRuntime(resources, React) {
  const setters = new WeakMap();
  let currentComponent = null;
  return {
    createComponentState() {
      return { setters: new Set() };
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
      for (const setter of componentState?.setters ?? []) {
        resources.releaseValueResource(setter);
      }
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
  };
}

export function createVirtualReactHookRuntime(resources) {
  let currentComponent = null;
  return {
    createComponentState(scheduleRender) {
      return {
        hookIndex: 0,
        hooks: [],
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
        resources.releaseValueResource(hook.setter);
      }
      if (Array.isArray(componentState?.hooks)) {
        componentState.hooks.length = 0;
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
      }
      return stateResult(resources, hook.value, hook.setter);
    },
  };
}

export function createReactStateHostBindings(resources, hookRuntime) {
  return {
    "react.useState": (initial) => hookRuntime.useState(initial),
    "react.state.set": (setter, value) => setStateValue(resources, setter, value),
    "react.state.modify": (setter, update) => modifyStateValue(resources, setter, update),
  };
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

function createVirtualStateHook(initial, scheduleRender) {
  const hook = {
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

function stateResult(resources, value, setter) {
  return {
    value,
    setter: resources.resourceForValue(setter),
  };
}

function setStateValue(resources, setter, value) {
  resources.resolveResource(setter, "ReactStateSetter").set(value);
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
        return update(previous);
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
