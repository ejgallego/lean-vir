/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createInfoviewHostBindings({ commandDispatcher = null } = {}) {
  return {
    "infoview.documentPosition": (uri, fileName, line, character, label) => ({
      uri,
      fileName,
      line,
      character,
      label,
    }),
    "infoview.clipboard.writeText": (text) => writeTextToHostClipboard(text),
    "infoview.command.revealPosition": (position) =>
      revealInfoviewPosition(commandDispatcher, position),
    "infoview.command.insertText": (position, text) =>
      insertInfoviewText(commandDispatcher, position, text),
    "proofwidgets.rpc.ref": (id, label, typeName, summary, expression) => ({
      id,
      label,
      typeName,
      summary,
      expression,
      typeText: "",
      context: "",
    }),
    "proofwidgets.rpc.ref.finish": (ref, typeText, context, serverRef) => ({
      ...ref,
      typeText,
      context,
      ...nullableField(serverRef, "serverRef"),
    }),
    "js.value.proofwidgets.resolvedRef.value": (ref) =>
      normalizeProofWidgetsResolvedRef(ref),
    "proofwidgets.rpc.inspectRef": (ref) =>
      inspectProofWidgetsRpcRef(commandDispatcher, ref),
    "proofwidgets.rpc.resolveRef": (ref, callback) =>
      resolveProofWidgetsRpcRef(commandDispatcher, ref, callback),
  };
}

export function normalizeInfoviewDocumentPosition(position) {
  if (position === null || typeof position !== "object") {
    return null;
  }
  const uri = typeof position.uri === "string" ? position.uri : "";
  if (uri.length === 0) {
    return null;
  }
  const line = nonNegativeInteger(position.line);
  const character = nonNegativeInteger(position.character);
  if (line === null || character === null) {
    return null;
  }
  return { uri, line, character };
}

export function normalizeProofWidgetsRpcRef(ref) {
  if (ref === null || typeof ref !== "object") {
    return null;
  }
  const id = stringField(ref.id);
  if (id.length === 0) {
    return null;
  }
  const normalized = {
    id,
    label: stringField(ref.label),
    typeName: stringField(ref.typeName),
    summary: stringField(ref.summary),
    expression: stringField(ref.expression),
    typeText: stringField(ref.typeText),
    context: stringField(ref.context),
  };
  const serverRef = proofWidgetsServerRpcRef(ref);
  if (serverRef !== null) {
    normalized.serverRef = serverRef;
  }
  return normalized;
}

export function normalizeProofWidgetsResolvedRef(ref) {
  const value = ref !== null && typeof ref === "object" ? ref : {};
  return {
    id: stringField(value.id),
    label: stringField(value.label),
    typeName: stringField(value.typeName),
    summary: stringField(value.summary),
    expression: stringField(value.expression),
    typeText: stringField(value.typeText),
    context: stringField(value.context),
    source: stringField(value.source),
    position: stringField(value.position),
    packageRevision: stringField(value.packageRevision),
    storeKey: stringField(value.storeKey),
    knownConstant: value.knownConstant === true,
  };
}

function writeTextToHostClipboard(text) {
  const copiedSynchronously = copyTextWithExecCommand(text);
  if (copiedSynchronously) {
    return true;
  }
  const clipboard = globalThis.navigator?.clipboard;
  if (
    clipboard !== null &&
    typeof clipboard === "object" &&
    typeof clipboard.writeText === "function"
  ) {
    try {
      clipboard.writeText(text).catch((error) => {
        reportInfoviewHostError(error);
      });
      return true;
    } catch (error) {
      reportInfoviewHostError(error);
      return false;
    }
  }
  return false;
}

function revealInfoviewPosition(commandDispatcher, position) {
  const normalized = normalizeInfoviewDocumentPosition(position);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "revealPosition",
    normalized,
  );
}

function insertInfoviewText(commandDispatcher, position, text) {
  const normalized = normalizeInfoviewDocumentPosition(position);
  if (normalized === null || typeof text !== "string") {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "insertText",
    normalized,
    text,
  );
}

function inspectProofWidgetsRpcRef(commandDispatcher, ref) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null) {
    return false;
  }
  return dispatchInfoviewCommand(
    commandDispatcher,
    "proofwidgetsRpcInspectRef",
    normalized,
  );
}

function resolveProofWidgetsRpcRef(commandDispatcher, ref, callback) {
  const normalized = normalizeProofWidgetsRpcRef(ref);
  if (normalized === null || typeof callback !== "function") {
    return false;
  }
  const handler = infoviewCommandHandler(
    commandDispatcher,
    "proofwidgetsRpcResolveRef",
  );
  if (handler === null) {
    return false;
  }
  let result;
  try {
    result = handler(normalized);
  } catch (error) {
    reportInfoviewHostError(error);
    return false;
  }
  if (result === false) {
    return false;
  }
  if (
    result !== null &&
    typeof result === "object" &&
    typeof result.then === "function"
  ) {
    result
      .then((info) => {
        callHostCallback(callback, normalizeProofWidgetsResolvedRef(info));
      })
      .catch((error) => {
        reportInfoviewHostError(error);
      });
  } else {
    callHostCallback(callback, normalizeProofWidgetsResolvedRef(result));
  }
  return true;
}

function dispatchInfoviewCommand(commandDispatcher, name, ...payload) {
  const handler = infoviewCommandHandler(commandDispatcher, name);
  if (handler === null) {
    return false;
  }
  try {
    const result = handler(...payload);
    if (
      result !== null &&
      typeof result === "object" &&
      typeof result.then === "function"
    ) {
      result.catch((error) => {
        reportInfoviewHostError(error);
      });
      return true;
    }
    return result !== false;
  } catch (error) {
    reportInfoviewHostError(error);
    return false;
  }
}

function infoviewCommandHandler(commandDispatcher, name) {
  const dispatcher =
    commandDispatcher ?? globalThis.leanVirInfoviewCommands ?? null;
  if (typeof dispatcher === "function") {
    return (...payload) => dispatcher(name, ...payload);
  }
  if (
    dispatcher !== null &&
    typeof dispatcher === "object" &&
    typeof dispatcher[name] === "function"
  ) {
    return (...payload) => dispatcher[name](...payload);
  }
  return null;
}

function callHostCallback(callback, value) {
  try {
    callback(value);
  } catch (error) {
    reportInfoviewHostError(error);
  }
}

function reportInfoviewHostError(error) {
  console.error(error);
  const status = globalThis.document?.querySelector?.("#status") ?? null;
  if (status !== null) {
    status.textContent = "Trap";
    status.dataset.ready = "false";
  }
}

function copyTextWithExecCommand(text) {
  const document = globalThis.document;
  if (
    document === null ||
    typeof document !== "object" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }
  const body = document.body;
  if (body === null || typeof body !== "object") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function nullableField(value, name) {
  return value === null ? {} : { [name]: value };
}

function nonNegativeInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function stringField(value) {
  return typeof value === "string" ? value : "";
}

function proofWidgetsServerRpcRef(ref) {
  return isRpcRefObject(ref.serverRef) ? ref.serverRef : null;
}

function isRpcRefObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.__rpcref === "number" || typeof value.p === "number")
  );
}
