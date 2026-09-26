/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { DocumentPosition, EditorContext, InteractiveCode, TaggedText_stripTags, useClientNotificationEffect, useRpcSession } from "@leanprover/infoview";
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
  // Upstream can reconnect when this hook runs. Loading-state updates must not
  // themselves manufacture fresh contexts and repeatedly retry a broken server.
  return e(WidgetLoader, { widgetProps: props, rpcSession });
}

function WidgetLoader({ widgetProps: props, rpcSession }) {
  const committedRequestRef = React.useRef({});
  const [status, setStatus] = React.useState({
    kind: "loading",
    message: "Loading VIR widget...",
  });
  const loadedRef = React.useRef(null);
  const [loaded, setLoaded] = React.useState(null);
  // Counts acquisition attempts, including attempts that reuse the installed code.
  const acquisitionSequenceRef = React.useRef(0);
  const acquisitionRef = React.useRef(null);
  const configurationKey = JSON.stringify([
    props.pos?.uri,
    props.wasmPath,
    props.irPackage?.entry,
  ]);

  const requestKey = JSON.stringify([
    configurationKey, props.irPackage?.fingerprint,
  ]);

  React.useLayoutEffect(() => {
    committedRequestRef.current.configurationKey = configurationKey;
    committedRequestRef.current.requestKey = requestKey;
    return () => {
      // Invalidate pending candidates at removal, before passive cleanup runs.
      committedRequestRef.current.configurationKey = null;
    };
  }, [configurationKey, requestKey]);

  async function acquireAndInstallWidget(attempt, acquisitionId) {
    const obsolete = () => acquisitionId !== acquisitionSequenceRef.current ||
      configurationKey !== committedRequestRef.current.configurationKey ||
      requestKey !== committedRequestRef.current.requestKey;
    let setupHint = "";
    // A fresh candidate is owned here until publication. Clear it when reused,
    // disposed, or handed to React so failure cleanup only releases unpublished work.
    let candidate = null;
    try {
      const config = widgetRuntimeConfigFromProps(props);
      setupHint = config.setupHint;
      const installed = loadedRef.current?.configurationKey === configurationKey
        ? loadedRef.current.service : null;
      candidate = await loadRuntimeService({
        rpcSession: attempt.rpcSession,
        config,
        previous: installed,
      });
      if (obsolete()) {
        if (candidate !== installed) {
          const abandoned = candidate;
          candidate = null;
          abandoned.runtime.dispose();
        }
        return;
      }
      if (candidate === installed) {
        candidate = null;
        setStatus({ kind: "ready", message: config.irPackage.entry });
        return;
      }
      const componentEntry = validateWidgetComponentEntry(
        candidate.runtime,
        config.irPackage.entry,
      );
      const component = candidate.runtime.call(componentEntry.entry);
      if (typeof component !== "function") {
        throw new Error(
          `VIR widget component entry ${componentEntry.entry} did not return a JavaScript function`,
        );
      }
      const next = {
        service: candidate,
        component,
        configurationKey,
        generation: acquisitionId,
      };
      loadedRef.current = next;
      setLoaded(next);
      candidate = null;
      setStatus({ kind: "ready", message: componentEntry.entry });
    } catch (error) {
      const errors = [error];
      if (candidate !== null) {
        collectCleanupError(errors, () => candidate.runtime.dispose());
      }
      const failure = errors.length === 1
        ? error
        : new AggregateError(errors, "VIR widget loading failed");
      if (!obsolete()) {
        attempt.failed = true;
        setStatus({ kind: "error", message: errorMessage(failure, setupHint) });
      } else {
        console.error(failure);
      }
    }
  }

  React.useEffect(() => {
    return () => {
      // React owns the descendant UI. Release shell ownership, not the
      // runtime: surviving callbacks and JSL keep their generation.
      loadedRef.current = null;
    };
  }, [configurationKey]);

  React.useEffect(() => {
    const previousAttempt = acquisitionRef.current;
    // Context changes leave healthy and pending acquisitions alone. A failed
    // attempt may use a new context once, including one received while pending.
    if (previousAttempt?.requestKey === requestKey &&
        (!previousAttempt.failed || previousAttempt.rpcSession === rpcSession)) {
      return;
    }
    const attempt = { requestKey, rpcSession, failed: false };
    acquisitionRef.current = attempt;
    if (loadedRef.current?.configurationKey !== configurationKey) {
      loadedRef.current = null;
      setLoaded(null);
      setStatus({ kind: "loading", message: "Loading VIR widget..." });
    }
    const acquisitionId = ++acquisitionSequenceRef.current;
    acquireAndInstallWidget(attempt, acquisitionId);
  }, [requestKey, rpcSession, status]);

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
    position: requiredPosition(props.pos, "pos"),
    setupHint: optionalString(props.setupHint, "setupHint"),
  };
}

