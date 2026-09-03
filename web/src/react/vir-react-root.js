/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  collectCleanupError,
  throwCollectedErrors,
} from "../runtime/cleanup.js";

export function createReactRootHostBindings(
  lifecycle,
  createRoot,
) {
  function createTrackedRoot(container) {
    const root = createRoot(container);
    lifecycle.addDisposable(root, () => cleanupTrackedRoot(root));
    return root;
  }

  function cleanupTrackedRoot(root) {
    root.unmount();
  }

  function releaseRoot(root) {
    const errors = [];
    collectCleanupError(errors, () => lifecycle.removeDisposable(root));
    collectCleanupError(errors, () => cleanupTrackedRoot(root));
    throwCollectedErrors(errors, "React root release failed");
  }

  return {
    "react.root.create": (container) => {
      const root = createTrackedRoot(container);
      return lifecycle.stageResult(root, {
        onAbort: () => releaseRoot(root),
      });
    },
    "react.root.renderNode": (root, node) => {
      root.render(node);
      return undefined;
    },
    "react.root.unmount": (root) => {
      releaseRoot(root);
      return undefined;
    },
  };
}
