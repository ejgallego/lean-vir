/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createInfoviewHostBindings({
  commandDispatcher = null,
  useClientNotificationEffect = null,
} = {}) {
  return {
    "infoview.documentPosition": (uri, fileName, line, character, label) =>
      documentPosition(uri, fileName, line, character, label),
    "infoview.clipboard.writeText": (text) => writeTextToHostClipboard(text),
    "infoview.command.revealPosition": (position) =>
      dispatchInfoviewCommand(commandDispatcher, "revealPosition", position),
    "infoview.command.insertText": (position, text) =>
      dispatchInfoviewCommand(commandDispatcher, "insertText", position, text),
    "infoview.rpcSession.call": (session, method, params) =>
      session.call(method, params),
    "infoview.rpcSession.callWithOptions": (session, method, params, options) =>
      session.call(method, params, options),
    "infoview.clientRequestOptions.empty": () => ({}),
    "infoview.clientRequestOptions.setAbortSignal": (options, signal) => {
      options.abortSignal = signal;
    },
    "infoview.useClientNotificationEffect": (method, callback) => {
      if (useClientNotificationEffect === null) {
        throw new Error("useClientNotificationEffect requires the upstream infoview host");
      }
      return useClientNotificationEffect(method, callback);
    },
    "infoview.useClientNotificationEffectWithDeps": (method, callback, deps) => {
      if (useClientNotificationEffect === null) {
        throw new Error("useClientNotificationEffect requires the upstream infoview host");
      }
      return useClientNotificationEffect(method, callback, deps);
    },
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
  if (
    commandDispatcher !== null &&
    typeof commandDispatcher === "object" &&
    typeof commandDispatcher[name] === "function"
  ) {
    return (...payload) => commandDispatcher[name](...payload);
  }
  return null;
}

function reportInfoviewHostError(error) {
  console.error(error);
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

function documentPosition(uri, fileName, line, character, label) {
  const lineNumber = nonNegativeInteger(line);
  const characterNumber = nonNegativeInteger(character);
  if (lineNumber === null || characterNumber === null) {
    throw new Error(
      "infoview document position requires non-negative safe-integer coordinates",
    );
  }
  return {
    uri,
    fileName,
    line: lineNumber,
    character: characterNumber,
    label,
  };
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
  return null;
}
