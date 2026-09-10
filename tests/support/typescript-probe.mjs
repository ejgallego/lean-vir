/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import ts from "typescript";

// Compile independent test-authored wrappers, optionally replacing the pinned
// ES5 declarations in memory. Never derive the expected wrapper from Lean policy.
export function typeScriptDiagnostics(source, es5Source) {
  const path = new URL("./binding-probe.virtual.ts", import.meta.url).pathname;
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, types: [] };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, ...args) => {
    const replacement = file === path ? source : es5Source !== undefined && file.endsWith("/lib.es5.d.ts") ? es5Source : undefined;
    return replacement === undefined ? getSourceFile(file, languageVersion, ...args) :
      ts.createSourceFile(file, replacement, languageVersion, true);
  };
  return ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
}
