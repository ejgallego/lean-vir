/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { releaseCallbackRoot } from "../../web/src/runtime/callbacks.js";

export function createBenchmarkHostBindings(releaseCallback = releaseCallbackRoot) {
  const documentValue = { title: "" };
  return {
    "browser.document.current": () => documentValue,
    "browser.document.getTitle": (document) => document.title,
    "browser.document.setTitle": (document, title) => {
      document.title = title;
      return undefined;
    },
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        // This benchmark binding never retains the callback. Keep its root
        // lifetime deterministic without adding lifecycle fields to the exact
        // JavaScript function exposed to ordinary hosts.
        releaseCallback(callback);
      }
    },
    "test.recordNat": () => undefined,
  };
}
