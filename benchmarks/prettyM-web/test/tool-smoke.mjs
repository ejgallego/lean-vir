import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  artifactSetConfig,
  componentOrder,
  readBuildDatabase,
} from "../scripts/artifact-build-lib.mjs";

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

const packManifestLoad = spawnSync(
  process.execPath,
  [
    "scripts/pack-artifact-set.mjs",
    "--build",
    "prettyM",
    "--receipt",
    `test-results/missing-receipt-${process.pid}.json`,
  ],
  { cwd: appRoot, encoding: "utf8" },
);
assert.notEqual(packManifestLoad.status, 0);
assert.match(packManifestLoad.stderr, /ENOENT/);
assert.doesNotMatch(packManifestLoad.stderr, /readJson is not defined/);

const exampleList = spawnSync(
  process.execPath,
  ["scripts/check-example-catalog.mjs"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(exampleList.status, 0, exampleList.stderr);
assert.match(exampleList.stdout, /^illuminate\trehearsal\tIlluminate player$/m);
assert.match(exampleList.stdout, /^prettyM\tactive\tStd\.Format\.prettyM$/m);
assert.match(
  exampleList.stdout,
  /^verso-search-json\tcandidate\tVerso search JSON lanes$/m,
);

const examplePlan = spawnSync(
  process.execPath,
  [
    "scripts/run-example.mjs",
    "prettyM",
    "default",
    "--plan",
    "--materialize",
  ],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(examplePlan.status, 0, examplePlan.stderr);
assert.match(examplePlan.stdout, /^build: prettyM$/m);
assert.match(
  examplePlan.stdout,
  /^test: smoke-parity · smoke · js, vir, vir-format, native, llvm · oracle js$/m,
);
assert.match(examplePlan.stdout, /^benchmark: suite \(not measured\)$/m);
assert.match(examplePlan.stdout, /^sources: materialize catalogued revisions$/m);

for (const [variant, build, backend] of [
  ["default", "verso-search-json-owned", "owned"],
  ["borrowed", "verso-search-json-borrowed", "borrowed"],
]) {
  const plan = spawnSync(
    process.execPath,
    [
      "scripts/run-example.mjs",
      "verso-search-json",
      variant,
      "--plan",
    ],
    { cwd: appRoot, encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, new RegExp(`^build: ${build}$`, "m"));
  assert.match(
    plan.stdout,
    new RegExp(
      `^test: real-xref-parity · smoke · js, ${backend} · oracle js$`,
      "m",
    ),
  );
  assert.match(plan.stdout, /^benchmark: benchmark \(not measured\)$/m);
}

const contradictoryExample = spawnSync(
  process.execPath,
  [
    "scripts/run-example.mjs",
    "prettyM",
    "default",
    "--test-only",
    "--materialize",
  ],
  { cwd: appRoot, encoding: "utf8" },
);
assert.notEqual(contradictoryExample.status, 0);
assert.match(
  contradictoryExample.stderr,
  /--test-only cannot be combined with --materialize/,
);

const buildList = spawnSync(
  process.execPath,
  ["scripts/build-artifacts.mjs", "--list"],
  { cwd: appRoot, encoding: "utf8" },
);
assert.equal(buildList.status, 0, buildList.stderr);
assert.match(buildList.stdout, /^prettyM\tprettyM-bounded-set-0002$/m);
assert.match(
  buildList.stdout,
  /^verso-search-json-owned\tverso-search-json-owned-set-0001$/m,
);
assert.match(
  buildList.stdout,
  /^verso-search-json-borrowed\tverso-search-json-borrowed-set-0001$/m,
);

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
    {
      example: "verso-search-json",
      variant: "default",
      build: "verso-search-json-owned",
    },
    {
      example: "verso-search-json",
      variant: "borrowed",
      build: "verso-search-json-borrowed",
    },
  ],
});

const buildDatabase = await readBuildDatabase(join(appRoot, "artifact-builds.json"));
assert.equal(
  artifactSetConfig(buildDatabase, "prettyM").setId,
  "prettyM-bounded-set-0002",
);
assert.deepEqual(
  componentOrder(buildDatabase.builds.prettyM),
  ["vir", "native", "llvm"],
);

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

console.log("PASS standalone report and campaign tool contracts");
