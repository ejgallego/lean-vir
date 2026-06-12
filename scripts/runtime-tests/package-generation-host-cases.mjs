/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntimeFactory,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import {
  assert,
  generateIrPackage,
  join,
  readFile,
  writeFile,
} from "./shared.mjs";

export async function runHostPackageSmoke({ freshDir, wasmBytes }) {
  const hostSource = join(freshDir, "FreshHost.lean");
  const hostPackage = join(freshDir, "host.irpkg");
  await writeFile(hostSource, [
    "import Lean.Vir.Browser",
    "",
    "def freshEchoBang (s : String) : String :=",
    "  Lean.Vir.Common.echoString (s ++ \"!\")",
    "",
    "def freshTitleRoundtrip (s : String) : IO String := do",
    "  Lean.Vir.Browser.Document.setTitle s",
    "  Lean.Vir.Browser.Document.getTitle",
    "",
    "def freshElementRoundtrip (s : String) : IO (String × Option String) := do",
    "  match ← Lean.Vir.Browser.Document.querySelector \"#fresh\" with",
    "  | none => pure (\"\", none)",
    "  | some fresh =>",
    "      Lean.Vir.Browser.Element.setTextContent fresh s",
    "      Lean.Vir.Browser.Element.setAttribute fresh \"data-fresh\" (s ++ \"!\")",
    "      let text ← Lean.Vir.Browser.Element.getTextContent fresh",
    "      let attr ← Lean.Vir.Browser.Element.getAttribute fresh \"data-fresh\"",
    "      pure (text, attr)",
    "",
  ].join("\n"));

  generateIrPackage(hostSource, hostPackage);
  const freshHostDocumentState = createVirtualDocumentState();
  ensureVirtualElementState(freshHostDocumentState, "#fresh");
  const hostFactory = createVirRuntimeFactory({ wasmBytes, virtualDocumentState: freshHostDocumentState });
  const hostRuntime = await hostFactory.createRuntime({ irPackageBytes: await readFile(hostPackage) });
  assert.equal(hostRuntime.interfaceManifest.hostImports.length, 8);
  assert.equal(hostRuntime.call("freshEchoBang", "ok"), "ok!");
  assert.equal(hostRuntime.call("freshTitleRoundtrip", "Lean.Vir"), "Lean.Vir");
  assert.deepEqual(hostRuntime.call("freshElementRoundtrip", "element"), {
    fst: "element",
    snd: "element!",
  });

  const customHostSource = join(freshDir, "FreshCustomHost.lean");
  const customHostPackage = join(freshDir, "custom-host.irpkg");
  await writeFile(customHostSource, [
    "import Lean.Vir.Host",
    "",
    "structure HostCounter where",
    "  label : String",
    "  value : Nat",
    "  enabled : Bool",
    "deriving Inhabited",
    "",
    "@[vir_js \"test.bumpNat\"]",
    "opaque jsBumpNat (n : Nat) : Nat",
    "",
    "@[vir_js \"test.bumpCounter\"]",
    "opaque jsBumpCounter (counter : HostCounter) : HostCounter",
    "",
    "def freshCustomBump (n : Nat) : Nat :=",
    "  jsBumpNat n",
    "",
    "def freshCustomCounter (counter : HostCounter) : HostCounter :=",
    "  jsBumpCounter counter",
    "",
  ].join("\n"));
  generateIrPackage(customHostSource, customHostPackage);
  const customFactory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.bumpCounter": (counter) => ({
        label: `${counter.label}!`,
        value: (BigInt(counter.value) + 1n).toString(),
        enabled: !counter.enabled,
      }),
      "test.bumpNat": (n) => (BigInt(n) + 1n).toString(),
    },
  });
  const customRuntime = await customFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.deepEqual(customRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), [
    "test.bumpCounter",
    "test.bumpNat",
  ]);
  assert.equal(customRuntime.call("freshCustomBump", 41), "42");
  assert.deepEqual(customRuntime.call("freshCustomCounter", {
    label: "count",
    value: 4,
    enabled: true,
  }), {
    label: "count!",
    value: "5",
    enabled: false,
  });

  const objectImportFactory = createVirRuntimeFactory({
    wasmBytes,
    imports: {},
    hostBindings: {
      "test.bumpCounter": (counter) => counter,
      "test.bumpNat": (n) => (BigInt(n) + 2n).toString(),
    },
  });
  const objectImportRuntime = await objectImportFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.equal(objectImportRuntime.call("freshCustomBump", 40), "42");
}
