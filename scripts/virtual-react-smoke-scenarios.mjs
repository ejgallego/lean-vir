/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createVirtualElementState,
  createVirtualEventState,
  virtualReactElementById,
} from "../web/src/vir-runtime-node.js";
import {
  createMovedProofSurfaceFixture,
  createProofSurfaceFixture,
} from "../web/src/proof-surface-fixtures.js";
import { virtualReactTextContent } from "./virtual-fixtures.mjs";

export function smokeVirtualReactCounter(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactCounter.mount", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "react:0");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-counter-button").handlers.onClick({});
  assert.equal(element.textContent, "react:1");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-counter-button").handlers.onClick({});
  assert.equal(element.textContent, "react:2");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactInput(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountInput", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "name:");
  assertLiveCallbacks(runtime, 2);
  const currentTarget = createVirtualElementState({ value: "Ada" });
  documentState.elements.set("#react-name-input", currentTarget);
  reactElementById(element, "react-name-input").handlers.onInput(createVirtualEventState({
    currentTarget,
    target: createVirtualElementState({ value: "unused-target" }),
  }));
  assert.equal(element.textContent, "name:Ada");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-name-input").handlers.onInput(createVirtualEventState({
    target: createVirtualElementState({ value: "Target" }),
  }));
  assert.equal(element.textContent, "name:Target");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactChangeInput(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountChangeInput", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "change:");
  assertLiveCallbacks(runtime, 3);
  const submitEvent = createVirtualEventState();
  reactElementById(element, "react-change-widget").handlers.onSubmit(submitEvent);
  assert.equal(submitEvent.defaultPrevented, true);
  assert.equal(submitEvent.propagationStopped, true);
  assertLiveCallbacks(runtime, 3);
  const changeEvent = createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "Grace" }),
  });
  reactElementById(element, "react-change-input").handlers.onChange(changeEvent);
  assert.equal(element.textContent, "change:Grace");
  assert.equal(changeEvent.defaultPrevented, true);
  assert.equal(changeEvent.propagationStopped, true);
  assertLiveCallbacks(runtime, 3);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactSelectTextarea(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountSelectTextarea", selector), true);
  const element = documentState.elements.get(selector);
  assertLiveCallbacks(runtime, 3);
  const widget = reactElementById(element, "react-select-textarea-widget");
  assert.equal(widget.tag, "main");
  const nav = reactElementById(element, "react-select-textarea-nav");
  assert.equal(nav.tag, "nav");
  assert.equal(nav.props["aria-label"], "React textarea fixture");
  const noteInput = reactElementById(element, "react-note-input");
  assert.equal(noteInput.tag, "textarea");
  assert.equal(noteInput.props.name, "note");
  assert.equal(noteInput.props.value, "draft");
  assert.equal(noteInput.props.rows, 3);
  assert.equal(noteInput.props.cols, 24);
  assert.equal(noteInput.props.placeholder, "note");
  const flavorSelect = reactElementById(element, "react-flavor-select");
  assert.equal(flavorSelect.tag, "select");
  assert.equal(flavorSelect.props.name, "flavor");
  assert.equal(flavorSelect.props.value, "vanilla");
  assert.deepEqual(flavorSelect.children.map((child) => child.tag), ["option", "option", "option"]);
  assert.deepEqual(flavorSelect.children.map((child) => child.props.value), ["vanilla", "chocolate", "strawberry"]);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-select-textarea-output")),
    "note:draft; flavor:vanilla",
  );
  reactElementById(element, "react-note-input").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "hello" }),
  }));
  assertLiveCallbacks(runtime, 3);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-select-textarea-output")),
    "note:hello; flavor:vanilla",
  );
  reactElementById(element, "react-flavor-select").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "chocolate" }),
  }));
  assertLiveCallbacks(runtime, 3);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-select-textarea-output")),
    "note:hello; flavor:chocolate",
  );
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactCheckbox(runtime, documentState, selector) {
  assert.equal(runtime.call("ReactInput.mountCheckbox", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "checked:false");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-checkbox-input").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ checked: true }),
  }));
  assert.equal(element.textContent, "checked:true");
  assertLiveCallbacks(runtime, 2);
  reactElementById(element, "react-checkbox-input").handlers.onChange(createVirtualEventState({
    target: createVirtualElementState({ checked: false }),
  }));
  assert.equal(element.textContent, "checked:false");
  assertLiveCallbacks(runtime, 2);
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactAttributes(runtime, documentState, selector, {
  assertKeys = false,
} = {}) {
  assert.equal(runtime.call("ReactInput.mountAttributes", selector), true);
  const element = documentState.elements.get(selector);
  assert.equal(element.textContent, "attrs:attrs");
  assertLiveCallbacks(runtime, 0);
  const widget = reactElementById(element, "react-attributes-widget");
  assert.equal(widget.props.role, "group");
  assert.equal(widget.props["aria-label"], "React attribute fixture");
  assert.equal(widget.props["data-case"], "attributes");
  assert.equal(widget.props["data-testid"], "react-attributes");
  assert.equal(widget.props.tabIndex, 3);
  assert.equal(widget.props.className, "react-attributes is-mounted");
  assert.equal(widget.props.style.color, "rgb(1, 2, 3)");
  assert.equal(widget.props.style.marginTop, "4px");
  const label = reactElementById(element, "react-attributes-label");
  assert.equal(label.props.htmlFor, "react-attributes-input");
  const input = reactElementById(element, "react-attributes-input");
  assert.equal(input.props.name, "attributes");
  assert.equal(input.props.type, "checkbox");
  assert.equal(input.props.checked, true);
  assert.equal(input.props.disabled, true);
  const output = reactElementById(element, "react-attributes-output");
  assert.equal(output.props.title, "attribute output");
  if (assertKeys) {
    assert.equal(label.key, "attributes-label");
    assert.equal(input.key, "attributes-input");
    assert.equal(output.key, "attributes-output");
  }
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualProofWidgetsHtml(runtime, documentState, selector) {
  assert.equal(runtime.call("ProofWidgetsHtml.mount", selector), true);
  const element = documentState.elements.get(selector);
  assertLiveCallbacks(runtime, 1);
  const widget = reactElementById(element, "proofwidgets-html-demo");
  assert.equal(widget.tag, "section");
  assert.equal(widget.props.role, "region");
  assert.equal(widget.props["aria-label"], "ProofWidgets HTML facade demo");
  assert.equal(widget.props["data-testid"], "proofwidgets-html");
  assert.equal(widget.props.className, "pw-html-demo is-live");
  assert.equal(
    virtualReactTextContent(reactElementById(element, "proofwidgets-html-demo")),
    "ProofWidgets-style HtmlThis tree is written through a shallow Html facade and rendered as native React nodes.Elements5Components1TextnativeHtml.element \"section\" attrs children",
  );
  const stats = widget.children[2];
  assert.equal(stats.tag, "ul");
  assert.equal(stats.children.length, 3);
  assert.equal(stats.children[0].props["data-label"], "Elements");
  assert.equal(stats.children[1].props["data-label"], "Components");
  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualProofWidgetsJsxSubset(runtime, documentState, selector) {
  assert.equal(runtime.call("ProofWidgetsJsxSubset.mount", selector), true);
  const element = documentState.elements.get(selector);
  assertLiveCallbacks(runtime, 3);
  const widget = reactElementById(element, "proofwidgets-jsx-subset");
  assert.equal(widget.tag, "section");
  assert.equal(widget.props.role, "region");
  assert.equal(widget.props["aria-label"], "ProofWidgets JSX subset combinator demo");
  assert.equal(widget.props["data-testid"], "proofwidgets-jsx-subset");
  const card = reactElementById(element, "proofwidgets-jsx-card");
  assert.equal(card.tag, "section");
  assert.equal(card.props["data-component"], "Card");
  assert.equal(
    virtualReactTextContent(card.children[0]),
    "JSX-shaped combinators",
  );
  const headline = reactElementById(element, "proofwidgets-jsx-headline");
  assert.equal(headline.tag, "b");
  assert.equal(virtualReactTextContent(headline), "What, HTML in Lean?!");
  const parrot = reactElementById(element, "proofwidgets-jsx-parrot");
  assert.equal(parrot.tag, "img");
  assert.match(parrot.props.src, /Parrot_montage\.jpg$/);
  assert.equal(parrot.props.alt, "Six photos of parrots arranged in a grid.");
  assert.equal(reactElementById(element, "proofwidgets-jsx-letter-h").props.style.color, "red");
  assert.equal(reactElementById(element, "proofwidgets-jsx-letter-t").props.style.color, "yellow");
  const spread = reactElementById(element, "proofwidgets-jsx-spread");
  assert.equal(virtualReactTextContent(spread), "You can use HTML in Lean 4! ");
  assert.equal(reactElementById(element, "proofwidgets-jsx-divider").tag, "hr");
  const markdown = reactElementById(element, "proofwidgets-jsx-markdown");
  assert.equal(markdown.props["data-component"], "MarkdownDisplay");
  assert.match(virtualReactTextContent(markdown), /Hello, Markdown/);
  assert.match(virtualReactTextContent(markdown), /3\*19/);
  const badge = reactElementById(element, "proofwidgets-jsx-badge-info");
  assert.equal(badge.props["data-tone"], "info");
  assert.equal(virtualReactTextContent(badge), "component children");
  const interactive = reactElementById(element, "proofwidgets-jsx-interactive-expr");
  assert.equal(interactive.tag, "button");
  assert.equal(interactive.props["data-component"], "InteractiveExpr");
  assert.equal(interactive.props["data-rpc-ref"], "jsx-demo.expr.successor");
  assert.equal(interactive.props["data-type"], "Nat -> Nat");
  assert.equal(virtualReactTextContent(interactive), "InteractiveExpr fun x => x + 1 ready");
  assertLiveCallbacks(runtime, 3);
  interactive.handlers.onClick({});
  assert.equal(
    virtualReactTextContent(reactElementById(element, "proofwidgets-jsx-interactive-status")),
    " resolved fun x => x + 1 : Nat -> Nat at virtual",
  );
  assert.deepEqual(documentState.infoviewCommands, [
    {
      kind: "proofwidgetsRpcResolveRef",
      ref: {
        id: "jsx-demo.expr.successor",
        label: "fun x => x + 1",
        typeName: "ExprWithCtx",
        summary: "A sample expression reference from the JSX subset demo.",
        expression: "fun x => x + 1",
        typeText: "Nat -> Nat",
        context: "",
      },
      result: {
        id: "jsx-demo.expr.successor",
        label: "fun x => x + 1",
        typeName: "ExprWithCtx",
        summary: "A sample expression reference from the JSX subset demo.",
        expression: "fun x => x + 1",
        typeText: "Nat -> Nat",
        context: "",
        source: "virtual",
        position: "virtual",
        packageRevision: "virtual",
        storeKey: "virtual:jsx-demo.expr.successor",
        knownConstant: false,
      },
    },
  ]);
  assertLiveCallbacks(runtime, 3);
  reactElementById(element, "proofwidgets-jsx-action").handlers.onClick({});
  assert.equal(documentState.title, "ProofWidgets JSX subset clicked");
  assertLiveCallbacks(runtime, 3);
  const rows = reactElementById(element, "proofwidgets-jsx-rows");
  assert.equal(rows.tag, "ul");
  assert.equal(rows.children.length, 3);
  assert.equal(rows.children[0].key, "tags");
  assert.equal(rows.children[1].key, "components");
  assert.equal(rows.children[2].key, "interpolation");
  assert.match(virtualReactTextContent(rows), /3 rendered rows/);
  element.reactRoot.unmount();
  documentState.infoviewCommands.length = 0;
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactTamagotchi(runtime, documentState, selector, {
  extended = false,
} = {}) {
  assert.equal(runtime.call("ReactTamagotchi.mount", selector), true);
  const element = documentState.elements.get(selector);
  assertLiveCallbacks(runtime, 10);
  const widget = reactElementById(element, "react-pet-widget");
  assert.equal(widget.props["data-mood"], "happy");
  if (extended) {
    const device = reactElementById(element, "react-pet-device");
    assert.equal(device.props.role, "img");
    assert.equal(device.props["data-art"], "octopus");
    assert.equal(device.props["data-mood"], "happy");
    assert.match(device.props["aria-label"], /Octopus Octi mood happy/);
    const nameInput = reactElementById(element, "react-pet-name-input");
    assert.equal(nameInput.props.maxLength, 18);
    assert.equal(nameInput.props.autoComplete, "off");
    assert.equal(
      virtualReactTextContent(reactElementById(element, "react-pet-summary")),
      "Octi is happy; last ...; care 3/5; turn 0",
    );
  }

  reactElementById(element, "react-pet-action-ignore").handlers.onClick({});
  assertLiveCallbacks(runtime, 10);
  assert.equal(reactElementById(element, "react-pet-widget").props["data-mood"], "hungry");
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-summary")),
    "Octi is hungry; last ignore; care 2/5; turn 1",
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-trace")),
    "happyhungry",
  );
  const trace = reactElementById(element, "react-pet-trace");
  assert.equal(trace.props.role, "list");
  assert.equal(trace.props["aria-label"], "Mood trace: happy -> hungry");
  assert.equal(trace.children[0].props.role, "listitem");
  assert.equal(trace.children[1].props.role, "listitem");

  reactElementById(element, "react-pet-name-input").handlers.onChange(createVirtualEventState({
    currentTarget: createVirtualElementState({ value: "Ada" }),
  }));
  assertLiveCallbacks(runtime, 10);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-pet-summary")),
    "Ada is hungry; last rename; care 2/5; turn 1",
  );

  if (extended) {
    const submitEvent = createVirtualEventState();
    reactElementById(element, "react-pet-name-form").handlers.onSubmit(submitEvent);
    assert.equal(submitEvent.defaultPrevented, true);
    assert.equal(submitEvent.propagationStopped, true);
    assertLiveCallbacks(runtime, 10);
    reactElementById(element, "react-pet-art-toggle").handlers.onChange(createVirtualEventState({
      currentTarget: createVirtualElementState({ checked: false }),
    }));
    assertLiveCallbacks(runtime, 10);
    assert.equal(reactElementById(element, "react-pet-device").props["data-art"], "pet");
    assert.equal(reactElementById(element, "react-pet-art-toggle").props.checked, false);
    reactElementById(element, "react-pet-reset").handlers.onClick({});
    assertLiveCallbacks(runtime, 10);
    assert.equal(
      virtualReactTextContent(reactElementById(element, "react-pet-summary")),
      "Ada is happy; last ...; care 3/5; turn 0",
    );
  }

  element.reactRoot.unmount();
  assertUnmountCleanup(runtime, element);
}

export function smokeVirtualReactProofWidget(runtime, documentState, selector) {
  const proofSurfaceFixture = createProofSurfaceFixture();
  assert.equal(runtime.call("ReactProofWidget.mount", selector, proofSurfaceFixture), true);
  const element = documentState.elements.get(selector);
  const root = element.reactRoot;
  assertLiveCallbacks(runtime, 10);
  const widget = reactElementById(element, "react-proof-widget");
  assert.match(String(widget.props.style?.background ?? ""), /--vscode-editorWidget-background/);
  assert.equal(widget.props.style?.colorScheme, "light dark");
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-selected-title")),
    "Main goal",
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-target-code")),
    "xs.reverse.reverse = xs",
  );
  const summary = reactElementById(element, "react-proof-summary");
  assert.equal(
    virtualReactTextContent(summary),
    "Main goal; 2 local hypotheses; 3 goals / 6 hypotheses at ReactProofWidget.lean:42:7",
  );
  assert.equal(summary.props["aria-live"], "polite");
  assert.equal(reactElementById(element, "react-proof-detail").props["aria-live"], "polite");
  assert.equal(reactElementById(element, "react-proof-metrics").children.length, 4);
  const apiStrip = reactElementById(element, "react-proof-api-strip");
  assert.equal(apiStrip.children.length, 8);
  assert.match(virtualReactTextContent(apiStrip), /Surface\.goals3/);
  assert.match(virtualReactTextContent(apiStrip), /Hypothesis\.fvarIds2 fvars/);
  assert.match(virtualReactTextContent(apiStrip), /Clipboard\.writeTextcopy actions/);
  assert.match(virtualReactTextContent(apiStrip), /Command\.revealPositioncursor/);
  assert.match(virtualReactTextContent(apiStrip), /WithRpcRef ExprWithCtxpending/);
  const surfacePanel = reactElementById(element, "react-proof-surface-panel");
  assert.equal(surfacePanel.children.length, 6);
  assert.match(virtualReactTextContent(surfacePanel), /selectedLocationsmain/);
  assert.match(virtualReactTextContent(surfacePanel), /mvarIdmain/);
  assert.match(String(reactElementById(element, "react-proof-target").props.style?.background ?? ""), /--vscode-textCodeBlock-background/);
  const goalList = reactElementById(element, "react-proof-goal-list");
  assert.equal(goalList.props.role, "list");
  assert.equal(goalList.children.length, 3);
  const mainGoal = reactElementById(element, "react-proof-goal-main");
  assert.equal(mainGoal.props["aria-pressed"], true);
  assert.equal(mainGoal.props["aria-selected"], true);
  assert.match(String(mainGoal.props.style?.background ?? ""), /--vscode-list-activeSelectionBackground/);
  const stepGoal = reactElementById(element, "react-proof-goal-step");
  assert.equal(stepGoal.props["data-goal"], "step");
  assert.equal(stepGoal.props["aria-pressed"], false);
  reactElementById(element, "react-proof-reveal-cursor").handlers.onClick({});
  assert.deepEqual(documentState.revealedPosition, {
    uri: "file:///workspace/ReactProofWidget.lean",
    line: 41,
    character: 6,
  });
  assert.deepEqual(documentState.infoviewCommands, [
    {
      kind: "revealPosition",
      position: {
        uri: "file:///workspace/ReactProofWidget.lean",
        line: 41,
        character: 6,
      },
    },
  ]);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-action-status")),
    "Reveal cursor requested",
  );
  reactElementById(element, "react-proof-copy-cursor").handlers.onClick({});
  const cursorClipboardText = documentState.clipboardText;
  assert.match(cursorClipboardText, /Cursor: ReactProofWidget\.lean:42:7/);
  assert.match(cursorClipboardText, /URI: file:\/\/\/workspace\/ReactProofWidget\.lean/);
  assert.match(cursorClipboardText, /Line: 42/);
  assert.match(cursorClipboardText, /Character: 7/);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-action-status")),
    "Cursor copied",
  );
  reactElementById(element, "react-proof-copy-selection").handlers.onClick({});
  const selectionClipboardText = documentState.clipboardText;
  assert.match(selectionClipboardText, /Selected locations: main/);
  assert.match(selectionClipboardText, /Selection: main/);
  assert.match(selectionClipboardText, /Kind: location/);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-action-status")),
    "Selection copied",
  );
  reactElementById(element, "react-proof-copy-target").handlers.onClick({});
  assert.equal(documentState.clipboardText, "xs.reverse.reverse = xs");
  assert.deepEqual(documentState.clipboardWrites, [
    cursorClipboardText,
    selectionClipboardText,
    "xs.reverse.reverse = xs",
  ]);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-action-status")),
    "Target copied",
  );
  reactElementById(element, "react-proof-goal-step").handlers.onClick({});
  assertLiveCallbacks(runtime, 10);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-selected-title")),
    "Induction step",
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-target-code")),
    "(x :: xs).reverse.reverse = x :: xs",
  );
  const updatedSummary = reactElementById(element, "react-proof-summary");
  assert.equal(
    virtualReactTextContent(updatedSummary),
    "Induction step; 3 local hypotheses; 3 goals / 6 hypotheses at ReactProofWidget.lean:42:7",
  );
  assert.equal(updatedSummary.props["aria-live"], "polite");
  const hypotheses = reactElementById(element, "react-proof-hypotheses");
  assert.equal(hypotheses.props.role, "list");
  assert.equal(hypotheses.children.length, 3);
  assert.equal(reactElementById(element, "react-proof-goal-step").props["aria-pressed"], true);
  reactElementById(element, "react-proof-copy-context").handlers.onClick({});
  assert.match(documentState.clipboardText, /Goal: Induction step/);
  assert.match(documentState.clipboardText, /\(x :: xs\)\.reverse\.reverse = x :: xs/);
  assert.match(documentState.clipboardText, /ih : xs\.reverse\.reverse = xs/);
  assert.deepEqual(documentState.clipboardWrites, [
    cursorClipboardText,
    selectionClipboardText,
    "xs.reverse.reverse = xs",
    documentState.clipboardText,
  ]);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-action-status")),
    "Context copied",
  );
  const movedProofSurfaceFixture = createMovedProofSurfaceFixture(proofSurfaceFixture);
  assert.equal(runtime.call("ReactProofWidget.mount", selector, movedProofSurfaceFixture), true);
  assert.equal(element.reactRoot, root);
  assertLiveCallbacks(runtime, 10);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-summary")),
    "Induction step; 3 local hypotheses; 3 goals / 6 hypotheses at ReactProofWidget.lean:87:3",
  );
  assert.equal(runtime.call("ReactProofWidget.unmount", selector), true);
  assertUnmountCleanup(runtime, element);
  assert.equal(runtime.call("ReactProofWidget.unmount", selector), false);
}

