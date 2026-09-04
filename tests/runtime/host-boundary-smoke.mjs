/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  abortHostCallTransaction,
  beginHostCallTransaction,
  commitHostCallTransaction,
  ExternrefRoots,
  registerHostCallRollback,
} from "../../web/src/host-boundary.js";
import {
  createAnimationHostBindings,
  createHostLifecycle,
  createTimerHostBindings,
} from "../../web/src/host/vir-active-host-bindings.js";
import { createJsValueHostBindings } from "../../web/src/host/vir-js-value-bindings.js";
import { createBrowserAnimationHostBindings } from "../../web/src/vir-host-bindings.js";
import { createInfoviewHostBindings } from "../../web/src/host/vir-infoview-host-bindings.js";

{
  const roots = new ExternrefRoots({ initial: 3 });
  const object = { name: "same object" };
  const values = [null, undefined, false, 0, -0, 3n, "text", object];
  const ids = values.map((value) => roots.root(value));
  values.forEach((value, index) => {
    assert.equal(roots.has(ids[index]), true);
    assert.equal(Object.is(roots.get(ids[index]), value), true);
  });
  assert.equal(roots.get(0), undefined);
  assert.equal(roots.has(0), false);
  roots.release(ids[0]);
  assert.equal(roots.has(ids[0]), false);
  const reused = roots.root("reused");
  assert.equal(reused, ids[0]);
  assert.equal(roots.get(reused), "reused");
  roots.clear();
  assert.equal(roots.debugCounts().active, 0);
}

{
  const events = [];
  const transaction = beginHostCallTransaction();
  registerHostCallRollback(() => events.push("first"));
  registerHostCallRollback(() => events.push("second"));
  commitHostCallTransaction(transaction);
  assert.deepEqual(events, []);
}

{
  const events = [];
  const transaction = beginHostCallTransaction();
  registerHostCallRollback(() => events.push("first"));
  registerHostCallRollback(() => events.push("second"));
  abortHostCallTransaction(transaction);
  assert.deepEqual(events, ["second", "first"]);
}

{
  const outerEvents = [];
  const outer = beginHostCallTransaction();
  registerHostCallRollback(() => outerEvents.push("outer"));
  const inner = beginHostCallTransaction();
  registerHostCallRollback(() => outerEvents.push("inner"));
  commitHostCallTransaction(inner);
  abortHostCallTransaction(outer);
  assert.deepEqual(outerEvents, ["outer"]);
  assert.equal(
    registerHostCallRollback(() => undefined),
    false,
  );
}

{
  const lifecycle = createHostLifecycle();
  const events = [];
  const removable = { remove: () => events.push("remove") };
  const cancellable = { cancel: () => events.push("cancel") };
  lifecycle.addDisposable(removable, () => removable.remove());
  lifecycle.addDisposable(cancellable, () => cancellable.cancel());
  assert.deepEqual(lifecycle.debugResourceCounts(), {
    active: 2,
  });
  lifecycle.removeDisposable(removable);
  lifecycle.dispose();
  assert.deepEqual(events, ["cancel"]);
  assert.equal(lifecycle.phase, "disposed");
  let rejectedCleanup = 0;
  assert.throws(
    () => lifecycle.addDisposable({}, () => rejectedCleanup++),
    /host lifecycle cannot register/,
  );
  assert.equal(rejectedCleanup, 1);
  lifecycle.dispose();
}

{
  const calls = [];
  const bindings = createInfoviewHostBindings({
    commandDispatcher: {
      insertText(...payload) {
        calls.push(payload);
      },
    },
  });
  const position = bindings["infoview.documentPosition"](
    "file:///Main.lean",
    "Main.lean",
    3n,
    7n,
    "Main",
  );
  assert.equal(
    bindings["infoview.command.insertText"](position, "exact text"),
    true,
  );
  assert.deepEqual(calls, [
    [
      {
        uri: "file:///Main.lean",
        fileName: "Main.lean",
        line: 3,
        character: 7,
        label: "Main",
      },
      "exact text",
    ],
  ]);
  assert.throws(
    () =>
      bindings["infoview.documentPosition"](
        "file:///Main.lean",
        "Main.lean",
        -1n,
        0n,
        "Main",
      ),
    /non-negative safe-integer coordinates/,
  );
}

{
  const lifecycle = createHostLifecycle();
  const bindings = createJsValueHostBindings();
  const object = { exact: true };
  assert.equal(bindings["js.nullable.of"](object), object);
  assert.equal(bindings["js.nullable.of"](undefined), undefined);
  assert.equal(bindings["js.nullable.null"](), null);
  assert.equal(bindings["js.nullable.isNull"](null), true);
  assert.equal(bindings["js.nullable.isNull"](object), false);
  assert.equal(bindings["js.nullable.isNull"](undefined), false);
  assert.equal(bindings["js.nullable.value"](object), object);
  assert.equal(bindings["js.nullable.value"](undefined), undefined);
  assert.throws(() => bindings["js.nullable.value"](null), /non-null/);
  lifecycle.dispose();
}

