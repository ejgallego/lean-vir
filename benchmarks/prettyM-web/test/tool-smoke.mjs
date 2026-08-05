import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const commands = [
  [process.execPath, ["scripts/collect-report.mjs", "--help"]],
  ["python3", ["scripts/run-campaign.py", "--help"]],
  ["python3", ["scripts/generate-observation-cards.py", "--help"]],
  ["python3", ["scripts/refresh-benchmark.py", "--help"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: join(appRoot, "test-results", "pycache"),
    },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stderr}`,
  );
  assert.match(result.stdout, /usage:/i);
}

const escapedOutput = spawnSync(
  process.execPath,
  ["scripts/collect-report.mjs", "--output", "/tmp/escaped-report.json"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.notEqual(escapedOutput.status, 0);
assert.match(escapedOutput.stderr, /refusing to write outside/);

const collector = readFileSync(
  join(appRoot, "scripts/collect-report.mjs"),
  "utf8",
);
assert.doesNotMatch(collector, /runJsonRoundTripStudy/);

console.log("PASS standalone report, campaign, card, and refresh tool contracts");
