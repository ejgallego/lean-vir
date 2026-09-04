/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { registerHostCallRollback } from "../host-boundary.js";

export function createReactRootHostBindings(lifecycle, createRoot) {
  function releaseRoot(root) {
    root.unmount();
    lifecycle.removeDisposable(root);
  }

  return {
    "react.root.create": (container) => {
      const root = createRoot(container);
      lifecycle.addDisposable(root, () => root.unmount());
      registerHostCallRollback(() => releaseRoot(root));
      return root;
    },
    "react.root.renderNode": (root, node) => root.render(node),
    "react.root.unmount": (root) => releaseRoot(root),
  };
}
