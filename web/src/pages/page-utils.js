/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function setReadyState(element, text, ready) {
  element.textContent = text;
  element.dataset.ready = String(ready);
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function assetPathFor(text, baseUrl) {
  if (/^(https?:)?\/\//.test(text) || text.startsWith("/")) {
    return text;
  }
  return `${baseUrl}${text}`;
}
