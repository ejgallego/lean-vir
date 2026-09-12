/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { EditorContext, TaggedText_stripTags, useClientNotificationEffect, useRpcSession } from "@leanprover/infoview";
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
  const editorConnection = React.useContext(EditorContext);
  const hostContextRef = React.useRef({
    rpcSession,
    editorConnection,
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
    hostContextRef.current.editorConnection = editorConnection;
    hostContextRef.current.position = position;
    hostContextRef.current.configurationKey = configurationKey;
    setupHintRef.current = setupHint;
    return () => {
      // Invalidate pending candidates at removal, before passive cleanup runs.
      hostContextRef.current.configurationKey = null;
    };
  }, [rpcSession, editorConnection, props.pos, props.setupHint, configurationKey]);

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
        hostContext: hostContextRef.current,
        config,
      });
      if (obsolete()) {
        disposeRuntimeService(service);
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
        collectCleanupError(errors, () => disposeRuntimeService(service));
      }
      const failure = widgetCleanupError(errors, "VIR widget loading failed");
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
  const entry = requireWidgetManifestEntry(
    runtime,
    entryName,
    "component entry",
  );
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

function requireWidgetManifestEntry(runtime, entryName, label) {
  const entry =
    runtime.findManifestEntry?.(entryName) ??
    runtime.interfaceManifest?.exports?.find(
      (candidate) =>
        candidate.entry === entryName ||
        candidate.id === entryName ||
        candidate.jsName === entryName,
    );
  if (entry === null || entry === undefined) {
    throw new Error(`VIR widget ${label} not found: ${entryName}`);
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

export async function loadRuntimeService({
  rpcSession,
  hostContext = null,
  config,
}) {
  const sources = await resolveRuntimeSources(rpcSession, config);
  return createRuntimeService({
    rpcSession,
    hostContext: hostContext ?? {
      rpcSession,
      editorConnection: null,
      position: config.position,
    },
    sources,
  });
}

async function createRuntimeService({ rpcSession, hostContext, sources }) {
  const runtimeOptions = await loadRuntimeOptionsFromSources({
    rpcSession,
    sources,
  });
  runtimeOptions.defaultHostBindings = () =>
    createBrowserHostBindings({
      infoviewCommandDispatcher: createInfoviewCommandDispatcher({
        hostContext,
      }),
      reactHostBindings: createBrowserReactHostBindings,
      infoviewUseClientNotificationEffect: useClientNotificationEffect,
      infoviewUseRpcSession: useRpcSession,
      infoviewStripTags: TaggedText_stripTags,
    });
  return {
    packageRevision: sources.packageSource.revision ?? "",
    disposed: false,
    runtime: await createBundledVirRuntime(runtimeOptions),
  };
}

function createInfoviewCommandDispatcher({ hostContext }) {
  return {
    revealPosition(position) {
      const editorConnection = hostContext.editorConnection ?? null;
      if (
        editorConnection === null ||
        typeof editorConnection !== "object" ||
        typeof editorConnection.revealPosition !== "function"
      ) {
        return false;
      }
      editorConnection.revealPosition(position).catch((error) => {
        console.error(error);
      });
      return true;
    },
    insertText(position, text) {
      const editorConnection = hostContext.editorConnection ?? null;
      if (
        editorConnection === null ||
        typeof editorConnection !== "object" ||
        editorConnection.api === null ||
        typeof editorConnection.api !== "object" ||
        typeof editorConnection.api.applyEdit !== "function"
      ) {
        return false;
      }
      const cursor = { line: position.line, character: position.character };
      const edit = editorConnection.api.applyEdit({
        changes: {
          [position.uri]: [
            { range: { start: cursor, end: cursor }, newText: text },
          ],
        },
      });
      if (
        edit !== null &&
        typeof edit === "object" &&
        typeof edit.catch === "function"
      ) {
        edit.catch((error) => {
          console.error(error);
        });
      }
      return true;
    },
  };
}

function disposeRuntimeService(service) {
  if (!service.disposed) {
    service.disposed = true;
    service.runtime.dispose?.();
  }
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

export async function loadRuntimeOptions({
  rpcSession,
  wasmPath,
  irPackage,
  position,
}) {
  const sources = await resolveRuntimeSources(rpcSession, {
    wasmPath,
    irPackage,
    position,
  });
  return loadRuntimeOptionsFromSources({ rpcSession, sources });
}

async function resolveRuntimeSources(rpcSession, config) {
  const wasmSource = wasmAssetSource(config);
  const packageSource = irPackageSource(config);
  return {
    wasmSource: await resolveAssetSource(rpcSession, wasmSource),
    packageSource: await resolveAssetSource(rpcSession, packageSource),
  };
}

async function resolveAssetSource(rpcSession, source) {
  if (source.kind === "irPackage") {
    const info = await statIRPackage(
      rpcSession,
      source.package,
      source.position,
    );
    return { ...source, revision: info.revision, source: info.source };
  }
  const info = await statAsset(rpcSession, source.value);
  return { ...source, revision: info.revision };
}

async function loadRuntimeOptionsFromSources({ rpcSession, sources }) {
  const { wasmSource, packageSource } = sources;
  const options = {};
  options.wasmModule = await loadWasmModule(rpcSession, wasmSource);
  const irPackage = await buildIRPackage(
    rpcSession,
    packageSource.package,
    packageSource.position,
  );
  if (
    (packageSource.revision ?? "") !== "" &&
    irPackage.revision !== packageSource.revision
  ) {
    throw new Error(
      "VIR IR package changed while loading; retrying with the latest Lean snapshot",
    );
  }
  options.irPackageSet = [decodeBase64Bytes(irPackage.dataBase64)];
  return options;
}

export async function loadWasmModule(rpcSession, source) {
  const sourceKey = `${source.kind}:${source.value}`;
  const key = assetSourceCacheKey(source);
  let cached = wasmModuleCache.get(sourceKey);
  if (cached?.key !== key) {
    const module = compileWasmModule(rpcSession, source);
    cached = { key, module };
    wasmModuleCache.set(sourceKey, cached);
    module.catch(() => {
      if (wasmModuleCache.get(sourceKey) === cached) {
        wasmModuleCache.delete(sourceKey);
      }
    });
  }
  return cached.module;
}

async function compileWasmModule(rpcSession, source) {
  const bytes = await loadAssetBytes(rpcSession, source.value);
  return WebAssembly.compile(bytes);
}

function assetSourceCacheKey(source) {
  const revision = source.revision ?? "";
  return revision.length === 0
    ? `${source.kind}:${source.value}`
    : `${source.kind}:${source.value}:${revision}`;
}

function wasmAssetSource(config) {
  const wasmPath = config.wasmPath ?? "";
  if (wasmPath.length === 0) {
    throw new Error("VIR widget wasmPath must be a non-empty string");
  }
  return { kind: "path", value: wasmPath };
}

function irPackageSource(config) {
  const irPackage = config.irPackage ?? null;
  if (irPackage === null) {
    throw new Error("VIR widget irPackage must be set");
  }
  if (config.position === null || config.position === undefined) {
    throw new Error("VIR widget irPackage requires an infoview position");
  }
  return {
    kind: "irPackage",
    package: irPackage,
    roots: irPackage.roots,
    position: config.position,
  };
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

function widgetCleanupError(errors, message) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}