{
  const nativeTimers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timeoutTokens = [
    { kind: "timeout", id: 1 },
    { kind: "timeout", id: 2 },
  ];
  const intervalToken = { kind: "interval", id: 1 };
  const timeoutRuns = [];
  const cancellations = [];
  let timeoutIndex = 0;
  globalThis.setTimeout = (run, delay) => {
    assert.equal(delay, 7);
    timeoutRuns.push(run);
    return timeoutTokens[timeoutIndex++];
  };
  globalThis.clearTimeout = (token) => cancellations.push(["timeout", token]);
  let intervalRun = null;
  globalThis.setInterval = (run, delay) => {
    assert.equal(delay, 11);
    intervalRun = run;
    return intervalToken;
  };
  globalThis.clearInterval = (token) => cancellations.push(["interval", token]);

  try {
    const lifecycle = createHostLifecycle();
    const bindings = createTimerHostBindings(lifecycle);
    let timeoutCalls = 0;
    const timeout = bindings["browser.timer.setTimeout"](
      () => timeoutCalls++,
      7,
    );
    assert.equal(timeout, timeoutTokens[0]);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 1 });
    timeoutRuns[0]();
    assert.equal(timeoutCalls, 1);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });

    const interval = bindings["browser.timer.setInterval"](() => {
      throw new Error("interval callback boom");
    }, 11);
    assert.equal(interval, intervalToken);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 1 });
    assert.throws(() => intervalRun(), /interval callback boom/);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 1 });
    bindings["browser.timer.clearInterval"](interval);
    assert.deepEqual(cancellations, [["interval", intervalToken]]);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });

    const transaction = beginHostCallTransaction();
    const abortedTimeout = bindings["browser.timer.setTimeout"](
      () => undefined,
      7,
    );
    assert.equal(abortedTimeout, timeoutTokens[1]);
    abortHostCallTransaction(transaction);
    assert.deepEqual(cancellations, [
      ["interval", intervalToken],
      ["timeout", timeoutTokens[1]],
    ]);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });

    globalThis.setInterval = () => {
      throw new Error("schedule failed");
    };
    assert.throws(
      () => bindings["browser.timer.setInterval"](() => undefined, 11),
      /schedule failed/,
    );
    assert.deepEqual(cancellations, [
      ["interval", intervalToken],
      ["timeout", timeoutTokens[1]],
    ]);

    const synchronousToken = { kind: "timeout", id: "synchronous" };
    globalThis.setTimeout = (run) => {
      run();
      return synchronousToken;
    };
    let synchronousCalls = 0;
    assert.equal(
      bindings["browser.timer.setTimeout"](() => synchronousCalls++, 7),
      synchronousToken,
    );
    assert.equal(synchronousCalls, 1);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
    assert.throws(
      () =>
        bindings["browser.timer.setTimeout"](() => {
          throw new Error("timeout callback boom");
        }, 7),
      /timeout callback boom/,
    );
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
    lifecycle.dispose();
  } finally {
    Object.assign(globalThis, nativeTimers);
  }
}

{
  const lifecycle = createHostLifecycle();
  const frameToken = { kind: "animation-frame", id: 1 };
  const cancelled = [];
  const bindings = createAnimationHostBindings(lifecycle, {
    requestFrame: () => frameToken,
    cancelFrame: (token) => cancelled.push(token),
  });
  const frame = bindings["browser.animation.requestAnimationFrame"](
    () => undefined,
  );
  assert.equal(frame, frameToken);
  assert.deepEqual(lifecycle.debugResourceCounts(), { active: 1 });
  bindings["browser.animation.cancelAnimationFrame"](frame);
  assert.deepEqual(cancelled, [frameToken]);
  assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
  lifecycle.dispose();
}

{
  const previousRequest = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const previousCancel = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  try {
    const lifecycle = createHostLifecycle();
    const bindings = createBrowserAnimationHostBindings(lifecycle);
    assert.throws(
      () =>
        bindings["browser.animation.requestAnimationFrame"](() => undefined),
      /requires globalThis\.requestAnimationFrame/,
    );
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
    let requests = 0;
    globalThis.requestAnimationFrame = () => {
      requests++;
      return 1;
    };
    assert.throws(
      () =>
        bindings["browser.animation.requestAnimationFrame"](() => undefined),
      /requires globalThis\.cancelAnimationFrame/,
    );
    assert.equal(requests, 0);
    assert.deepEqual(lifecycle.debugResourceCounts(), { active: 0 });
    lifecycle.dispose();
  } finally {
    if (previousRequest === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      Object.defineProperty(
        globalThis,
        "requestAnimationFrame",
        previousRequest,
      );
    }
    if (previousCancel === undefined) {
      delete globalThis.cancelAnimationFrame;
    } else {
      Object.defineProperty(globalThis, "cancelAnimationFrame", previousCancel);
    }
  }
}
