/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";
import {
  describeError,
  fixturePosition,
  until,
  withCleanup,
} from "./rpc-test-support.js";
import { finishLeanProcess } from "./rpc-process-test-support.mjs";
import { waitForChildExit } from "../browser/harness.mjs";

test("Lean process cleanup awaits graceful exit and both signal fallbacks", async (t) => {
  await finishLeanProcess(undefined);
  for (const mode of ["graceful", "SIGTERM", "SIGKILL"]) {
    await t.test(mode, async () => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        if (${JSON.stringify(mode)} === "SIGKILL") process.on("SIGTERM", () => {});
        process.stdin.on("data", () => process.exit(0));
        setInterval(() => {}, 1000);
        process.stdout.write("ready");
      `,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      try {
        await once(child.stdout, "data");
        if (mode === "graceful") child.stdin.write("exit");
        await finishLeanProcess(child, 100);
        if (mode === "graceful") assert.equal(child.exitCode, 0);
        else assert.equal(child.signalCode, mode);
        assert.equal(child.listenerCount("exit"), 0);
        await finishLeanProcess(child, 100);
      } finally {
        child.kill("SIGKILL");
        assert.equal(await waitForChildExit(child, 2000), true);
      }
    });
  }
});

test("Lean process cleanup fails if neither signal produces an exit", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null,
    signalCode: null,
  });
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  await assert.rejects(
    finishLeanProcess(child, 1),
    /did not exit after SIGKILL/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("exit"), 0);
});

test("fixture positions require a unique marker and a following tactic", () => {
  const source = "namespace Test\n-- target\nexample : True := by\n  trivial\n";
  assert.deepEqual(fixturePosition(source, "target"), {
    line: 3,
    character: 2,
  });
  assert.throws(() => fixturePosition(source, "missing"), /missing; found 0/);
  assert.throws(
    () => fixturePosition(source + source, "target"),
    /target; found 2/,
  );
  assert.throws(
    () => fixturePosition("-- target\nexample : True := by\n", "target"),
    /Missing tactic/,
  );
});

test("success is published only after successful teardown", async () => {
  const events = [];
  const run = () =>
    withCleanup(
      () => "accepted",
      [
        [
          "close",
          async () => {
            await Promise.resolve();
            events.push("closed");
          },
        ],
      ],
    ).then((value) => events.push(value));
  await run();
  assert.deepEqual(events, ["closed", "accepted"]);
  await assert.rejects(
    withCleanup(
      () => "accepted",
      [
        [
          "close",
          () => {
            throw new Error("teardown failed");
          },
        ],
      ],
    ).then((value) => events.push(value)),
    /Cleanup failed: close/,
  );
  assert.deepEqual(events, ["closed", "accepted"]);
});

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
