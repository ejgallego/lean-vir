/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function stageStaticReportShell(templateDir, outputDir) {
  const entries = [
    ["index.html", "index.html"],
    ["app.js", "assets/app.js"],
    ["style.css", "assets/style.css"],
  ];
  await mkdir(join(outputDir, "assets"), { recursive: true });
  const sizes = await Promise.all(
    entries.map(async ([source, destination]) => {
      const contents = await readFile(join(templateDir, source), "utf8");
      await writeFile(join(outputDir, destination), contents);
      return Buffer.byteLength(contents);
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}
