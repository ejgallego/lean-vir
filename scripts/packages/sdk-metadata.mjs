/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SDK_METADATA_FILES = Object.freeze([
  "README.txt",
  "LICENSE",
  "NOTICE",
]);

export async function sdkFileRecord(root, path, extra = {}) {
  const bytes = await readFile(join(root, path));
  return {
    path,
    ...extra,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
  };
}

export function sdkReadme({ localBuild = false } = {}) {
  const provenance = localBuild
    ? "This copy was built locally for the consuming workspace's exact Lean toolchain."
    : "This copy was packaged for the matching lean_vir package revision.";
  return `Lean VIR SDK
============

${provenance}

This SDK contains the JavaScript runtime modules and wasm32-wasip1 interpreter.
The preferred Lake application workflow is:

  1. mark the application root's declarations with @[vir_export] and
     @[vir_startup];
  2. declare a named Lean library with one or more explicit application roots;
  3. add that library's virWebAssets facet to the application's ordinary
     target; and
  4. build that target and deploy its named .lake/build/vir/web-assets
     directory.

The application root may import contributions from several Lake packages. To
run them in one live Wasm instance and Lean heap, keep one explicit root and let
that root own the public wrappers, startup order, and lifecycle.

The lower-level commands remain available for custom artifact assembly:

  lake build +MyApp.Runtime:vir
  lake build :virSdk

The JavaScript files are ES modules. The generic runtime and host-binding
modules do not import React; js/vir-react-host-bindings.js imports react and
react-dom/client and should only be used by browser React integrations.

Application code should import the entry modules directly under js/:

  js/vir-web-assets.js
  js/vir-runtime.js
  js/vir-runtime-node.js
  js/vir-host-bindings.js
  js/vir-react-host-bindings.js

Nested js/runtime/, js/host/, and js/react/ modules are shipped so those entry
modules can resolve relative imports. They remain internal implementation
modules and may change with the matching lean_vir revision.

For custom assembly, serve the selected Wasm file, the runtime modules, and the
generated .irpkg-set.json together with all of its .irpkg members. Minimal
composed-assets browser usage is:

  import { createVirWebAssetsRuntime } from "./sdk/js/vir-web-assets.js";

  const vir = await createVirWebAssetsRuntime(
    "./VIR_WEB_ASSETS.json",
  );

  vir.runStartupEntries();

Expose the runtime where the application needs it and call vir.dispose() when
the page or application is torn down. The composed directory contains the
browser dependency closure selected by the SDK manifest; optional Node and
browser-React entry points plus the debug Wasm remain available in the full SDK
for custom assembly. A multi-program manifest requires an explicit program ID;
omission is accepted only when exactly one program exists.

Check lean-vir-artifact.json before mixing this SDK with generated packages
from another lean_vir revision or Lean compiler identity.
`;
}
