/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";

// Application policy, not a VIR request manager. The caller provides an exact
// position-specific session, stable query object, runtime and Lean component.
export function RpcReferenceWidget({ runtime, view, session, query }) {
  const [state, setState] = React.useState({
    reply: null,
    status: "loading",
    error: null,
  });
  React.useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    const succeed = (reply) => {
      if (active) setState({ reply, status: "ready", error: null });
    };
    const fail = (error) => {
      if (active)
        setState((previous) => ({ ...previous, status: "error", error }));
    };
    try {
      runtime
        .call(
          "RpcReferenceWidget.request",
          session,
          "RpcBrowserServer.create",
          query,
          { abortSignal: abort.signal },
        )
        .then(succeed, fail);
    } catch (error) {
      fail(error);
    }
    return () => {
      active = false;
      abort.abort();
    };
  }, [runtime, session, query]);

  const previous =
    state.reply === null ? "" : " Showing the previous response.";
  const status =
    state.status === "loading"
      ? `Loading…${previous}`
      : state.status === "error"
        ? `Request failed: ${state.error?.message ?? String(state.error)}.${previous}`
        : "Ready";
  return React.createElement(
    "section",
    { "aria-busy": state.status === "loading" },
    React.createElement(
      "p",
      {
        role: state.status === "error" ? "alert" : "status",
        "data-rpc-status": state.status,
      },
      status,
    ),
    // Keep the last successful child mounted while refreshing, preserving state.
    state.reply === null
      ? null
      : runtime.call("RpcReferenceWidget.render", view, state.reply),
  );
}
