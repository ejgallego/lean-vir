/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";

const e = React.createElement;
const STRING_WIRE_TAG = 3;
const BOOL_WIRE_TAG = 2;
let nextMountId = 0;

const shellStyle = {
  display: "grid",
  gap: "0.5rem",
  minWidth: 0,
};

const mountStyle = {
  minWidth: 0,
};

const statusStyle = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "0.82rem",
};

export default function VirInfoviewWidget(props) {
  const [status, setStatus] = React.useState({ kind: "loading", message: "Loading VIR widget..." });
  const [mountId] = React.useState(() => freshMountId(props.mountId));

  React.useEffect(() => {
    let disposed = false;
    let runtime = null;

    async function start() {
      try {
        setStatus({ kind: "loading", message: "Loading VIR widget..." });
        const runtimeUrl = requiredString(props.runtimeUrl, "runtimeUrl");
        const wasmUrl = requiredString(props.wasmUrl, "wasmUrl");
        const packageUrl = requiredString(props.packageUrl, "packageUrl");
        const entryName = requiredString(props.entry, "entry");
        const runtimeModule = await import(runtimeUrl);
        const createVirRuntime = runtimeModule.createVirRuntime;
        if (typeof createVirRuntime !== "function") {
          throw new Error("VIR runtime module does not export createVirRuntime");
        }
        runtime = await createVirRuntime({ wasmUrl, irPackageUrl: packageUrl });
        const entry = validateWidgetEntry(runtime, entryName);
        const selector = `#${mountId}`;
        const mounted = runtime.call(entry.entry, selector);
        if (mounted !== true) {
          throw new Error(`VIR widget entry ${entry.entry} did not mount ${selector}`);
        }
        if (!disposed) {
          setStatus({ kind: "ready", message: entry.entry });
        }
      } catch (error) {
        runtime?.dispose?.();
        runtime = null;
        if (!disposed) {
          setStatus({ kind: "error", message: errorMessage(error) });
        }
      }
    }

    start();
    return () => {
      disposed = true;
      runtime?.dispose?.();
    };
  }, [props.runtimeUrl, props.wasmUrl, props.packageUrl, props.entry, mountId]);

  return e(
    "section",
    {
      className: "vir-infoview-widget-shell",
      "data-vir-infoview-state": status.kind,
      style: shellStyle,
    },
    e("div", {
      id: mountId,
      className: "vir-infoview-widget-mount",
      style: mountStyle,
    }),
    status.kind === "ready"
      ? null
      : e("pre", { className: "vir-infoview-widget-status", style: statusStyle }, status.message),
  );
}

export function validateWidgetEntry(runtime, entryName) {
  const entry = runtime.findManifestEntry?.(entryName)
    ?? runtime.interfaceManifest?.exports?.find((candidate) =>
      candidate.entry === entryName || candidate.id === entryName || candidate.jsName === entryName);
  if (entry === null || entry === undefined) {
    throw new Error(`VIR widget entry not found: ${entryName}`);
  }
  if (
    entry.effect !== "io" ||
    entry.args?.length !== 1 ||
    entry.args[0]?.type?.wireTag !== STRING_WIRE_TAG ||
    entry.result?.wireTag !== BOOL_WIRE_TAG
  ) {
    throw new Error(`VIR widget entry ${entryName} must have signature String -> IO Bool`);
  }
  return entry;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`VIR widget ${label} must be a non-empty string`);
  }
  return value;
}

function freshMountId(value) {
  const prefix = typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
    ? value
    : "vir-infoview-widget";
  nextMountId += 1;
  return `${prefix}-${nextMountId}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
