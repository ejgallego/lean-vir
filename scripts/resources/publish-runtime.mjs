/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Maintainer release operation, never invoked by application acquisition.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { runtimeAssetName, runtimeLogicalId } from "./runtime-source.mjs";
import { publishAsset } from "../releases/publish-asset.mjs";

const [tag, pack, ...extra] = process.argv.slice(2);
if (!tag || !pack || extra.length)
  throw new Error("usage: node scripts/resources/publish-runtime.mjs TAG PACK");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim()
)
  throw new Error("runtime publication requires clean committed VIR source");
const name = runtimeAssetName(revision);
const bytes = await readFile(pack);
const descriptor = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)));
if (descriptor.logicalId !== runtimeLogicalId(revision))
  throw new Error("runtime pack source does not match the publishing checkout");
await publishAsset(tag, pack, name);