export function smokeVirtualReactProofWidgetHello(runtime, documentState, selector) {
  const proofSurfaceFixture = createProofSurfaceFixture();
  const legacyProofSurfaceFixture = { ...proofSurfaceFixture };
  delete legacyProofSurfaceFixture.proofWidgetsExpr;
  assert.equal(runtime.call("ReactProofWidgetHello.mount", selector, legacyProofSurfaceFixture), true);
  assert.equal(runtime.call("ReactProofWidgetHello.mount", selector, proofSurfaceFixture), true);
  const element = documentState.elements.get(selector);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-title")),
    "Hello ProofWidget from IRIF",
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-summary")),
    "case main - active",
  );
  assert.match(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-metrics")),
    /Goals3 goalsHypotheses6Selection1CursorReactProofWidget\.lean:42:7/,
  );
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-target")),
    "xs.reverse.reverse = xs",
  );
  assert.match(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-hypothesis")),
    /xs : List Nat/,
  );
  const movedProofSurfaceFixture = {
    ...proofSurfaceFixture,
    position: "ReactProofWidget.lean:87:3",
    cursor: {
      ...proofSurfaceFixture.cursor,
      line: 86,
      character: 2,
      label: "ReactProofWidget.lean:87:3",
    },
    selectedLocations: ["step"],
    selections: [
      { id: "location-step-0", kind: "location", label: "step" },
    ],
  };
  assert.equal(runtime.call("ReactProofWidgetHello.mount", selector, movedProofSurfaceFixture), true);
  assert.equal(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-summary")),
    "case main - active",
  );
  assert.match(
    virtualReactTextContent(reactElementById(element, "react-proof-hello-metrics")),
    /ReactProofWidget\.lean:87:3/,
  );
  assert.equal(runtime.call("ReactProofWidgetHello.unmount", selector), true);
  assertUnmountCleanup(runtime, element);
  assert.equal(runtime.call("ReactProofWidgetHello.unmount", selector), false);
}

function reactElementById(element, id) {
  return virtualReactElementById(element.reactRoot, id);
}

function assertLiveCallbacks(runtime, expected) {
  assert.equal(runtime.liveCallbacks.size, expected);
}

function assertUnmountCleanup(runtime, element) {
  assertLiveCallbacks(runtime, 0);
  assert.equal(element.reactRoot, undefined);
}
