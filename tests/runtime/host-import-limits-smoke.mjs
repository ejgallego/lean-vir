/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import {
  IR_PACKAGE_SECTION as SECTION, readIrPackageInfo, replaceIrPackageManifest,
} from "../../scripts/packages/irpkg-format.mjs";
import { assert, createRuntimeModuleProject, join, readFile } from "./shared.mjs";

const forms = [
  ...Array.from({ length: 6 }, (_, index) => ({ args: index + 1, io: false, erased: false })),
  ...Array.from({ length: 6 }, (_, args) => ({ args, io: true, erased: false })),
  { args: 4, io: false, erased: true },
  { args: 3, io: true, erased: true },
];
while (forms.length < 129) forms.push({ args: 5, io: true, erased: false });
const directory = await mkdtemp(join(tmpdir(), "vir-host-limits-"));
try {
  const project = await createRuntimeModuleProject(join(directory, "modules"), {
    Nullary: ["module", "meta import Vir.Attributes", "public import Vir.Js", "public section",
      "namespace Nullary", '@[vir_js "test.nullary"]', "opaque host : Unit := ()",
      "@[vir_export] def run : Unit := host", "end Nullary"].join("\n"),
    HostLimits: moduleSource("HostLimits", forms.slice(0, 128)),
    HostOverflow: moduleSource("HostOverflow", forms),
    ArityOverflow: moduleSource("ArityOverflow", [
      { args: 7, io: false, erased: false },
      { args: 6, io: true, erased: false },
      { args: 4, io: true, erased: true },
    ]),
  });
  const built = project.build();
  assert.equal(built.status, 0, `${built.stderr}\n${built.stdout}`);
  const bytes = await generate("HostLimits");
  const info = readIrPackageInfo(bytes);
  assert.equal(info.manifest.hostImports.length, 128);
  assert.equal(info.manifest.hostImports[127].arity, 6);
  const factory = createVirRuntimeFactory({
    wasmBytes: await readFile(process.argv[2] ?? new URL("../../web/public/vir-upstream.wasm", import.meta.url)),
    hostBindings: Object.fromEntries(forms.slice(0, 128).map((form, id) => [
      `test.limits.${id}`, (...args) => {
        assert.equal(args.length, form.args, `host ${id} must omit erased/world arguments`);
        return `${id}:${args.join("/")}`;
      },
    ])),
  });

  await test("all 128 slots preserve pure/effectful and erased calls", async () => {
    const runtime = await factory.createRuntime({ irPackageSet: [bytes] });
    try {
      for (const [id, form] of forms.slice(0, 128).entries()) {
        const args = Array.from({ length: form.args }, (_, i) => `arg${i}`);
        assert.equal(runtime.call(`HostLimits.call${pad(id)}`, ...args), `${id}:${args.join("/")}`);
      }
    } finally { runtime.dispose(); }
  });

  await test("duplicate host display names do not replace structural identity", async () => {
    const aliases = structuredClone(info.manifest);
    for (const entry of aliases.hostImports) entry.name = "client host alias";
    const runtime = await factory.createRuntime({ irPackageSet: [replaceIrPackageManifest(bytes, aliases)] });
    try {
      assert.equal(runtime.call("HostLimits.call127", "a", "b", "c", "d", "e"), "127:a/b/c/d/e");
    } finally { runtime.dispose(); }
  });

  await test("producer rejects slot 128 and IR arity 7 including erased/world arguments", async () => {
    for (const [module, pattern] of [
      ["Nullary", /nullary JavaScript host imports are unsupported/],
      ["HostOverflow", /too many JavaScript imports; current package format supports at most 128/],
      ["ArityOverflow", /JavaScript import arity 7 exceeds current limit 6/],
    ]) {
      const result = generateResult(module);
      assert.notEqual(result.status, 0);
      const diagnostics = `${result.stderr}\n${result.stdout}`;
      assert.match(diagnostics, pattern);
      if (module === "ArityOverflow") {
        for (const id of [0, 1, 2]) assert.match(diagnostics, new RegExp(`host${pad(id)}`));
      }
    }
  });

  await test("raw loader rejects host and native symbol alias collisions before initialization", async () => {
    const runtime = await factory.createRuntime();
    const e = runtime.exports;
    try {
      for (const [symbols, diagnostic] of [
        [["vir_host_collision", "vir_host_collision___boxed"], /ambiguous JavaScript host import symbol alias/],
        [["vir_host_collision___boxed", "vir_host_collision"], /ambiguous JavaScript host import symbol alias/],
        ...["lean_array_uget_borrowed", "lean_array_uget_borrowed___boxed", "l_ByteArray_empty"]
          .map(symbol => [[symbol, "vir_host_distinct"], /conflicts with the native symbol registry/]),
      ]) {
        const conflicting = structuredClone(info.manifest.hostImports);
        conflicting[0].symbol = symbols[0];
        conflicting[1].symbol = symbols[1];
        const malformed = replaceSection(
          bytes,
          SECTION.HOST_IMPORTS,
          encodeHosts(conflicting),
        );
        const ptr = runtime.allocBytes(malformed);
        try {
          assert.equal(e.vir_begin_ir_package_set(), 1);
          assert.equal(e.vir_append_ir_package(ptr, malformed.length), 0);
          assert.match(runtime.lastPackageError(), diagnostic);
          assert.equal(runtime.packageDeclCount(), 0, "rejected member must not partially append");
        } finally {
          runtime.freeBytes(ptr);
          e.vir_abort_ir_package_set();
        }
      }

      runtime.loadIrPackageSetBytes([bytes]);
      assert.equal(
        runtime.call("HostLimits.call127", "a", "b", "c", "d", "e"),
        "127:a/b/c/d/e",
        "rejected aliases must not poison the next valid package's symbol map",
      );
    } finally {
      runtime.dispose();
    }
  });

  {
    const tooMany = structuredClone(info.manifest);
    tooMany.hostImports.push({ ...tooMany.hostImports[127], slot: 128,
      name: "HostLimits.extra", nameKey: "s486f73744c696d697473/s6578747261/", symbol: "vir_js_import_128_6" });
    const tooWide = structuredClone(info.manifest);
    const entry = tooWide.hostImports.find(entry => entry.arity === 6 && entry.effect === "pure" && entry.erasedPrefixArgs === 0);
    entry.arity = 7;
    entry.args.push({ ...entry.args[0], name: "extra" });
    const nullary = structuredClone(info.manifest);
    nullary.hostImports[0].arity = 0;
    nullary.hostImports[0].effect = "pure";
    nullary.hostImports[0].erasedPrefixArgs = 0;
    nullary.hostImports[0].args = [];
    for (const [label, manifest, pattern] of [
      ["nullary native constant", nullary, /nullary JavaScript host import .* is unsupported/],
      ["slot 128", tooMany, /129 JavaScript host imports; limit is 128/],
      ["arity 7", tooWide, /has IR arity 7; limit is 6/],
    ]) await test(`loader rejects ${label} before finalization and permits retry`, async () => {
      const runtime = await factory.createRuntime();
      let finishes = 0;
      const original = runtime.exports;
      runtime.exports = { ...original, vir_finish_ir_package_set() {
        finishes++;
        return original.vir_finish_ir_package_set();
      } };
      try {
        assert.throws(() => runtime.loadIrPackageSetBytes([withHosts(bytes, manifest)]), pattern);
        assert.equal(finishes, 0);
        assert.equal(runtime.packageDeclCount(), 0);
        assert.equal(runtime.interfaceManifest, null);
        runtime.loadIrPackageSetBytes([bytes]);
        assert.equal(finishes, 1);
        assert.equal(runtime.call("HostLimits.call127", "a", "b", "c", "d", "e"), "127:a/b/c/d/e");
      } finally { runtime.dispose(); }
    });
  }

  for (const [label, mutate] of [
    ["erased prefix", entry => { entry.erasedPrefixArgs = 0xffffffff; }],
    ["missing world", entry => { entry.arity = 0; entry.erasedPrefixArgs = 0; entry.effect = "runtime"; }],
  ]) await test(`raw preparation rejects invalid ${label} counts`, async () => {
    const manifest = structuredClone(info.manifest);
    mutate(manifest.hostImports[0]);
    // Keep the original valid manifest: this probe exercises the raw binary
    // boundary independently of the JS schema/contract checks.
    const malformed = replaceSection(bytes, SECTION.HOST_IMPORTS, encodeHosts(manifest.hostImports));
    const runtime = await factory.createRuntime();
    const e = runtime.exports;
    const ptr = runtime.allocBytes(malformed);
    try {
      assert.equal(e.vir_begin_ir_package_set(), 1);
      assert.equal(e.vir_append_ir_package(ptr, malformed.length), 1);
      assert.equal(e.vir_prepare_ir_package_set(), 0);
      assert.match(runtime.lastPackageError(), /invalid erased-prefix\/world argument counts/);
      assert.equal(e.vir_finish_ir_package_set(), 0);
    } finally { runtime.freeBytes(ptr); runtime.dispose(); }
  });

  function generateResult(module) {
    return project.runVirIrpkg([join(directory, `${module}.irpkg`),
      join(directory, `${module}.report.md`), "--target-marked-module", module]);
  }
  async function generate(module) {
    const result = generateResult(module);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    return readFile(join(directory, `${module}.irpkg`));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

function pad(id) { return String(id).padStart(3, "0"); }
function moduleSource(module, entries) {
  return ["module", "meta import Vir.Attributes", "public import Vir.Js", "public section",
    `namespace ${module}`, "open Lean.Vir", ...entries.flatMap((entry, id) => {
      const args = Array.from({ length: entry.args }, (_, i) => `a${i}`);
      const params = args.length ? `(${args.join(" ")} : Js ${entry.erased ? "α" : "String"})` : "";
      const prefix = entry.erased ? "{α : Type} (_proof : True)" : "";
      const result = `${entry.io ? "RuntimeM " : ""}(Js ${entry.erased ? "α" : "String"})`;
      return [`@[vir_js "test.limits.${id}"]`, `opaque host${pad(id)} ${prefix} ${params} : ${result}${entry.io ? "" : " := a0"}`,
        "@[vir_export]", `def call${pad(id)} ${params.replace("α", "String")} : ${result.replace("α", "String")} :=`,
        `  host${pad(id)} ${entry.erased ? "(α := String) True.intro" : ""} ${args.join(" ")}`];
    }), `end ${module}`, ""].join("\n");
}
function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
function string(value) {
  const bytes = new TextEncoder().encode(value);
  return [...u32(bytes.length), ...bytes];
}
function name(value) {
  let bytes = [0];
  for (const part of value.split(".")) bytes = [1, ...bytes, ...string(part)];
  return bytes;
}
function encodeHosts(entries) {
  return Uint8Array.from([...u32(entries.length), ...entries.flatMap(entry => [
    ...name(entry.name), ...string(entry.target), ...string(entry.symbol),
    ...u32(entry.arity), ...u32(entry.erasedPrefixArgs), entry.effect === "pure" ? 0 : 1,
  ])]);
}
function replaceSection(input, kind, contents) {
  const sections = readIrPackageInfo(input).package.sections;
  const bytes = Uint8Array.from([...input, ...contents]);
  const view = new DataView(bytes.buffer);
  const declarationCountOffset = 4 + view.getUint32(0, true) + 4;
  const entry = declarationCountOffset + 8 + 12 * sections.findIndex(s => s.kind === kind);
  view.setUint32(entry + 4, input.length, true);
  view.setUint32(entry + 8, contents.length, true);
  return bytes;
}
function withHosts(bytes, manifest) {
  return replaceIrPackageManifest(replaceSection(bytes, SECTION.HOST_IMPORTS,
    encodeHosts(manifest.hostImports)), manifest);
}
