/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import {
  createMovedProofSurfaceFixture,
  createProofSurfaceFixture,
} from "../support/proof-surface-fixtures.mjs";

globalThis.runVirNativeInfoviewUpdates = async (wasm, pkg) => {
  let root;
  let component;
  let submissions = 0;
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings: createBrowserHostBindings({
      reactHostBindings: createBrowserReactHostBindings,
    }),
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const query = (selector) => container.querySelector(selector);
  const mount = (surface) => React.act(async () => {
    const node = runtime.call("VirNativeInfoview.renderComponent", component, surface);
    check(node.type === component, "every element must reuse the exact component function");
    submissions++;
    root.render(node);
  });
  const empty = (surface) => ({
    ...surface, goals: [], selectedLocations: [], selections: [],
  });
  const inspectEmpty = (surface) => {
    check(query("#vir-native-infoview-empty")?.textContent ===
      `No goals at ${surface.cursor.label}.`, "empty state must show the current cursor");
    check(query(".vir-native-infoview-goal") === null, "empty state must remove goal cards");
  };
  const inspectGoals = (surface, collapsedId = null) => {
    check(query("#vir-native-infoview-empty") === null, "goals must replace the empty state");
    check(container.querySelectorAll(".vir-native-infoview-goal").length === surface.goals.length,
      "Lean must render every goal exactly once");
    check(query("#vir-native-infoview-summary")?.textContent ===
      `${surface.goals.length} goals · ${surface.cursor.label}`, "summary must follow surface updates");
    for (const goal of surface.goals) {
      const card = query(`#vir-native-infoview-goal-${goal.index}`);
      const collapsed = goal.id === collapsedId;
      check(card?.dataset.goalId === goal.id && card.dataset.goalStatus === goal.status,
        "goal identity and status must follow the current snapshot");
      check(card.querySelector(".vir-native-infoview-collapse")?.getAttribute("aria-expanded") ===
        String(!collapsed), "goal collapse state must survive the update");
      const target = card.querySelector(".vir-native-infoview-target-code");
      if (collapsed) {
        check(target === null && card.querySelector(".vir-native-infoview-context") === null,
          "collapsed goals must keep their target and hypotheses hidden");
      } else {
        check(target?.textContent === goal.target, "target must follow the current snapshot");
        const hypotheses = card.querySelectorAll(".vir-native-infoview-hypothesis");
        check(hypotheses.length === goal.hypotheses.length, "Lean must render every hypothesis");
        goal.hypotheses.forEach((hypothesis, index) => {
          check(hypotheses[index].querySelector(".vir-native-infoview-hyp-name")?.textContent ===
            hypothesis.names.join(" "), "hypothesis names must follow the current snapshot");
          check(hypotheses[index].querySelector(".vir-native-infoview-hyp-type")?.textContent ===
            hypothesis.type, "hypothesis types must follow the current snapshot");
        });
      }
    }
  };
  try {
    root = createRoot(container);
    // These are the generated shell entries, not a fresh-root selector helper
    // or a JavaScript replacement for the Lean component.
    component = runtime.call("VirNativeInfoview.createComponent");
    check(typeof component === "function", "Lean factory must return a native component function");
    const surface = createProofSurfaceFixture();
    await mount(empty(surface));
    inspectEmpty(surface);
    const panel = query("#vir-native-infoview");

    await mount(surface);
    inspectGoals(surface);
    check(query("#vir-native-infoview") === panel, "empty-to-goals must reconcile the existing panel");
    const firstCard = query("#vir-native-infoview-goal-0");
    const toggle = firstCard.querySelector(".vir-native-infoview-collapse");
    await React.act(async () => toggle.click());
    inspectGoals(surface, surface.goals[0].id);

    const updated = createMovedProofSurfaceFixture(surface);
    updated.goals = surface.goals.map((goal) => ({
      ...goal,
      status: "updated",
      target: `updated: ${goal.target}`,
      hypotheses: goal.hypotheses.map((hypothesis) => ({
        ...hypothesis, names: hypothesis.names.map((name) => `${name}'`),
        type: `updated: ${hypothesis.type}`,
      })),
    }));
    await mount(updated);
    inspectGoals(updated, surface.goals[0].id);
    check(query("#vir-native-infoview-goal-0") === firstCard &&
      firstCard.querySelector(".vir-native-infoview-collapse") === toggle,
    "surface updates must reconcile the same keyed GoalCard and toggle");
    await React.act(async () => toggle.click());
    inspectGoals(updated);

    await mount(empty(updated));
    inspectEmpty(updated);
    check(query("#vir-native-infoview") === panel, "goals-to-empty must reconcile the existing panel");
    check(submissions === 4, "all four snapshots must use the generated Lean element entry");
    return { submissions, initialGoals: surface.goals.length, collapsedAfterUpdate: true, finalGoals: 0 };
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

function check(condition, message) {
  if (!condition) throw new Error(message);
}
