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

export const rootModule = "VirIlluminateAcceptance.Exports";
const adapterSource =
  "fixtures/illuminate/VirIlluminateAcceptance/Exports.lean";

// Preserve the client's Lake configuration and dependency pins. Only the
// caller-owned archived view gets VIR's package adapter and library target.
export async function createSourceView(client, producer, parent) {
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
    return { workspace, sourceView };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
