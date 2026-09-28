/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Real interpreter gate. Requires an exact-toolchain release Wasm and compiled
// generator/FormatPretty fixture; it never installs a SDK or rebuilds Wasm.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { measureResourceRetention } from "./retention.mjs";
import {
  descriptorContentId,
  encodeDescriptor,
  validateDescriptor,
} from "../../web/src/resources/descriptor.js";
import {
  PACKAGE_FORMAT_VERSION,
  RUNTIME_ABI_VERSION,
  RESOURCE_JS_API_VERSION,
} from "../../scripts/packages/package-versions.mjs";
import {
  launchChromium,
  openChromiumPage,
  navigate,
  evaluate,
} from "../browser/harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const outputRoot = join(root, "build/resources-browser");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "run-"));
const programDir = join(output, "program");
await mkdir(programDir);
const generated = execFileSync(
  "lake",
  [
    "env",
    join(root, ".lake/build/bin/vir_irpkg"),
    join(programDir, "root.irpkg"),
    join(output, "program.report.md"),
    "--module-set-output",
    join(programDir, "set.json"),
    join(programDir, "parts"),
    "tests.resources.BrowserProgram",
    "root.irpkg",
    "parts",
    "--target-marked-module",
    "tests.resources.BrowserProgram",
  ],
  { cwd: root, encoding: "utf8" },
);
await writeFile(join(output, "generator.log"), generated);
const compiled = await esbuild.build({
  entryPoints: [join(root, "web/src/resource-program.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  metafile: true,
  legalComments: "inline",
  outfile: "runtime.js",
});
assert.deepEqual(
  Object.values(compiled.metafile.outputs).flatMap((o) => o.imports),
  [],
  "runtime must not acquire untracked JavaScript dependencies",
);
const wasm = await readFile(join(root, "web/public/vir-upstream.wasm"));
const buildIdentity = JSON.parse(
  await readFile(join(root, "build/upstream-probe/wasm-build-identity.json")),
);
const leanBuildId = execFileSync("lean", ["--githash"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(buildIdentity.leanSource.commit, leanBuildId);
assert.equal(buildIdentity.leanSource.dirty, false);
const compatibility = {
  leanBuildId,
  runtimeAbi: String(RUNTIME_ABI_VERSION),
  jsApiVersion: RESOURCE_JS_API_VERSION,
  irFormatVersion: PACKAGE_FORMAT_VERSION,
};
const inventory = new Map();
async function bundle(kind, entries, fileEntries, exports) {
  const descriptor = validateDescriptor({
    schemaVersion: 1,
    logicalId: `vir/test/${kind}`,
    kind,
    compatibility,
    files: entries.map(([path, bytes, mediaType]) => ({
      path,
      mediaType,
      byteLength: bytes.length,
      sha256: digest(bytes),
    })),
    fileEntries,
    exports,
  });
  const envelope = {
    contentId: await descriptorContentId(descriptor),
    descriptor,
  };
  for (const [path, bytes, mediaType] of entries)
    inventory.set(`${kind}/${path}`, { bytes, mediaType });
  inventory.set(`${kind}/bundle.json`, {
    bytes: Buffer.from(JSON.stringify(envelope)),
    mediaType: "application/json",
  });
  return envelope;
}
const runtime = await bundle(
  "runtime",
  [
    ["runtime.js", compiled.outputFiles[0].contents, "text/javascript"],
    ["runtime.wasm", wasm, "application/wasm"],
    ["LICENSE", await readFile(join(root, "LICENSE")), "text/plain"],
    ["NOTICE", await readFile(join(root, "NOTICE")), "text/plain"],
    [
      "lean-LICENSE",
      await readFile(join(root, "third_party/lean4-src/LICENSE")),
      "text/plain",
    ],
    [
      "lean-LICENSES",
      await readFile(join(root, "third_party/lean4-src/LICENSES")),
      "text/plain",
    ],
  ],
  [
    { role: "runtimeModule", path: "runtime.js" },
    { role: "wasm", path: "runtime.wasm" },
  ],
  [],
);
const setBytes = await readFile(join(programDir, "set.json"));
const set = JSON.parse(setBytes);
const program = await bundle(
  "program",
  [
    ["set.json", setBytes, "application/json"],
    ...(await Promise.all(
      set.packages.map(async (member) => [
        member.path,
        await readFile(join(programDir, member.path)),
        "application/octet-stream",
      ]),
    )),
  ],
  [{ role: "programSet", path: "set.json" }],
  [
    {
      role: "score",
      declaration: "Vir.Resources.Test.prettyScore",
      interfaceId: "vir-test-score-v1",
    },
    {
      role: "leanError",
      declaration: "Vir.Resources.Test.leanError",
      interfaceId: "vir-test-error-v1",
    },
  ],
);
for (const [path, { bytes }] of inventory) {
  const destination = join(output, "site", path);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await writeFile(destination, bytes);
}
await writeFile(
  join(output, "identities.json"),
  JSON.stringify(
    {
      leanBuildId,
      wasmSha256: digest(wasm),
      runtime: runtime.contentId,
      program: program.contentId,
      packages: set.packages.length,
    },
    null,
    2,
  ),
);
for (const envelope of [runtime, program]) {
  const kind = envelope.descriptor.kind;
  const descriptorPath = join(output, `${kind}.descriptor.json`);
  await writeFile(descriptorPath, encodeDescriptor(envelope.descriptor));
  execFileSync(
    join(root, ".lake/build/bin/vir_resource_pack"),
    [
      "pack",
      descriptorPath,
      join(output, "site", kind),
      join(output, `${kind}.virres`),
    ],
    { cwd: root, stdio: "pipe" },
  );
}

// Same inventory under two unrelated URL roots, without rebuilding or rewriting.
const requests = [];
let override = null;
const server = createServer((req, res) => {
  requests.push(req.url);
  let path = new URL(req.url, "http://localhost").pathname;
  if (path.startsWith("/talk/nested/"))
    path = path.slice("/talk/nested/".length);
  else path = path.slice(1);
  if (path === "") {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>resources</title>");
    return;
  }
  const item = override?.(path) ?? inventory.get(path);
  if (!item) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(item.status ?? 200, {
    "content-type": item.mediaType,
    "content-length": item.bytes.length,
    ...item.headers,
  });
  res.end(item.bytes);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let chromium, cdp;
const outcomes = [];
try {
  chromium = await launchChromium();
  cdp = await openChromiumPage(chromium);
  for (const prefix of ["/", "/talk/nested/"]) {
    await navigate(cdp, origin + prefix);
    const result = await evaluate(
      cdp,
      `(async () => {
      const {createProgram} = await import('./runtime/runtime.js');
      const options = {runtimeManifestUrl: new URL('runtime/bundle.json', location.href),
        programManifestUrl: new URL('program/bundle.json', location.href)};
      const first = await createProgram(options);
      const second = await createProgram(options);
      const values = [first.call('score'), second.call('score')];
      let unknown = false; try {first.call('missing')} catch(e) {unknown = /unknown.*role/.test(e.message)};
      first.dispose(); first.dispose();
      let disposed = false; try {first.call('score')} catch(e) {disposed = /disposed/.test(e.message)};
      values.push(second.call('score')); second.dispose();
      const remounted = await createProgram(options); values.push(remounted.call('score')); remounted.dispose();
      globalThis.openResourceProgram = () => createProgram(options);
      return {values, unknown, disposed};
    })()`,
    );
    assert.deepEqual(result, {
      values: ["6093", "6093", "6093", "6093"],
      unknown: true,
      disposed: true,
    });
    outcomes.push(
      `${prefix}: role call, independent instance, disposal, remount PASS`,
    );
  }
  const browserVersion = await cdp.send("Browser.getVersion");
  await measureResourceRetention(cdp, async (observations) => {
    await writeFile(join(output, "retention.json"), JSON.stringify({
      browserVersion,
      scope: "4.34 resource instances; scalar Format score, not dynamic PrettyM or callbacks",
      method: "WeakRef memories after explicit CDP GC; heap/capacity are observations, not leak thresholds",
      observations,
    }, null, 2));
  });
  outcomes.push("retention: live control, 300 scalar calls, 12 released instances PASS");
  // Route one normal facade call into an actual Wasm out-of-bounds access.
  // The existing runtime guard, not the facade, must record/retire that failure.
  const status = await evaluate(cdp, `(async () => {
    const original = WebAssembly.Instance;
    let trapNext = false, boundaryCalls = 0;
    WebAssembly.Instance = new Proxy(original, {construct(target, args) {
      const instance = Reflect.construct(target, args);
      return {exports: {...instance.exports, vir_call_resolved_objects(...args) {
        boundaryCalls++;
        if (trapNext) { trapNext = false; return instance.exports.vir_obj_nat(0xfffffff0, 32); }
        return instance.exports.vir_call_resolved_objects(...args);
      }}};
    }});
    let program, peer, fresh;
    try {
      program = await openResourceProgram(); peer = await openResourceProgram();
      const initial = program.status;
      let ioError = false;
      try { program.call('leanError'); } catch (e) { ioError = /resource recoverable error/.test(e.message); }
      const afterIo = program.status;
      const afterIoValue = program.call('score');
      let invalidRole = false;
      try { program.call('missing'); } catch { invalidRole = true; }
      const afterInvalidRole = program.status;
      const immutable = !Reflect.set(program, 'status', 'disposed') && program.status === 'active';
      trapNext = true;
      let failure;
      try { program.call('score'); } catch (error) { failure = error; }
      const failed = program.status;
      const callsAtFailure = boundaryCalls;
      let retired = false;
      try { program.call('score'); } catch (error) { retired = error.cause === failure; }
      const noReplay = boundaryCalls === callsAtFailure;
      const peerState = peer.status, peerValue = peer.call('score');
      program.dispose(); program.dispose();
      const disposed = program.status;
      fresh = await openResourceProgram();
      return {initial, ioError, afterIo, afterIoValue, invalidRole, afterInvalidRole,
        immutable, realTrap: failure instanceof WebAssembly.RuntimeError, failed,
        retired, noReplay, peerState, peerValue, disposed,
        freshState: fresh.status, freshValue: fresh.call('score')};
    } finally {
      program?.dispose(); peer?.dispose(); fresh?.dispose();
      WebAssembly.Instance = original;
    }
  })()`);
  assert.deepEqual(status, {
    initial: "active", ioError: true, afterIo: "active", afterIoValue: "6093",
    invalidRole: true, afterInvalidRole: "active", immutable: true,
    realTrap: true, failed: "failed", retired: true, noReplay: true,
    peerState: "active", peerValue: "6093", disposed: "disposed",
    freshState: "active", freshValue: "6093",
  });
  outcomes.push("status: recoverable IO, real Wasm trap, no replay, independent recovery, disposal PASS");
  const jsonItem = (value) => ({
    bytes: Buffer.from(JSON.stringify(value)),
    mediaType: "application/json",
  });
  await evaluate(
    cdp,
    `(() => {
    globalThis.resourceInstances = 0;
    WebAssembly.Instance = new Proxy(WebAssembly.Instance, {construct(target, args) {
      resourceInstances++; return Reflect.construct(target, args);
    }});
  })()`,
  );
  async function rejected(name, change, expected) {
    override = change;
    const result = await evaluate(
      cdp,
      `(async () => {
      try {const p = await openResourceProgram(); p.dispose(); return 'unexpected success'}
      catch(e) {return e.message}
    })()`,
    );
    override = null;
    assert.match(result, expected, name);
    assert.equal(
      await evaluate(cdp, "resourceInstances"),
      0,
      `${name}: reject before Lean instantiation`,
    );
    outcomes.push(`${name}: PASS (${result})`);
  }
  const changed = async (f) => {
    const value = structuredClone(program);
    f(value.descriptor);
    value.contentId = await descriptorContentId(value.descriptor);
    return jsonItem(value);
  };
  await rejected(
    "outer identity",
    (path) =>
      path === "program/bundle.json"
        ? jsonItem({ ...program, contentId: "0".repeat(64) })
        : null,
    /CONTENT_ID_MISMATCH/,
  );
  const incompatible = await changed(
    (d) => (d.compatibility.runtimeAbi = "wrong"),
  );
  await rejected(
    "compatibility",
    (path) => (path === "program/bundle.json" ? incompatible : null),
    /incompatible/,
  );
  const missingExport = await changed(
    (d) => (d.exports[0].declaration = "Missing.export"),
  );
  await rejected(
    "actual export",
    (path) => (path === "program/bundle.json" ? missingExport : null),
    /missing program export/,
  );
  await rejected(
    "Wasm integrity",
    (path) =>
      path === "runtime/runtime.wasm"
        ? { ...inventory.get(path), bytes: Buffer.alloc(wasm.length) }
        : null,
    /integrity mismatch/,
  );
  await rejected(
    "Wasm MIME",
    (path) =>
      path === "runtime/runtime.wasm"
        ? { ...inventory.get(path), mediaType: "text/html" }
        : null,
    /Content-Type/,
  );
  await rejected(
    "duplicate envelope key",
    (path) =>
      path === "program/bundle.json"
        ? {
            bytes: Buffer.from(
              `{"contentId":"x",${JSON.stringify(program).slice(1)}`,
            ),
            mediaType: "application/json",
          }
        : null,
    /duplicate JSON key/,
  );
  const missingMember = await changed(
    (d) => (d.files = d.files.filter((f) => f.path !== "root.irpkg")),
  );
  await rejected(
    "undeclared member",
    (path) => (path === "program/bundle.json" ? missingMember : null),
    /outside verified inventory/,
  );
  await rejected(
    "nested JSON",
    (path) =>
      path === "program/bundle.json"
        ? {
            bytes: Buffer.from("[".repeat(17) + "0" + "]".repeat(17)),
            mediaType: "application/json",
          }
        : null,
    /nesting limit/,
  );
  await rejected(
    "redirect",
    (path) =>
      path === "program/bundle.json"
        ? {
            bytes: Buffer.alloc(0),
            mediaType: "application/json",
            status: 302,
            headers: { location: "/elsewhere" },
          }
        : null,
    /fetch/i,
  );
  assert.equal(requests.includes("/elsewhere"), false);
  await writeFile(
    join(output, "acceptance.json"),
    JSON.stringify({ outcomes, requests }, null, 2),
  );
  console.log(`resource browser: ${outcomes.length} checks passed; ${output}`);
} finally {
  cdp?.close();
  await chromium?.close();
  await new Promise((r) => server.close(r));
  console.log(`resource browser evidence retained: ${output}`);
}