function requiredIRPackage(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`VIR widget ${label} must be an object`);
  }
  return {
    entry: requiredString(value.entry, `${label}.entry`),
    fingerprint: requiredString(value.fingerprint, `${label}.fingerprint`),
  };
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

export async function loadRuntimeService({ rpcSession, config, previous = null }) {
  const { wasmPath, irPackage, position } = config;
  requiredString(wasmPath, "wasmPath");
  if (irPackage === null || irPackage === undefined) {
    throw new Error("VIR widget irPackage must be set");
  }
  if (position === null || position === undefined) {
    throw new Error("VIR widget irPackage requires an infoview position");
  }
  const wasmModule = await loadWasmModule(rpcSession, wasmPath);
  const builtPackage = await buildIRPackage(rpcSession, irPackage, position);
  const packageBytes = decodeBase64Bytes(builtPackage.dataBase64);
  const packageDigest = await contentDigest(packageBytes);
  // Compare the complete artifact, including interfaces and initializers.
  // Distinct descriptions can still emit identical bytes. Preserve the installed
  // component when the acquired artifacts match.
  if (previous?.runtime.module === wasmModule && previous.packageDigest === packageDigest) {
    return previous;
  }
  const runtime = await createBundledVirRuntime({
    wasmModule,
    irPackageSet: [packageBytes],
    defaultHostBindings: () => createBrowserHostBindings({
      infoviewEditorContext: EditorContext,
      infoviewPositionToTdpp: DocumentPosition.toTdpp,
      reactHostBindings: createBrowserReactHostBindings,
      infoviewUseClientNotificationEffect: useClientNotificationEffect,
      infoviewUseRpcSession: useRpcSession,
      infoviewInteractiveCode: InteractiveCode,
      infoviewStripTags: TaggedText_stripTags,
    }),
  });
  return { runtime, packageDigest };
}

async function contentDigest(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadWasmModule(rpcSession, path) {
  // Relative paths and file metadata cannot identify bytes across projects.
  // Read only on acquisition; ordinary proof/context updates never get here.
  const bytes = await loadAssetBytes(rpcSession, path);
  const digest = await contentDigest(bytes);
  let module = wasmModuleCache.get(digest);
  if (module === undefined) {
    module = WebAssembly.compile(bytes);
    wasmModuleCache.set(digest, module);
    module.catch(() => {
      if (wasmModuleCache.get(digest) === module) {
        wasmModuleCache.delete(digest);
      }
    });
  }
  return module;
}

export async function loadAssetBytes(rpcSession, path) {
  const response = await rpcSession.call("Lean.Vir.Infoview.readAsset", {
    path,
  });
  return decodeBase64Bytes(assetDataBase64(response, path));
}

export async function buildIRPackage(rpcSession, irPackage, position) {
  const { entry, fingerprint } = requiredIRPackage(irPackage, "irPackage");
  const response = await rpcSession.call("Lean.Vir.Infoview.buildIRPackage", {
    package: { entry, fingerprint },
    pos: position,
  });
  if (response?.entry !== entry) {
    throw new Error(`VIR widget entry mismatch: expected ${entry}, got ${response?.entry}`);
  }
  if (response?.fingerprint !== fingerprint) {
    throw new Error(
      `VIR IR package fingerprint mismatch: expected ${fingerprint}, got ${response?.fingerprint}`,
    );
  }
  return { entry, fingerprint,
    dataBase64: requiredString(response?.dataBase64, "IR package dataBase64") };
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

export function decodeBase64Bytes(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
