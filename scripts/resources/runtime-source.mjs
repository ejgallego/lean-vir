export function runtimeAssetName(revision) {
  if (!/^[0-9a-f]{40}$/.test(revision))
    throw new Error("invalid VIR source revision");
  return `runtime-${revision}.virres`;
}

export function runtimeLogicalId(revision) {
  runtimeAssetName(revision);
  return `lean-vir/runtime/${revision}`;
}
