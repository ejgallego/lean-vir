/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(repoRoot, "web"),
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(repoRoot, "web/index.html"),
        dev: resolve(repoRoot, "web/dev.html"),
        format: resolve(repoRoot, "web/format.html"),
        react: resolve(repoRoot, "web/react.html"),
        runtimeExample: resolve(repoRoot, "web/runtime-example.html"),
      },
    },
  },
});
