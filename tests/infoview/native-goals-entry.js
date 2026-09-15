/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0. */
import * as React from "react";
import { createRoot } from "react-dom/client";
import { TaggedText_stripTags } from "@leanprover/infoview-api";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";

const check = (value, message) => { if (!value) throw new Error(message); };
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected),
  `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
const code = text => ({ tag: [{ info: { p: "fixture" } }, { text }] });
const hyp = (names, flags = {}) => ({ names, type: code("Nat"), ...flags });
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Isolate deliberately malformed wire replies without suppressing ordinary
// React warnings or changing the production renderer's error policy.
class WireErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? React.createElement("span", { role: "alert" }, "Invalid reply") : this.props.children; }
}

export async function runNativeGoalPanel(wasm, pkg, entry = "VirNativeInfoview.createComponent") {
  let copiedText;
  let rejectCopy = false;
  const requests = [];
  let replyMode = "ready";
  let resolveDelayed;
  let invalidDoc;
  const nativeDoc = "Unicode: λ ∀ 🐙\n  **plain text**, not Markdown";
  const session = { call(method, info, options) {
    requests.push({ method, info, options });
    if (replyMode === "delayed") return new Promise(resolve => { resolveDelayed = resolve; });
    if (replyMode === "error") return Promise.reject(new Error("RPC failed"));
    if (replyMode === "null-doc") return Promise.resolve({ exprExplicit: { text: "p" }, type: { text: "Prop" }, doc: null });
    if (replyMode === "omitted-doc") return Promise.resolve({ type: { text: "Prop" } });
    if (replyMode === "undefined-doc") return Promise.resolve({ type: { text: "Prop" }, doc: undefined });
    if (replyMode === "empty-doc") return Promise.resolve({ type: { text: "Prop" }, doc: "" });
    if (replyMode === "native-doc") return Promise.resolve({ type: { text: "Prop" }, doc: nativeDoc });
    if (replyMode === "nested-popup") return Promise.resolve({
      type: { tag: [{ info: { p: "popup-child" } }, { text: "nested response" }] }, doc: "Parent popup",
    });
    if (replyMode === "invalid-doc") return Promise.resolve({ type: { text: "Prop" }, doc: invalidDoc });
    if (replyMode === "null-code") return Promise.resolve({ exprExplicit: null, type: null, doc: null });
    return Promise.resolve({ exprExplicit: { text: "n" }, type: { text: "Nat" }, doc: "Natural numbers" });
  } };
  const editorContext = React.createContext({ api: { copyToClipboard: async text => {
    if (rejectCopy) throw new Error("clipboard denied");
    copiedText = text;
  } } });
  const hostBindings = createBrowserHostBindings({
      reactHostBindings: createBrowserReactHostBindings,
      infoviewStripTags: TaggedText_stripTags,
      infoviewEditorContext: editorContext,
      infoviewUseRpcSession: () => session,
  });
  const fmtReads = [];
  const get = hostBindings["js.object.get"];
  hostBindings["js.object.get"] = (object, name) => {
    const value = get(object, name);
    if (name === "fmt") fmtReads.push({ props: object, value });
    return value;
  };
  let decodedDocs = 0;
  let stringDecodes = 0;
  let stringEncodes = 0;
  const encodedStrings = new Set();
  const decodedStrings = new Set();
  const encodeString = hostBindings["js.string"];
  hostBindings["js.string"] = value => {
    stringEncodes++;
    encodedStrings.add(value);
    return encodeString(value);
  };
  const decodeString = hostBindings["js.string.value"];
  hostBindings["js.string.value"] = value => {
    stringDecodes++;
    decodedStrings.add(value);
    if (value === nativeDoc || value === "Natural numbers") decodedDocs++;
    return decodeString(value);
  };
  const lengthInputs = [];
  const stringLength = hostBindings["js.string.length"];
  hostBindings["js.string.length"] = value => {
    lengthInputs.push(value);
    return stringLength(value);
  };
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings,
  });
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const oldError = console.error;
  const warnings = [];
  console.error = (...args) => { warnings.push(args.map(String).join(" ")); oldError(...args); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const containers = [document.createElement("div"), document.createElement("div")];
  containers.forEach(c => document.body.append(c));
  const roots = containers.map(c => createRoot(c));
  const fixture = freeze({
    pos: { uri: "file:///NativeGoals.lean", line: 0, character: 0 },
    goals: [{
      userName: "main", mvarId: "main", goalPrefix: "", isInserted: true,
      type: code("n = n"),
      hyps: [hyp(["α"], { isType: true }), hyp(["inst"], { isInstance: true }),
        hyp(["visible", "hidden✝"]), hyp(["only✝"]), hyp(["n"], { val: code("2") }),
        hyp(["[anonymous]", "x[anonymous]y"]), hyp([])],
    }, {
      userName: "second", mvarId: "second", goalPrefix: "⊢? ", type: code("True"), hyps: [],
    }],
    selectedLocations: [],
  });
  const snapshot = JSON.stringify(fixture);
  let checks = 0;
  const verify = (actual, expected, label) => { equal(actual, expected, label); checks++; };
  const first = containers[0];
  const card = (key = "main", container = first) => container.querySelector(`[data-goal-key="${key}"]`);
  const names = (container = first) => [...card("main", container).querySelectorAll(".vir-native-infoview-hyp-name")]
    .map(n => n.textContent.trim().replace(/\s+/g, " "));
  const control = (label, container = first) => [...container.querySelectorAll("label")]
    .find(n => n.textContent.trim() === label)?.querySelector("input");
  const toggle = async label => {
    const input = control(label); check(input, `missing ${label}`);
    await React.act(async () => input.click());
  };
  const render = async props => React.act(async () => roots[0].render(React.createElement(component, props)));
  let component;
  let initialConversions;
  try {
    component = runtime.call(entry);
    await render(fixture);
    await React.act(async () => roots[1].render(React.createElement(component, fixture)));
    initialConversions = { stringDecodes, stringEncodes };
    verify(fixture.goals[0].hyps.flatMap(hyp => hyp.names).every(name => !encodedStrings.has(name)), true,
      "hypothesis names are filtered in Lean but never re-encoded for display");
    verify(!encodedStrings.has("⊢? ") && !decodedStrings.has("⊢? "), true,
      "custom goal prefix remains native through display");
    const codes = new Set(fixture.goals.flatMap(goal => [goal.type,
      ...goal.hyps.flatMap(hyp => [hyp.type, ...(hyp.val ? [hyp.val] : [])])]));
    verify(fmtReads.some(read => read.value === fixture.goals[0].type), true,
      "native fmt props carry the exact goal tagged-text value");
    verify(fmtReads.every(read => codes.has(read.value) && !("data" in read.props)), true,
      "declared fmt projection uses native props without WithData boxing");
    verify(names(), ["α", "inst", "visible hidden✝", "only✝", "n", ""], "upstream anonymous/empty bundle behavior");
    verify(card().querySelector(".goal-vdash").textContent, "", "empty prefix is preserved");
    verify(card("second").querySelector(".goal-vdash").textContent, "⊢? ", "custom prefix");
    await toggle("Hide type assumptions");
    verify(names(), ["inst", "visible hidden✝", "only✝", "n", ""], "type filter");
    await toggle("Hide instance assumptions");
    verify(names(), ["visible hidden✝", "only✝", "n", ""], "instance filter");
    await toggle("Hide inaccessible assumptions");
    verify(names(), ["visible", "n", ""], "mixed and fully inaccessible bundles");
    await toggle("Hide let-values");
    verify(card().querySelector(".vir-native-infoview-hyp-value"), null, "hide value");
    await toggle("Hide let-values");
    verify(card().querySelector(".vir-native-infoview-hyp-value").textContent.trim(), ":= 2", "restore value");
    await toggle("Display target before assumptions");
    verify(names(), ["", "n", "visible"], "reverse hypothesis order");
    verify(card().querySelector("[id]").firstElementChild.className, "vir-native-infoview-target", "target first");
    await toggle("Emphasize first goal");
    verify(card("second").style.opacity, "0.7", "first-goal emphasis");
    await React.act(async () => card().querySelector("button").click());
    verify(card().querySelector("[id]").hidden, true, "collapse");
    await toggle("Hide goal names");
    verify(card().querySelector("button"), null, "hide name");
    verify(card().querySelector("[id]").hidden, false, "hidden names do not hide goals");
    await toggle("Hide goal names");
    verify(card().querySelector("[id]").hidden, true, "restore remembered collapse");
    const originalCard = card();
    await render({ ...fixture, pos: { ...fixture.pos, line: 9 }, goals: [...fixture.goals].reverse() });
    verify(card() === originalCard, true, "stable goal identity after reorder");
    verify(card().querySelector("[id]").hidden, true, "collapse survives cursor/reorder");
    verify(control("Hide type assumptions").checked, true, "settings survive cursor changes");
    await React.act(async () => { control("Hide let-values").click(); control("Hide let-values").click(); });
    verify(control("Hide let-values").checked, false, "batched toggles compose");
    verify(names(containers[1]), ["α", "inst", "visible hidden✝", "only✝", "n", ""], "independent mounted panel state");
    const ids = [...document.querySelectorAll(".vir-native-infoview-goal [id]")].map(n => n.id);
    verify(new Set(ids).size, ids.length, "unique native useId values across panels");
    await render({ ...fixture, goals: [] });
    verify(first.querySelector(".vir-native-infoview-summary").textContent, "No goals", "empty state");
    await render(fixture);
    verify(control("Hide type assumptions").checked, true, "empty-to-goals retains settings");
    verify(JSON.stringify(fixture), snapshot, "all native input objects remain unchanged");
    await React.act(async () => first.querySelector(".vir-native-infoview-copy").click());
    verify(copiedText, "case main\nα : Nat\ninst : Nat\nvisible hidden✝ : Nat\nonly✝ : Nat\nn : Nat := 2\n : Nat\n : Nat\n⊢ n = n\n\ncase second\n⊢ True",
      "copy complete unfiltered state with upstream formatting");
    rejectCopy = true;
    await React.act(async () => first.querySelector(".vir-native-infoview-copy").click());
    verify(first.querySelector('[role="status"]').textContent, "Copy failed", "clipboard rejection surfaced");
    const tag = () => card().querySelector(".vir-native-infoview-target-code .vir-native-infoview-code-tag");
    // Hover is intentionally delayed; keyboard and click activation below remain
    // immediate.  The popup is a document portal, so aria-controls is its owner
    // relationship rather than DOM containment.
    const wait = ms => React.act(async () => new Promise(resolve => setTimeout(resolve, ms)));
    const popupFor = element => document.getElementById(element.getAttribute("aria-controls"));
    const popup = () => popupFor(tag());
    const hover = async (element = tag()) => {
      await React.act(async () => element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
      await wait(550);
    };
    const leave = async (element = tag(), relatedTarget = document.body) => {
      await React.act(async () => element.dispatchEvent(new PointerEvent("pointerout", {
        bubbles: true, relatedTarget,
      })));
      await wait(350);
    };
    verify(requests.length, 0, "tagged code does not fetch before interaction");
    await hover();
    verify(tag().classList.contains("highlight"), true, "hovered tag is highlighted");
    verify(popup().textContent.includes("n : Nat"), true, "native type popup renders tagged reply");
    verify(popup().textContent.includes("Natural numbers"), true, "popup documentation");
    verify(popup().querySelector('button[aria-label="Close type information"]') !== null, true,
      "portal popup retains its close control");
    verify(requests[0].method, "Lean.Widget.InteractiveDiagnostics.infoToInteractive", "official RPC method");
    verify(requests[0].info === fixture.goals[0].type.tag[0].info, true, "exact server reference passed to RPC");
    await React.act(async () => tag().click());
    await leave();
    verify(popup() !== null, true, "clicked popup remains pinned after pointer leaves");
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    verify(popup(), null, "Escape closes popup");
    verify(requests[0].options.abortSignal.aborted, true, "closing cancels the request scope");
    const fastLeaveRequests = requests.length;
    await React.act(async () => {
      tag().dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      tag().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    await wait(550);
    verify(requests.length, fastLeaveRequests, "fast hover leave does not issue RPC");
    verify(popup(), null, "fast hover leave creates no popup");
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      await React.act(async () => tag().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, [modifier]: true })));
      await wait(550);
      verify(popup(), null, `${modifier} suppresses delayed hover popup`);
      verify(requests.length, fastLeaveRequests, `${modifier} suppresses delayed hover RPC`);
    }
    await React.act(async () => tag().dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    verify(popup() !== null, true, "focus opens the popup immediately");
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await hover();
    const heldPopup = popup();
    await React.act(async () => {
      tag().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: heldPopup }));
      heldPopup.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: tag() }));
    });
    await wait(350);
    verify(popup() === heldPopup, true, "entering portal popup cancels its close timer");
    await React.act(async () => heldPopup.dispatchEvent(new PointerEvent("pointerout", {
      bubbles: true, relatedTarget: document.body,
    })));
    await wait(350);
    verify(popup(), null, "portal popup closes after its leave delay");
    replyMode = "delayed";
    await hover();
    verify(popup().textContent.includes("Loading"), true, "pending popup state");
    const delayed = requests.at(-1);
    await leave();
    verify(delayed.options.abortSignal.aborted, true, "obsolete popup is aborted");
    await React.act(async () => resolveDelayed({ type: { text: "obsolete" } }));
    verify(popup(), null, "late resolution cannot reopen a closed popup");
    replyMode = "error";
    await hover();
    verify(popup().textContent.includes("Unable to load type information"), true, "RPC rejection is visible");
    await leave();
    replyMode = "ready";
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    verify(popup().textContent.includes("n : Nat"), true, "keyboard activation and request recovery");
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    replyMode = "null-doc";
    await hover();
    verify(popup().textContent.includes("p : Prop"), true, "Lean RPC null documentation is absent");
    verify(popup().querySelector(".vir-native-infoview-doc"), null, "null doc creates no documentation element");
    await leave();
    for (const mode of ["omitted-doc", "undefined-doc", "empty-doc"]) {
      replyMode = mode;
      await hover();
      verify(popup().textContent.includes("Prop"), true, `${mode} retains popup type`);
      verify(popup().querySelector(".vir-native-infoview-doc"), null, `${mode} creates no documentation element`);
      await leave();
    }
    replyMode = "native-doc";
    await hover();
    verify(popup().querySelector(".vir-native-infoview-doc").textContent, nativeDoc,
      "documentation preserves Unicode, whitespace and literal Markdown");
    verify(decodedDocs, 0, "display documentation never decodes to Lean String");
    verify(lengthInputs.includes("") && lengthInputs.includes(nativeDoc), true,
      "empty and Unicode docs use the native string-length branch");
    await leave();
    replyMode = "null-code";
    await hover();
    verify(popup().querySelector(".font-code").textContent, " : ", "null optional popup code is absent");
    await leave();
    replyMode = "nested-popup";
    await hover();
    const parentPopup = popup();
    const popupChild = parentPopup.querySelector(".vir-native-infoview-code-tag");
    verify(popupChild !== null, true, "parent popup renders a nested tagged response");
    await hover(popupChild);
    const childPopup = popupFor(popupChild);
    verify(childPopup !== null, true, "nested response opens a child portal popup");
    await React.act(async () => popupChild.click());
    await React.act(async () => {
      popupChild.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: parentPopup }));
      childPopup.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: parentPopup }));
      parentPopup.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    });
    await wait(350);
    verify(popupFor(popupChild) === childPopup && popup() === parentPopup, true,
      "pinning nested child keeps both popup portals after leaves");
    await React.act(async () => popupChild.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    verify(popupFor(popupChild), null, "child Escape closes only child popup");
    verify(popup() === parentPopup, true, "child Escape preserves pinned parent popup");
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    verify(popup(), null, "parent Escape removes the nested popup chain");
    await hover();
    const unmountParentPopup = popup();
    const unmountChild = unmountParentPopup.querySelector(".vir-native-infoview-code-tag");
    await React.act(async () => unmountChild.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    const chainUnmountRequests = requests.length;
    await render({ ...fixture, goals: [] });
    await wait(550);
    verify(document.querySelectorAll(".vir-native-infoview-type-popup").length, 0,
      "unmount removes parent and nested child portals");
    verify(requests.length, chainUnmountRequests, "unmount cancels nested popup hover timer without RPC");
    await render(fixture);
    replyMode = "ready";
    const termGoal = freeze({ hyps: [hyp(["local"])], type: { text: "Expected" } });
    await render({ ...fixture, termGoal });
    verify(card("term").querySelector("button").textContent, "▾ Expected type", "expected-type heading");
    verify(card("term").querySelector(".goal-vdash").textContent, "⊢ ", "default expected-type prefix");
    await React.act(async () => card("term").querySelector("button").click());
    const termCard = card("term");
    await render({ ...fixture, goals: [], termGoal });
    verify(card("term") === termCard, true, "term identity survives tactic-goal removal");
    verify(card("term").querySelector("[id]").hidden, true, "term collapse survives tactic-goal removal");
    await render(fixture);
    verify(card("term"), null, "absent expected type removes its card");
    const diffTags = ["wasChanged", "willChange", "wasInserted", "willInsert", "wasDeleted", "willDelete"];
    const nested = freeze({ append: [{ append: [] }, { append: [{ text: "left " }] },
      { tag: ["highlighted", { text: "highlight" }] },
      ...diffTags.map(diffStatus => ({ tag: [{ info: { p: diffStatus }, diffStatus }, { text: diffStatus }] }))] });
    const nestedSnapshot = JSON.stringify(nested);
    await render({ ...fixture, goals: [{ ...fixture.goals[0], type: nested }] });
    const target = card().querySelector(".vir-native-infoview-target-code");
    verify(target.textContent, "left highlight" + diffTags.join(""), "append and nested tagged text remain in order");
    verify(target.querySelector(".highlighted-text").textContent, "highlight", "highlight marker");
    verify(target.querySelectorAll(".inserted-text").length, 3, "insertion and changed diff tags");
    verify(target.querySelectorAll(".removed-text").length, 3, "removal and pending-change diff tags");
    replyMode = "ready";
    const nestedTag = target.querySelector(".vir-native-infoview-code-tag");
    await React.act(async () => nestedTag.click());
    const nestedRequest = requests.at(-1);
    verify(nestedRequest.info === nested.append[3].tag[0].info, true, "native append traversal preserves exact tag reference");
    const nestedPopupId = nestedTag.getAttribute("aria-controls");
    const requestCount = requests.length;
    const changedText = freeze({ append: [{ append: [] }, { append: [{ text: "updated " }] }, ...nested.append.slice(2)] });
    await render({ ...fixture, goals: [{ ...fixture.goals[0], type: changedText }] });
    const updatedTag = card().querySelector(".vir-native-infoview-target-code .vir-native-infoview-code-tag");
    verify(updatedTag === nestedTag && updatedTag.getAttribute("aria-controls") === nestedPopupId,
      true, "native child construction preserves tag component and popup identity");
    verify(popupFor(updatedTag) !== null, true, "pinned portal popup survives sibling text update");
    verify(requests.length, requestCount, "sibling text update does not restart popup request");
    verify(nestedRequest.options.abortSignal.aborted, false, "sibling text update preserves request lifetime");
    verify(JSON.stringify(nested), nestedSnapshot, "append traversal never mutates native input");
    await React.act(async () => tag().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    const hoverTree = freeze({ tag: [{ info: { p: "parent" } }, { append: [
      { text: "parent " }, { tag: [{ info: { p: "child" } }, { text: "child" }] },
      { text: " " }, { tag: [{ info: { p: "sibling" } }, { text: "sibling" }] },
    ] }] });
    await render({ ...fixture, goals: [{ ...fixture.goals[0], type: hoverTree }] });
    const hoverTags = [...card().querySelectorAll(".vir-native-infoview-target-code .vir-native-infoview-code-tag")];
    const childBeforeParentPopup = hoverTags[1];
    const activeHighlights = () => hoverTags.filter(element => element.classList.contains("highlight"));
    verify(hoverTags.length, 3, "nested hover fixture renders parent, child and sibling tags");
    await hover(hoverTags[0]);
    verify(hoverTags[1] === childBeforeParentPopup, true, "opening parent popup preserves nested child DOM identity");
    await React.act(async () => {
      hoverTags[0].dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: hoverTags[1] }));
      hoverTags[1].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: hoverTags[0] }));
    });
    await wait(550);
    verify(activeHighlights().length, 1, "parent-to-child transition has one active highlight");
    verify(activeHighlights()[0] === hoverTags[1], true, "child owns nested hover highlight");
    await React.act(async () => {
      hoverTags[1].dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: hoverTags[2] }));
      hoverTags[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: hoverTags[1] }));
    });
    await wait(550);
    verify(activeHighlights().length, 1, "child-to-sibling transition has one active highlight");
    verify(activeHighlights()[0] === hoverTags[2], true, "sibling owns transition highlight");
    await leave(hoverTags[2]);
    const unmountRequests = requests.length;
    await React.act(async () => hoverTags[0].dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    await render({ ...fixture, goals: [] });
    await wait(550);
    verify(requests.length, unmountRequests, "unmount disposes pending hover timer without RPC");
    let coercions = 0;
    const invalidDocs = [false, 42, [], new String("boxed"),
      { toString() { coercions++; return "coerced"; } }];
    for (const [index, value] of invalidDocs.entries()) {
      invalidDoc = value;
      replyMode = "invalid-doc";
      const invalidContainer = document.createElement("div");
      document.body.append(invalidContainer);
      const caught = [];
      const invalidRoot = createRoot(invalidContainer, { onCaughtError: error => caught.push(error) });
      try {
        await React.act(async () => invalidRoot.render(React.createElement(WireErrorBoundary, null,
          React.createElement(component, fixture))));
        const invalidTag = invalidContainer.querySelector(".vir-native-infoview-target-code .vir-native-infoview-code-tag");
        await React.act(async () => invalidTag.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
        await wait(550);
        verify(caught.length > 0 && caught.every(error => String(error).includes("expects a primitive JavaScript string")),
          true, `malformed doc ${index} fails primitive-string validation`);
        verify(invalidContainer.querySelector('[role="alert"]')?.textContent, "Invalid reply",
          `malformed doc ${index} reaches the host error boundary`);
        verify(requests.at(-1).options.abortSignal.aborted, true,
          `malformed doc ${index} cleans up its popup request scope`);
      } finally {
        await React.act(async () => invalidRoot.unmount());
        invalidContainer.remove();
      }
    }
    verify(coercions, 0, "malformed documentation is never string-coerced");
    replyMode = "ready";
    // Keep the retained visual preview representative of the default panel.
    await React.act(async () => roots[0].unmount());
    roots[0] = createRoot(first);
    await render(fixture);
    return { checks, warnings, html: first.innerHTML, initialConversions };
  } finally {
    await React.act(async () => roots.forEach(root => root.unmount()));
    await React.act(async () => runtime.dispose());
    containers.forEach(c => c.remove());
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    console.error = oldError;
  }
}

globalThis.runNativeGoalPanel = runNativeGoalPanel;
