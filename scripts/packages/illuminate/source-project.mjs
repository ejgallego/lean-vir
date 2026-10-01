import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { runSync } from "../../process-utils.mjs";
import { readToolchain } from "../vir-client-package-lib.mjs";

export const rootModule = "VirIlluminateAcceptance.Exports";
const adapterSource =
  "fixtures/illuminate/VirIlluminateAcceptance/Exports.lean";

// Preserve the client's Lake configuration and dependency pins. The archived
// view uses VIR's pinned toolchain, while the returned client pin records what
// the selected upstream source declared before this local build.
export async function createSourceView(client, producer, parent) {
  const toolchain = await readToolchain(producer);
  const workspace = await mkdtemp(join(parent, ".illuminate-source-view-"));
  try {
    const sourceView = join(workspace, "source");
    const archive = join(workspace, "source.tar");
    await mkdir(sourceView);
    runSync("git", [
      "-C",
      client,
      "archive",
      "--format=tar",
      `--output=${archive}`,
      "HEAD",
    ]);
    runSync("tar", ["-xf", archive, "-C", sourceView]);
    const clientToolchain = await readToolchain(sourceView);
    await writeFile(join(sourceView, "lean-toolchain"), `${toolchain}\n`);
    await symlink(producer, join(sourceView, "vir"), "dir");
    await mkdir(join(sourceView, "VirIlluminateAcceptance"));
    await copyFile(
      join(producer, adapterSource),
      join(sourceView, "VirIlluminateAcceptance/Exports.lean"),
    );
    const lakefile = join(sourceView, "lakefile.lean");
    await writeFile(
      lakefile,
      `${(await readFile(lakefile, "utf8")).trimEnd()}\n\n` +
        "lean_lib VirIlluminateAcceptance where\n" +
        "  roots := #[`" +
        rootModule +
        "]\n",
    );
    return { workspace, sourceView, toolchain, clientToolchain };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
