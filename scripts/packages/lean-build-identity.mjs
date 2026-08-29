/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function parseLeanBuildIdentity(output) {
  const version = /\bversion ([^,]+),/.exec(output)?.[1]?.trim();
  const githash = /\bcommit ([0-9a-fA-F]+),/.exec(output)?.[1]?.toLowerCase();
  if (!version || !githash) {
    throw new Error(`could not parse Lean build identity from: ${output}`);
  }
  return { leanVersionString: version, leanGithash: githash };
}
