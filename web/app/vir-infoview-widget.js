/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { DocumentPosition, EditorContext, TaggedText_stripTags, useClientNotificationEffect, useRpcSession } from "@leanprover/infoview";
import { createBrowserHostBindings } from "../src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../src/vir-react-host-bindings.js";
import { createVirRuntime as createBundledVirRuntime } from "../src/vir-runtime.js";
import { widgetErrorMessage as errorMessage } from "../src/vir-widget-errors.js";
import { isEffectfulInterfaceEffect } from "../src/runtime/interface-effects.js";
import { INTERFACE_TAG } from "../src/runtime/interface-tags.js";
import { collectCleanupError } from "../src/runtime/cleanup.js";

const e = React.createElement;
const wasmModuleCache = new Map();

const shellStyle = {
  display: "grid",
  gap: "0.5rem",
  minWidth: 0,
};

const statusStyle = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "0.82rem",
};

export default function VirInfoviewWidget(props) {
  const rpcSession = useRpcSession();
  const hostContextRef = React.useRef({
    rpcSession,
    position: null,
  });
  const setupHintRef = React.useRef("");
  const [status, setStatus] = React.useState({
    kind: "loading",
    message: "Loading VIR widget...",
  });
  const loadedRef = React.useRef(null);
  const [loaded, setLoaded] = React.useState(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const refreshGenerationRef = React.useRef(0);
  const loadingGenerationRef = React.useRef(null);
  const irPackageKey =
    props.irPackage === null || props.irPackage === undefined
      ? ""
      : JSON.stringify(props.irPackage);
  const configurationKey = JSON.stringify([
    props.wasmPath, irPackageKey, props.componentEntry,
  ]);

  React.useLayoutEffect(() => {
    let position = null;
    let setupHint = "";
    try {
      position = requiredPosition(props.pos, "pos");
      setupHint = optionalString(props.setupHint, "setupHint");
    } catch {
      // The loading effect reports invalid widget configuration.
    }
    hostContextRef.current.rpcSession = rpcSession;
    hostContextRef.current.position = position;
    hostContextRef.current.configurationKey = configurationKey;
    setupHintRef.current = setupHint;
    return () => {
      // Invalidate pending candidates at removal, before passive cleanup runs.
      hostContextRef.current.configurationKey = null;
    };
  }, [rpcSession, props.pos, props.setupHint, configurationKey]);

  async function refreshLoadedWidget(isDisposed) {
    const generation = refreshGenerationRef.current;
    loadingGenerationRef.current = generation;
    const obsolete = () => isDisposed() ||
      configurationKey !== hostContextRef.current.configurationKey;
    let setupHint = "";
    let service = null;
    try {
      const config = widgetRuntimeConfigFromProps(props);
      setupHint = config.setupHint;
      service = await loadRuntimeService({
        rpcSession: hostContextRef.current.rpcSession,
        config,
      });
      if (obsolete()) {
        service.runtime.dispose();
        return;
      }
      const componentEntry = validateWidgetComponentEntry(
        service.runtime,
        config.componentEntry,
      );
      const component = service.runtime.call(componentEntry.entry);
      if (typeof component !== "function") {
        throw new Error(
          `VIR widget component entry ${componentEntry.entry} did not return a JavaScript function`,
        );
      }
      const next = {
        service,
        component,
        configurationKey,
        generation: refreshGenerationRef.current,
      };
      loadedRef.current = next;
      setLoaded(next);
      service = null;
      setReloadToken(0);
      setStatus({ kind: "ready", message: componentEntry.entry });
    } catch (error) {
      const errors = [error];
      if (service !== null) {
        collectCleanupError(errors, () => service.runtime.dispose());
      }
      const failure = errors.length === 1
        ? error
        : new AggregateError(errors, "VIR widget loading failed");
      if (!obsolete()) {
        setStatus({ kind: "error", message: errorMessage(failure, setupHint) });
      } else {
        console.error(failure);
      }
    } finally {
      if (loadingGenerationRef.current === generation) {
        loadingGenerationRef.current = null;
      }
    }
  }

  React.useEffect(() => {
    let disposed = false;
    setLoaded(null);
    setStatus({ kind: "loading", message: "Loading VIR widget..." });
    const generation = ++refreshGenerationRef.current;
    refreshLoadedWidget(
      () => disposed || generation !== refreshGenerationRef.current,
    );
    return () => {
      disposed = true;
      // React owns the descendant UI. Release shell ownership, not the runtime:
      // surviving callbacks and JSL still own their original generation.
      loadedRef.current = null;
    };
  }, [
    props.wasmPath,
    irPackageKey,
    props.componentEntry,
  ]);

  React.useEffect(() => {
    if (reloadToken === 0) {
      return undefined;
    }
    let disposed = false;
    const generation = ++refreshGenerationRef.current;
    refreshLoadedWidget(
      () => disposed || generation !== refreshGenerationRef.current,
    );
    return () => {
      disposed = true;
    };
  }, [
    props.wasmPath,
    irPackageKey,
    props.componentEntry,
    reloadToken,
  ]);

  React.useEffect(() => {
    let intervalId = null;
    let disposed = false;
    let inFlight = false;
    try {
      const config = widgetRuntimeConfigFromProps(props);
      if (config.autoReloadMs > 0) {
        intervalId = setInterval(() => {
          // The first package has no installed revision yet. Polling here can
          // continually supersede a slow initial load before it can mount.
          if (inFlight || loadedRef.current === null || loadingGenerationRef.current !== null) {
            return;
          }
          inFlight = true;
          shouldReloadIRPackage({
            rpcSession: hostContextRef.current.rpcSession,
            irPackage: config.irPackage,
            position: hostContextRef.current.position,
            currentRevision: loadedRef.current.service.packageRevision,
          })
            .then((shouldReload) => {
              if (!disposed && shouldReload) {
                setReloadToken((token) => token + 1);
              }
            })
            .catch((error) => {
              if (!disposed) {
                setStatus({
                  kind: "error",
                  message: errorMessage(error, setupHintRef.current),
                });
              }
            })
            .finally(() => {
              inFlight = false;
            });
        }, config.autoReloadMs);
      }
    } catch {
      return undefined;
    }
    return () => {
      disposed = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, [
    props.wasmPath,
    irPackageKey,
    props.componentEntry,
    props.autoReloadMs,
  ]);

  return e(
    "section",
    {
      className: "vir-infoview-widget-shell",
      "data-vir-infoview-state": status.kind,
      onClick: stopInfoviewEvent,
      onContextMenu: stopInfoviewEvent,
      onMouseDown: stopInfoviewEvent,
      onPointerDown: stopInfoviewEvent,
      style: shellStyle,
    },
    loaded?.configurationKey === configurationKey
      ? e(loaded.component, { ...props, key: loaded.generation })
      : null,
    status.kind === "ready"
      ? null
      : e(
          "pre",
          { className: "vir-infoview-widget-status", style: statusStyle },
          status.message,
        ),
  );
}

function stopInfoviewEvent(event) {
  event.stopPropagation();
}

export function validateWidgetComponentEntry(runtime, entryName) {
  const entry = runtime.findManifestEntry(entryName);
  if (entry === null || entry === undefined) {
    throw new Error(`VIR widget component entry not found: ${entryName}`);
  }
  if (
    !isEffectfulInterfaceEffect(entry.effect) ||
    entry.args?.length !== 0 ||
    entry.result?.interfaceTag !== INTERFACE_TAG.RESOURCE
  ) {
    throw new Error(
      `VIR widget component entry ${entryName} must be an effectful () -> Component entry`,
    );
  }
  return entry;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`VIR widget ${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`VIR widget ${label} must be a string`);
  }
  return value;
}

function widgetRuntimeConfigFromProps(props) {
  const irPackage = requiredIRPackage(props.irPackage, "irPackage");
  return {
    wasmPath: requiredString(props.wasmPath, "wasmPath"),
    irPackage,
    componentEntry: requiredString(props.componentEntry, "componentEntry"),
    position: requiredPosition(props.pos, "pos"),
    autoReloadMs: optionalNonNegativeInteger(
      props.autoReloadMs,
      "autoReloadMs",
    ),
    setupHint: optionalString(props.setupHint, "setupHint"),
  };
}

function requiredIRPackage(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`VIR widget ${label} must be an object`);
  }
  const roots = requiredStringArray(value.roots, `${label}.roots`);
  if (roots.length === 0) {
    throw new Error(`VIR widget ${label}.roots must not be empty`);
  }
  return { roots };
}

function requiredPosition(value, label) {
  if (value === null || typeof value !== "object") {
    throw new Error(`VIR widget ${label} must be an LSP position`);
  }
  if (
    !Number.isInteger(value.line) ||
    value.line < 0 ||
    !Number.isInteger(value.character) ||
    value.character < 0
  ) {
    throw new Error(
      `VIR widget ${label} must contain non-negative line and character`,
    );
  }
  return {
    line: value.line,
    character: value.character,
  };
}

function optionalNonNegativeInteger(value, label) {
  if (value === undefined || value === null) {
    return 0;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`VIR widget ${label} must be a non-negative integer`);
  }
  return value;
}

export async function loadRuntimeService({ rpcSession, config }) {
  const { wasmPath, irPackage, position } = config;
  requiredString(wasmPath, "wasmPath");
  if (irPackage === null || irPackage === undefined) {
    throw new Error("VIR widget irPackage must be set");
  }
  if (position === null || position === undefined) {
    throw new Error("VIR widget irPackage requires an infoview position");
  }
  const wasmInfo = await statAsset(rpcSession, wasmPath);
  const packageInfo = await statIRPackage(rpcSession, irPackage, position);
  const wasmModule = await loadWasmModule(rpcSession, wasmPath, wasmInfo.revision);
  const builtPackage = await buildIRPackage(rpcSession, irPackage, position);
  if (builtPackage.revision !== packageInfo.revision) {
    throw new Error(
      "VIR IR package changed while loading; reload the widget to use the latest Lean snapshot",
    );
  }
  const runtime = await createBundledVirRuntime({
    wasmModule,
    irPackageSet: [decodeBase64Bytes(builtPackage.dataBase64)],
    defaultHostBindings: () => createBrowserHostBindings({
      infoviewEditorContext: EditorContext,
      infoviewPositionToTdpp: DocumentPosition.toTdpp,
      reactHostBindings: createBrowserReactHostBindings,
      infoviewUseClientNotificationEffect: useClientNotificationEffect,
      infoviewUseRpcSession: useRpcSession,
      infoviewStripTags: TaggedText_stripTags,
    }),
  });
  return { runtime, packageRevision: builtPackage.revision };
}

export async function shouldReloadIRPackage({
  rpcSession,
  irPackage,
  position,
  currentRevision,
}) {
  const info = await statIRPackage(rpcSession, irPackage, position);
  return info.revision !== currentRevision;
}

export async function loadWasmModule(rpcSession, path, revision) {
  let cached = wasmModuleCache.get(path);
  if (cached === undefined || cached.revision !== revision) {
    const module = loadAssetBytes(rpcSession, path).then((bytes) =>
      WebAssembly.compile(bytes),
    );
    cached = { revision, module };
    wasmModuleCache.set(path, cached);
    module.catch(() => {
      if (wasmModuleCache.get(path) === cached) {
        wasmModuleCache.delete(path);
      }
    });
  }
  return cached.module;
}

export async function loadAssetBytes(rpcSession, path) {
  const response = await rpcSession.call("Lean.Vir.Infoview.readAsset", {
    path,
  });
  return decodeBase64Bytes(assetDataBase64(response, path));
}

export async function statIRPackage(rpcSession, irPackage, position) {
  const response = await rpcSession.call("Lean.Vir.Infoview.statIRPackage", {
    package: irPackage,
    pos: position,
  });
  return irPackageStatInfo(response, irPackage.roots);
}

export async function buildIRPackage(rpcSession, irPackage, position) {
  const response = await rpcSession.call("Lean.Vir.Infoview.buildIRPackage", {
    package: irPackage,
    pos: position,
  });
  return irPackageInfo(response, irPackage.roots);
}

export async function statAsset(rpcSession, path) {
  const response = await rpcSession.call("Lean.Vir.Infoview.statAsset", {
    path,
  });
  return assetInfo(response, path);
}

function assetDataBase64(response, path) {
  assetInfo(response, path);
  return requiredString(response?.dataBase64, `asset ${path} dataBase64`);
}

function assetInfo(response, path) {
  const responsePath = requiredString(response?.path, `asset ${path} path`);
  if (responsePath !== path) {
    throw new Error(
      `VIR asset response path mismatch: expected ${path}, got ${responsePath}`,
    );
  }
  return {
    path: responsePath,
    mime: requiredString(response?.mime, `asset ${path} mime`),
    byteSize: requiredString(response?.byteSize, `asset ${path} byteSize`),
    modified: requiredString(response?.modified, `asset ${path} modified`),
    revision: requiredString(response?.revision, `asset ${path} revision`),
  };
}

function irPackageInfo(response, roots) {
  const info = irPackageStatInfo(response, roots);
  return {
    ...info,
    byteSize: requiredString(response?.byteSize, "IR package byteSize"),
    dataBase64: requiredString(response?.dataBase64, "IR package dataBase64"),
    report: optionalString(response?.report, "IR package report"),
  };
}

function irPackageStatInfo(response, roots) {
  const responseRoots = requiredStringArray(
    response?.roots,
    "IR package roots",
  );
  if (JSON.stringify(responseRoots) !== JSON.stringify(roots)) {
    throw new Error(
      `VIR IR package roots mismatch: expected ${roots.join(", ")}, got ${responseRoots.join(", ")}`,
    );
  }
  return {
    source: requiredString(response?.source, "IR package source"),
    roots: responseRoots,
    revision: requiredString(response?.revision, "IR package revision"),
  };
}

function requiredStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`VIR widget ${label} must be an array of strings`);
  }
  return value;
}

export function decodeBase64Bytes(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
