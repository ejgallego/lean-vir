/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Execute the actual documentation example, not a second lifecycle implementation.
// These are scheduling/ownership tests; real Wasm is covered by browser.mjs.
const guide = readFileSync(new URL("../../docs/guides/RESOURCE_LIFETIME.md", import.meta.url), "utf8");
const source = guide.match(/<!-- resource-mount-example -->\s*```js\n([\s\S]*?)\n```/)[1];
function setup() {
  const pending = [], states = [];
  const create = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const host = new Function("createProgram", "setStatus", "runtimeManifestUrl", "programManifestUrl",
    `${source}\nreturn { mount, unmount, get current() { return current; } };`)(
    create, state => states.push(state), new URL("https://example.test/runtime/bundle.json"),
    new URL("https://example.test/program/bundle.json"));
  return { host, pending, states };
}
function program(name, cleanupError = null) {
  return { disposed: 0, call() { assert.equal(this.disposed, 0); return name; },
    dispose() { this.disposed++; if (cleanupError) throw cleanupError; } };
}

for (const order of [[0, 1], [1, 0]]) {
  test(`latest mount wins completion order ${order}`, async () => {
    const { host, pending, states } = setup();
    const mounts = [host.mount(), host.mount()];
    const programs = [program("old"), program("new")];
    for (const i of order) {
      pending[i].resolve(programs[i]);
      await mounts[i];
      if (i === 0) assert.equal(programs[0].disposed, 1);
    }
    assert.equal(host.current, programs[1]);
    assert.equal(host.current.call(), "new");
    assert.equal(states.at(-1), "Ready");
    host.unmount(); host.unmount();
    assert.equal(programs[1].disposed, 1);
    assert.equal(host.current, null);
  });
}

test("unmount invalidates pending success and stale rejection", async () => {
  const { host, pending, states } = setup();
  const success = host.mount();
  const rejected = host.mount();
  host.unmount();
  const late = program("late");
  pending[0].resolve(late);
  await success;
  const error = new Error("late failure");
  const observed = assert.rejects(rejected, e => e === error);
  pending[1].reject(error);
  await observed;
  assert.equal(late.disposed, 1);
  assert.equal(host.current, null);
  assert.equal(states.at(-1), "Disposed");
});

test("stale failure cannot replace a ready peer; current failure is visible", async () => {
  const { host, pending, states } = setup();
  const old = host.mount(), latest = host.mount();
  const ready = program("ready");
  pending[1].resolve(ready); await latest;
  const observed = assert.rejects(old, /old failure/);
  pending[0].reject(new Error("old failure")); await observed;
  assert.equal(host.current.call(), "ready");
  assert.equal(states.at(-1), "Ready");
  const failure = host.mount();
  assert.equal(ready.disposed, 1);
  const caught = assert.rejects(failure, /current failure/);
  pending[2].reject(new Error("current failure")); await caught;
  assert.equal(states.at(-1), "Failed");
  assert.equal(host.current, null);
});

test("throwing cleanup detaches ownership; separate hosts remain independent", async () => {
  const a = setup(), b = setup();
  const error = new Error("cleanup failure");
  const failedCleanup = program("a", error), peer = program("b");
  const mountingA = a.host.mount(), mountingB = b.host.mount();
  a.pending[0].resolve(failedCleanup); b.pending[0].resolve(peer);
  await Promise.all([mountingA, mountingB]);
  assert.throws(() => a.host.unmount(), e => e === error);
  assert.equal(a.host.current, null);
  assert.equal(a.states.at(-1), "Disposed");
  a.host.unmount();
  assert.equal(failedCleanup.disposed, 1);
  assert.equal(b.host.current.call(), "b");
  b.host.unmount();
});
