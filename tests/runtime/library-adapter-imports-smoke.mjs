/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestModuleProject } from "../support/module-project.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-adapter-imports-"));
try {
  const register = helper => `module
public import AdapterImportDomain
meta import Vir.Compiler.Interface.LibraryAdapters
run_meta do
  let .forallE _ wire outcome _ := (← Lean.getConstInfo \`\`AdapterImportDomain.decode${helper}).type
    | Lean.throwError "invalid test helper"
  let #[_, source] := outcome.getAppArgs | Lean.throwError "invalid test outcome"
  (Vir.Interface.registerClosedLibraryAdapter source wire
    \`\`AdapterImportDomain.decode${helper} \`\`AdapterImportDomain.encode${helper}).run'
`;
  const check = (imports, conflict) => `module
${imports.map(name => `public import ${name}`).join("\n")}
meta import Vir.Compiler.Interface.Classify.Core
run_meta do
  let result ← Vir.Interface.interfaceType (Lean.mkConst \`\`AdapterImportDomain.Box)
  match result with
  | .error error =>
    unless ${conflict} && ((← error.toMessageData.toString).splitOn "conflicting library adapters").length > 1 do
      Lean.throwError "unexpected classifier diagnostic: {error.toMessageData}"
  | .ok (.libraryAdapter _ _ descriptor) =>
    if ${conflict} then Lean.throwError "conflicting imports selected a codec"
    unless descriptor.decode == \`\`AdapterImportDomain.decodeA do
      Lean.throwError "identical rules changed their helper"
  | _ => Lean.throwError "expected a library adapter"
`;
  const guide = await readFile(new URL("../../docs/design/JSON_SAFE_VALUE_CODEC.md", import.meta.url), "utf8");
  const blocks = [...guide.matchAll(/```lean\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const project = await createTestModuleProject({ directory, modules: {
    AdapterImportDomain: `module
public import Lean
public section
namespace AdapterImportDomain
-- Expose helper bodies so independent modules can validate their safety.
structure Box where
  n : Nat
@[expose] def decodeA (wire : Array Nat) : Except String Box := .ok ⟨wire.size⟩
@[expose] def encodeA (value : Box) : Array Nat := #[value.n]
@[expose] def decodeB (wire : Array Nat) : Except String Box := .ok ⟨wire.size + 1⟩
@[expose] def encodeB (value : Box) : Array Nat := #[value.n + 1]
end AdapterImportDomain
`,
    AdapterRuleA: register("A"), AdapterRuleB: register("B"),
    AdapterRepeatA: register("A"),
    AdapterConflictAB: check(["AdapterRuleA", "AdapterRuleB"], true),
    AdapterConflictBA: check(["AdapterRuleB", "AdapterRuleA"], true),
    AdapterIdenticalAB: check(["AdapterRuleA", "AdapterRepeatA"], false),
    AdapterIdenticalBA: check(["AdapterRepeatA", "AdapterRuleA"], false),
    JsonSafeWriterGuide: blocks[0],
    AdapterTraversal: `module
public import Vir.Package.JsonSafeWriter
meta import Vir.Compiler.Interface.JsonSafeWriter
meta import Vir.Compiler.Interface.LibraryAdapters
public section
namespace AdapterTraversal
structure A where
  n : Nat
structure B where
  n : Nat
structure C where
  n : Nat
def decodeA (values : Array B) : Except String A :=
  .ok ⟨(values[0]?.map (·.n)).getD 0⟩
def encodeA (value : A) : Array B := #[⟨value.n⟩]
def decodeB (value : C) : Except String B := .ok ⟨value.n⟩
def encodeB (value : B) : C := ⟨value.n⟩
def decodeC (value : B) : Except String C := .ok ⟨value.n⟩
def encodeC (value : C) : B := ⟨value.n⟩
run_meta do
  Vir.Interface.registerClosedLibraryAdapter (Lean.mkConst \`\`A)
    (Lean.mkApp (Lean.mkConst \`\`Array [.zero]) (Lean.mkConst \`\`B)) \`\`decodeA \`\`encodeA
  Vir.Interface.registerClosedLibraryAdapter (Lean.mkConst \`\`B)
    (Lean.mkConst \`\`C) \`\`decodeB \`\`encodeB
run_elab Vir.Interface.JsonSafeWriter.generate \`AdapterTraversal.writeA (Lean.mkConst \`\`A)
#guard writeA ⟨7⟩ == "[{\\\"n\\\":\\\"7\\\"}]"
run_meta do
  Vir.Interface.registerClosedLibraryAdapter (Lean.mkConst \`\`C)
    (Lean.mkConst \`\`B) \`\`decodeC \`\`encodeC
  for type in #[\`\`A, \`\`B] do
    match ← Vir.Interface.interfaceType (Lean.mkConst type) with
    | .error error =>
      unless ((← error.toMessageData.toString).splitOn "recursive adapter wire domains").length > 1 do
        Lean.throwError "unexpected cycle diagnostic: {error.toMessageData}"
    | .ok _ => Lean.throwError "adapter cycle was accepted"
end AdapterTraversal
`,
    JsonSafeRegistrationGuide: `module
public import Lean
meta import Vir.Compiler.Interface.LibraryAdapters
public section
structure Source where
  n : Nat
abbrev Wire := Array Nat
def decode (wire : Wire) : Except String Source := .ok ⟨wire.size⟩
def encode (source : Source) : Wire := #[source.n]
${blocks[1]}
`,
  } });
  const result = project.build();
  assert.equal(result.status, 0, result.stderr + result.stdout);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("imported adapter conflicts, acyclic chains, cycle rejection and executable JSON-safe guide: PASS");
