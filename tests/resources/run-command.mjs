import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";

// Keep large Lean diagnostics intact without spawnSync's pipe-buffer limit.
export function runCommand(cwd, logPath, cmd, args, { error = null, timeout = 240000 } = {}) {
  const logFile = openSync(logPath, "w");
  let result;
  try {
    result = spawnSync(cmd, args, {
      cwd,
      stdio: ["ignore", logFile, logFile],
      timeout,
    });
  } finally {
    closeSync(logFile);
  }
  const log = readFileSync(logPath, "utf8");
  if (result.error) throw result.error;
  if (error) {
    assert.notEqual(result.status, 0, logPath);
    assert.match(log, error, logPath);
  } else assert.equal(result.status, 0, `${logPath}: ${log}`);
  return log;
}
