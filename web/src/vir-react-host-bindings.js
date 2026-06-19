/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import {
  createBrowserReactHookRuntime,
  createReactJsValueHostBindings,
  createReactStateHostBindings,
} from "./react/vir-react-hooks.js";
import {
  createBrowserReactNodeElementResource,
  createBrowserReactNodeTextResource,
  createBrowserReactRootResource as createBrowserReactRootResourceFromNode,
} from "./react/vir-react-node.js";
import {
  createHostResourceState,
  createReactHostHooks,
  createReactRootResourceHostBindings,
} from "./host/vir-host-resources.js";

export function createBrowserReactHostBindings(state = createHostResourceState()) {
  const hookRuntime = createBrowserReactHookRuntime(state, React);
  const hooks = {
    ...createReactHostHooks(),
    hookRuntime,
  };
  return {
    ...createReactRootResourceHostBindings(state, (target) =>
      createBrowserReactRootResource(state, ReactDOMClient.createRoot(target), React, hooks), {
        createNodeTextResource: (value) => createBrowserReactNodeTextResource(state, value),
        createNodeElementResource: (tag, key, props, handlers, children) =>
          createBrowserReactNodeElementResource(state, React.createElement, hooks, tag, key, props, handlers, children),
      }),
    ...createReactJsValueHostBindings(state),
    ...createReactStateHostBindings(state, hookRuntime),
  };
}

function createBrowserReactRootResource(state, root, React, hooks) {
  return createBrowserReactRootResourceFromNode(state, root, React, hooks);
}
