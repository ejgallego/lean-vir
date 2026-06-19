/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { EditorContext, useRpcSession } from "@leanprover/infoview";
import { createBrowserHostBindings } from "./vir-host-bindings.js";
import { createBrowserReactHostBindings } from "./vir-react-host-bindings.js";
import { createVirRuntime as createBundledVirRuntime } from "./vir-runtime.js";
import { isEffectfulInterfaceEffect } from "./runtime/interface-effects.js";
import { WIRE } from "./runtime/wire-tags.js";

const e = React.createElement;
let nextMountId = 0;
const wasmModuleCache = new Map();
const runtimeServiceCache = new Map();
const runtimeServiceIdleTtlMs = 60_000;

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
  const rpcSession = useRpcSession();
  const editorConnection = React.useContext(EditorContext);
  const rpcSessionRef = React.useRef(rpcSession);
  const editorConnectionRef = React.useRef(editorConnection);
  const [status, setStatus] = React.useState({ kind: "loading", message: "Loading VIR widget..." });
  const [mountId] = React.useState(() => freshMountId(props.mountId));
  const loadedRef = React.useRef(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [runtimeToken, setRuntimeToken] = React.useState(0);
  const irPackageRevisionRef = React.useRef("");
  const surface = surfaceFromInfoviewProps(props);
  const surfaceKey = surfaceCacheKey(surface);
  const irPackageKey = props.irPackage === null || props.irPackage === undefined
    ? ""
    : JSON.stringify(props.irPackage);

  React.useEffect(() => {
    rpcSessionRef.current = rpcSession;
  }, [rpcSession]);

  React.useEffect(() => {
    editorConnectionRef.current = editorConnection;
  }, [editorConnection]);

  async function refreshLoadedWidget(isDisposed) {
    let setupHint = "";
    try {
      const config = widgetRuntimeConfigFromProps(props);
      setupHint = config.setupHint;
      const service = await loadRuntimeService({
        rpcSession: rpcSessionRef.current,
        editorConnectionRef,
        config,
      });
      if (isDisposed()) {
        return;
      }
      const entry = validateWidgetEntry(service.runtime, config.entry);
      const unmountEntry = validateWidgetUnmountEntry(service.runtime, config.unmountEntry);
      const current = loadedRef.current;
      if (sameLoadedWidget(current, service, entry, unmountEntry, setupHint)) {
        return;
      }
      irPackageRevisionRef.current = service.packageRevision;
      retainRuntimeService(service);
      if (current !== null) {
        releaseLoadedWidget(current, mountId);
      }
      loadedRef.current = { service, entry, unmountEntry, setupHint };
      setRuntimeToken((token) => token + 1);
    } catch (error) {
      if (!isDisposed()) {
        setStatus({ kind: "error", message: errorMessage(error, setupHint) });
      }
    }
  }

  React.useEffect(() => {
    let disposed = false;
    refreshLoadedWidget(() => disposed);
    return () => {
      disposed = true;
      const loaded = loadedRef.current;
      if (loaded !== null) {
        releaseLoadedWidget(loaded, mountId);
        if (loadedRef.current === loaded) {
          loadedRef.current = null;
        }
      }
    };
  }, [
    props.runtimeUrl,
    props.wasmUrl,
    props.packageUrl,
    props.wasmPath,
    props.packagePath,
    irPackageKey,
    props.entry,
    props.unmountEntry,
    props.setupHint,
    mountId,
  ]);

  React.useEffect(() => {
    if (reloadToken === 0) {
      return undefined;
    }
    let disposed = false;
    refreshLoadedWidget(() => disposed);
    return () => {
      disposed = true;
    };
  }, [
    props.runtimeUrl,
    props.wasmUrl,
    props.packageUrl,
    props.wasmPath,
    props.packagePath,
    irPackageKey,
    props.entry,
    props.unmountEntry,
    props.setupHint,
    mountId,
    reloadToken,
  ]);

  React.useEffect(() => {
    let intervalId = null;
    let disposed = false;
    let inFlight = false;
    try {
      const config = widgetRuntimeConfigFromProps(props);
      if (config.autoReloadMs > 0 && config.irPackage !== null) {
        intervalId = setInterval(() => {
          if (inFlight) {
            return;
          }
          inFlight = true;
          shouldReloadIRPackage({
            rpcSession: rpcSessionRef.current,
            irPackage: config.irPackage,
            position: config.position,
            currentRevision: irPackageRevisionRef.current,
          })
            .then((shouldReload) => {
              if (!disposed && shouldReload) {
                setReloadToken((token) => token + 1);
              }
            })
            .catch((error) => {
              if (!disposed) {
                setStatus({ kind: "error", message: errorMessage(error, config.setupHint) });
              }
            })
            .finally(() => {
              inFlight = false;
            });
        }, config.autoReloadMs);
      } else if (config.autoReloadMs > 0 && usesPathAssets(config)) {
        intervalId = setInterval(() => {
          setReloadToken((token) => token + 1);
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
    props.runtimeUrl,
    props.wasmUrl,
    props.packageUrl,
    props.wasmPath,
    props.packagePath,
    irPackageKey,
    props.entry,
    props.unmountEntry,
    props.autoReloadMs,
    props.setupHint,
  ]);

  React.useEffect(() => {
    const loaded = loadedRef.current;
    if (loaded === null) {
      return;
    }
    try {
      const selector = `#${mountId}`;
      const mounted = loaded.service.runtime.call(loaded.entry.entry, selector, surface);
      if (mounted !== true) {
        throw new Error(`VIR widget entry ${loaded.entry.entry} did not mount ${selector}`);
      }
      setStatus({ kind: "ready", message: loaded.entry.entry });
    } catch (error) {
      if (loadedRef.current === loaded) {
        loadedRef.current = null;
      }
      releaseLoadedWidget(loaded, mountId);
      dropRuntimeService(loaded.service);
      setStatus({ kind: "error", message: errorMessage(error, loaded.setupHint) });
    }
  }, [runtimeToken, surfaceKey, mountId]);

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

function stopInfoviewEvent(event) {
  event.stopPropagation();
}

export function validateWidgetEntry(runtime, entryName) {
  const entry = runtime.findManifestEntry?.(entryName)
    ?? runtime.interfaceManifest?.exports?.find((candidate) =>
      candidate.entry === entryName || candidate.id === entryName || candidate.jsName === entryName);
  if (entry === null || entry === undefined) {
    throw new Error(`VIR widget entry not found: ${entryName}`);
  }
  if (
    !isEffectfulInterfaceEffect(entry.effect) ||
    entry.args?.length !== 2 ||
    entry.args[0]?.type?.wireTag !== WIRE.STRING ||
    entry.args[1]?.type?.wireTag !== WIRE.STRUCTURE ||
    entry.result?.wireTag !== WIRE.BOOL
  ) {
    throw new Error(
      `VIR widget entry ${entryName} must be an effectful String -> Surface -> Bool entry ` +
        `(Lean: String -> Surface -> DomM Bool)`,
    );
  }
  return entry;
}

export function validateWidgetUnmountEntry(runtime, entryName) {
  if (entryName.length === 0) {
    return null;
  }
  const entry = runtime.findManifestEntry?.(entryName)
    ?? runtime.interfaceManifest?.exports?.find((candidate) =>
      candidate.entry === entryName || candidate.id === entryName || candidate.jsName === entryName);
  if (entry === null || entry === undefined) {
    throw new Error(`VIR widget unmount entry not found: ${entryName}`);
  }
  if (
    !isEffectfulInterfaceEffect(entry.effect) ||
    entry.args?.length !== 1 ||
    entry.args[0]?.type?.wireTag !== WIRE.STRING ||
    entry.result?.wireTag !== WIRE.BOOL
  ) {
    throw new Error(
      `VIR widget unmount entry ${entryName} must be an effectful String -> Bool entry ` +
        `(Lean: String -> DomM Bool)`,
    );
  }
  return entry;
}

function unmountWidgetSelector(loaded, mountId) {
  if (loaded.unmountEntry === null) {
    return;
  }
  try {
    loaded.service.runtime.call(loaded.unmountEntry.entry, `#${mountId}`);
  } catch (error) {
    console.error(error);
  }
}

function releaseLoadedWidget(loaded, mountId) {
  unmountWidgetSelector(loaded, mountId);
  releaseRuntimeService(loaded.service);
}

export function surfaceFromInfoviewProps(props) {
  const goals = arrayOrEmpty(props?.goals).map((goal, index) =>
    goalFromInteractiveGoal(goal, index, "goal"));
  const termGoal = props?.termGoal === null || props?.termGoal === undefined
    ? []
    : [goalFromInteractiveGoal(props.termGoal, goals.length, "term")];
  const cursor = documentPositionFromInfoviewPosition(props?.pos);
  const selections = arrayOrEmpty(props?.selectedLocations).map(selectedLocationFromInfoviewLocation);
  return {
    position: cursor.label,
    cursor,
    goals: [...goals, ...termGoal],
    selectedLocations: selections.map((selection) => selection.label),
    selections,
  };
}

export function surfaceCacheKey(surface) {
  return JSON.stringify(surface);
}

function goalFromInteractiveGoal(goal, index, kind) {
  const userName = optionalStringValue(readOption(goal?.userName ?? goal?.["userName?"]));
  const mvarId = optionalStringValue(goal?.mvarId?.name ?? goal?.mvarId);
  const title = kind === "term"
    ? "Term goal"
    : userName.length === 0
      ? `Goal ${index + 1}`
      : `case ${userName}`;
  const idSeed = kind === "term"
    ? `term-${index}`
    : optionalStringValue(mvarId || userName);
  const id = safeDomId(idSeed.length === 0 ? `${kind}-${index}` : idSeed);
  return {
    id,
    kind,
    index,
    title,
    userName: userName.length === 0 ? null : userName,
    mvarId: mvarId.length === 0 ? null : mvarId,
    status: goalStatus(goal, index, kind),
    target: nonEmptyText(taggedTextToPlain(goal?.type), "(unavailable target)"),
    hypotheses: arrayOrEmpty(goal?.hyps).map((hypothesis, hypothesisIndex) =>
      hypothesisFromBundle(hypothesis, id, hypothesisIndex)),
  };
}

function hypothesisFromBundle(hypothesis, goalId, index) {
  const names = arrayOrEmpty(hypothesis?.names).filter((name) => typeof name === "string");
  const fvarIds = arrayOrEmpty(hypothesis?.fvarIds).map(infoviewIdToString).filter((id) => id.length !== 0);
  const idSeed = names.length === 0
    ? optionalStringValue(fvarIds[0] ?? `hyp-${index}`)
    : names.join("-");
  return {
    id: safeDomId(`${goalId}-${idSeed}`),
    names,
    fvarIds,
    type: nonEmptyText(taggedTextToPlain(hypothesis?.type), "(unavailable type)"),
    value: optionalTaggedTextToPlain(hypothesis?.val ?? hypothesis?.["val?"]),
  };
}

export function taggedTextToPlain(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(taggedTextToPlain).join("");
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (Array.isArray(value.append)) {
    return value.append.map(taggedTextToPlain).join("");
  }
  if (Array.isArray(value.tag)) {
    return taggedTextToPlain(value.tag[1]);
  }
  return "";
}

function optionalTaggedTextToPlain(value) {
  const option = readOption(value);
  return option === null ? null : taggedTextToPlain(option);
}

function readOption(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "object") {
    if (value.kind === "none") {
      return null;
    }
    if (value.kind === "some") {
      return value.value;
    }
    if (Object.prototype.hasOwnProperty.call(value, "some")) {
      return value.some;
    }
  }
  return value;
}

function goalStatus(goal, index, kind) {
  if (kind === "term") {
    return "term";
  }
  if (readOption(goal?.isInserted ?? goal?.["isInserted?"]) === true) {
    return "inserted";
  }
  if (readOption(goal?.isRemoved ?? goal?.["isRemoved?"]) === true) {
    return "removed";
  }
  return index === 0 ? "active" : "pending";
}

function documentPositionFromInfoviewPosition(pos) {
  const hasPosition = pos !== null && typeof pos === "object";
  const line = hasPosition && Number.isInteger(pos.line) && pos.line >= 0 ? pos.line : 0;
  const character = hasPosition && Number.isInteger(pos.character) && pos.character >= 0 ? pos.character : 0;
  const uri = hasPosition && typeof pos.uri === "string" ? pos.uri : "";
  const fileName = fileNameFromUri(uri);
  const label = hasPosition
    ? formatDocumentPositionParts(fileName, line, character)
    : "unknown position";
  return {
    uri,
    fileName,
    line,
    character,
    label,
  };
}

function formatDocumentPosition(pos) {
  return documentPositionFromInfoviewPosition(pos).label;
}

function formatDocumentPositionParts(fileName, line, character) {
  const label = `line ${line + 1}:${character + 1}`;
  return fileName.length === 0 ? label : `${fileName}:${line + 1}:${character + 1}`;
}

function fileNameFromUri(uri) {
  if (uri.length === 0) {
    return "";
  }
  return decodeURIComponent(uri).split(/[\\/]/).pop() ?? "";
}

function selectedLocationFromInfoviewLocation(location, index) {
  const label = formatSelectedLocation(location, index);
  const kind = selectedLocationKind(location);
  return {
    id: safeDomId(`${kind}-${label}-${index}`),
    kind,
    label,
  };
}

function formatSelectedLocation(location, index) {
  if (location === null || location === undefined) {
    return `location-${index}`;
  }
  if (typeof location === "string") {
    return location;
  }
  if (typeof location === "object") {
    return optionalStringValue(location.kind ?? location.type ?? location.id) || `location-${index}`;
  }
  return String(location);
}

function selectedLocationKind(location) {
  if (location !== null && typeof location === "object") {
    return optionalStringValue(location.kind ?? location.type) || "location";
  }
  return "location";
}

function infoviewIdToString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object") {
    return optionalStringValue(value.name ?? value.id);
  }
  return "";
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function optionalStringValue(value) {
  return typeof value === "string" ? value : "";
}

function nonEmptyText(value, fallback) {
  const text = optionalStringValue(value).trim();
  return text.length === 0 ? fallback : text;
}

function safeDomId(value) {
  const normalized = String(value)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length === 0 ? "item" : normalized;
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
  const irPackage = optionalIRPackage(props.irPackage, "irPackage");
  return {
    runtimeUrl: optionalString(props.runtimeUrl, "runtimeUrl"),
    wasmUrl: optionalString(props.wasmUrl, "wasmUrl"),
    packageUrl: optionalString(props.packageUrl, "packageUrl"),
    wasmPath: optionalString(props.wasmPath, "wasmPath"),
    packagePath: optionalString(props.packagePath, "packagePath"),
    irPackage,
    entry: requiredString(props.entry, "entry"),
    unmountEntry: optionalString(props.unmountEntry, "unmountEntry"),
    position: irPackage !== null ? requiredPosition(props.pos, "pos") : null,
    autoReloadMs: optionalNonNegativeInteger(props.autoReloadMs, "autoReloadMs"),
    setupHint: optionalString(props.setupHint, "setupHint"),
  };
}

function optionalIRPackage(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
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
  if (!Number.isInteger(value.line) || value.line < 0 ||
      !Number.isInteger(value.character) || value.character < 0) {
    throw new Error(`VIR widget ${label} must contain non-negative line and character`);
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

function usesPathAssets(config) {
  return config.wasmPath.length !== 0 || config.packagePath.length !== 0;
}

function sameLoadedWidget(loaded, service, entry, unmountEntry, setupHint) {
  return loaded !== null
    && loaded.service === service
    && loaded.entry.entry === entry.entry
    && (loaded.unmountEntry?.entry ?? "") === (unmountEntry?.entry ?? "")
    && loaded.setupHint === setupHint;
}

function runtimeBaseKey(config) {
  return JSON.stringify({
    runtimeUrl: config.runtimeUrl,
    wasmUrl: config.wasmUrl,
    wasmPath: config.wasmPath,
    packageUrl: config.packageUrl,
    packagePath: config.packagePath,
    irPackage: config.irPackage,
  });
}

export async function loadRuntimeService({ rpcSession, editorConnectionRef = null, config }) {
  return loadRuntimeServiceWithHost({ rpcSession, editorConnectionRef, config });
}

async function loadRuntimeServiceWithHost({ rpcSession, editorConnectionRef, config }) {
  const baseKey = runtimeBaseKey(config);
  const sources = await resolveRuntimeSources(rpcSession, config);
  const key = runtimeServiceKey(baseKey, sources);
  let cached = runtimeServiceCache.get(key);
  if (cached === undefined) {
    cached = createRuntimeService({ rpcSession, editorConnectionRef, config, baseKey, key, sources });
    runtimeServiceCache.set(key, cached);
    cached.then(() => {
      retireRuntimeServicesForBaseKey(baseKey, key);
    }).catch(() => {
      if (runtimeServiceCache.get(key) === cached) {
        runtimeServiceCache.delete(key);
      }
    });
  }
  const service = await cached;
  service.lastUsed = Date.now();
  scheduleRuntimeServiceIdleDispose(service);
  return service;
}

function runtimeServiceKey(baseKey, sources) {
  return JSON.stringify({
    baseKey,
    wasmRevision: sources.wasmSource.revision ?? "",
    packageRevision: sources.packageSource.revision ?? "",
  });
}

async function createRuntimeService({ rpcSession, editorConnectionRef, config, baseKey, key, sources }) {
  const runtimeModule = config.runtimeUrl.length === 0
    ? { createVirRuntime: createBundledVirRuntime }
    : await import(config.runtimeUrl);
  const createVirRuntime = runtimeModule.createVirRuntime;
  if (typeof createVirRuntime !== "function") {
    throw new Error("VIR runtime module does not export createVirRuntime");
  }
  const runtimeOptions = await loadRuntimeOptionsFromSources({ rpcSession, sources });
  runtimeOptions.defaultHostBindings = (runtimeRef) => createBrowserHostBindings({
    runtimeRef,
    infoviewCommandDispatcher: createInfoviewCommandDispatcher(editorConnectionRef),
    reactHostBindings: createBrowserReactHostBindings,
  });
  return {
    baseKey,
    key,
    activeRefs: 0,
    packageRevision: sources.packageSource.revision ?? "",
    idleTimer: null,
    lastUsed: Date.now(),
    stale: false,
    disposed: false,
    runtime: await createVirRuntime(runtimeOptions),
  };
}

function createInfoviewCommandDispatcher(editorConnectionRef) {
  return {
    revealPosition(position) {
      const editorConnection = editorConnectionRef?.current ?? null;
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
  };
}

function retainRuntimeService(service) {
  clearRuntimeServiceIdleTimer(service);
  service.activeRefs += 1;
  service.lastUsed = Date.now();
}

function releaseRuntimeService(service) {
  service.activeRefs = Math.max(0, service.activeRefs - 1);
  disposeStaleRuntimeServiceIfIdle(service);
  scheduleRuntimeServiceIdleDispose(service);
}

function retireRuntimeService(service) {
  service.stale = true;
  if (runtimeServiceCache.get(service.key) !== undefined) {
    runtimeServiceCache.delete(service.key);
  }
  disposeStaleRuntimeServiceIfIdle(service);
}

function disposeStaleRuntimeServiceIfIdle(service) {
  if (service.stale && service.activeRefs === 0) {
    disposeRuntimeServiceNow(service);
  }
}

function disposeRuntimeServiceNow(service) {
  if (!service.disposed) {
    clearRuntimeServiceIdleTimer(service);
    service.disposed = true;
    service.runtime.dispose?.();
  }
}

function clearRuntimeServiceIdleTimer(service) {
  if (service.idleTimer !== null) {
    clearTimeout(service.idleTimer);
    service.idleTimer = null;
  }
}

function scheduleRuntimeServiceIdleDispose(service) {
  if (service.disposed || service.stale || service.activeRefs !== 0 || service.idleTimer !== null) {
    return;
  }
  service.idleTimer = setTimeout(() => {
    service.idleTimer = null;
    if (!service.disposed && !service.stale && service.activeRefs === 0) {
      if (runtimeServiceCache.get(service.key) !== undefined) {
        runtimeServiceCache.delete(service.key);
      }
      disposeRuntimeServiceNow(service);
    }
  }, runtimeServiceIdleTtlMs);
}

function retireRuntimeServicesForBaseKey(baseKey, keepKey) {
  for (const [key, cached] of runtimeServiceCache) {
    if (key === keepKey) {
      continue;
    }
    cached.then((service) => {
      if (service.baseKey === baseKey) {
        retireRuntimeService(service);
      }
    }).catch(() => {});
  }
}

function dropRuntimeService(service) {
  const cached = runtimeServiceCache.get(service.key);
  if (cached !== undefined) {
    runtimeServiceCache.delete(service.key);
  }
  service.activeRefs = 0;
  service.stale = true;
  disposeRuntimeServiceNow(service);
}

export async function clearRuntimeServiceCacheForTests() {
  const services = await Promise.allSettled(Array.from(runtimeServiceCache.values()));
  runtimeServiceCache.clear();
  for (const service of services) {
    if (service.status === "fulfilled") {
      service.value.activeRefs = 0;
      service.value.stale = true;
      disposeRuntimeServiceNow(service.value);
    }
  }
}

export async function shouldReloadIRPackage({ rpcSession, irPackage, position, currentRevision }) {
  const info = await statIRPackage(rpcSession, irPackage, position);
  return info.revision !== currentRevision;
}

export async function loadRuntimeOptions({
  rpcSession,
  wasmUrl = "",
  packageUrl = "",
  wasmPath = "",
  packagePath = "",
  irPackage = null,
  entry = "",
  unmountEntry = "",
  position = null,
}) {
  const sources = await resolveRuntimeSources(rpcSession, {
    wasmUrl,
    packageUrl,
    wasmPath,
    packagePath,
    irPackage,
    entry,
    unmountEntry,
    position,
  });
  return loadRuntimeOptionsFromSources({ rpcSession, sources });
}

async function resolveRuntimeSources(rpcSession, config) {
  const wasmSource = exactlyOneAssetSource("wasm", config.wasmUrl, config.wasmPath);
  const packageSource = exactlyOnePackageSource(config);
  return {
    wasmSource: await resolveAssetSource(rpcSession, wasmSource),
    packageSource: await resolveAssetSource(rpcSession, packageSource),
  };
}

async function resolveAssetSource(rpcSession, source) {
  if (source.kind === "url") {
    return source;
  }
  if (source.kind === "irPackage") {
    const info = await statIRPackage(rpcSession, source.package, source.position);
    return { ...source, revision: info.revision, source: info.source };
  }
  const info = await statAsset(rpcSession, source.value);
  return { ...source, revision: info.revision };
}

async function loadRuntimeOptionsFromSources({ rpcSession, sources }) {
  const { wasmSource, packageSource } = sources;
  const options = {};
  options.wasmModule = await loadWasmModule(rpcSession, wasmSource);
  if (packageSource.kind === "url") {
    options.irPackageUrl = packageSource.value;
  } else if (packageSource.kind === "irPackage") {
    const irPackage = await buildIRPackage(rpcSession, packageSource.package, packageSource.position);
    if ((packageSource.revision ?? "") !== "" && irPackage.revision !== packageSource.revision) {
      throw new Error("VIR IR package changed while loading; retrying with the latest Lean snapshot");
    }
    options.irPackageBytes = decodeBase64Bytes(irPackage.dataBase64);
  } else {
    options.irPackageBytes = await loadAssetBytes(rpcSession, packageSource.value);
  }
  return options;
}

export async function loadWasmModule(rpcSession, source) {
  const key = assetSourceCacheKey(source);
  let cached = wasmModuleCache.get(key);
  if (cached === undefined) {
    cached = compileWasmModule(rpcSession, source);
    wasmModuleCache.set(key, cached);
    cached.catch(() => {
      if (wasmModuleCache.get(key) === cached) {
        wasmModuleCache.delete(key);
      }
    });
  }
  return cached;
}

async function compileWasmModule(rpcSession, source) {
  const bytes = source.kind === "url"
    ? await loadUrlBytes(source.value)
    : await loadAssetBytes(rpcSession, source.value);
  return WebAssembly.compile(bytes);
}

async function loadUrlBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function assetSourceCacheKey(source) {
  const revision = source.revision ?? "";
  return revision.length === 0
    ? `${source.kind}:${source.value}`
    : `${source.kind}:${source.value}:${revision}`;
}

export function exactlyOneAssetSource(label, url, path) {
  const hasUrl = url.length !== 0;
  const hasPath = path.length !== 0;
  if (hasUrl === hasPath) {
    throw new Error(`VIR widget ${label} asset must set exactly one of ${label}Url or ${label}Path`);
  }
  return hasUrl ? { kind: "url", value: url } : { kind: "path", value: path };
}

export function exactlyOnePackageSource(config) {
  const packageUrl = config.packageUrl ?? "";
  const packagePath = config.packagePath ?? "";
  const hasUrl = packageUrl.length !== 0;
  const hasPath = packagePath.length !== 0;
  const irPackage = config.irPackage ?? null;
  const hasIRPackage = irPackage !== null;
  const sourceCount = Number(hasUrl) + Number(hasPath) + Number(hasIRPackage);
  if (sourceCount !== 1) {
    throw new Error("VIR widget package asset must set exactly one of packageUrl, packagePath, or irPackage");
  }
  if (hasUrl) {
    return { kind: "url", value: packageUrl };
  }
  if (hasPath) {
    return { kind: "path", value: packagePath };
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

function statIRPackageForConfig(rpcSession, config) {
  const source = exactlyOnePackageSource(config);
  if (source.kind !== "irPackage") {
    throw new Error("VIR widget package source is not an IR package");
  }
  return statIRPackage(rpcSession, source.package, source.position);
}

export async function loadAssetBytes(rpcSession, path) {
  const response = await rpcSession.call("Lean.Vir.Infoview.readAsset", { path });
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
  const response = await rpcSession.call("Lean.Vir.Infoview.statAsset", { path });
  return assetInfo(response, path);
}

function assetDataBase64(response, path) {
  assetInfo(response, path);
  return requiredString(response?.dataBase64, `asset ${path} dataBase64`);
}

function assetInfo(response, path) {
  const responsePath = requiredString(response?.path, `asset ${path} path`);
  if (responsePath !== path) {
    throw new Error(`VIR asset response path mismatch: expected ${path}, got ${responsePath}`);
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
  const responseRoots = requiredStringArray(response?.roots, "IR package roots");
  if (JSON.stringify(responseRoots) !== JSON.stringify(roots)) {
    throw new Error(`VIR IR package roots mismatch: expected ${roots.join(", ")}, got ${responseRoots.join(", ")}`);
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

function freshMountId(value) {
  const prefix = typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
    ? value
    : "vir-infoview-widget";
  nextMountId += 1;
  return `${prefix}-${nextMountId}`;
}

function errorMessage(error, setupHint) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = typeof setupHint === "string" ? setupHint.trim() : "";
  return hint.length === 0 ? message : `${message}\n\n${hint}`;
}
