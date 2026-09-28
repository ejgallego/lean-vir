/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import { createHostLifecycle } from "../../web/src/host/vir-active-host-bindings.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";

const resultKey = "__leanVirInfoviewHoverLifecycleSmoke";

globalThis[resultKey] = runHoverLifecycleSmoke().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  }),
);

async function runHoverLifecycleSmoke() {
  const lifecycle = createHostLifecycle();
  const bindings = createBrowserHostBindings({ lifecycle });
  const reference = document.createElement("div");
  const popup = document.createElement("div");
  document.body.append(reference, popup);
  const view = reference.ownerDocument.defaultView;
  const NativeResizeObserver = view.ResizeObserver;
  let constructed = 0;
  let disconnected = 0;
  let added = 0;
  let removed = 0;
  const nativeAdd = view.addEventListener;
  const nativeRemove = view.removeEventListener;
  view.ResizeObserver = class extends NativeResizeObserver {
    constructor(...args) {
      super(...args);
      constructed++;
    }

    disconnect() {
      disconnected++;
      return super.disconnect();
    }
  };
  view.addEventListener = function (type, ...args) {
    if (type === "resize" || type === "scroll") added++;
    return nativeAdd.call(this, type, ...args);
  };
  view.removeEventListener = function (type, ...args) {
    if (type === "resize" || type === "scroll") removed++;
    return nativeRemove.call(this, type, ...args);
  };

  let cleanup = null;
  let reentrantError = null;
  const reentrantTarget = document.createElement("div");
  try {
    cleanup = bindings["infoview.hover.observe"](
      reference,
      popup,
      () => undefined,
    );
    const activeBeforeDispose = lifecycle.debugResourceCounts().active;
    lifecycle.addDisposable({}, () => {
      try {
        bindings["infoview.hover.observe"](
          reentrantTarget,
          popup,
          () => undefined,
        );
      } catch (error) {
        reentrantError = error;
      }
    });
    lifecycle.dispose();
    const result = {
      activeBeforeDispose,
      activeAfterDispose: lifecycle.debugResourceCounts().active,
      constructed,
      disconnected,
      added,
      removed,
      reentrantError: reentrantError?.message ?? null,
    };
    cleanup();
    return result;
  } finally {
    view.ResizeObserver = NativeResizeObserver;
    view.addEventListener = nativeAdd;
    view.removeEventListener = nativeRemove;
    reference.remove();
    popup.remove();
  }
}
