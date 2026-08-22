import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { runSync } from "./process-utils.mjs";

function git(path, args) {
  return runSync("git", ["-C", path, ...args], { capture: true });
}

function normalizedRepository(repository) {
  const trimmed = repository.replace(/\/+$/, "").replace(/\.git$/, "");
  const githubScp = /^git@github\.com:(.+)$/.exec(trimmed);
  if (githubScp) return `https://github.com/${githubScp[1]}`;
  const githubSsh = /^ssh:\/\/git@github\.com\/(.+)$/.exec(trimmed);
  if (githubSsh) return `https://github.com/${githubSsh[1]}`;
  return trimmed;
}

export async function verifyGitCheckout(checkoutId, path, source) {
  const checkoutPath = resolve(path);
  if (!(await stat(checkoutPath).catch(() => null))?.isDirectory()) {
    throw new Error(`checkout ${checkoutId} is not a directory: ${checkoutPath}`);
  }
  const root = resolve(git(checkoutPath, ["rev-parse", "--show-toplevel"]));
  if (root !== checkoutPath) {
    throw new Error(
      `checkout ${checkoutId} must point at its Git root: ${root}`,
    );
  }
  const origin = git(checkoutPath, ["remote", "get-url", "origin"]);
  if (normalizedRepository(origin) !== normalizedRepository(source.repository)) {
    throw new Error(
      `checkout ${checkoutId} origin mismatch: expected ${source.repository}, got ${origin}`,
    );
  }
  const revision = git(checkoutPath, ["rev-parse", "HEAD"]);
  if (revision !== source.revision) {
    throw new Error(
      `checkout ${checkoutId} revision mismatch: expected ${source.revision}, got ${revision}`,
    );
  }
  if (git(checkoutPath, ["status", "--porcelain"]) !== "") {
    throw new Error(`checkout ${checkoutId} is dirty: ${checkoutPath}`);
  }
  return {
    path: checkoutPath,
    revision,
    sourceId: source.id,
    repository: source.repository,
  };
}
