import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveVirInputsSync, virInputsQueryArgs } from "../../scripts/packages/irpkg-generator.mjs";

test("inputs query keeps module acquisition separate from selection", () => {
  assert.deepEqual(virInputsQueryArgs(["App.Root", "App.Other", "App.Root"]),
    ["query", "--json", "+App.Root:virInputs", "+App.Other:virInputs"]);
  for (const modules of [[], null, [""], ["+App"], ["App:vir"], ["App.lean"], ["../App"]]) {
    assert.throws(() => virInputsQueryArgs(modules));
  }
});

test("inputs query consumes returned paths from an explicit workspace", () => {
  const root = mkdtempSync(path.join(tmpdir(), "vir-input-query-"));
  const previousPath = process.env.PATH;
  try {
    const cwd = path.join(root, "consumer with spaces");
    const bin = path.join(root, "bin");
    mkdirSync(cwd);
    mkdirSync(bin);
    process.env.PATH = bin;
    // Process-protocol controls only; actual Lake generation is checked by the
    // cache campaign. Assert argument boundaries and cwd without guessing layout.
    const lake = (body) => writeFileSync(path.join(bin, "lake"),
      `#!${process.execPath}\n${body}`, { mode: 0o755 });
    lake(`const assert = require("node:assert/strict");
assert.equal(process.cwd(), ${JSON.stringify(cwd)});
assert.deepEqual(process.argv.slice(2), ["query","--json","+App.Root:virInputs"]);
console.log(JSON.stringify("custom build/a setup.json"));`);
    assert.deepEqual(resolveVirInputsSync({ modules: ["App.Root"], cwd }), {
      ok: true, inputArgs: ["--setup", path.join(cwd, "custom build/a setup.json")],
    });
    lake("console.log(JSON.stringify({not: 'a path'}));");
    assert.throws(() => resolveVirInputsSync({ modules: ["App.Root"], cwd }), /artifact paths/);
    lake("console.log(JSON.stringify('one')); console.log(JSON.stringify('extra'));");
    assert.throws(() => resolveVirInputsSync({ modules: ["App.Root"], cwd }), /artifact paths/);
    lake("process.exit(7);");
    assert.deepEqual(resolveVirInputsSync({ modules: ["App.Root"], cwd }), {
      ok: false, phase: "vir-inputs", status: 7,
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
