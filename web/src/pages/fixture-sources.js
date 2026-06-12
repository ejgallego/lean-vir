/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import fibSource from "../../../examples/Fib.lean?raw";
import hostInteropSource from "../../../examples/HostInterop.lean?raw";
import mergeSortSource from "../../../examples/MergeSort.lean?raw";
import fixtureBasicSource from "../../../fixtures/Basic.lean?raw";
import fixtureExprPrinterSource from "../../../fixtures/ExprPrinter.lean?raw";
import fixtureFormatPrettySource from "../../../fixtures/FormatPretty.lean?raw";
import fixtureInterfaceShapesSource from "../../../fixtures/InterfaceShapes.lean?raw";
import fixtureListOptionSource from "../../../fixtures/ListOption.lean?raw";
import fixtureRecursiveTypesSource from "../../../fixtures/RecursiveTypes.lean?raw";
import fixtureBoundarySource from "../../../fixtures/Boundary.lean?raw";
import fixtureLeanParserSource from "../../../fixtures/LeanParser.lean?raw";
import fixtureLeanParserHeaderSource from "../../../fixtures/LeanParserHeader.lean?raw";
import fixtureTaskSource from "../../../fixtures/Task.lean?raw";

export const sourceFiles = [
  { path: "examples/Fib.lean", source: fibSource },
  { path: "examples/HostInterop.lean", source: hostInteropSource },
  { path: "examples/MergeSort.lean", source: mergeSortSource },
  { path: "fixtures/Basic.lean", source: fixtureBasicSource },
  { path: "fixtures/ExprPrinter.lean", source: fixtureExprPrinterSource },
  { path: "fixtures/FormatPretty.lean", source: fixtureFormatPrettySource },
  { path: "fixtures/InterfaceShapes.lean", source: fixtureInterfaceShapesSource },
  { path: "fixtures/ListOption.lean", source: fixtureListOptionSource },
  { path: "fixtures/RecursiveTypes.lean", source: fixtureRecursiveTypesSource },
  { path: "fixtures/Boundary.lean", source: fixtureBoundarySource },
  { path: "fixtures/LeanParser.lean", source: fixtureLeanParserSource },
  { path: "fixtures/LeanParserHeader.lean", source: fixtureLeanParserHeaderSource },
  { path: "fixtures/Task.lean", source: fixtureTaskSource },
];

const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source.source]));

export function sourceSnippetForFixture(fixture) {
  const source = sourceByPath.get(fixture.source);
  if (!source) return "";
  if (fixture.group === "demo") return source.trimEnd();
  const lines = source.trimEnd().split(/\r?\n/);
  const name = shortEntryName(fixture.entry);
  const start = lines.findIndex((line) =>
    line.startsWith(`def ${name}`) ||
    line.startsWith(`partial def ${name}`) ||
    line.startsWith(`unsafe def ${name}`)
  );
  if (start === -1) {
    return source.trimEnd();
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^(def|partial def|unsafe def|inductive|structure|namespace|end|#eval)\b/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

function shortEntryName(entry) {
  return entry.split(".").at(-1) ?? entry;
}
