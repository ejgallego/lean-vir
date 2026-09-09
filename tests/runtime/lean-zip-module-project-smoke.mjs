// Real Lake plumbing test, not a substitute for external compression acceptance.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import {
  createLeanZipModuleProject,
  exportsModule,
  oracleTarget,
} from "../../scripts/packages/lean-zip/module-project.mjs";

const workspace = await mkdtemp(join(tmpdir(), "vir-zip-project-smoke-"));
try {
  const client = join(workspace, "client with spaces");
  const producer = join(workspace, "producer with spaces");
  const toolchain = await readFile(
    join(repositoryRoot, "lean-toolchain"),
    "utf8",
  );
  const sources = {
    [join(client, "lean-toolchain")]: toolchain,
    [join(producer, "lean-toolchain")]: toolchain,
    [join(producer, "lakefile.toml")]: 'name = "lean_vir"\n',
    [join(client, "lakefile.lean")]: `import Lake
open System Lake DSL
package «lean-zip»
lean_lib Zip
input_file native.c where
  path := "native.c"
  text := true
target native.o pkg : FilePath := do
  let src ← native.c.fetch
  buildLeanO (pkg.buildDir / "native.o") src #[] #["-fPIC"]
extern_lib libnative pkg := do
  let obj ← native.o.fetch
  buildStaticLib (pkg.staticLibDir / nameToStaticLib "native") #[obj]
`,
    [join(client, "native.c")]: `#include <stdint.h>
uint32_t vir_zip_project_native(uint32_t x) { return x + 2; }
`,
    // The deliberately distinct Lean body proves the oracle uses the native
    // library inherited from the dependency, not an interpreted replacement.
    [join(client, "Zip.lean")]: `module
@[extern "vir_zip_project_native"] public def Zip.answer (x : UInt32) : UInt32 := x + 1
`,
    [join(producer, "fixtures/lean-zip/VirLeanZipAcceptance/Exports.lean")]:
      `module
public import Zip
public def exportedAnswer (x : UInt32) : UInt32 := Zip.answer x
`,
    [join(
      producer,
      "fixtures/lean-zip/VirLeanZipAcceptance/NativeOracle.lean",
    )]: `module
public import VirLeanZipAcceptance.Exports
public def main (args : List String) : IO Unit := do
  IO.println s!"{exportedAnswer 40}:{args}"
`,
  };
  for (const [path, contents] of Object.entries(sources)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  const project = await createLeanZipModuleProject({
    directory: join(workspace, "project with spaces"),
    client,
    producer,
  });
  project.lake(["build", `+${exportsModule}`, oracleTarget]);
  assert.equal(
    project.lake(["exe", oracleTarget, "argument with spaces"], {
      capture: true,
    }),
    "42:[argument with spaces]",
  );
  // lake env must pair the package search path with the project cwd, even if
  // a caller supplies another cwd. This is the generator invocation boundary.
  assert.equal(
    project.lake(
      ["env", process.execPath, "-e", "process.stdout.write(process.cwd())"],
      { capture: true, cwd: client },
    ),
    project.directory,
  );
  for (const [path, contents] of Object.entries(sources)) {
    assert.equal(await readFile(path, "utf8"), contents);
  }
  console.log(
    "lean-zip module project smoke ok: compiled adapter, native dependency linking, arguments, project cwd, untouched input sources",
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
