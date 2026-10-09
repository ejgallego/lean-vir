// Execute the authored tutorial, not a reconstructed greeting fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceFixture } from "./fixture-edit.mjs";
import { launchChromium, openChromiumPage, navigate, evaluate, serveDist } from "../browser/harness.mjs";
import { waitForBrowserState } from "../browser/page-actions.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const browser = process.argv.includes("--browser");
mkdirSync(join(root, "build"), { recursive: true });
const evidence = mkdtempSync(join(root, "build/quickstart-"));
console.log(`quickstart evidence: ${evidence}`);
const app = join(evidence, "application");
cpSync(join(root, "examples/tutorials/quickstart"), app, {
  recursive: true,
  filter: path => ![".lake", "_site", "lake-manifest.json"].includes(basename(path)),
});
// The copy-out project pins landed VIR. This one test-only substitution exercises
// the candidate checkout with the exact same authored program/publisher/page.
const lakefile = join(app, "lakefile.lean");
writeFileSync(lakefile, replaceFixture(readFileSync(lakefile, "utf8"),
  'require lean_vir from git "https://github.com/ejgallego/lean-vir.git" @\n  "aa465b873387a0bf46669031da1af99f59b0f3b9"',
  `require lean_vir from ${JSON.stringify(root)}`));
const site = join(evidence, "site");
function publish(label) {
  const result = spawnSync("lake", ["exe", "publish", site], {
    cwd: app, encoding: "utf8", timeout: 240000,
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  assert.ifError(result.error);
  assert.equal(result.status, 0, log);
  return log;
}
function identities() {
  const config = JSON.parse(readFileSync(join(site, "app.json")));
  return [config.runtimeManifest, config.programManifest].map(path =>
    JSON.parse(readFileSync(join(site, path))).contentId);
}
publish("cold");
const initial = identities();
publish("warm");
assert.deepEqual(identities(), initial);

const entry = join(app, "web/main.js");
const entrySource = readFileSync(entry, "utf8");
writeFileSync(entry, entrySource + "\n// Authored frontend edit.\n");
const frontendEdit = publish("frontend-edit");
assert.equal(readFileSync(join(site, "main.js"), "utf8"), readFileSync(entry, "utf8"),
  "ordinary build must refresh the embedded frontend");
assert.deepEqual(identities(), initial);
assert.doesNotMatch(frontendEdit, /Built.*:virProgram/);

const program = join(app, "QuickstartApp/Program.lean");
const programSource = readFileSync(program, "utf8");
writeFileSync(program, replaceFixture(programSource, '"Hello, "', '"Hello again, "'));
publish("program-edit");
const edited = identities();
assert.equal(edited[0], initial[0], "program edit must not change the runtime");
assert.notEqual(edited[1], initial[1]);

if (browser) {
  const prefix = "/nested/quickstart/";
  const server = await serveDist(site, prefix);
  let chromium;
  try {
    chromium = await launchChromium();
    const cdp = await openChromiumPage(chromium);
    await navigate(cdp, server.origin + prefix);
    const observed = await waitForBrowserState(cdp, `(() => {
      const text = document.getElementById("result")?.textContent ?? "";
      return { ready: text !== "" && text !== "Loading Lean…", value: text };
    })()`, { timeoutMessage: "authored tutorial did not finish", timeoutMs: 15000 });
    assert.equal(observed, "Hello again, world");
    const broken = join(site, "broken");
    mkdirSync(broken);
    // Ordinary hosting failure: serve the page/config but not its runtime files.
    for (const name of ["index.html", "main.js", "app.json"]) cpSync(join(site, name), join(broken, name));
    await navigate(cdp, server.origin + prefix + "broken/index.html");
    const failure = await waitForBrowserState(cdp, `(() => {
      const text = document.getElementById("result")?.textContent ?? "";
      return { ready: text.startsWith("Lean failed:"), value: text };
    })()`, { timeoutMessage: "tutorial initialization failure was not reported", timeoutMs: 15000 });
    assert.match(failure, /Lean failed:/);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('button').length"), 0);
    writeFileSync(join(evidence, "browser.log"), `${observed}\n${failure}\n`);
    cdp.close();
  } finally {
    try { await chromium?.close(); }
    finally { await server.close(); }
  }
}
writeFileSync(program, programSource);
writeFileSync(entry, entrySource);
publish("restored");
assert.deepEqual(identities(), initial);
console.log(`authored quickstart: cold/warm, frontend/program edits${browser ? ", nested real-Wasm call and initialization failure" : ""} PASS`);
