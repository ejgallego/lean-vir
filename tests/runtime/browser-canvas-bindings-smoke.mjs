/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createBrowserCanvasHostBindings,
  createBrowserElementHostBindings,
  createCSSStyleDeclarationHostBindings,
  createDOMTokenListHostBindings,
} from "../../web/src/vir-host-bindings.js";
import { createNullableValue } from "../../web/src/host/vir-js-value-bindings.js";

const state = {
  addDisposable() {},
  removeDisposable() {},
};

const elementCalls = [];
const child = { id: "child" };
const element = {
  textContent: "",
  attributes: new Map(),
  _classList: {
    add: (name) => elementCalls.push(["class.add", name]),
    remove: (name) => elementCalls.push(["class.remove", name]),
    toggle: (name) => {
      elementCalls.push(["class.toggle", name]);
      return true;
    },
  },
  get classList() {
    return this._classList;
  },
  set classList(value) {
    elementCalls.push(["class.set", value]);
  },
  _style: {
    setProperty: (name, value) =>
      elementCalls.push(["style.property", name, value]),
  },
  get style() {
    return this._style;
  },
  set style(value) {
    elementCalls.push(["style.text", value]);
  },
  appendChild: (value) => elementCalls.push(["append", value]),
  remove: () => elementCalls.push(["remove"]),
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  },
  setAttribute(name, value) {
    this.attributes.set(name, value);
  },
  addEventListener() {},
  removeEventListener() {},
};
const elementBindings = createBrowserElementHostBindings(state);
const tokenBindings = createDOMTokenListHostBindings();
const styleBindings = createCSSStyleDeclarationHostBindings({
  fromElement: (value) =>
    typeof value?.style?.setProperty === "function" ? value : null,
});
assert.equal(
  elementBindings["browser.element.appendChild"](element, child),
  child,
);
const tokenList = elementBindings["browser.element.getClassList"](element);
assert.equal(tokenList, element.classList);
tokenBindings["browser.domTokenList.add"](tokenList, "active");
tokenBindings["browser.domTokenList.remove"](tokenList, "hidden");
assert.equal(
  tokenBindings["browser.domTokenList.toggle"](tokenList, "ready"),
  true,
);
elementBindings["browser.element.setClassList"](element, "ready selected");
assert.equal(
  styleBindings["browser.elementCSSInlineStyle.fromElement"](element),
  element,
);
assert.equal(
  styleBindings["browser.elementCSSInlineStyle.fromElement"]({}),
  null,
);
const declaration =
  styleBindings["browser.elementCSSInlineStyle.getStyle"](element);
assert.equal(declaration, element.style);
styleBindings["browser.cssStyleDeclaration.setProperty"](
  declaration,
  "color",
  createNullableValue("red"),
);
styleBindings["browser.cssStyleDeclaration.setProperty"](
  declaration,
  "display",
  null,
);
styleBindings["browser.elementCSSInlineStyle.setStyle"](
  element,
  "color: blue",
);
elementBindings["browser.element.remove"](element);
assert.deepEqual(elementCalls, [
  ["append", child],
  ["class.add", "active"],
  ["class.remove", "hidden"],
  ["class.toggle", "ready"],
  ["class.set", "ready selected"],
  ["style.property", "color", "red"],
  ["style.property", "display", null],
  ["style.text", "color: blue"],
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
const canvasBindings = createBrowserCanvasHostBindings(state);
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
canvasBindings["browser.canvas2d.setFillStyle"](ctx, "#f80");
canvasBindings["browser.canvas2d.setStrokeStyle"](ctx, "black");
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
