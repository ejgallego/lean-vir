/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { TaggedText_stripTags } from "@leanprover/infoview-api";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import {
  createMovedNativePanelFixture,
  createNativePanelFixture,
} from "../support/native-panel-fixtures.mjs";

globalThis.runProofWidgetsNativeChildren = async (wasm, pkg) => {
  const hostBindings = createBrowserHostBindings({
    reactHostBindings: createBrowserReactHostBindings,
    infoviewStripTags: code => TaggedText_stripTags(code),
  });
  const trace = [];
  let traceConstruction = false;
  const setProperty = hostBindings["js.object.set"];
  hostBindings["js.object.set"] = (object, name, value) => {
    if (traceConstruction) trace.push(name);
    return setProperty(object, name, value);
  };
  const textNode = hostBindings["react.node.text"];
  hostBindings["react.node.text"] = value => {
    if (traceConstruction) trace.push("text");
    return textNode(value);
  };
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings,
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const previousTitle = document.title;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const containers = [];
  try {
    const component = props => props.children;
    const payload = { color: "red" };
    const label = "native JSX value";
    const callback = () => {};
    traceConstruction = true;
    const node = runtime.call("ProofWidgetsJsxSubset.nativeConstruction",
      component, payload, label, callback);
    traceConstruction = false;
    check(JSON.stringify(trace) === JSON.stringify([
      "label", "label", "payload", "onClick", "values", "title", "style", "onClick", "text",
    ]), "native construction evaluates fields once in order before child actions");
    check(node.type === component, "uppercase JSX must preserve native component identity");
    check(node.props.label === label, "native object writes use the last duplicate field");
    check(node.props.payload === payload && node.props.onClick === callback,
      "native JSX props must not box, clone or convert their nested inputs");
    check(Array.isArray(node.props.values) && node.props.values.length === 2 &&
      node.props.values.every(value => value === label), "native array notation preserves exact values");
    check(node.props.children.props.title === label &&
      node.props.children.props.style === payload &&
      node.props.children.props.onClick === callback &&
      node.props.children.props.children === label,
    "native attributes and text must reach official React unchanged");
    trace.length = 0;
    traceConstruction = true;
    const typed = runtime.call("ProofWidgetsJsxSubset.nativeTypedConstruction",
      component, payload, label, callback);
    traceConstruction = false;
    check(JSON.stringify(trace) === JSON.stringify(["label", "payload", "onClick", "values"]),
      "typed JSX performs only ordered native field writes, with no Lean record encoding");
    check(typed.type === component && typed.props.label === label &&
      typed.props.payload === payload && typed.props.onClick === callback &&
      typed.props.values.length === 2 && typed.props.values.every(value => value === label),
    "typed native props preserve exact inputs");
    let reads = 0;
    check(runtime.call("ProofWidgetsJsxSubset.nativeTypedLabel", {
      get label() { reads++; return label; },
    }) === label && reads === 1, "declared-field projection performs one native property read");
    const fieldFailure = new Error("typed field getter failed");
    let thrown;
    try {
      runtime.call("ProofWidgetsJsxSubset.nativeTypedLabel", { get label() { throw fieldFailure; } });
    } catch (error) { thrown = error; }
    check(thrown === fieldFailure, "declared-field projection preserves native getter exceptions");
    check(runtime.call("ProofWidgetsJsxSubset.nativeStringLength", "") === 0 &&
      runtime.call("ProofWidgetsJsxSubset.nativeStringLength", "😀") === 2,
    "native string length is UTF-16 length, not decoded Lean character count");
    for (const [entry, id] of [["ProofWidgetsHtml.mount", "native-html"],
      ["ProofWidgetsJsxSubset.mount", "native-jsx"]]) {
      const container = document.createElement("div");
      container.id = id;
      document.body.append(container);
      containers.push(container);
      await React.act(async () => check(runtime.call(entry, `#${id}`), `${entry} mounts`));
    }
    check(containers[0].querySelectorAll(".pw-html-stat").length === 3,
      "explicit Lean data fields must survive native React props copying");
    const jsx = containers[1];
    check(jsx.querySelector(".pw-jsx-card-title").textContent === "JSX-shaped combinators",
      "typed JSX props reach the native component");
    check(jsx.querySelectorAll(".pw-jsx-row").length === 3,
      "multiple native children remain in the Card subtree");
    check(jsx.querySelector("#proofwidgets-jsx-badge-info").textContent.includes("component children"),
      "a single native text child remains in the Badge subtree");
    await React.act(async () => jsx.querySelector("#proofwidgets-jsx-action").click());
    check(document.title === "ProofWidgets JSX subset clicked", "nested child callback enters Lean");
    for (const [entry, id] of [
      ["ReactInput.mountInput", "native-input"],
      ["ReactInput.mountCheckbox", "native-checkbox"],
      ["ReactInput.mountSelectTextarea", "native-fields"],
      ["ReactInput.mountAttributes", "native-attributes"],
      ["ReactTamagotchi.mount", "native-pet"],
    ]) {
      const container = document.createElement("div");
      container.id = id;
      document.body.append(container);
      containers.push(container);
      await React.act(async () => check(runtime.call(entry, `#${id}`), `${entry} mounts`));
    }
    const input = document.querySelector("#react-name-input");
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Ada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    check(input.value === "Ada" && document.querySelector("#react-name-output").textContent === "Ada",
      "input state remains native through event, props and text");
    await React.act(async () => document.querySelector("#react-checkbox-input").click());
    check(document.querySelector("#react-checkbox-output").textContent === "checked:true",
      "native boolean props and callbacks survive rerendering");
    const select = document.querySelector("#react-flavor-select");
    await React.act(async () => {
      select.value = "chocolate";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    check(document.querySelector("#react-select-textarea-output").textContent === "note:draft; flavor:chocolate",
      "native select values retain existing Lean formatting");
    const attributes = document.querySelector("#react-attributes-widget");
    check(attributes.style.color === "rgb(1, 2, 3)" && attributes.style.marginTop === "4px" &&
      attributes.tabIndex === 3 && attributes.dataset.case === "attributes",
    "native style, numeric and data attributes preserve values");
    const pet = document.querySelector("#react-pet-widget");
    check(pet !== null && JSON.stringify([...pet.querySelectorAll(".react-pet-action-button")]
      .map(button => button.id)) === JSON.stringify(["feed", "play", "nap", "wake", "ignore"]
      .map(action => `react-pet-action-${action}`)),
      "Tamagotchi retains its native action tree");
    check(document.querySelector("#react-pet-device").dataset.art === "octopus",
      "Tamagotchi retains its initial artwork");
    for (const artwork of ["pet", "octopus"]) {
      await React.act(async () => document.querySelector("#react-pet-art-toggle").click());
      check(document.querySelector("#react-pet-device").dataset.art === artwork,
        `Tamagotchi artwork should be ${artwork}, got ${document.querySelector("#react-pet-device").dataset.art}`);
    }
    const helloContainer = document.createElement("div");
    document.body.append(helloContainer);
    containers.push(helloContainer);
    const helloRoot = createRoot(helloContainer);
    try {
      const Hello = runtime.call("ReactProofWidgetHello.createComponent");
      const props = createNativePanelFixture();
      for (const goals of [[], props.goals]) {
        await React.act(async () => helloRoot.render(React.createElement(Hello, { ...props, goals })));
        check(helloContainer.querySelector("#react-proof-hello h3")?.textContent === `Hello from ${props.pos.uri}`,
          "both Hello branches retain the outer section and native URI text");
        check(helloContainer.querySelector("pre")?.textContent === (goals.length === 0
          ? "Move the cursor into a proof to see its first goal."
          : `⊢ ${TaggedText_stripTags(goals[0].type)}`), "Hello displays only the first native goal");
      }
    } finally {
      await React.act(async () => helloRoot.unmount());
    }
    return true;
  } finally {
    try { await React.act(async () => runtime.dispose()); }
    finally {
      containers.forEach(container => container.remove());
      document.title = previousTitle;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }
};

globalThis.runVirNativeInfoviewUpdates = async (wasm, pkg) => {
  let root;
  let component;
  let submissions = 0;
  let expectedProps = null;
  let boundaryChecks = 0;
  const hostBindings = createBrowserHostBindings({
    reactHostBindings: createBrowserReactHostBindings,
    infoviewStripTags: (code) => TaggedText_stripTags(code),
  });
  const panelPosition = hostBindings["infoview.panelWidgetProps.pos"];
  hostBindings["infoview.panelWidgetProps.pos"] = (props) => {
    assertNestedRefs(props, expectedProps);
    boundaryChecks++;
    return panelPosition(props);
  };
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings,
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const query = (selector) => container.querySelector(selector);
  const mount = (props) => React.act(async () => {
    expectedProps = props;
    const node = React.createElement(component, props);
    check(node.type === component, "every element must reuse the exact component function");
    submissions++;
    root.render(node);
  });
  const empty = (props) => ({ ...props, goals: [], termGoal: undefined });
  const displayedGoalCount = (props) => props.goals.length + (props.termGoal === undefined ? 0 : 1);
  const positionLabel = (props) =>
    `${props.pos.uri}:${props.pos.line + 1}:${props.pos.character + 1}`;
  const goalKey = (goal, index) => goal.mvarId ?? goal.userName ?? `goal-${index}`;
  const goalStatus = (goal) =>
    goal.isRemoved === true ? "removed" : goal.isInserted === true ? "inserted" : "active";
  const inspectEmpty = (props) => {
    check(query("#vir-native-infoview-empty")?.textContent ===
      `No goals at ${positionLabel(props)}.`, "empty state must show the native position");
    check(query(".vir-native-infoview-goal") === null, "empty state must remove goal cards");
  };
  const inspectGoal = (goal, index, collapsed, prefix = "goal") => {
    const card = query(`#vir-native-infoview-goal-${prefix}-${index}`);
    check(card !== null, "every native goal must have a card");
    if (prefix === "goal") {
      check(card.dataset.goalKey === goalKey(goal, index) &&
        card.dataset.goalStatus === goalStatus(goal),
      "goal identity and native insertion/removal status must follow props");
    }
    check(card.querySelector(".vir-native-infoview-collapse")?.getAttribute("aria-expanded") ===
      String(!collapsed), "goal collapse state must survive the update");
    const target = card.querySelector(".vir-native-infoview-target-code");
    if (collapsed) {
      check(target === null && card.querySelector(".vir-native-infoview-context") === null,
        "collapsed goals must keep their target and hypotheses hidden");
      return;
    }
    check(target?.textContent === TaggedText_stripTags(goal.type),
      "target must use the exact upstream tagged-text result");
    const hypotheses = card.querySelectorAll(".vir-native-infoview-hypothesis");
    check(hypotheses.length === goal.hyps.length, "Lean must render every native hypothesis");
    goal.hyps.forEach((hypothesis, hypothesisIndex) => {
      check(hypotheses[hypothesisIndex].querySelector(".vir-native-infoview-hyp-name")?.textContent ===
        hypothesis.names.join(" "), "hypothesis names must follow native props");
      check(hypotheses[hypothesisIndex].querySelector(".vir-native-infoview-hyp-type")?.textContent ===
        TaggedText_stripTags(hypothesis.type), "hypothesis types must use tagged-text stripping");
    });
  };
  const inspectGoals = (props, collapsedKey = null) => {
    const count = displayedGoalCount(props);
    check(query("#vir-native-infoview-empty") === null, "goals must replace the empty state");
    check(container.querySelectorAll(".vir-native-infoview-goal").length === count,
      "Lean must render every tactic and term goal exactly once");
    check(query("#vir-native-infoview-summary")?.textContent ===
      `${count} goals · ${positionLabel(props)}`, "summary must follow native position updates");
    props.goals.forEach((goal, index) =>
      inspectGoal(goal, index, goalKey(goal, index) === collapsedKey));
    if (props.termGoal !== undefined) {
      inspectGoal(props.termGoal, props.goals.length, false, "term");
    }
  };
  try {
    root = createRoot(container);
    component = runtime.call("VirNativeInfoview.createComponent");
    check(typeof component === "function", "Lean factory must return a native component function");
    const props = createNativePanelFixture();
    await mount(empty(props));
    inspectEmpty(props);
    const panel = query("#vir-native-infoview");

    await mount(props);
    inspectGoals(props);
    check(query("#vir-native-infoview") === panel, "empty-to-goals must reconcile the existing panel");
    const firstCard = query("#vir-native-infoview-goal-goal-0");
    const toggle = firstCard.querySelector(".vir-native-infoview-collapse");
    await React.act(async () => toggle.click());
    inspectGoals(props, goalKey(props.goals[0], 0));

    const updated = createMovedNativePanelFixture(props);
    await mount(updated);
    inspectGoals(updated, "main");
    check(query("#vir-native-infoview-goal-goal-0") === firstCard &&
      firstCard.querySelector(".vir-native-infoview-collapse") === toggle,
    "native props updates must reconcile the same keyed GoalCard and toggle");
    const reordered = { ...updated, goals: [updated.goals[1], updated.goals[0], updated.goals[2]] };
    await mount(reordered);
    inspectGoals(reordered, "main");
    check(query("#vir-native-infoview-goal-goal-1") === firstCard &&
      firstCard.querySelector(".vir-native-infoview-collapse") === toggle,
    "reordering native goals must keep collapse state with the original goal");
    await React.act(async () => toggle.click());
    inspectGoals(reordered);

    await mount(empty(reordered));
    inspectEmpty(reordered);
    check(query("#vir-native-infoview") === panel, "goals-to-empty must reconcile the existing panel");
    check(submissions === 5, "all five snapshots must use direct React component elements");
    check(boundaryChecks === 5, "each render must reach the native panel-props boundary");
    return {
      submissions,
      boundaryChecks,
      initialGoals: displayedGoalCount(props),
      collapsedAfterUpdate: true,
      finalGoals: 0,
    };
  } finally {
    try {
      if (root) await React.act(async () => root.unmount());
    } finally {
      container.remove();
      try {
        runtime.dispose();
      } finally {
        globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      }
    }
  }
};

function assertNestedRefs(actual, expected) {
  check(expected !== null, "the component boundary requires expected native props");
  check(actual.pos === expected.pos, "component must receive the exact native position object");
  check(actual.goals === expected.goals, "component must receive the exact native goals array");
  for (let index = 0; index < expected.goals.length; index++) {
    check(actual.goals[index] === expected.goals[index], "component must preserve native goal references");
    check(actual.goals[index].hyps === expected.goals[index].hyps,
      "component must preserve nested native hypothesis arrays");
    check(actual.goals[index].hyps[0] === expected.goals[index].hyps[0],
      "component must preserve nested native hypothesis references");
  }
  check(actual.termGoal === expected.termGoal, "component must preserve the optional native term goal");
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}
