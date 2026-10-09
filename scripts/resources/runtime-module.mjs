/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as esbuild from "esbuild";

// One release bundle operation for the packer and its real browser regression.
// Preserve diagnostic names and legal comments; never mangle public properties.
export async function buildRuntimeModule(root) {
  const compiled = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ["web/src/resource-program.js"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    keepNames: true,
    write: false,
    metafile: true,
    legalComments: "inline",
    outfile: "runtime.js",
  });
  if (Object.values(compiled.metafile.outputs).some((output) => output.imports.length))
    throw new Error(
      "runtime has external JavaScript dependencies outside its inventory",
    );
  return compiled;
}
