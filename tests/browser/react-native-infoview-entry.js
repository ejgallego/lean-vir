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
