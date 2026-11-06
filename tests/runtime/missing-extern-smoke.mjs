/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolveVirIrpkgPathSync } from "../../scripts/packages/irpkg-generator.mjs";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { assert, createRuntimeModuleProject, join, readFile, spawnSync } from "./shared.mjs";

// An `@[extern]` without a native implementation in the runtime must be
// rejected before execution: by the export attribute, by package generation,
// and by the loader when a package names a native the runtime does not have.
const dir = await mkdtemp(join(tmpdir(), "vir-missing-extern-"));
const output = result => `${result.stderr}${result.stdout}`;
try {
  await test("an export reaching a local extern without a fallback is rejected", async () => {
    const project = await createRuntimeModuleProject(join(dir, "marked"), {
      MarkedLocalExtern: `module
meta import Vir.Attributes
public section
namespace MarkedLocalExtern
@[extern "vir_missing_extern_marked"] opaque missing : Nat → Nat
@[vir_export] def callMissing (n : Nat) : Nat := missing n
end MarkedLocalExtern`,
    });
    const built = project.build();
    assert.notEqual(built.status, 0, "the export unexpectedly elaborated");
    assert.match(output(built),
      /invalid `@\[vir_export\]` declaration `MarkedLocalExtern\.callMissing`: compiled closure reaches unsupported runtime dependency `MarkedLocalExtern\.missing`: no native extern implementation is registered/);
  });

  await test("package generation rejects a local extern without a fallback", async () => {
    const project = await createRuntimeModuleProject(join(dir, "explicit"), {
      ExplicitLocalExtern: `module
public section
namespace ExplicitLocalExtern
@[extern "vir_missing_extern_explicit"] opaque missing : Nat → Nat
def callMissing (n : Nat) : Nat := missing n
end ExplicitLocalExtern`,
    });
    assert.equal(project.build().status, 0);
    const generated = project.runVirIrpkg([
      join(dir, "explicit.irpkg"), join(dir, "explicit.report.md"),
      "--target-module", "ExplicitLocalExtern", "ExplicitLocalExtern.callMissing",
    ]);
    assert.equal(generated.status, 1, output(generated));
    assert.match(output(generated),
      /missing native extern registrations:\n {2}- ExplicitLocalExtern\.missing \(via ExplicitLocalExtern\.callMissing -> ExplicitLocalExtern\.missing\)/);
  });

  await test("the loader rejects a client-native extern absent from this runtime", async () => {
    const projectDir = join(dir, "client");
    const project = await createRuntimeModuleProject(projectDir, {
      ClientOnly: `module
public import Vir
public section
namespace ClientOnly
@[extern "vir_missing_extern_client_increment"]
def increment (value : UInt32) : UInt32 := value + 1
vir_extern_fallback ClientOnly.increment
@[vir_export] def callIncrement (value : UInt32) : UInt32 := increment value
end ClientOnly`,
    });
    assert.equal(project.build().status, 0);
    const manifestPath = join(projectDir, "lean-vir-native-externs.json");
    await writeFile(join(projectDir, "provider.c"), "");
    await writeFile(manifestPath, JSON.stringify({
      format: "lean-vir-client-native-externs", version: 1, modules: ["ClientOnly"],
      externs: ["ClientOnly.increment"], providerSources: ["provider.c"],
    }));
    const generate = (profile, extraEnv) => {
      const path = join(dir, `client-${profile}.irpkg`);
      const env = { ...project.env() };
      delete env.VIR_NATIVE_EXTERN_MANIFEST;
      delete env.VIR_NATIVE_EXTERN_EXTRAS_FILE;
      Object.assign(env, extraEnv);
      const generated = spawnSync(resolveVirIrpkgPathSync(), [
        path, join(dir, `client-${profile}.report.md`), "--target-marked-module", "ClientOnly",
      ], { cwd: projectDir, env, encoding: "utf8" });
      assert.equal(generated.status, 0, output(generated));
      return readFile(path);
    };
    const nativeBytes = await generate("native", { VIR_NATIVE_EXTERN_MANIFEST: manifestPath });
    const fallbackBytes = await generate("fallback", {});
    const wasmBytes = await readFile(process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url));
    const factory = createVirRuntimeFactory({ wasmBytes });

    await assert.rejects(factory.createRuntime({ irPackageSet: [nativeBytes] }),
      /IR package-set validation failed: IR declaration `ClientOnly\.increment` is an extern with no native implementation in this runtime/);
    const runtime = await factory.createRuntime({ irPackageSet: [fallbackBytes] });
    try {
      assert.equal(runtime.call("ClientOnly.callIncrement", 41), 42);
    } finally { runtime.dispose(); }
  });
} finally {
  await rm(dir, { recursive: true, force: true });
}
