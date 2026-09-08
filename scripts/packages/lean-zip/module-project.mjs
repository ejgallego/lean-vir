import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runSync } from "../../process-utils.mjs";

export const exportsModule = "VirLeanZipAcceptance.Exports";
export const oracleTarget = "virLeanZipAcceptanceOracle";

// A normal dependent Lake project preserves the client's transitive dependency
// pins and native libraries. Caller owns this fresh directory and its cleanup.
export async function createLeanZipModuleProject({
  directory,
  client,
  producer,
}) {
  directory = resolve(directory);
  client = resolve(client);
  producer = resolve(producer);
  const toolchain = (
    await readFile(join(producer, "lean-toolchain"), "utf8")
  ).trim();
  const clientToolchain = (
    await readFile(join(client, "lean-toolchain"), "utf8")
  ).trim();
  if (clientToolchain !== toolchain) {
    throw new Error(
      `Lean toolchain mismatch: VIR uses ${toolchain}, lean-zip uses ${clientToolchain}`,
    );
  }
  await mkdir(directory);
  await writeFile(join(directory, "lean-toolchain"), `${toolchain}\n`);
  const sourceDirectory = join(producer, "fixtures/lean-zip");
  await writeFile(
    join(directory, "lakefile.toml"),
    [
      'name = "vir_lean_zip_acceptance"',
      "[[require]]",
      'name = "lean-zip"',
      `path = ${JSON.stringify(client)}`,
      "[[require]]",
      'name = "lean_vir"',
      `path = ${JSON.stringify(producer)}`,
      "[[lean_lib]]",
      'name = "VirLeanZipAcceptance"',
      `srcDir = ${JSON.stringify(sourceDirectory)}`,
      `roots = [${JSON.stringify(exportsModule)}]`,
      "[[lean_exe]]",
      `name = ${JSON.stringify(oracleTarget)}`,
      'root = "VirLeanZipAcceptance.NativeOracle"',
      `srcDir = ${JSON.stringify(sourceDirectory)}`,
      "",
    ].join("\n"),
  );
  return Object.freeze({
    directory,
    lake(args, options = {}) {
      return runSync("lake", args, { ...options, cwd: directory });
    },
  });
}
