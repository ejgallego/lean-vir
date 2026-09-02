/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "./vir-react-dom-client.js";
import {
  createBrowserReactHookBindings,
  createReactJsValueHostBindings,
} from "./react/vir-react-hooks.js";
import {
  createBrowserLeanComponentNode,
  createBrowserReactNodeElement,
  createBrowserReactNodeFragment,
  reactNodeTextValue,
} from "./react/vir-react-node.js";
import {
  createHostLifecycle,
  createReactRootHostBindings,
} from "./host/vir-host-resources.js";

export function createBrowserReactHostBindings(
  state = createHostLifecycle(),
  { querySelector = queryBrowserElement } = {},
) {
  return {
    ...createReactRootHostBindings(
      state,
      (target) => ReactDOMClient.createRoot(target),
      {
        querySelector,
        createLeanComponentNode: (component, props, key) =>
          createBrowserLeanComponentNode(
            React.createElement,
            component,
            props,
            key,
          ),
        createNodeText: reactNodeTextValue,
        createNodeElement: (elementType, props, children) =>
          createBrowserReactNodeElement(
            React.createElement,
            elementType,
            props,
            children,
          ),
        createNodeFragment: (props, children) =>
          createBrowserReactNodeFragment(
            React.createElement,
            React.Fragment,
            props,
            children,
          ),
      },
    ),
    ...createReactJsValueHostBindings(),
    ...createBrowserReactHookBindings(React),
  };
}

function queryBrowserElement(selector) {
  if (!globalThis.document) {
    throw new Error("React selector host bindings require globalThis.document");
  }
  return globalThis.document.querySelector(selector);
}
