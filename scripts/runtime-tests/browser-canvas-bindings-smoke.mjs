/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createBrowserCanvasHostBindings,
  createBrowserElementHostBindings,
} from "../../web/src/vir-host-bindings.js";

const state = {
  resourceForValue: (value) => value,
  resolveResource: (value) => value,
  addDisposable() {},
  releaseResource() {},
};

const elementCalls = [];
const child = { id: "child" };
const element = {
  textContent: "",
  attributes: new Map(),
  classList: {
    add: (name) => elementCalls.push(["class.add", name]),
    remove: (name) => elementCalls.push(["class.remove", name]),
    toggle: (name) => {
      elementCalls.push(["class.toggle", name]);
      return true;
    },
  },
  style: {
    setProperty: (name, value) => elementCalls.push(["style", name, value]),
  },
  appendChild: (value) => elementCalls.push(["append", value]),
  remove: () => elementCalls.push(["remove"]),
  getAttribute(name) { return this.attributes.get(name) ?? null; },
  setAttribute(name, value) { this.attributes.set(name, value); },
  addEventListener() {},
  removeEventListener() {},
};
const elementBindings = createBrowserElementHostBindings(state);
elementBindings["browser.element.appendChild"](element, child);
elementBindings["browser.element.classList.add"](element, "active");
elementBindings["browser.element.classList.remove"](element, "hidden");
assert.equal(elementBindings["browser.element.classList.toggle"](element, "ready"), true);
elementBindings["browser.element.style.setProperty"](element, "color", "red");
elementBindings["browser.element.remove"](element);
assert.deepEqual(elementCalls, [
  ["append", child],
  ["class.add", "active"],
  ["class.remove", "hidden"],
  ["class.toggle", "ready"],
  ["style", "color", "red"],
  ["remove"],
]);

const canvasCalls = [];
const ctx = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  clearRect: (...args) => canvasCalls.push(["clearRect", ...args]),
  fillRect: (...args) => canvasCalls.push(["fillRect", ...args]),
  strokeRect: (...args) => canvasCalls.push(["strokeRect", ...args]),
  beginPath: () => canvasCalls.push(["beginPath"]),
  closePath: () => canvasCalls.push(["closePath"]),
  moveTo: (...args) => canvasCalls.push(["moveTo", ...args]),
  lineTo: (...args) => canvasCalls.push(["lineTo", ...args]),
  arc: (...args) => canvasCalls.push(["arc", ...args]),
  fill: () => canvasCalls.push(["fill"]),
  stroke: () => canvasCalls.push(["stroke"]),
  save: () => canvasCalls.push(["save"]),
  restore: () => canvasCalls.push(["restore"]),
  translate: (...args) => canvasCalls.push(["translate", ...args]),
  rotate: (...args) => canvasCalls.push(["rotate", ...args]),
};
const canvas = { width: 300, height: 150, getContext: (kind) => kind === "2d" ? ctx : null };
const canvasBindings = createBrowserCanvasHostBindings(state);
assert.equal(canvasBindings["browser.htmlCanvasElement.getWidth"](canvas), 300n);
canvasBindings["browser.htmlCanvasElement.setWidth"](canvas, 640n);
canvasBindings["browser.htmlCanvasElement.setHeight"](canvas, 360n);
assert.equal(canvas.width, 640);
assert.equal(canvas.height, 360);
canvasBindings["browser.canvas2d.fillRect"](ctx, 1.5, 2.5, 30, 40);
canvasBindings["browser.canvas2d.arc"](ctx, 5, 6, 7, 0, 3.14);
canvasBindings["browser.canvas2d.setFillStyle"](ctx, "#f80");
canvasBindings["browser.canvas2d.setStrokeStyle"](ctx, "black");
canvasBindings["browser.canvas2d.setLineWidth"](ctx, 2.25);
canvasBindings["browser.canvas2d.translate"](ctx, 4, 8);
canvasBindings["browser.canvas2d.rotate"](ctx, 0.5);
assert.deepEqual(canvasCalls, [
  ["fillRect", 1.5, 2.5, 30, 40],
  ["arc", 5, 6, 7, 0, 3.14],
  ["translate", 4, 8],
  ["rotate", 0.5],
]);
assert.equal(ctx.fillStyle, "#f80");
assert.equal(ctx.strokeStyle, "black");
assert.equal(ctx.lineWidth, 2.25);

console.log("vir browser canvas bindings smoke ok");
