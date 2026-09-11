/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/

import assert from "node:assert/strict";
import test from "node:test";
import { widgetErrorMessage } from "../../web/src/vir-widget-errors.js";

test("plain RPC failures retain their message and code", () => {
  assert.equal(widgetErrorMessage({ code: -32602, message: "VIR IR package failed" }, " Setup "),
    "VIR IR package failed (-32602)\n\nSetup");
});

test("native, cross-realm-shaped and primitive errors remain readable", () => {
  assert.equal(widgetErrorMessage(new Error("native")), "native");
  assert.equal(widgetErrorMessage({ message: "foreign" }), "foreign");
  assert.equal(widgetErrorMessage("text"), "text");
  assert.equal(widgetErrorMessage(null), "null");
  assert.equal(widgetErrorMessage(undefined), "undefined");
  assert.equal(widgetErrorMessage({ reason: "missing" }), '{"reason":"missing"}');
});

test("cleanup aggregation preserves underlying RPC failures", () => {
  assert.equal(widgetErrorMessage(new AggregateError([
    { code: -32900, message: "Reconnect required" }, new Error("cleanup")
  ], "load failed")), "load failed\nReconnect required (-32900)\ncleanup");
});

test("cycles and unprintable values cannot break the error UI", () => {
  const cycle = new AggregateError([], "cycle");
  cycle.errors.push(cycle);
  assert.equal(widgetErrorMessage(cycle), "cycle\n[Repeated error]");
  const record = {}; record.self = record;
  assert.equal(widgetErrorMessage(record), "Unprintable widget error");
  assert.equal(widgetErrorMessage({ get message() { throw new Error("getter"); } }),
    "Unprintable widget error");
});
