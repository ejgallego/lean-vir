#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { runTypeAnchorManifestCli } from "./type-anchor-manifest.mjs";

await runTypeAnchorManifestCli(process.argv.slice(2));
