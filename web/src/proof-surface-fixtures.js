/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createProofSurfaceFixture() {
  return {
    position: "ReactProofWidget.lean:42:7",
    cursor: {
      uri: "file:///workspace/ReactProofWidget.lean",
      fileName: "ReactProofWidget.lean",
      line: 41,
      character: 6,
      label: "ReactProofWidget.lean:42:7",
    },
    goals: [
      {
        id: "main",
        kind: "goal",
        index: 0,
        title: "Main goal",
        userName: "main",
        mvarId: "main",
        status: "active",
        target: "xs.reverse.reverse = xs",
        hypotheses: [
          { id: "main-xs", names: ["xs"], fvarIds: ["xs"], type: "List Nat", value: null },
          { id: "main-hxs", names: ["hxs"], fvarIds: ["hxs"], type: "xs.length > 0", value: null },
        ],
      },
      {
        id: "step",
        kind: "goal",
        index: 1,
        title: "Induction step",
        userName: "step",
        mvarId: "step",
        status: "pending",
        target: "(x :: xs).reverse.reverse = x :: xs",
        hypotheses: [
          { id: "step-x", names: ["x"], fvarIds: ["x"], type: "Nat", value: null },
          { id: "step-xs", names: ["xs"], fvarIds: ["xs"], type: "List Nat", value: null },
          { id: "step-ih", names: ["ih"], fvarIds: ["ih"], type: "xs.reverse.reverse = xs", value: null },
        ],
      },
      {
        id: "side",
        kind: "goal",
        index: 2,
        title: "Side condition",
        userName: "side",
        mvarId: "side",
        status: "pending",
        target: "([] : List Nat).reverse = []",
        hypotheses: [
          { id: "side-inst", names: ["inst"], fvarIds: ["inst"], type: "DecidableEq Nat", value: null },
        ],
      },
    ],
    selectedLocations: ["main"],
    selections: [
      { id: "location-main-0", kind: "location", label: "main" },
    ],
    proofWidgetsExpr: null,
  };
}

export function createMovedProofSurfaceFixture(base = createProofSurfaceFixture()) {
  return {
    ...base,
    position: "ReactProofWidget.lean:87:3",
    cursor: {
      ...base.cursor,
      line: 86,
      character: 2,
      label: "ReactProofWidget.lean:87:3",
    },
    selectedLocations: ["step"],
    selections: [
      { id: "location-step-0", kind: "location", label: "step" },
    ],
  };
}
