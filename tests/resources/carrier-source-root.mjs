import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const support = path.join(repo, "tests/resources/source-root-probe");
const toolchain = fs.readFileSync(path.join(repo, "lean-toolchain"), "utf8").trim();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "vir-carrier-roots-"));
const logs = [];
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
function run(label, cwd, args, expectFailure = false) {
  // Elan selects before Lake handles --dir: deliberately pin the compiler when
  // the caller is outside the project's toolchain directory.
  const invocation = ["run", toolchain, "lake", ...args];
  const result = spawnSync("elan", invocation, {
    cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  write(path.join(fixture, `${label}.log`), text);
  logs.push({ label, cwd, command: "elan", args: invocation, status: result.status });
  if (result.error) throw result.error;
  assert.equal(result.status === 0, !expectFailure, text);
  return text;
}
const oracle = `
script roots do
  let ws ← getWorkspace
  for pkg in ws.packages do
    for lib in pkg.leanLibs do
      if pkg.baseName != \`sourceRootProbe then
        for mod in ← lib.getModuleArray do
          IO.println <| "LAKE_ROOT_ORACLE " ++ (Lean.Json.mkObj [
            ("module", Lean.toJson mod.name.toString),
            ("key", Lean.toJson lib.name.toString),
            ("source", Lean.toJson (← IO.FS.realPath mod.leanFile).toString),
            ("root", Lean.toJson (← IO.FS.realPath lib.srcDir).toString),
            ("stage", Lean.toJson ((← IO.FS.realPath lib.srcDir) / ".vir-generated" / s!"{lib.name}.virres").toString)
          ]).compress
  return 0
`;

const cases = [
  { pkg: "slidesCase", packageDir: "slides case", source: ".", build: "build space", lib: "VersoSlidesVirPrettyMResources", libSource: "resources", module: "VersoSlides.VirPrettyMResources", file: "VersoSlides/VirPrettyMResources.lean" },
  { pkg: "deepCase", packageDir: "deep case", source: "base source", build: "other build", lib: "DeepResources", libSource: "nested resources", module: "Deep.Nested.Carrier", file: "Deep/Nested/Carrier.lean" },
  { pkg: "dottedCase", packageDir: "dotted", source: ".", build: ".lake/build", lib: "Carrier.Library", libSource: "source space", module: "Quoted.«component.with.dots».Leaf", file: "Quoted/component.with.dots/Leaf.lean" },
  { pkg: "quotedCase", packageDir: "quoted", source: "source", build: "compiled", lib: "«Carrier library»", libSource: "resources", module: "Quoted.«component space».Leaf", file: "Quoted/component space/Leaf.lean" },
  { pkg: "dependencyA", packageDir: "dependency a", source: ".", build: "compiled", lib: "ClientResources", libSource: "resources", module: "DepA.Resources", file: "DepA/Resources.lean" },
  { pkg: "dependencyB", packageDir: "dependency b", source: "source", build: "compiled", lib: "ClientResources", libSource: "assets", module: "DepB.Resources", file: "DepB/Resources.lean" },
  { pkg: "defaultCase", packageDir: "default source", source: ".", build: ".lake/build", lib: "BasicResources", libSource: ".", module: "BasicCarrier", file: "BasicCarrier.lean" },
];

try {
  for (const c of cases) {
    const dir = path.join(fixture, c.packageDir);
    c.dir = dir;
    write(path.join(dir, "lean-toolchain"), fs.readFileSync(path.join(repo, "lean-toolchain")));
    write(path.join(dir, "lakefile.lean"), `import Lake\nopen Lake DSL\npackage ${c.pkg} where\n  srcDir := ${JSON.stringify(c.source)}\n  buildDir := ${JSON.stringify(c.build)}\nrequire sourceRootProbe from ${JSON.stringify(support)}\n@[default_target]\nlean_lib ${c.lib} where\n  roots := #[]\n  srcDir := ${JSON.stringify(c.libSource)}\n  globs := #[.one \`${c.module}]\n${oracle}`);
    const source = path.join(dir, c.source, c.libSource, c.file);
    write(source, `module\nmeta import SourceRootProbe\npublic def proof : Bool := source_root_probe ${c.lib}\n`);
    run(`${c.pkg}-update`, dir, ["update"]);
    const built = run(`${c.pkg}-build`, fixture, ["--dir", dir, "build"]);
    const observed = built.split("\n").filter(l => l.includes("CARRIER_ROOT_PROBE "))
      .map(l => JSON.parse(l.slice(l.indexOf("CARRIER_ROOT_PROBE ") + 19)));
    const queried = run(`${c.pkg}-oracle`, fixture, ["--dir", dir, "run", "roots"]);
    const expected = queried.split("\n").filter(l => l.includes("LAKE_ROOT_ORACLE "))
      .map(l => JSON.parse(l.slice(l.indexOf("LAKE_ROOT_ORACLE ") + 17)));
    assert.equal(observed.length, 1, built);
    assert.equal(expected.length, 1, queried);
    assert.deepEqual(observed, expected);
    c.observed = observed[0];
  }
  const app = path.join(fixture, "application elsewhere");
  write(path.join(app, "lean-toolchain"), fs.readFileSync(path.join(repo, "lean-toolchain")));
  write(path.join(app, "lakefile.lean"), `import Lake\nopen Lake DSL\npackage application\nrequire dependencyA from ${JSON.stringify(cases[4].dir)}\nrequire dependencyB from ${JSON.stringify(cases[5].dir)}\n${oracle}`);
  run("application-update", app, ["update"]);
  const queried = run("application-oracle", fixture, ["--dir", app, "run", "roots"]);
  const dependencyRoots = queried.split("\n").filter(l => l.includes("LAKE_ROOT_ORACLE "))
    .map(l => JSON.parse(l.slice(l.indexOf("LAKE_ROOT_ORACLE ") + 17)));
  assert.deepEqual(dependencyRoots.sort((a,b) => a.module.localeCompare(b.module)),
    cases.filter(c => c.pkg === "dependencyA" || c.pkg === "dependencyB")
      .map(c => c.observed).sort((a,b) => a.module.localeCompare(b.module)));
  const first = cases[0];
  const setup = path.join(fixture, "wrong-module.setup.json");
  const moduleFile = path.parse(first.file);
  const setupSource = path.join(first.dir, first.build, "ir", moduleFile.dir, `${moduleFile.name}.setup.json`);
  const compiledSetup = JSON.parse(fs.readFileSync(setupSource, "utf8"));
  assert.equal(compiledSetup.name, first.module);
  // Preserve Lake's actual imports/options; vary only the admitted module name.
  write(setup, JSON.stringify({ ...compiledSetup, name: "Wrong.VirPrettyMResources" }));
  const negative = run("same-basename-wrong-suffix", first.dir,
    ["env", "lean", "--setup", setup, path.join(first.dir, "resources", first.file)], true);
  assert.match(negative, /CARRIER_SUFFIX_MISMATCH/);
  write(path.join(fixture, "results.json"), JSON.stringify({ cases, logs, negative: "full suffix mismatch rejected", productionLocator: false }, null, 2));
  console.log(`Carrier mapping: seven contexts, two same-key dependencies and full-suffix negative PASS; retained ${fixture}`);
} catch (error) {
  console.error(`Carrier mapping failed; retained ${fixture}`);
  throw error;
}
