/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeError, until, withCleanup } from "./rpc-test-support.js";

test("cleanup attempts every step and preserves original and teardown failures", async () => {
  const original = new Error("acceptance failed");
  const close = new Error("close failed");
  const disposed = new Error("dispose failed");
  const visited = [];
  await assert.rejects(
    withCleanup(async () => {
      throw original;
    }, [
      [
        "Chromium",
        () => {
          visited.push("chrome");
          throw close;
        },
      ],
      [
        "runtime",
        async () => {
          visited.push("runtime");
          throw disposed;
        },
      ],
      [
        "server",
        async () => {
          await Promise.resolve();
          visited.push("server");
        },
      ],
      ["sessions", () => visited.push("sessions")],
      ["temporary files", () => visited.push("temp")],
    ]),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, original);
      assert.equal(error.errors[0], original);
      assert.equal(error.errors[1].cause, close);
      assert.equal(error.errors[2].cause, disposed);
      assert.match(
        JSON.stringify(describeError(error)),
        /acceptance failed.*close failed.*dispose failed/,
      );
      return true;
    },
  );
  assert.deepEqual(visited, [
    "chrome",
    "runtime",
    "server",
    "sessions",
    "temp",
  ]);
});

test("cleanup preserves success and single failures, including thrown undefined", async () => {
  const value = {};
  assert.equal(await withCleanup(() => value, []), value);
  const original = new Error("original");
  await assert.rejects(
    withCleanup(() => {
      throw original;
    }, []),
    (error) => error === original,
  );
  await assert.rejects(
    withCleanup(
      () => value,
      [
        [
          "dispose",
          () => {
            throw original;
          },
        ],
      ],
    ),
    (error) => error.cause === original,
  );
  let rejected = false;
  await withCleanup(() => {
    throw undefined;
  }, []).catch((error) => {
    rejected = true;
    assert.equal(error, undefined);
  });
  assert.equal(rejected, true);
});

test("diagnostics preserve native Error details and RPC codes", () => {
  const error = Object.assign(new Error("RPC failed"), { code: -32800 });
  assert.deepEqual(JSON.parse(JSON.stringify(describeError(error))), {
    message: error.message,
    stack: error.stack,
    code: -32800,
  });
  assert.equal(
    describeError({ message: "cancelled", code: -32800 }).code,
    -32800,
  );
  assert.equal(describeError(undefined).message, "undefined");
  assert.equal(describeError("failed").message, "failed");
});

test("polling reports the awaited condition and propagates predicate failures", async () => {
  await until("ready", async () => true);
  await assert.rejects(
    until("response gated: first", () => false, { attempts: 1, delay: 0 }),
    /response gated: first/,
  );
  const error = new Error("transport failed");
  await assert.rejects(
    until("ready", () => {
      throw error;
    }),
    (actual) => actual === error,
  );
});
