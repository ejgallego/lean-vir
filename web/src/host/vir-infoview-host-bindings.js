/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createInfoviewHostBindings({
  useClientNotificationEffect = null,
} = {}) {
  return {
    "infoview.rpcSession.call": (session, method, params) =>
      session.call(method, params),
    "infoview.rpcSession.callWithOptions": (session, method, params, options) =>
      session.call(method, params, options),
    "infoview.clientRequestOptions.empty": () => ({}),
    "infoview.clientRequestOptions.setAbortSignal": (options, signal) => {
      options.abortSignal = signal;
    },
    "infoview.useClientNotificationEffect": (method, callback, deps) => {
      if (useClientNotificationEffect === null) {
        throw new Error("useClientNotificationEffect requires the upstream infoview host");
      }
      return useClientNotificationEffect(method, callback, deps);
    },
  };
}
