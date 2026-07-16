/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  createBrowserHostBindings,
  createHostResourceState,
} from "../../web/src/vir-host-bindings.js";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import {
  assert,
  join,
  readFile,
  readRuntimeArtifacts,
  runVirIrpkg,
} from "./shared.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "lean-vir-slides-canvas-"));
const previousDocument = globalThis.document;
const previousCanvas = globalThis.HTMLCanvasElement;
const previousRequestFrame = globalThis.requestAnimationFrame;
const previousCancelFrame = globalThis.cancelAnimationFrame;
const previousConsoleError = console.error;

const drawCalls = [];
const queuedFrames = new Map();
const hostErrors = [];
let nextFrameId = 1;

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.textContent = "";
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classes = new Set();
    this.styles = new Map();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name) => {
        if (this.classes.has(name)) {
          this.classes.delete(name);
          return false;
        }
        this.classes.add(name);
        return true;
      },
    };
    this.style = {
      setProperty: (name, value) => this.styles.set(name, value),
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement === null) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

const context2d = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  clearRect: (...args) => {
    drawCalls.push(["clearRect", ...args]);
  },
  fillRect: (...args) => {
    drawCalls.push(["fillRect", ...args]);
  },
  strokeRect: (...args) => {
    drawCalls.push(["strokeRect", ...args]);
  },
};

class FakeCanvas extends FakeElement {
  constructor() {
    super("canvas");
    this.width = 300;
    this.height = 150;
  }

  getContext(kind) {
    return kind === "2d" ? context2d : null;
  }
}

const slideRoot = new FakeElement("section");

try {
  globalThis.HTMLCanvasElement = FakeCanvas;
  globalThis.document = {
    title: "",
    querySelector: (selector) => selector === "#vir-slide-root" ? slideRoot : null,
    createElement: (tagName) => tagName === "canvas" ? new FakeCanvas() : new FakeElement(tagName),
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    queuedFrames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => queuedFrames.delete(id);
  console.error = (...args) => hostErrors.push(args);

  const packagePath = join(tempDir, "slides-canvas.irpkg");
  const generated = runVirIrpkg([
    packagePath,
    join(tempDir, "slides-canvas.report.md"),
    "--target-marked",
    "examples/SlidesCanvas.lean",
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const { wasmBytes } = await readRuntimeArtifacts();
  const resources = createHostResourceState();
  const runtime = await createVirRuntime({
    wasmBytes,
    irPackageBytes: await readFile(packagePath),
    defaultHostBindings: createBrowserHostBindings({ resources }),
  });
  try {
    for (const target of ["js.float.owned", "js.string.owned"]) {
      const hostImport = runtime.interfaceManifest.hostImports.find((entry) => entry.target === target);
      assert.equal(hostImport?.boundary, "explicitConversion");
    }
    assert.equal(runtime.runEntries(), undefined);
    assert.equal(runtime.runEntries(), undefined);
    assert.equal(slideRoot.children.length, 2);

    const [status, canvas] = slideRoot.children;
    assert.ok(status.classes.has("vir-slide-status"));
    assert.ok(canvas instanceof FakeCanvas);
    assert.ok(canvas.classes.has("vir-slide-canvas"));
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 360);
    assert.equal(queuedFrames.size, 1);
    const mountedResourceCounts = resources.debugResourceCounts();

    const [[frameId, drawFrame]] = queuedFrames.entries();
    queuedFrames.delete(frameId);
    drawFrame(20_000);
    assert.deepEqual(hostErrors, []);

    assert.deepEqual(drawCalls, [
      ["clearRect", 0, 0, 640, 360],
      ["fillRect", 0, 124, 72, 72],
      ["strokeRect", 0, 124, 72, 72],
    ]);
    assert.equal(context2d.fillStyle, "#2563eb");
    assert.equal(context2d.strokeStyle, "#0f172a");
    assert.equal(context2d.lineWidth, 3);
    assert.equal(status.textContent, "Lean animation frame: 0");
    assert.equal(queuedFrames.size, 1, "the Lean callback should schedule the next frame");
    assert.deepEqual(
      resources.debugResourceCounts(),
      mountedResourceCounts,
      "a frame should consume its temporary float and text resources",
    );

    const [[secondFrameId, secondDrawFrame]] = queuedFrames.entries();
    queuedFrames.delete(secondFrameId);
    secondDrawFrame(20_160);
    assert.deepEqual(hostErrors, []);
    assert.deepEqual(drawCalls.slice(3), [
      ["clearRect", 0, 0, 640, 360],
      ["fillRect", 10, 124, 72, 72],
      ["strokeRect", 10, 124, 72, 72],
    ]);
    assert.equal(status.textContent, "Lean animation frame: 1");
    assert.equal(queuedFrames.size, 1, "the Lean callback should keep scheduling frames");
    assert.deepEqual(
      resources.debugResourceCounts(),
      mountedResourceCounts,
      "repeated frames should not accumulate scalar host resources",
    );
  } finally {
    runtime.dispose();
  }
  assert.equal(queuedFrames.size, 0, "runtime disposal should cancel the pending frame");
} finally {
  console.error = previousConsoleError;
  restoreGlobal("document", previousDocument);
  restoreGlobal("HTMLCanvasElement", previousCanvas);
  restoreGlobal("requestAnimationFrame", previousRequestFrame);
  restoreGlobal("cancelAnimationFrame", previousCancelFrame);
  await rm(tempDir, { recursive: true, force: true });
}

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
  } else {
    globalThis[name] = value;
  }
}
