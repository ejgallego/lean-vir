/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createBenchmarkHostBindings() {
  const documentValue = { title: "" };
  return {
    "browser.document.current": () => documentValue,
    "browser.document.getTitle": (document) => document.title,
    "browser.document.setTitle": (document, title) => {
      document.title = title;
      return undefined;
    },
    "test.callNatCallback": (input, callback) => callback(input),
    "test.recordNat": () => undefined,
  };
}
