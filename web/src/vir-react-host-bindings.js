/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "./vir-react-dom-client.js";
import {
  createBrowserReactHookRuntime,
  createReactJsValueHostBindings,
  createReactStateHostBindings,
} from "./react/vir-react-hooks.js";
import {
  createBrowserReactNodeElementResource,
  createBrowserReactNodeFragmentResource,
  createBrowserReactNodeTextResource,
  createBrowserReactRootResource as createBrowserReactRootResourceFromNode,
  reactNodeResourceFactories,
} from "./react/vir-react-node.js";
import {
  hasHostResourceFinalizationSupport,
} from "./host-resource.js";
import {
  createHostResourceState,
  createReactHostHooks,
  createReactRootResourceHostBindings,
} from "./host/vir-host-resources.js";

export function createBrowserReactHostBindings(state = createHostResourceState(), {
  querySelector = queryBrowserElement,
} = {}) {
  if (!hasHostResourceFinalizationSupport()) {
    throw new Error("browser React host bindings require FinalizationRegistry and WeakRef support");
  }
  const hookRuntime = createBrowserReactHookRuntime(state, React);
  const hooks = {
    ...createReactHostHooks({
      resources: state,
      reportError: (error) => state.recordGcFinalizerError(error),
    }),
    hookRuntime,
  };
  return {
    ...createReactRootResourceHostBindings(state, (target) =>
      createBrowserReactRootResource(state, ReactDOMClient.createRoot(target), React, hooks), {
        querySelector,
        createNodeTextResource: (value) => createBrowserReactNodeTextResource(state, value),
        createNodeElementResource: (elementType, props, children) =>
          createBrowserReactNodeElementResource(state, React.createElement, hooks, elementType, props, children),
        createNodeFragmentResource: (props, children) =>
          createBrowserReactNodeFragmentResource(state, React.createElement, React.Fragment, props, children),
        ...reactNodeResourceFactories,
      }),
    ...createReactJsValueHostBindings(state),
    ...createReactStateHostBindings(state, hookRuntime),
  };
}

function createBrowserReactRootResource(state, root, React, hooks) {
  return createBrowserReactRootResourceFromNode(state, root, React, hooks);
}

function queryBrowserElement(selector) {
  if (!globalThis.document) {
    throw new Error("React selector host bindings require globalThis.document");
  }
  return globalThis.document.querySelector(selector);
}
