/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

function code(text) {
  return {
    append: [
      { text: text.slice(0, Math.max(1, Math.floor(text.length / 2))) },
      { tag: [{ info: "fixture" }, { text: text.slice(Math.max(1, Math.floor(text.length / 2))) }] },
    ],
  };
}

function hypothesis(name, type, val = undefined) {
  return { names: [name], type: code(type), val };
}

export function createNativePanelFixture() {
  return {
    pos: {
      uri: "file:///workspace/VirNativeInfoview.lean",
      line: 41,
      character: 6,
    },
    goals: [
      {
        userName: "main",
        mvarId: "main",
        isInserted: true,
        isRemoved: false,
        type: code("xs.reverse.reverse = xs"),
        hyps: [
          hypothesis("xs", "List Nat"),
          hypothesis("hxs", "xs.length > 0", code("proof")),
        ],
      },
      {
        type: code("(x :: xs).reverse.reverse = x :: xs"),
        hyps: [
          hypothesis("x", "Nat"),
          hypothesis("xs", "List Nat"),
          hypothesis("ih", "xs.reverse.reverse = xs"),
        ],
      },
      {
        userName: "side",
        type: code("([] : List Nat).reverse = []"),
        hyps: [hypothesis("inst", "DecidableEq Nat")],
      },
    ],
    termGoal: {
      type: code("Nat"),
      hyps: [hypothesis("n", "Nat")],
    },
    selectedLocations: [],
  };
}

export function createMovedNativePanelFixture(base = createNativePanelFixture()) {
  return {
    ...base,
    pos: { ...base.pos, line: 86, character: 2 },
    goals: base.goals.map((goal) => ({
      ...goal,
      type: code(`updated: ${plainFixtureCode(goal.type)}`),
      hyps: goal.hyps.map((hyp) => ({
        ...hyp,
        names: hyp.names.map((name) => `${name}'`),
        type: code(`updated: ${plainFixtureCode(hyp.type)}`),
      })),
    })),
    termGoal: {
      ...base.termGoal,
      type: code(`updated: ${plainFixtureCode(base.termGoal.type)}`),
      hyps: base.termGoal.hyps.map((hyp) => ({
        ...hyp,
        names: hyp.names.map((name) => `${name}'`),
        type: code(`updated: ${plainFixtureCode(hyp.type)}`),
      })),
    },
  };
}

function plainFixtureCode(value) {
  if ("text" in value) return value.text;
  if ("append" in value) return value.append.map(plainFixtureCode).join("");
  return plainFixtureCode(value.tag[1]);
}
