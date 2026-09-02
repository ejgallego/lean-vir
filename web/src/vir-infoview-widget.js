/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { EditorContext, useRpcSession } from "@leanprover/infoview";
import {
  createBrowserHostBindings,
  createHostLifecycle,
  normalizeProofWidgetsRpcRef,
} from "./vir-host-bindings.js";
import { createBrowserReactHostBindings } from "./vir-react-host-bindings.js";
import { createVirRuntime as createBundledVirRuntime } from "./vir-runtime.js";
import { isEffectfulInterfaceEffect } from "./runtime/interface-effects.js";
import { INTERFACE_TAG } from "./runtime/interface-tags.js";

const e = React.createElement;
let nextMountId = 0;
const wasmModuleCache = new Map();

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
  const [mountId] = React.useState(() => freshMountId(props.mountId));
  const loadedRef = React.useRef(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [runtimeToken, setRuntimeToken] = React.useState(0);
  const [proofWidgetsExpr, setProofWidgetsExpr] = React.useState(null);
  const irPackageRevisionRef = React.useRef("");
  const refreshGenerationRef = React.useRef(0);
  const baseSurface = surfaceFromInfoviewProps(props);
  const baseSurfaceKey = surfaceCacheKey(baseSurface);
  const surface = surfaceFromInfoviewProps(props, proofWidgetsExpr);
  const surfaceKey = surfaceCacheKey(surface);
  const irPackageKey =
    props.irPackage === null || props.irPackage === undefined
      ? ""
      : JSON.stringify(props.irPackage);

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
    setupHintRef.current = setupHint;
  }, [rpcSession, editorConnection, props.pos, props.setupHint]);

  async function refreshLoadedWidget(isDisposed) {
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
      if (isDisposed()) {
        disposeRuntimeService(service);
        return;
      }
      const componentEntry = validateWidgetComponentEntry(
        service.runtime,
        config.componentEntry,
      );
      const entry = validateWidgetEntry(service.runtime, config.entry);
      const unmountEntry = validateWidgetUnmountEntry(
        service.runtime,
        config.unmountEntry,
      );
      const component = service.runtime.call(componentEntry.entry);
      if (typeof component !== "function") {
        throw new Error(
          `VIR widget component entry ${componentEntry.entry} did not return a JavaScript function`,
        );
      }
      irPackageRevisionRef.current = service.packageRevision;
      const current = loadedRef.current;
      loadedRef.current = null;
      if (current !== null) {
        releaseLoadedWidget(current, mountId);
      }
      loadedRef.current = {
        service,
        componentEntry,
        component,
        entry,
        unmountEntry,
      };
      service = null;
      setProofWidgetsExpr(null);
      setReloadToken(0);
      setRuntimeToken((token) => token + 1);
    } catch (error) {
      if (service !== null) {
        disposeRuntimeService(service);
      }
      if (!isDisposed()) {
        setStatus({ kind: "error", message: errorMessage(error, setupHint) });
      }
    }
  }

  React.useEffect(() => {
    let disposed = false;
    const generation = ++refreshGenerationRef.current;
    refreshLoadedWidget(
      () => disposed || generation !== refreshGenerationRef.current,
    );
    return () => {
      disposed = true;
      const loaded = loadedRef.current;
      if (loaded !== null) {
        releaseLoadedWidget(loaded, mountId);
        if (loadedRef.current === loaded) {
          loadedRef.current = null;
        }
        setProofWidgetsExpr(null);
      }
    };
  }, [
    props.wasmPath,
    irPackageKey,
    props.componentEntry,
    props.entry,
    props.unmountEntry,
    mountId,
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
    props.entry,
    props.unmountEntry,
    mountId,
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
          if (inFlight) {
            return;
          }
          inFlight = true;
          shouldReloadIRPackage({
            rpcSession: hostContextRef.current.rpcSession,
            irPackage: config.irPackage,
            position: hostContextRef.current.position,
            currentRevision: irPackageRevisionRef.current,
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
    props.entry,
    props.unmountEntry,
    props.autoReloadMs,
  ]);

  React.useEffect(() => {
    let disposed = false;

    async function refreshProofWidgetsExpr() {
      const loaded = loadedRef.current;
      if (
        loaded === null ||
        hostContextRef.current.rpcSession === null ||
        typeof hostContextRef.current.rpcSession?.call !== "function"
      ) {
        if (!disposed) {
          setProofWidgetsExpr(null);
        }
        return;
      }
      let config;
      try {
        config = widgetRuntimeConfigFromProps(props);
      } catch {
        if (!disposed) {
          setProofWidgetsExpr(null);
        }
        return;
      }
      if (config.position === null) {
        if (!disposed) {
          setProofWidgetsExpr(null);
        }
        return;
      }
      try {
        const saved = await createProofWidgetsExprWithCtxAtPos(
          hostContextRef.current.rpcSession,
          config.position,
          loaded.service.packageRevision,
        );
        if (!disposed && loadedRef.current === loaded) {
          setProofWidgetsExpr(
            saved === null ? null : proofWidgetsExprFromSavedRef(saved),
          );
        }
      } catch (error) {
        if (!disposed) {
          console.error(error);
          setProofWidgetsExpr(null);
        }
      }
    }

    refreshProofWidgetsExpr();
    return () => {
      disposed = true;
    };
  }, [runtimeToken, baseSurfaceKey, irPackageKey]);

  React.useEffect(() => {
    const loaded = loadedRef.current;
    if (loaded === null) {
      return;
    }
    try {
      const selector = `#${mountId}`;
      const mounted = loaded.service.runtime.call(
        loaded.entry.entry,
        selector,
        loaded.component,
        surface,
      );
      if (mounted !== true) {
        throw new Error(
          `VIR widget entry ${loaded.entry.entry} did not mount ${selector}`,
        );
      }
      setStatus({ kind: "ready", message: loaded.entry.entry });
    } catch (error) {
      if (loadedRef.current === loaded) {
        loadedRef.current = null;
      }
      releaseLoadedWidget(loaded, mountId);
      setStatus({
        kind: "error",
        message: errorMessage(error, setupHintRef.current),
      });
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

export function validateWidgetEntry(runtime, entryName) {
  const entry = requireWidgetManifestEntry(runtime, entryName, "entry");
  if (
    !isEffectfulInterfaceEffect(entry.effect) ||
    entry.args?.length !== 3 ||
    entry.args[0]?.type?.interfaceTag !== INTERFACE_TAG.STRING ||
    entry.args[1]?.type?.interfaceTag !== INTERFACE_TAG.RESOURCE ||
    entry.args[2]?.type?.interfaceTag !== INTERFACE_TAG.STRUCTURE ||
    entry.args[2]?.type?.name !== "Lean.Vir.Infoview.Surface" ||
    entry.result?.interfaceTag !== INTERFACE_TAG.BOOL
  ) {
    throw new Error(
      `VIR widget entry ${entryName} must be an effectful String -> Component -> Surface -> Bool entry`,
    );
  }
  return entry;
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

export function validateWidgetUnmountEntry(runtime, entryName) {
  if (entryName.length === 0) {
    return null;
  }
  const entry = requireWidgetManifestEntry(runtime, entryName, "unmount entry");
  if (
    !isEffectfulInterfaceEffect(entry.effect) ||
    entry.args?.length !== 1 ||
    entry.args[0]?.type?.interfaceTag !== INTERFACE_TAG.STRING ||
    entry.result?.interfaceTag !== INTERFACE_TAG.BOOL
  ) {
    throw new Error(
      `VIR widget unmount entry ${entryName} must be an effectful String -> Bool entry ` +
        `(Lean: String -> DomM Bool)`,
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
  disposeRuntimeService(loaded.service);
}

export function surfaceFromInfoviewProps(props, proofWidgetsExpr = null) {
  const goals = arrayOrEmpty(props?.goals).map((goal, index) =>
    goalFromInteractiveGoal(goal, index, "goal"),
  );
  const termGoal =
    props?.termGoal === null || props?.termGoal === undefined
      ? []
      : [goalFromInteractiveGoal(props.termGoal, goals.length, "term")];
  const cursor = documentPositionFromInfoviewPosition(props?.pos);
  const selections = arrayOrEmpty(props?.selectedLocations).map(
    selectedLocationFromInfoviewLocation,
  );
  return {
    position: cursor.label,
    cursor,
    goals: [...goals, ...termGoal],
    selectedLocations: selections.map((selection) => selection.label),
    selections,
    proofWidgetsExpr,
  };
}

export function surfaceCacheKey(surface) {
  return JSON.stringify(surface);
}

export function proofWidgetsExprFromSavedRef(saved) {
  const info = saved?.info;
  const ref = requiredRpcRefObject(saved?.ref, "proofwidgets stored expr ref");
  return {
    value: {
      code: optionalString(info?.expression, "proofwidgets expr expression"),
      typeText: optionalString(info?.typeText, "proofwidgets expr typeText"),
      context: optionalString(info?.context, "proofwidgets expr context"),
    },
    ref: {
      id: requiredString(info?.id, "proofwidgets expr id"),
      label: optionalString(info?.label, "proofwidgets expr label"),
      typeName: optionalString(info?.typeName, "proofwidgets expr typeName"),
      summary: optionalString(info?.summary, "proofwidgets expr summary"),
      expression: optionalString(
        info?.expression,
        "proofwidgets expr expression",
      ),
      typeText: optionalString(info?.typeText, "proofwidgets expr typeText"),
      context: optionalString(info?.context, "proofwidgets expr context"),
      serverRef: ref,
    },
  };
}

function goalFromInteractiveGoal(goal, index, kind) {
  const userName = optionalStringValue(
    readOption(goal?.userName ?? goal?.["userName?"]),
  );
  const mvarId = optionalStringValue(goal?.mvarId?.name ?? goal?.mvarId);
  const title =
    kind === "term"
      ? "Term goal"
      : userName.length === 0
        ? `Goal ${index + 1}`
        : `case ${userName}`;
  const idSeed =
    kind === "term" ? `term-${index}` : optionalStringValue(mvarId || userName);
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
      hypothesisFromBundle(hypothesis, id, hypothesisIndex),
    ),
  };
}

function hypothesisFromBundle(hypothesis, goalId, index) {
  const names = arrayOrEmpty(hypothesis?.names).filter(
    (name) => typeof name === "string",
  );
  const fvarIds = arrayOrEmpty(hypothesis?.fvarIds)
    .map(infoviewIdToString)
    .filter((id) => id.length !== 0);
  const idSeed =
    names.length === 0
      ? optionalStringValue(fvarIds[0] ?? `hyp-${index}`)
      : names.join("-");
  return {
    id: safeDomId(`${goalId}-${idSeed}`),
    names,
    fvarIds,
    type: nonEmptyText(
      taggedTextToPlain(hypothesis?.type),
      "(unavailable type)",
    ),
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
  const line =
    hasPosition && Number.isInteger(pos.line) && pos.line >= 0 ? pos.line : 0;
  const character =
    hasPosition && Number.isInteger(pos.character) && pos.character >= 0
      ? pos.character
      : 0;
  const uri = hasPosition && typeof pos.uri === "string" ? pos.uri : "";
  const fileName = fileNameFromUri(uri);
  const label = hasPosition
    ? formatDocumentPositionLabel(fileName, line, character)
    : "unknown position";
  return {
    uri,
    fileName,
    line,
    character,
    label,
  };
}

function formatDocumentPositionLabel(fileName, line, character) {
  const label = `line ${line + 1}:${character + 1}`;
  return fileName.length === 0
    ? label
    : `${fileName}:${line + 1}:${character + 1}`;
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
    return (
      optionalStringValue(location.kind ?? location.type ?? location.id) ||
      `location-${index}`
    );
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

function requiredBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`VIR widget ${label} must be a boolean`);
  }
  return value;
}

function widgetRuntimeConfigFromProps(props) {
  const irPackage = requiredIRPackage(props.irPackage, "irPackage");
  return {
    wasmPath: requiredString(props.wasmPath, "wasmPath"),
    irPackage,
    componentEntry: requiredString(props.componentEntry, "componentEntry"),
    entry: requiredString(props.entry, "entry"),
    unmountEntry: optionalString(props.unmountEntry, "unmountEntry"),
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
  const resources = createHostLifecycle();
  const runtimeOptions = await loadRuntimeOptionsFromSources({
    rpcSession,
    sources,
  });
  runtimeOptions.defaultHostBindings = (runtimeRef) =>
    createBrowserHostBindings({
      resources,
      runtimeRef,
      infoviewCommandDispatcher: createInfoviewCommandDispatcher({
        hostContext,
        packageRevision: sources.packageSource.revision ?? "",
      }),
      reactHostBindings: createBrowserReactHostBindings,
    });
  try {
    return {
      packageRevision: sources.packageSource.revision ?? "",
      disposed: false,
      resources,
      runtime: await createBundledVirRuntime(runtimeOptions),
    };
  } catch (error) {
    try {
      resources.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "VIR runtime creation failed during host cleanup",
      );
    }
    throw error;
  }
}

function createInfoviewCommandDispatcher({
  hostContext,
  packageRevision = "",
}) {
  const resolveRef = (ref) => {
    const rpcSession = hostContext.rpcSession ?? null;
    const position = hostContext.position ?? null;
    if (
      rpcSession === null ||
      typeof rpcSession.call !== "function" ||
      position === null
    ) {
      return false;
    }
    return resolveProofWidgetsRpcRef(
      rpcSession,
      ref,
      position,
      packageRevision,
    );
  };
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
    proofwidgetsRpcInspectRef(ref) {
      const result = resolveRef(ref);
      if (result === false) {
        return false;
      }
      result
        .then((info) => {
          console.info("VIR ProofWidgets RPC reference", info);
        })
        .catch((error) => {
          console.error(error);
        });
      return true;
    },
    proofwidgetsRpcResolveRef: resolveRef,
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
  options.irPackageSetBytes = [decodeBase64Bytes(irPackage.dataBase64)];
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

export async function resolveProofWidgetsRpcRef(
  rpcSession,
  ref,
  position,
  packageRevision = "",
) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    throw new Error("VIR ProofWidgets RPC ref must have a non-empty id");
  }
  const pos = requiredPosition(position, "proofwidgets rpc position");
  const response =
    normalized.serverRef === undefined
      ? await rpcSession.call("Lean.Vir.Infoview.resolveProofWidgetsRpcRef", {
          ref: proofWidgetsRpcRefRequest(normalized),
          pos,
          packageRevision,
        })
      : await rpcSession.call(
          "Lean.Vir.Infoview.resolveProofWidgetsExprWithCtxRef",
          {
            ref: normalized.serverRef,
            pos,
            packageRevision,
          },
        );
  return proofWidgetsRpcRefInfo(response, normalized);
}

export async function createProofWidgetsExprWithCtxRef(
  rpcSession,
  ref,
  position,
  packageRevision = "",
) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    throw new Error("VIR ProofWidgets RPC ref must have a non-empty id");
  }
  const response = await rpcSession.call(
    "Lean.Vir.Infoview.createProofWidgetsExprWithCtxRef",
    {
      ref: proofWidgetsRpcRefRequest(normalized),
      pos: requiredPosition(position, "proofwidgets rpc position"),
      packageRevision,
    },
  );
  return {
    ref: requiredRpcRefObject(response?.ref, "proofwidgets stored expr ref"),
    info: proofWidgetsRpcRefInfo(response?.info, normalized),
  };
}

export async function createProofWidgetsExprWithCtxAtPos(
  rpcSession,
  position,
  packageRevision = "",
) {
  const response = await rpcSession.call(
    "Lean.Vir.Infoview.createProofWidgetsExprWithCtxAtPos",
    {
      pos: requiredPosition(position, "proofwidgets expr position"),
      packageRevision,
    },
  );
  const saved = readOption(response);
  if (saved === null) {
    return null;
  }
  const id = requiredString(saved?.info?.id, "proofwidgets expr id");
  return {
    ref: requiredRpcRefObject(saved?.ref, "proofwidgets stored expr ref"),
    info: proofWidgetsRpcRefInfo(saved?.info, { id }),
  };
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

function proofWidgetsRpcRefInfo(response, ref) {
  const id = requiredString(response?.id, "proofwidgets rpc ref id");
  if (id !== ref.id) {
    throw new Error(
      `VIR ProofWidgets RPC ref id mismatch: expected ${ref.id}, got ${id}`,
    );
  }
  return {
    id,
    label: optionalString(response?.label, "proofwidgets rpc ref label"),
    typeName: optionalString(
      response?.typeName,
      "proofwidgets rpc ref typeName",
    ),
    summary: optionalString(response?.summary, "proofwidgets rpc ref summary"),
    expression: optionalString(
      response?.expression,
      "proofwidgets rpc ref expression",
    ),
    typeText: optionalString(
      response?.typeText,
      "proofwidgets rpc ref typeText",
    ),
    context: optionalString(response?.context, "proofwidgets rpc ref context"),
    source: requiredString(response?.source, "proofwidgets rpc ref source"),
    position: requiredString(
      response?.position,
      "proofwidgets rpc ref position",
    ),
    packageRevision: optionalString(
      response?.packageRevision,
      "proofwidgets rpc ref packageRevision",
    ),
    storeKey: optionalString(
      response?.storeKey,
      "proofwidgets rpc ref storeKey",
    ),
    knownConstant: requiredBoolean(
      response?.knownConstant,
      "proofwidgets rpc ref knownConstant",
    ),
  };
}

function proofWidgetsRpcRefRequest(ref) {
  return {
    id: ref.id,
    label: ref.label,
    typeName: ref.typeName,
    summary: ref.summary,
    expression: ref.expression,
    typeText: ref.typeText,
    context: ref.context,
  };
}

function requiredRpcRefObject(value, label) {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.__rpcref === "number" || typeof value.p === "number")
  ) {
    return value;
  }
  throw new Error(`VIR widget ${label} must be an RPC ref object`);
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

function freshMountId(value) {
  const prefix =
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
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
