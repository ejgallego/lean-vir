// Retained actual same-profile regression fixture, never an application selector.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length)
  throw new Error("usage: node tests/resources/historical-runtime.mjs OUTPUT");
const cid = "426c9d2cc37e7e4cb74295555e785b446ad72dcc15279822e3fbaedb366158bb";
const path = resolve(output);
execFileSync(
  resolve(root, ".lake/build/bin/vir_resource_pack"),
  [
    "acquire",
    resolve(root, "vir-resources/compatibility.json"),
    cid,
    `https://github.com/ejgallego/lean-vir/releases/download/resource-${cid}/${cid}.virres`,
    `${path}.cache`,
    path,
  ],
  { cwd: root, stdio: "inherit" },
);
