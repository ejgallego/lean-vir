import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const commands = [
  [process.execPath, ["scripts/check-example-catalog.mjs", "--help"]],
  [process.execPath, ["scripts/run-example.mjs", "--help"]],
  [process.execPath, ["scripts/checkout-artifact-sources.mjs", "--help"]],
  [process.execPath, ["scripts/build-artifacts.mjs", "--help"]],
  [process.execPath, ["scripts/build-artifact-candidate.mjs", "--help"]],
  [process.execPath, ["scripts/pack-artifact-set.mjs", "--help"]],
  [process.execPath, ["scripts/fetch-artifact-set.mjs", "--help"]],
  [process.execPath, ["scripts/stage-artifact-set.mjs", "--help"]],
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

const exampleList = spawnSync(
  process.execPath,
  ["scripts/check-example-catalog.mjs"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(exampleList.status, 0, exampleList.stderr);
assert.match(exampleList.stdout, /^illuminate\trehearsal\tIlluminate player$/m);
assert.match(exampleList.stdout, /^prettyM\tactive\tStd\.Format\.prettyM$/m);

const examplePlan = spawnSync(
  process.execPath,
  ["scripts/run-example.mjs", "prettyM", "default", "--plan"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(examplePlan.status, 0, examplePlan.stderr);
assert.match(examplePlan.stdout, /^build: prettyM$/m);
assert.match(
  examplePlan.stdout,
  /^test: smoke-parity · smoke · js, vir, vir-format, native, llvm · oracle js$/m,
);
assert.match(examplePlan.stdout, /^benchmark: suite \(not measured\)$/m);

const buildList = spawnSync(
  process.execPath,
  ["scripts/build-artifacts.mjs", "--list"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(buildList.status, 0, buildList.stderr);
assert.match(buildList.stdout, /^prettyM\tprettyM-bounded-set-0002$/m);

const sourcePlan = spawnSync(
  process.execPath,
  ["scripts/checkout-artifact-sources.mjs", "prettyM", "--plan"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(sourcePlan.status, 0, sourcePlan.stderr);
assert.match(sourcePlan.stdout, /fir: https:\/\/github\.com\/ejgallego\/lean-fir/);
assert.match(sourcePlan.stdout, /vir: https:\/\/github\.com\/ejgallego\/lean-vir/);
assert.match(sourcePlan.stdout, /workload: https:\/\/github\.com\/leanprover\/verso-slides/);

const candidatePlan = spawnSync(
  process.execPath,
  [
    "scripts/build-artifact-candidate.mjs",
    "prettyM",
    "--plan",
    "--toolchain",
    join(appRoot, "_sources/fir"),
  ],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(candidatePlan.status, 0, candidatePlan.stderr);
assert.match(
  candidatePlan.stdout,
  /candidate output: _artifacts\/candidates\/prettyM\/upload/,
);
assert.match(candidatePlan.stdout, /toolchain fir: .*\/_sources\/fir/);

const candidateMatrix = spawnSync(
  process.execPath,
  ["scripts/example-candidate-matrix.mjs"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(candidateMatrix.status, 0, candidateMatrix.stderr);
assert.deepEqual(JSON.parse(candidateMatrix.stdout), {
  include: [
    { example: "prettyM", variant: "default", build: "prettyM" },
  ],
});

const buildPlan = spawnSync(
  process.execPath,
  ["scripts/build-artifacts.mjs", "prettyM", "--plan"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(buildPlan.status, 0, buildPlan.stderr);
assert.match(buildPlan.stdout, /^artifact set: prettyM-bounded-set-0002$/m);
assert.match(buildPlan.stdout, /^components: vir -> native -> llvm$/m);

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

const attribution = JSON.parse(
  readFileSync(
    join(appRoot, "evidence/vir-pr104-runtime-call-profile.json"),
    "utf8",
  ),
);
assert.equal(attribution.schemaVersion, 1);
assert.equal(attribution.kind, "prettyM-runtime-call-profile-attribution");
assert.equal(attribution.runs.length, 2);
for (const run of attribution.runs) {
  assert.deepEqual(run.workloads.map(({ id }) => id).sort(), [
    "nodes-2047",
    "tag-transitions-64x64",
  ]);
  for (const workload of run.workloads) {
    assert.ok(workload.samples > 0);
    assert.match(workload.outputDigest, /^[0-9a-f]{64}$/);
  }
}

console.log(
  "PASS standalone report, campaign, card, and refresh tool contracts",
);
