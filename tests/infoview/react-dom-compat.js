/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
// Infoview 0.13 targets React 18's react-dom.createRoot export. The test workspace
// uses React 19. Retain the actual client root so the test can also unmount it;
// renderInfoview's public API does not expose a disposer.
export * from "react-dom";
import * as ReactDOM from "react-dom";
import { createRoot as createClientRoot } from "react-dom/client";
const roots = new Set();
export function createRoot(...args) {
  const root = createClientRoot(...args);
  roots.add(root);
  return root;
}
export function unmountInfoviewRoots() {
  for (const root of roots) root.unmount();
  roots.clear();
}
export default { ...ReactDOM, createRoot };
