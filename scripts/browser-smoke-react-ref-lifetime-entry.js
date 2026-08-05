/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { registerHostResourcePayloadLifetime } from "../web/src/host-resource.js";
import { createHostResourceState } from "../web/src/host/vir-host-resources.js";
import {
  createBrowserReactHookRuntime,
  createReactStateHostBindings,
} from "../web/src/react/vir-react-hooks.js";

const resultKey = "__leanVirReactRefLifetimeSmoke";

globalThis[resultKey] = runReactRefLifetimeSmoke().then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
  }),
);

async function runReactRefLifetimeSmoke() {
  const resources = createHostResourceState();
  const hookRuntime = createBrowserReactHookRuntime(resources, React);
  const bindings = createReactStateHostBindings(resources, hookRuntime);
  const componentState = hookRuntime.createComponentState();
  const container = document.createElement("div");
  container.id = "react-ref-lifetime-smoke-root";
  document.body.append(container);

  let leases = 1;
  let releases = 0;
  let finalized = false;
  const payload = { kind: "browser React ref lifetime payload" };
  registerHostResourcePayloadLifetime(payload, {
    retain() {
      if (finalized) throw new Error("cannot retain the finalized React ref payload");
      leases++;
      return payload;
    },
    release() {
      if (leases === 0) return false;
      leases--;
      releases++;
      if (leases === 0) finalized = true;
      return true;
    },
  });

  const input = resources.adoptResourceForValue(payload, { tracked: false });
  const root = createRoot(container);
  let inputReleased = false;
  let componentDisposed = false;
  let refObject = null;

  function Probe({ attached }) {
    return hookRuntime.withComponentRender(componentState, () => {
      const refResource = bindings["react.useRef"](input);
      refObject = resources.resolveResource(refResource, "ReactRef");
      resources.releaseResource(refResource);
      hookRuntime.commitComponentRender(componentState);
      return attached
        ? React.createElement("div", { id: "react-ref-lifetime-target", ref: refObject })
        : null;
    });
  }

  try {
    flushSync(() => root.render(React.createElement(Probe, { attached: false })));
    requireState(leases === 2, "the unattached ref must own one committed payload lease", { leases, releases });
    requireState(refObject?.current === payload, "the unattached ref must still contain its initial payload", {
      leases,
      releases,
    });
    const unattached = { leases, releases, current: "payload" };

    flushSync(() => root.render(React.createElement(Probe, { attached: true })));
    requireState(leases === 1, "React attachment must release the ref hook's displaced payload lease", {
      leases,
      releases,
    });
    requireState(
      refObject?.current instanceof HTMLElement && refObject.current.id === "react-ref-lifetime-target",
      "React must replace ref.current with the mounted DOM element",
      { leases, releases },
    );
    const attached = { leases, releases, current: "element" };

    flushSync(() => root.render(React.createElement(Probe, { attached: false })));
    requireState(leases === 1, "clearing the DOM ref must not recreate or lose a payload lease", {
      leases,
      releases,
    });
    requireState(refObject?.current === null, "React must clear ref.current when the target unmounts", {
      leases,
      releases,
    });
    const cleared = { leases, releases, current: "null" };

    resources.releaseResource(input);
    inputReleased = true;
    requireState(leases === 0 && finalized, "releasing the independent input must finalize the payload", {
      leases,
      releases,
    });

    return {
      unattached,
      attached,
      cleared,
      released: { leases, releases, finalized },
    };
  } finally {
    flushSync(() => root.unmount());
    if (!componentDisposed) {
      hookRuntime.disposeComponent(componentState);
      componentDisposed = true;
    }
    if (!inputReleased) {
      resources.releaseResource(input);
      inputReleased = true;
    }
    resources.dispose();
    container.remove();
  }
}

function requireState(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}: ${JSON.stringify(details)}`);
  }
}
