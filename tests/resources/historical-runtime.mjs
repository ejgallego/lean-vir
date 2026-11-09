// Fetch the fixed historical regression independently of CURRENT native
// compatibility. This is test data, never an application selector or downloader.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length)
  throw new Error("usage: node tests/resources/historical-runtime.mjs OUTPUT");
const cid = "426c9d2cc37e7e4cb74295555e785b446ad72dcc15279822e3fbaedb366158bb";
const sha = "110ec5424de49e9b66f4fb3bede1cf5ccb631d5fbd84a4723e228907b86e8f1c";
const path = resolve(output);
const matches = (path) =>
  existsSync(path) &&
  createHash("sha256").update(readFileSync(path)).digest("hex") === sha;
if (!matches(path)) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = mkdtempSync(join(dirname(path), ".historical-runtime-"));
  try {
    const downloaded = join(temporary, "426c.virres");
    execFileSync(
      "curl",
      [
        "-fsSL",
        "--max-time",
        "120",
        "--retry",
        "2",
        `https://github.com/ejgallego/lean-vir/releases/download/resource-${cid}/${cid}.virres`,
        "-o",
        downloaded,
      ],
      { stdio: "inherit" },
    );
    if (!matches(downloaded))
      throw new Error("historical426c SHA-256 mismatch");
    renameSync(downloaded, path);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
