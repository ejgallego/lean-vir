/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import {
  createBrowserReactRootResource,
  createHostResourceState,
  createReactRootResourceHostBindings,
} from "./vir-host-bindings.js";

export function createBrowserReactHostBindings(state = createHostResourceState()) {
  return createReactRootResourceHostBindings(state, (target) =>
    createBrowserReactRootResource(state, ReactDOMClient.createRoot(target), React.createElement));
}
