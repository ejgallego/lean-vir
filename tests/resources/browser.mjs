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
import { buildRuntimeModule } from "../../scripts/resources/runtime-module.mjs";
import { measureResourceRetention } from "./retention.mjs";
import {
  descriptorContentId,
  encodeDescriptor,
  validateDescriptor,
} from "../../web/src/resources/descriptor.js";
import {
  VIR_COMPATIBILITY_VERSION,
} from "../../web/src/runtime/versions.js";
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
const compiled = await buildRuntimeModule(root);
const wasm = await readFile(join(root, "web/public/vir-upstream.wasm"));
const buildIdentity = JSON.parse(
  await readFile(join(root, "build/upstream-probe/wasm-build-identity.json")),
);
const leanRevision = execFileSync("lean", ["--githash"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(buildIdentity.leanSource.commit, leanRevision);
assert.equal(buildIdentity.leanSource.dirty, false);
const compatibility = {
  leanRevision,
  virVersion: VIR_COMPATIBILITY_VERSION,
};
const inventory = new Map();
async function bundle(kind, entries, fileEntries) {
  const descriptor = validateDescriptor({
    schemaVersion: 2,
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
      leanRevision,
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
    // Match GitHub Pages: the declared text/javascript inventory is served
    // using its application/javascript response alias, including bootstrap.
    "content-type": item.mediaType === "text/javascript"
      ? "application/javascript" : item.mediaType,
    "content-length": item.bytes.length,
    ...item.headers,
  });
  res.end(item.bytes);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const noticePaths = ["LICENSE", "NOTICE", "lean-LICENSE", "lean-LICENSES"]
  .map((name) => `runtime/${name}`);
let chromium, cdp;
const outcomes = [];
try {
  chromium = await launchChromium();
  cdp = await openChromiumPage(chromium);
  // Distribution notices remain present, but unavailable notice responses must
  // not participate in program startup. Exercise the actual minimized module.
  override = (path) => noticePaths.includes(path)
    ? { ...inventory.get(path), status: 503 } : null;
  for (const prefix of ["/", "/talk/nested/"]) {
    await navigate(cdp, origin + prefix);
    const result = await evaluate(
      cdp,
      `(async () => {
      const {createProgram} = await import('./runtime/runtime.js');
      const options = {runtimeManifestUrl: new URL('runtime/bundle.json', location.href),
        programManifestUrl: new URL('program/bundle.json', location.href)};
      const controller = new AbortController();
      const checkedOptions = {
        ...options,
        signal: controller.signal,
        expectedExports: {
          'Vir.Resources.Test.prettyScore': {
            args: [],
            result: {type: 'Nat', interfaceTag: 0},
            effect: 'pure',
          },
        },
      };
      const first = await createProgram(checkedOptions);
      controller.abort(); // A handed-off instance belongs to the facade, not this signal.
      const second = await createProgram(options);
      // Assert native result types here; CDP carries only JSON observations.
      const score = 'Vir.Resources.Test.prettyScore';
      const values = [first.call(score), second.call(score)];
      let unknown = false; try {first.call('missing')} catch(e) {unknown = /unknown.*program export/.test(e.message)};
      first.dispose(); first.dispose();
      let disposed = false; try {first.call(score)} catch(e) {disposed = /disposed/.test(e.message)};
      values.push(second.call(score)); second.dispose();
      const remounted = await createProgram(options); values.push(remounted.call(score)); remounted.dispose();
      globalThis.openResourceProgram = (extra = {}) => createProgram({...options, ...extra});
      return {correctValues: values.map(value => value === 6093n), unknown, disposed,
        loaderCallable: typeof createProgram === 'function'};
    })()`,
    );
    assert.deepEqual(result, {
      correctValues: [true, true, true, true],
      unknown: true,
      disposed: true,
      loaderCallable: true,
    });
    outcomes.push(
      `${prefix}: JavaScript MIME alias, full-name call, independent instance, disposal, remount PASS`,
    );
  }
  assert.equal(requests.some((path) => noticePaths.some((notice) =>
    path === `/${notice}` || path === `/talk/nested/${notice}`)), false);
  override = null;
  outcomes.push("minimized runtime: callable export retained, no notice startup requests PASS");
  const browserVersion = await cdp.send("Browser.getVersion");
  await measureResourceRetention(cdp, async (observations) => {
    await writeFile(join(output, "retention.json"), JSON.stringify({
      browserVersion,
      scope: `Lean revision ${runtime.descriptor.compatibility.leanRevision} resource instances; scalar Format score, not dynamic PrettyM or callbacks`,
      method: "WeakRef memories after explicit CDP GC; heap/capacity are observations, not leak thresholds",
      observations,
    }, null, 2));
  });
  outcomes.push("retention: live control, 300 scalar calls, 12 released instances PASS");
  const cancelledCreation = await evaluate(cdp, `(async () => {
    const original = WebAssembly.Instance, controller = new AbortController();
    const memories = []; let cancelNext = true, handedOff = false, name, cause;
    WebAssembly.Instance = new Proxy(original, {construct(target, args) {
      const instance = Reflect.construct(target, args);
      memories.push(new WeakRef(instance.exports.memory));
      if (cancelNext) { cancelNext = false; controller.abort('cancel actual creation'); }
      return instance;
    }});
    try {
      try { const program = await openResourceProgram({signal: controller.signal}); handedOff = true; program.dispose(); }
      catch (error) { name = error.name; cause = error.cause; }
      const fresh = await openResourceProgram();
      let value;
      try { value = fresh.call('Vir.Resources.Test.prettyScore'); }
      finally { fresh.dispose(); }
      globalThis.cancelledCreationMemories = memories;
      return {handedOff, name, cause, created: memories.length, correctValue: value === 6093n};
    } finally { WebAssembly.Instance = original; }
  })()`);
  assert.deepEqual(cancelledCreation, {handedOff: false, name: "AbortError", cause: "cancel actual creation", created: 2, correctValue: true});
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  assert.equal(await evaluate(cdp, "cancelledCreationMemories.filter(ref => ref.deref()).length"), 0,
    "cancelled real-Wasm creation and fresh disposed peer release their memories");
  await evaluate(cdp, "delete globalThis.cancelledCreationMemories");
  await cdp.send("HeapProfiler.disable");
  outcomes.push("abort during actual Wasm creation: no handoff, memory released, independent recovery PASS");
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
      let startupError = false;
      try { program.call('Vir.Resources.Test.manualStartup'); }
      catch (e) { startupError = /startup requires an explicit call/.test(e.message); }
      const afterStartup = program.status;
      let ioError = false;
      try { program.call('Vir.Resources.Test.leanError'); }
      catch (e) { ioError = /resource recoverable error/.test(e.message); }
      const afterIo = program.status;
      const score = 'Vir.Resources.Test.prettyScore';
      const afterIoValue = program.call(score);
      let invalidName = false;
      try { program.call('missing'); } catch { invalidName = true; }
      const afterInvalidRole = program.status;
      const immutable = !Reflect.set(program, 'status', 'disposed') && program.status === 'active';
      trapNext = true;
      let failure;
      try { program.call(score); } catch (error) { failure = error; }
      const failed = program.status;
      const callsAtFailure = boundaryCalls;
      let retired = false;
      try { program.call(score); } catch (error) { retired = error.cause === failure; }
      const noReplay = boundaryCalls === callsAtFailure;
      const peerState = peer.status, peerValue = peer.call(score);
      let dependencyHidden = false;
      try { program.call('Vir.Fixtures.FormatPretty.formatPrettyScore'); }
      catch (e) { dependencyHidden = /unknown program export/.test(e.message); }
      program.dispose(); program.dispose();
      const disposed = program.status;
      fresh = await openResourceProgram();
      return {initial, startupError, afterStartup, ioError, afterIo, afterIoCorrect: afterIoValue === 6093n, invalidName, dependencyHidden, afterInvalidRole,
        immutable, realTrap: failure instanceof WebAssembly.RuntimeError, failed,
        retired, noReplay, peerState, peerCorrect: peerValue === 6093n, disposed,
        freshState: fresh.status, freshCorrect: fresh.call(score) === 6093n};
    } finally {
      program?.dispose(); peer?.dispose(); fresh?.dispose();
      WebAssembly.Instance = original;
    }
  })()`);
  assert.deepEqual(status, {
    initial: "active", startupError: true, afterStartup: "active", ioError: true,
    afterIo: "active", afterIoCorrect: true, invalidName: true, dependencyHidden: true,
    afterInvalidRole: "active", immutable: true,
    realTrap: true, failed: "failed", retired: true, noReplay: true,
    peerState: "active", peerCorrect: true, disposed: "disposed",
    freshState: "active", freshCorrect: true,
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
  async function rejected(name, change, expected, phase) {
    override = change;
    const result = await evaluate(
      cdp,
      `(async () => {
      try {const p = await openResourceProgram(); p.dispose(); return 'unexpected success'}
      catch(e) {return {message: e.message, cause: e.cause?.message, phase: e.phase}}
    })()`,
    );
    override = null;
    assert.match(result.cause, expected, name);
    assert.equal(result.phase, phase, name);
    assert.equal(
      await evaluate(cdp, "resourceInstances"),
      0,
      `${name}: reject before Lean instantiation`,
    );
    outcomes.push(`${name}: PASS (${result.phase})`);
  }
  const unavailableCrypto = await evaluate(cdp, `(async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (...args) => { requests++; return originalFetch(...args); };
    try {
      Object.defineProperty(globalThis, 'crypto', {value: {}, configurable: true});
      try { await openResourceProgram(); return {unexpected: true, requests}; }
      catch (error) { return {message: error.cause?.message, phase: error.phase, requests}; }
    } finally {
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
      globalThis.fetch = originalFetch;
    }
  })()`);
  assert.match(unavailableCrypto.message, /WebCrypto SHA-256.*secure context/);
  assert.equal(unavailableCrypto.phase, "runtime-creation");
  assert.equal(unavailableCrypto.requests, 0, "capability rejection before acquisition");
  assert.equal(await evaluate(cdp, "resourceInstances"), 0);
  outcomes.push("unavailable WebCrypto: reject before requests/instantiation PASS");
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
    "integrity",
  );
  const incompatible = await changed(
    (d) => (d.compatibility.virVersion += 1),
  );
  await rejected(
    "compatibility",
    (path) => (path === "program/bundle.json" ? incompatible : null),
    /incompatible/,
    "compatibility",
  );
  const missingExport = await evaluate(cdp, `(async () => {
    const expectedExports = {'Missing.export': {
      args: [], result: {type: 'Nat', interfaceTag: 0}, effect: 'pure'}};
    try { await openResourceProgram({expectedExports}); return {unexpected: true}; }
    catch (error) { return {message: error.cause?.message, phase: error.phase}; }
  })()`);
  assert.match(missingExport.message, /missing program export Missing\.export/);
  assert.equal(missingExport.phase, "program-validation");
  assert.equal(await evaluate(cdp, "resourceInstances"), 0);
  outcomes.push("unknown expected declaration: reject before runtime instantiation PASS");
  await rejected(
    "JavaScript MIME",
    (path) => path === "runtime/runtime.js"
      ? { ...inventory.get(path), mediaType: "text/plain" } : null,
    /Content-Type/,
    "resource-fetch",
  );
  await rejected(
    "JavaScript alias integrity",
    (path) => path === "runtime/runtime.js"
      ? { ...inventory.get(path), bytes: Buffer.alloc(compiled.outputFiles[0].contents.length) } : null,
    /integrity mismatch/,
    "integrity",
  );
  await rejected(
    "JavaScript alias is not Wasm MIME",
    (path) => path === "runtime/runtime.wasm"
      ? { ...inventory.get(path), mediaType: "application/javascript" } : null,
    /Content-Type/,
    "resource-fetch",
  );
  await rejected(
    "Wasm integrity",
    (path) =>
      path === "runtime/runtime.wasm"
        ? { ...inventory.get(path), bytes: Buffer.alloc(wasm.length) }
        : null,
    /integrity mismatch/,
    "integrity",
  );
  await rejected(
    "Wasm MIME",
    (path) =>
      path === "runtime/runtime.wasm"
        ? { ...inventory.get(path), mediaType: "text/html" }
        : null,
    /Content-Type/,
    "resource-fetch",
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
    "program-manifest",
  );
  const missingMember = await changed(
    (d) => (d.files = d.files.filter((f) => f.path !== "root.irpkg")),
  );
  await rejected(
    "undeclared member",
    (path) => (path === "program/bundle.json" ? missingMember : null),
    /outside verified inventory/,
    "program-validation",
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
    "program-manifest",
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
    "program-manifest",
  );
  assert.equal(requests.includes("/elsewhere"), false);
  const strict = await evaluate(cdp, `(async () => {
    const expectation = {'Vir.Resources.Test.prettyScore':
      {args: [], result: {type: 'String', interfaceTag: 3}, effect: 'pure'}};
    let phase;
    try { await openResourceProgram({expectedExports: expectation}); }
    catch (error) { phase = error.phase; }
    const controller = new AbortController(); controller.abort('preabort');
    let abort;
    try { await openResourceProgram({signal: controller.signal}); }
    catch (error) { abort = {name: error.name, cause: error.cause}; }
    return {phase, abort, instances: resourceInstances};
  })()`);
  assert.deepEqual(strict, {phase: "program-validation", abort: {name: "AbortError", cause: "preabort"}, instances: 0});
  outcomes.push("strict actual-ABI mismatch and preabort: zero Wasm creations PASS");
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
