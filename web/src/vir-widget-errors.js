/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

// RPC rejections are often plain records, not native Error instances.
export function widgetErrorMessage(error, setupHint = "") {
  const seen = new Set();
  function describe(value) {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      return String(value);
    }
    if (seen.has(value)) return "[Repeated error]";
    seen.add(value);
    try {
      const message = typeof value.message === "string"
        ? value.message
        : JSON.stringify(value);
      const code = typeof value.code === "number" || typeof value.code === "string"
        ? ` (${value.code})` : "";
      const causes = value instanceof AggregateError
        ? `\n${Array.from(value.errors, describe).join("\n")}` : "";
      return `${message ?? "Unknown widget error"}${code}${causes}`;
    } catch {
      return "Unprintable widget error";
    }
  }
  const message = describe(error);
  const hint = typeof setupHint === "string" ? setupHint.trim() : "";
  return hint.length === 0 ? message : `${message}\n\n${hint}`;
}
