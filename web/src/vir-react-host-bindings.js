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
} from "./react/vir-react-node.js";
import {
  createHostResourceState,
  createReactHostHooks,
  createReactRootResourceHostBindings,
} from "./host/vir-host-resources.js";

export function createBrowserReactHostBindings(state = createHostResourceState(), {
  querySelector = queryBrowserElement,
} = {}) {
  const hookRuntime = createBrowserReactHookRuntime(state, React);
  const externalBadge = createExternalBadgeComponent(React);
  const hooks = {
    ...createReactHostHooks(),
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
      }),
    ...createReactJsValueHostBindings(state),
    ...createReactStateHostBindings(state, hookRuntime),
    "test.react.externalBadge": () => state.resourceForValue(externalBadge),
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

function createExternalBadgeComponent(React) {
  const render = (props = {}, ref = null) => {
    const { children, ...rest } = props;
    return React.createElement("span", {
      ...rest,
      ref,
      "data-external-component": "true",
    }, children);
  };
  if (typeof React?.forwardRef === "function") {
    const component = React.forwardRef(function VirExternalBadge(props, ref) {
      return render(props, ref);
    });
    component.displayName = "VirExternalBadge";
    return component;
  }
  function VirExternalBadge(props) {
    return render(props, props?.ref ?? null);
  }
  VirExternalBadge.displayName = "VirExternalBadge";
  return VirExternalBadge;
}
