/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { createBrowserReactHookBindings } from "../../web/src/react/vir-react-hooks.js";

const resultKey = "__leanVirReactRefLifetimeSmoke";

globalThis[resultKey] = runReactRefSmoke().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  }),
);

async function runReactRefSmoke() {
  const bindings = createBrowserReactHookBindings(React);
  const container = document.createElement("div");
  container.id = "react-ref-smoke-root";
  document.body.append(container);
  const payload = { kind: "exact React ref payload" };
  const root = createRoot(container);
  let refObject = null;

  function Probe({ attached }) {
    refObject = bindings["react.useRef"](payload);
    return attached
      ? React.createElement("div", { id: "react-ref-target", ref: refObject })
      : null;
  }

  try {
    flushSync(() =>
      root.render(React.createElement(Probe, { attached: false })),
    );
    requireState(
      refObject?.current === payload,
      "useRef must store the exact initial JavaScript value",
    );
    const unattached = refObject.current === payload ? "payload" : "unexpected";

    flushSync(() =>
      root.render(React.createElement(Probe, { attached: true })),
    );
    requireState(
      refObject?.current instanceof HTMLElement &&
        refObject.current.id === "react-ref-target",
      "React must replace ref.current with the mounted DOM element",
    );
    const attached = refObject.current.id;

    flushSync(() =>
      root.render(React.createElement(Probe, { attached: false })),
    );
    requireState(
      refObject?.current === null,
      "React must clear ref.current when the target unmounts",
    );
    return { unattached, attached, cleared: refObject.current };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}
