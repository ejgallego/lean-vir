/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { parseProducerArguments } from "../../scripts/packages/vir-client-package-lib.mjs";
import {
  repositoryPath,
  repositoryRoot,
} from "../../scripts/repository-paths.mjs";

const specification = {
  checkoutRoles: ["producer", "runtime", "client"],
  packageRoles: ["workload"],
  defaultProducer: "/producer",
  usage: "usage",
};

test("source-package arguments normalize explicit inputs", () => {
  const options = parseProducerArguments(
    [
      "--output",
      "/output",
      "--checkout",
      "runtime=/runtime",
      "--checkout",
      "client=/client",
      "--package",
      "workload=/workload",
    ],
    specification,
  );
  assert.equal(options.output, "/output");
  assert.deepEqual(Object.fromEntries(options.checkouts), {
    runtime: "/runtime",
    client: "/client",
    producer: "/producer",
  });
  assert.deepEqual(Object.fromEntries(options.packages), {
    workload: "/workload",
  });
});

test("source-package arguments fail closed", () => {
  assert.throws(
    () =>
      parseProducerArguments(
        ["--output", "/output", "--checkout", "unknown=/checkout"],
        specification,
      ),
    /unknown checkout role/,
  );
  assert.throws(
    () =>
      parseProducerArguments(
        [
          "--output",
          "/output",
          "--checkout",
          "runtime=/runtime",
          "--checkout",
          "client=/client",
        ],
        specification,
      ),
    /missing dependency package: workload/,
  );
});

for (const client of [
  {
    id: "lean-zip",
    label: "Lean-zip",
    usage: /Build a client-native VIR runtime and lean-zip package/,
  },
  {
    id: "illuminate",
    label: "Illuminate",
    usage:
      /Consume a validated Illuminate workload and build its matching VIR browser\s+package/,
  },
]) {
  test(`${client.label} browser package tools load`, () => {
    const packagePath = (file) =>
      repositoryPath("scripts", "packages", client.id, file);
    const exporter = spawnSync(
      process.execPath,
      [packagePath("export-browser-package.mjs"), "--help"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );
    assert.equal(exporter.status, 0, exporter.stderr);
    assert.match(exporter.stdout, client.usage);

    const smoke = spawnSync(
      process.execPath,
      ["--check", packagePath("browser-package-smoke.mjs")],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );
    assert.equal(smoke.status, 0, smoke.stderr);
  });
}
