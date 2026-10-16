import assert from "node:assert/strict";
import test from "node:test";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./run-command.mjs";

function setup(t) {
  const cwd = mkdtempSync(join(tmpdir(), "vir-resource-command-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, log: join(cwd, "command.log") };
}
const child = (cwd, log, code, options) =>
  runCommand(cwd, log, process.execPath, ["-e", code], options);
const fail = String.raw`require("node:fs").writeSync(2,"EXPECTED-DIAGNOSTIC\n");process.exit(7)`;

test("full stdout/stderr beyond pipe limits and final diagnostics remain intact", t => {
  const { cwd, log } = setup(t);
  const n = 2 * 1024 * 1024;
  const text = child(cwd, log, `const fs=require("node:fs");fs.writeSync(1,"A".repeat(${n})+"STDOUT-END\\n");fs.writeSync(2,"B".repeat(${n})+"STDERR-END\\n");`);
  assert.equal(text, "A".repeat(n) + "STDOUT-END\n" + "B".repeat(n) + "STDERR-END\n");
  assert.equal(readFileSync(log, "utf8"), text);
});
test("unexpected nonzero exit fails and retains stderr", t => {
  const { cwd, log } = setup(t);
  assert.throws(() => child(cwd, log, fail), e => e.code === "ERR_ASSERTION" && e.actual === 7);
  assert.equal(readFileSync(log, "utf8"), "EXPECTED-DIAGNOSTIC\n");
});
test("expected error still requires both nonzero status and matching text", t => {
  const { cwd, log } = setup(t);
  assert.equal(child(cwd, log, fail, { error: /EXPECTED-DIAGNOSTIC/ }), "EXPECTED-DIAGNOSTIC\n");
  assert.throws(() => child(cwd, log, fail, { error: /missing/ }), assert.AssertionError);
  assert.throws(() => child(cwd, log, 'console.log("EXPECTED-DIAGNOSTIC")', { error: /EXPECTED-DIAGNOSTIC/ }), assert.AssertionError);
});
test("spawn failure stays primary and leaves its evidence file", t => {
  const { cwd, log } = setup(t);
  assert.throws(() => runCommand(cwd, log, join(cwd, "absent-command"), [], { error: /anything/ }), e => e.code === "ENOENT");
  assert.ok(existsSync(log));
});
test("timeout stays primary even when an error diagnostic was expected", t => {
  const { cwd, log } = setup(t);
  assert.throws(() => child(cwd, log, 'setInterval(()=>{},1000)', { timeout: 100, error: /anything/ }), e => e.code === "ETIMEDOUT");
  assert.ok(existsSync(log));
});
test("log descriptor closes on success, assertions, spawn failure and timeout", { skip: process.platform !== "linux" }, t => {
  const { cwd, log } = setup(t);
  child(cwd, log, ""); // Warm Node's child-process resources before checking reuse.
  const probe = join(cwd, "descriptor-probe");
  const fd = openSync(probe, "w"); closeSync(fd);
  for (const run of [
    () => child(cwd, log, ""),
    () => child(cwd, log, fail),
    () => child(cwd, log, fail, { error: /missing/ }),
    () => runCommand(cwd, log, join(cwd, "absent-command"), []),
    () => child(cwd, log, 'setInterval(()=>{},1000)', { timeout: 100 }),
  ]) {
    try { run(); } catch { /* Other cases above check the primary errors. */ }
    const after = openSync(probe, "w");
    try { assert.equal(after, fd, "lowest free descriptor must remain reusable"); }
    finally { closeSync(after); }
  }
});
