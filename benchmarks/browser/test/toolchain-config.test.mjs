import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkoutReceipt,
  parsePathAssignment,
  readToolchainConfig,
  resolveBuildCheckoutPaths,
} from "../scripts/toolchain-config-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(appRoot, "test-results/toolchain-config");

const build = {
  components: {
    vir: {
      producer: {
        adapter: "vir",
        checkouts: { producer: "vir", workload: "workload" },
      },
    },
    native: {
      producer: {
        adapter: "fir-native",
        checkouts: { producer: "fir" },
      },
    },
    llvm: {
      producer: {
        adapter: "fir-llvm",
        checkouts: { producer: "fir" },
      },
    },
  },
};
const sources = { vir: {}, fir: {}, workload: {} };

test("parses default and named toolchain paths", () => {
  assert.deepEqual(
    parsePathAssignment("/controlled/fir", {
      defaultName: "fir",
      label: "--toolchain",
    }),
    { name: "fir", path: resolve("/controlled/fir") },
  );
  assert.deepEqual(
    parsePathAssignment("vir=/controlled/vir", {
      defaultName: "fir",
      label: "--toolchain",
    }),
    { name: "vir", path: resolve("/controlled/vir") },
  );
});

test("build receipts omit machine-local checkout paths", () => {
  assert.deepEqual(
    checkoutReceipt({
      path: "/home/runner/private-checkout",
      sourceId: "fir-prettyM",
      repository: "https://github.com/ejgallego/lean-fir",
      revision: "298682a766d80e90053d3e76ee2f3e4af78a52aa",
    }),
    {
      sourceId: "fir-prettyM",
      repository: "https://github.com/ejgallego/lean-fir",
      revision: "298682a766d80e90053d3e76ee2f3e4af78a52aa",
    },
  );
});

test("loads a compact config with paths relative to the config", async () => {
  await mkdir(fixtureRoot, { recursive: true });
  const configPath = join(fixtureRoot, "toolchains.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: "browser-benchmarks/toolchains",
      toolchains: { fir: "checkouts/fir", vir: "checkouts/vir" },
      checkouts: { workload: "clients/workload" },
    }),
  );
  const config = await readToolchainConfig(appRoot, configPath);
  assert.equal(config.path, configPath);
  assert.equal(config.toolchains.get("fir"), join(fixtureRoot, "checkouts/fir"));
  assert.equal(config.toolchains.get("vir"), join(fixtureRoot, "checkouts/vir"));
  assert.equal(
    config.checkouts.get("workload"),
    join(fixtureRoot, "clients/workload"),
  );
});

test("resolves command-line, config, and source-directory precedence", () => {
  const selection = resolveBuildCheckoutPaths(build, sources, {
    sourcesDir: "/controlled/sources",
    checkouts: new Map([["workload", "/explicit/workload"]]),
    toolchains: new Map([["fir", "/explicit/fir"]]),
    config: {
      checkouts: new Map([
        ["fir", "/configured/fir-checkout"],
        ["vir", "/configured/vir-checkout"],
        ["workload", "/configured/workload"],
      ]),
      toolchains: new Map([
        ["fir", "/configured/fir-toolchain"],
        ["vir", "/configured/vir-toolchain"],
      ]),
    },
  });
  assert.equal(selection.paths.get("fir"), "/explicit/fir");
  assert.equal(selection.paths.get("vir"), "/configured/vir-checkout");
  assert.equal(selection.paths.get("workload"), "/explicit/workload");
  assert.deepEqual([...selection.toolchainRoles], [
    ["vir", "vir"],
    ["fir", "fir"],
  ]);
});

test("rejects unsupported config and command-line toolchain names", async () => {
  await mkdir(fixtureRoot, { recursive: true });
  const configPath = join(fixtureRoot, "invalid.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: "browser-benchmarks/toolchains",
      toolchains: { unknown: "checkouts/unknown" },
    }),
  );
  await assert.rejects(
    () => readToolchainConfig(appRoot, configPath),
    /unsupported toolchain name: unknown/,
  );
  assert.throws(
    () =>
      resolveBuildCheckoutPaths(build, sources, {
        sourcesDir: "/controlled/sources",
        toolchains: new Map([["unknown", "/controlled/unknown"]]),
      }),
    /build has no unknown toolchain/,
  );
});
