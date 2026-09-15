/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
// A deliberately small live renderer fixture.  The driver moves Chromium's
// pointer with CDP; it never substitutes a JavaScript hover implementation.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { TaggedText_stripTags } from "@leanprover/infoview-api";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";

const fixture = Object.freeze({
  pos: { uri: "file:///NativeHover.lean", line: 0, character: 0 },
  goals: [{ userName: "hover", mvarId: "hover", goalPrefix: "", isInserted: true, hyps: [],
    type: { tag: [{ info: { p: "parent" } }, { append: [
      { text: "prefix " }, { tag: [{ info: { p: "child" } }, { text: "child" }] },
      { text: " middle " }, { tag: [{ info: { p: "sibling" } }, { text: "sibling" }] },
      { text: " suffix" },
    ] }] } }],
  selectedLocations: [],
});

globalThis.setupNativeHoverPanel = async (wasm, pkg) => {
  const requests = [];
  const session = { call(method, info, options) {
    requests.push({ method, info, options, ref: info.p });
    return Promise.resolve({ exprExplicit: { text: info.p }, type: { text: "Nat" }, doc: "Hover docs" });
  } };
  const oldError = console.error;
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const warnings = [];
  console.error = (...args) => { warnings.push(args.map(String).join(" ")); oldError(...args); };
  // CDP dispatches browser-user events rather than test-harness act events.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const act = async callback => {
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    try { return await React.act(callback); }
    finally { globalThis.IS_REACT_ACT_ENVIRONMENT = previous; }
  };
  const editorContext = React.createContext({ api: { copyToClipboard: async () => {} } });
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)), irPackageSet: [new Uint8Array(pkg)],
    hostBindings: createBrowserHostBindings({ reactHostBindings: createBrowserReactHostBindings,
      infoviewStripTags: TaggedText_stripTags, infoviewEditorContext: editorContext,
      infoviewUseRpcSession: () => session }),
  });
  const container = document.createElement("div");
  container.style.cssText = "margin:80px";
  document.body.append(container);
  const root = createRoot(container);
  const component = runtime.call("VirNativeInfoview.createComponent");
  const render = async () => act(async () => root.render(React.createElement(component, fixture)));
  await render();
  const tag = () => container.querySelector(".vir-native-infoview-code-tag");
  const popup = () => {
    const tags = [...container.querySelectorAll(".vir-native-infoview-code-tag")];
    const active = tags.find(node => node.classList.contains("highlight"));
    const owner = active ?? tag();
    return document.getElementById(owner?.getAttribute("aria-controls"))
      ?? [...document.querySelectorAll(".vir-native-infoview-type-popup")].at(-1);
  };
  const rect = element => {
    const value = element?.getBoundingClientRect();
    return value && { left: value.left, top: value.top, width: value.width, height: value.height };
  };
  const textRect = needle => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf(needle);
      if (start >= 0) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + needle.length);
        return rect(range);
      }
    }
    return null;
  };
  const instances = new WeakMap();
  let nextInstance = 0;
  const instance = node => {
    if (!instances.has(node)) instances.set(node, ++nextInstance);
    return instances.get(node);
  };
  globalThis.nativeHoverController = {
    render,
    reset: render,
    theme: dark => {
      const style = document.documentElement.style;
      for (const [name, value] of Object.entries({
        "font-family": "system-ui", "font-size": "13px",
        "editor-font-family": "monospace", "editor-font-size": "14px",
        "editor-line-height": "21px", "editor-foreground": dark ? "#ddd" : "#222",
        "editorHoverWidget-foreground": dark ? "#ddd" : "#333",
        "editorHoverWidget-background": dark ? "#252526" : "#f3f3f3",
        "editorHoverWidget-border": dark ? "#555" : "#ccc",
        "widget-shadow": "#0003", "editor-selectionBackground": dark ? "#264f78" : "#add6ff",
      })) style.setProperty(`--vscode-${name}`, value);
      document.body.style.cssText = `font:13px system-ui;color:${dark ? "#ddd" : "#222"};background:${dark ? "#1e1e1e" : "#fff"}`;
    },
    requests: () => requests.length,
    snapshot: () => {
      const element = tag();
      const tip = popup();
      const tipStyle = tip && getComputedStyle(tip);
      const doc = tip?.querySelector(".vir-native-infoview-doc");
      const code = tip?.querySelector(".font-code");
      const tags = [...container.querySelectorAll(".vir-native-infoview-code-tag")].map(node => ({
        id: node.getAttribute("aria-controls"), instance: instance(node), text: node.textContent,
        highlighted: node.classList.contains("highlight"), rect: rect(node),
      }));
      return { requests: requests.length, refs: requests.map(request => request.ref), warnings, popup: Boolean(tip),
        highlighted: tags.filter(value => value.highlighted).map(value => value.id), tags,
        prefixRect: textRect("prefix"), suffixRect: textRect("suffix"), tag: rect(element),
        popupRect: rect(tip),
        popupStyle: tip && {
          color: tipStyle.color, background: tipStyle.backgroundColor, radius: tipStyle.borderRadius,
          shadow: tipStyle.boxShadow, padding: tipStyle.padding,
          docFont: doc && getComputedStyle(doc).fontFamily,
          codeFont: code && getComputedStyle(code).fontFamily,
          separators: tip.querySelectorAll("hr").length,
        },
        popupPosition: tip && getComputedStyle(tip).position, portal: tip?.parentElement === document.body };
    },
    dispose: async () => {
      await act(async () => root.unmount());
      await act(async () => runtime.dispose());
      container.remove();
      console.error = oldError;
      globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
      return warnings;
    },
  };
  return globalThis.nativeHoverController.snapshot();
};
