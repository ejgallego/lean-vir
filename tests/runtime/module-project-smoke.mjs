/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createTestModuleProject } from "../support/module-project.mjs";
import { fixtureHostModule } from "../support/fixture-modules.mjs";
import {
  assert,
  ensureVirIrpkgBuilt,
  join,
  readFile,
  spawnSync,
} from "./shared.mjs";
import { virIrpkgPath } from "../../scripts/packages/irpkg-generator.mjs";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";

const scratch = await mkdtemp(join(tmpdir(), "vir-module-project-"));
function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
try {
  ensureVirIrpkgBuilt();
  const project = await createTestModuleProject({
    directory: join(scratch, "project with spaces"),
    modules: {
      "Input.Sample": [
        "module",
        "public import Init",
        "",
        '#eval IO.println "VIR_TEST_MODULE_COMPILED"',
        "private def hidden : Nat := 40",
        "public unsafe def answer : Nat := hidden + 2",
        "",
      ].join("\n"),
      "Oracle.Main": fixtureHostModule(
        {
          id: "sample",
          entry: "answer",
          result: { type: "Nat" },
          unsafe: true,
        },
        "Input.Sample",
      ),
      "Input.Invalid": "module\npublic def invalid : Nat := true\n",
    },
  });
  // Build only requested roots: the invalid module must not poison this build.
  const built = project.build(["Oracle.Main", "Oracle.Main"]);
  success(built);
  assert.match(built.stdout + built.stderr, /VIR_TEST_MODULE_COMPILED/);
  const options = {
    cwd: project.directory,
    env: project.env(),
    encoding: "utf8",
  };
  const host = spawnSync(
    "lean",
    ["--run", project.sourcePath("Oracle.Main")],
    options,
  );
  success(host);
  assert.equal(host.stdout.trim(), "42");
  const args = [
    join(scratch, "out.irpkg"),
    join(scratch, "out.report.md"),
    "--target-module",
    "Input.Sample",
    "answer",
  ];
  const generated = spawnSync(virIrpkgPath, args, options);
  success(generated);
  assert.doesNotMatch(
    generated.stdout + generated.stderr,
    /VIR_TEST_MODULE_COMPILED/,
  );
  const bytes = await readFile(args[0]);
  const target = readIrPackageInfo(bytes).manifest.metadata.targets[0];
  assert.equal(target.module, "Input.Sample");
  assert.equal(target.source, undefined);
  success(spawnSync(virIrpkgPath, args, options));
  assert.deepEqual(await readFile(args[0]), bytes);
  // A compile-time negative result remains distinct from package validation.
  const invalid = project.build(["Input.Invalid"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /type mismatch/i);
  assert.throws(() => project.build([]), /requires modules/);
  assert.throws(() => project.build(["Missing"]), /unknown test module/);
  console.log(
    "module project smoke ok: isolated paths, selected builds, imported private IR, unsafe oracle, compile/package phases",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
