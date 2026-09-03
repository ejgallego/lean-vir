/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { createBrowserCanvasHostBindings } from "../../web/src/vir-host-bindings.js";

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
  measureText: (text) => {
    canvasCalls.push(["measureText", text]);
    return { width: 42.5 };
  },
  arc: (...args) => canvasCalls.push(["arc", ...args]),
  fill: () => canvasCalls.push(["fill"]),
  stroke: () => canvasCalls.push(["stroke"]),
  save: () => canvasCalls.push(["save"]),
  restore: () => canvasCalls.push(["restore"]),
  translate: (...args) => canvasCalls.push(["translate", ...args]),
  rotate: (...args) => canvasCalls.push(["rotate", ...args]),
};
const canvas = {
  width: 300,
  height: 150,
  getContext: (kind) => (kind === "2d" ? ctx : null),
};
const canvasBindings = createBrowserCanvasHostBindings();
assert.equal(
  canvasBindings["browser.htmlCanvasElement.fromElement"](canvas),
  canvas,
);
assert.equal(canvasBindings["browser.htmlCanvasElement.fromElement"]({}), null);
assert.equal(canvasBindings["browser.htmlCanvasElement.getWidth"](canvas), 300);
assert.equal(
  canvasBindings["browser.htmlCanvasElement.getHeight"](canvas),
  150,
);
canvasBindings["browser.htmlCanvasElement.setWidth"](canvas, 640);
canvasBindings["browser.htmlCanvasElement.setHeight"](canvas, 360);
assert.equal(canvas.width, 640);
assert.equal(canvas.height, 360);
assert.equal(
  canvasBindings["browser.htmlCanvasElement.getContext2D"](canvas),
  ctx,
);
canvasBindings["browser.canvas2d.clearRect"](ctx, 0, 0, 640, 360);
canvasBindings["browser.canvas2d.fillRect"](ctx, 1.5, 2.5, 30, 40);
canvasBindings["browser.canvas2d.strokeRect"](ctx, 3, 4, 50, 60);
canvasBindings["browser.canvas2d.beginPath"](ctx);
canvasBindings["browser.canvas2d.moveTo"](ctx, 1, 2);
canvasBindings["browser.canvas2d.lineTo"](ctx, 3, 4);
const metrics = canvasBindings["browser.canvas2d.measureText"](ctx, "Lean VIR");
assert.equal(
  canvasBindings["browser.canvas2d.textMetrics.getWidth"](metrics),
  42.5,
);
canvasBindings["browser.canvas2d.arc"](ctx, 5, 6, 7, 0, 3.14);
canvasBindings["browser.canvas2d.closePath"](ctx);
canvasBindings["browser.canvas2d.fill"](ctx);
canvasBindings["browser.canvas2d.stroke"](ctx);
const fillStyle = canvasBindings["js.value.browser.canvasStyle.string"]("#f80");
const strokeStyle = canvasBindings["js.value.browser.canvasStyle.string"]("black");
assert.equal(fillStyle, "#f80");
assert.equal(strokeStyle, "black");
canvasBindings["browser.canvas2d.setFillStyleValue"](ctx, fillStyle);
canvasBindings["browser.canvas2d.setStrokeStyleValue"](ctx, strokeStyle);
canvasBindings["browser.canvas2d.setLineWidth"](ctx, 2.25);
assert.equal(canvasBindings["browser.canvas2d.getFillStyle"](ctx), "#f80");
assert.equal(canvasBindings["browser.canvas2d.getStrokeStyle"](ctx), "black");
assert.equal(canvasBindings["browser.canvas2d.getLineWidth"](ctx), 2.25);
const gradient = { kind: "CanvasGradient" };
const pattern = { kind: "CanvasPattern" };
canvasBindings["browser.canvas2d.setFillStyleValue"](ctx, gradient);
canvasBindings["browser.canvas2d.setStrokeStyleValue"](ctx, pattern);
assert.equal(canvasBindings["browser.canvas2d.getFillStyle"](ctx), gradient);
assert.equal(canvasBindings["browser.canvas2d.getStrokeStyle"](ctx), pattern);
canvasBindings["browser.canvas2d.save"](ctx);
canvasBindings["browser.canvas2d.translate"](ctx, 4, 8);
canvasBindings["browser.canvas2d.rotate"](ctx, 0.5);
canvasBindings["browser.canvas2d.restore"](ctx);
assert.deepEqual(canvasCalls, [
  ["clearRect", 0, 0, 640, 360],
  ["fillRect", 1.5, 2.5, 30, 40],
  ["strokeRect", 3, 4, 50, 60],
  ["beginPath"],
  ["moveTo", 1, 2],
  ["lineTo", 3, 4],
  ["measureText", "Lean VIR"],
  ["arc", 5, 6, 7, 0, 3.14],
  ["closePath"],
  ["fill"],
  ["stroke"],
  ["save"],
  ["translate", 4, 8],
  ["rotate", 0.5],
  ["restore"],
]);
assert.equal(ctx.fillStyle, gradient);
assert.equal(ctx.strokeStyle, pattern);
assert.equal(ctx.lineWidth, 2.25);

console.log("vir browser canvas bindings smoke ok");
