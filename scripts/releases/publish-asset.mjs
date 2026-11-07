// Maintainer-only immutable asset publication shared by runtime and SDK releases.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function publishAsset(tag, file, name = basename(file)) {
  const { assets } = JSON.parse(
    execFileSync("gh", ["release", "view", tag, "--json", "assets"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const temporary = await mkdtemp(join(tmpdir(), "vir-release-"));
  try {
    const asset = join(temporary, name);
    if (assets.some((a) => a.name === name)) {
      execFileSync(
        "gh",
        ["release", "download", tag, "--pattern", name, "--dir", temporary],
        { stdio: "inherit" },
      );
      if (!(await readFile(file)).equals(await readFile(asset)))
        throw new Error(
          `existing release asset differs: ${tag}/${name}; left unchanged`,
        );
      console.log(`reused identical release asset: ${tag}/${name}`);
    } else {
      await copyFile(file, asset);
      execFileSync("gh", ["release", "upload", tag, asset], {
        stdio: "inherit",
      });
      const verified = join(temporary, "verified");
      await mkdir(verified);
      execFileSync(
        "gh",
        ["release", "download", tag, "--pattern", name, "--dir", verified],
        {
          stdio: "inherit",
        },
      );
      if (!(await readFile(file)).equals(await readFile(join(verified, name))))
        throw new Error(`uploaded release asset differs: ${tag}/${name}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [tag, file, ...extra] = process.argv.slice(2);
  if (!tag || !file || extra.length)
    throw new Error("usage: node scripts/releases/publish-asset.mjs TAG FILE");
  await publishAsset(tag, file);
}
