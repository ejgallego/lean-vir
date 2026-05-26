/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";

import { encodeInvalidMagicPackage, readIrPackageInfo, replaceIrPackageManifest } from "./irpkg-format.mjs";

const distRoot = fileURLToPath(new URL("../web/dist/", import.meta.url));
const basePath = "/lean-vir/";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".irpkg", "application/octet-stream"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

function isInside(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function serveDist() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      response.writeHead(302, { location: basePath });
      response.end();
      return;
    }
    if (!url.pathname.startsWith(basePath)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const relativePath = decodeURIComponent(url.pathname.slice(basePath.length)) || "index.html";
    const filePath = resolve(distRoot, relativePath);
    if (!isInside(resolve(distRoot), filePath)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new Error(`${filePath} is not a file`);
      }
      response.writeHead(200, {
        "content-length": String(info.size),
        "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end(`not found: ${basename(filePath)}`);
    }
  });

  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function chromiumPath() {
  return process.env.CHROMIUM ?? "/snap/bin/chromium";
}

async function fetchJsonWithRetry(url, child) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Chromium exited before DevTools became available`);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw lastError ?? new Error(`DevTools endpoint did not become available: ${url}`);
}

async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();

  ws.addEventListener("message", async (event) => {
    const text = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(text);
    if (message.id && pending.has(message.id)) {
      const { resolveMessage, rejectMessage } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        rejectMessage(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
      } else {
        resolveMessage(message.result);
      }
      return;
    }

    const waiters = eventWaiters.get(message.method);
    if (waiters?.length) {
      waiters.shift()(message.params);
    }
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolveMessage, rejectMessage) => {
      pending.set(id, { resolveMessage, rejectMessage });
      ws.send(payload);
    });
  }

  function waitFor(method) {
    return new Promise((resolveEvent) => {
      const waiters = eventWaiters.get(method) ?? [];
      waiters.push(resolveEvent);
      eventWaiters.set(method, waiters);
    });
  }

  return {
    send,
    waitFor,
    close: () => ws.close(),
  };
}

async function launchChromium(debugPort) {
  const profileDir = await mkdtemp(`${tmpdir()}/lean-vir-chromium-`);
  const child = spawn(chromiumPath(), [
    "--headless=new",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-sandbox",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });

  return {
    child,
    profileDir,
    stderr: () => stderr,
    close: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
        child.kill("SIGTERM");
        await exited;
      }
      await rm(profileDir, { recursive: true, force: true });
    },
  };
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitForReady(cdp) {
  return waitForStatus(cdp, "Ready");
}

async function waitForStatus(cdp, expected) {
  return evaluate(cdp, `new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const status = document.querySelector("#status")?.textContent?.trim();
      if (status === ${JSON.stringify(expected)}) {
        resolve(status);
      } else if (Date.now() > deadline) {
        reject(new Error("page did not become ${expected}; last status: " + status));
      } else {
        setTimeout(poll, 100);
      }
    };
    poll();
  })`);
}

async function smokeLanding(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}`);
  await waitForReady(cdp);
  const state = await evaluate(cdp, `({
    packageName: document.querySelector("#package-name")?.textContent?.trim(),
    links: Array.from(document.querySelectorAll(".pipeline-item")).map((link) => link.getAttribute("href")),
    mood: document.querySelector("#pet-mood-display")?.textContent?.trim()
  })`);
  assert.equal(
    state.packageName,
    "fixtures-basic.irpkg, demo-host.irpkg, fixtures-lean.irpkg, fixtures-boundary.irpkg",
  );
  assert.equal(state.mood, "happy");
  assert.ok(state.links.includes("dev.html?package=local-fib.irpkg&entry=fib"));
  assert.ok(state.links.includes("dev.html?package=local-mergesort.irpkg&entry=SortDemo_demoFromArray"));
  assert.ok(state.links.includes("dev.html?package=demo-host.irpkg&entry=HostInterop_titleHandshake"));
  assert.ok(state.links.includes("dev.html?package=fixtures-basic.irpkg&entry=Vir_Fixtures_InterfaceShapes_profileStatsBump"));

  const stepped = await evaluate(cdp, `new Promise((resolve, reject) => {
    document.querySelector("[data-action='ignore']").click();
    const deadline = Date.now() + 5000;
    const poll = () => {
      const state = {
        mood: document.querySelector("#pet-mood-display")?.textContent?.trim(),
        action: document.querySelector("#pet-action-display")?.textContent?.trim(),
        trace: document.querySelector("#pet-trace-display")?.textContent?.trim(),
        deviceMood: document.querySelector("#pet-device")?.dataset.mood,
        deviceTrace: document.querySelector("#pet-device")?.dataset.trace,
        status: document.querySelector("#status")?.textContent?.trim()
      };
      if (state.mood === "hungry") {
        resolve(state);
      } else if (Date.now() > deadline) {
        reject(new Error("Lean Tamagotchi step did not update the page"));
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  })`);
  assert.deepEqual(stepped, {
    mood: "hungry",
    action: "ignore",
    trace: "happy -> hungry",
    deviceMood: "hungry",
    deviceTrace: "happy,hungry",
    status: "Ready",
  });
}

async function smokeRunner(cdp, origin, url, expected) {
  await navigate(cdp, `${origin}${basePath}${url}`);
  await waitForReady(cdp);
  const before = await evaluate(cdp, `({
    location: window.location.href,
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    exports: document.querySelector("#dev-export-count")?.textContent?.trim(),
    sourceTargets: document.querySelector("#dev-source-targets")?.textContent?.trim(),
    toolchain: document.querySelector("#dev-toolchain")?.textContent?.trim(),
    generatedAt: document.querySelector("#dev-generated-at")?.textContent?.trim(),
    entry: document.querySelector("#dev-entry-select")?.value,
    entryCount: document.querySelector("#dev-entry-select")?.options.length,
    input: document.querySelector("[data-input-index='0']")?.value,
    inputs: Array.from(document.querySelectorAll("[data-input-index]")).map((field) => ({
      value: field.value,
      tagName: field.tagName
    }))
  })`);
  assert.ok(before.location.endsWith(url), `unexpected runner URL: ${before.location}`);
  assert.equal(before.packageName, expected.packageName);
  assert.ok(/^\d+$/.test(before.exports), `expected export count, got ${before.exports}`);
  assert.notEqual(before.sourceTargets, "...");
  assert.match(before.toolchain, /leanprover\/lean4/);
  assert.notEqual(before.generatedAt, "...");
  assert.equal(before.entry, expected.entry);
  if (expected.entryCount !== undefined) {
    assert.equal(before.entryCount, expected.entryCount);
  }
  if (expected.input !== undefined) {
    assert.equal(before.input, expected.input);
  }
  if (expected.inputs !== undefined) {
    assert.deepEqual(before.inputs.map((input) => input.value).slice(0, expected.inputs.length), expected.inputs);
  }
  if (expected.inputTags !== undefined) {
    assert.deepEqual(before.inputs.map((input) => input.tagName).slice(0, expected.inputTags.length), expected.inputTags);
  }

  const runInputs = expected.runInputs ?? (expected.runInput === undefined ? null : [expected.runInput]);
  const result = await evaluate(cdp, `new Promise((resolve, reject) => {
    const output = document.querySelector("#dev-result");
    const runInputs = ${JSON.stringify(runInputs)};
    if (runInputs !== null) {
      for (const [index, value] of runInputs.entries()) {
        document.querySelector("[data-input-index='" + index + "']").value = value;
      }
    }
    output.textContent = "pending";
    document.querySelector("#dev-run-entry").click();
    const deadline = Date.now() + 5000;
    const poll = () => {
      const text = output.textContent.trim();
      if (text !== "pending" && text !== "...") {
        resolve(text);
      } else if (Date.now() > deadline) {
        reject(new Error("runner did not produce a result"));
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  })`);
  assert.equal(result, expected.result);
  if (expected.documentTitle !== undefined) {
    const title = await evaluate(cdp, "document.title");
    assert.equal(title, expected.documentTitle);
  }
}

async function smokeRunnerFailure(cdp, origin, url, expected) {
  await navigate(cdp, `${origin}${basePath}${url}`);
  await waitForStatus(cdp, "Failed");
  const state = await evaluate(cdp, `({
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    status: document.querySelector("#status")?.textContent?.trim(),
    result: document.querySelector("#dev-result")?.textContent?.trim(),
    entryCount: document.querySelector("#dev-entry-select")?.options.length,
    runDisabled: document.querySelector("#dev-run-entry")?.disabled,
    exports: document.querySelector("#dev-export-count")?.textContent?.trim()
  })`);
  assert.equal(state.status, "Failed");
  assert.match(state.result, expected.result);
  assert.equal(state.runDisabled, true);
  if (expected.packageName !== undefined) {
    assert.equal(state.packageName, expected.packageName);
  }
  if (expected.entryCount !== undefined) {
    assert.equal(state.entryCount, expected.entryCount);
  }
  if (expected.exports !== undefined) {
    assert.equal(state.exports, expected.exports);
  }
}

function expectedInputTag(type) {
  if (type?.wireTag === 14) return "SELECT";
  if ([15, 16, 17, 18, 19, 20, 21].includes(type?.wireTag)) return "TEXTAREA";
  return "INPUT";
}

async function smokeManifestDrivenEntryList(cdp, origin, packageFile) {
  const info = await packageInfoFor(packageFile);
  await navigate(cdp, `${origin}${basePath}dev.html?package=${encodeURIComponent(packageFile)}`);
  await waitForReady(cdp);
  const state = await evaluate(cdp, `(() => {
    const select = document.querySelector("#dev-entry-select");
    return {
      options: Array.from(select.options).map((option) => ({
        value: option.value,
        text: option.textContent,
      })),
      packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    };
  })()`);
  assert.equal(state.packageName, packageFile);
  assert.deepEqual(
    state.options.map((option) => option.value),
    info.manifest.exports.map((entry) => entry.id),
  );
  for (const [index, entry] of info.manifest.exports.entries()) {
    assert.ok(state.options[index].text.includes(entry.jsName), `missing ${entry.jsName} in option label`);
  }

  const expectedControls = info.manifest.exports.map((entry) => ({
    id: entry.id,
    inputTags: entry.args.map((arg) => expectedInputTag(arg.type)),
    enumOptionCounts: entry.args.map((arg) =>
      arg.type?.wireTag === 14 ? (arg.type.constructors ?? []).length : null),
  }));
  const renderedControls = await evaluate(cdp, `(() => {
    const select = document.querySelector("#dev-entry-select");
    return ${JSON.stringify(expectedControls)}.map((expected) => {
      select.value = expected.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return {
        id: select.value,
        inputTags: Array.from(document.querySelectorAll("[data-input-index]")).map((field) => field.tagName),
        enumOptionCounts: Array.from(document.querySelectorAll("[data-input-index]")).map((field) =>
          field.tagName === "SELECT" ? field.options.length : null),
      };
    });
  })()`);
  assert.deepEqual(renderedControls, expectedControls);
}

async function prepareNegativePackages() {
  await writeFile(resolve(distRoot, "bad-magic.irpkg"), encodeInvalidMagicPackage());

  const fibBytes = await readFile(resolve(distRoot, "local-fib.irpkg"));
  const fibInfo = readIrPackageInfo(fibBytes);
  const manifest = {
    ...fibInfo.manifest,
    diagnostics: [
      ...(Array.isArray(fibInfo.manifest.diagnostics) ? fibInfo.manifest.diagnostics : []),
      {
        name: "BrowserSmoke.unsupported",
        source: "scripts/smoke-pages-browser.mjs",
        reason: "unsupported interface export smoke fixture",
      },
    ],
  };
  await writeFile(
    resolve(distRoot, "unsupported-interface.irpkg"),
    replaceIrPackageManifest(fibBytes, manifest),
  );
}

const packageInfoCache = new Map();

async function packageInfoFor(packageFile) {
  if (!packageInfoCache.has(packageFile)) {
    packageInfoCache.set(packageFile, readIrPackageInfo(await readFile(resolve(distRoot, packageFile))));
  }
  return packageInfoCache.get(packageFile);
}

async function runnerCaseFromManifest(packageFile, entryName, expected) {
  const info = await packageInfoFor(packageFile);
  const entry = info.manifest.exports.find((candidate) =>
    candidate.entry === entryName || candidate.id === entryName || candidate.jsName === entryName);
  assert.ok(entry, `${packageFile} manifest does not export ${entryName}`);
  return {
    url: `dev.html?package=${encodeURIComponent(packageFile)}&entry=${encodeURIComponent(entry.id)}`,
    expected: {
      packageName: packageFile,
      entry: entry.id,
      entryCount: info.manifest.exports.length,
      ...expected,
    },
  };
}

await prepareNegativePackages();

const server = await serveDist();
const debugPort = await freePort();
const chromium = await launchChromium(debugPort);

try {
  const targets = await fetchJsonWithRetry(`http://127.0.0.1:${debugPort}/json/list`, chromium.child);
  const pageTarget = targets.find((target) => target.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chromium did not expose a page DevTools target");
  const cdp = await openCdp(pageTarget.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  await smokeLanding(cdp, server.origin);
  await smokeManifestDrivenEntryList(cdp, server.origin, "fixtures-basic.irpkg");
  await smokeManifestDrivenEntryList(cdp, server.origin, "demo-host.irpkg");
  await smokeManifestDrivenEntryList(cdp, server.origin, "fixtures-lean.irpkg");
  await smokeManifestDrivenEntryList(cdp, server.origin, "fixtures-boundary.irpkg");
  const runnerCases = [
    await runnerCaseFromManifest("local-fib.irpkg", "fib", {
      entryCount: 1,
      input: "0",
      runInput: "12",
      result: "144",
    }),
    await runnerCaseFromManifest("local-mergesort.irpkg", "SortDemo.demoFromArray", {
      entryCount: 2,
      input: "[]",
      runInput: "[4, 1, 3, 2]",
      result: "30",
    }),
    await runnerCaseFromManifest("demo-host.irpkg", "HostInterop.titleHandshake", {
      input: "",
      runInput: "pages smoke",
      result: "Lean VIR host: pages smoke",
      documentTitle: "Lean VIR host: pages smoke",
    }),
    await runnerCaseFromManifest("demo-host.irpkg", "Tamagotchi.uiStep", {
      inputTags: ["SELECT", "TEXTAREA", "INPUT", "SELECT"],
      runInputs: ["happy", `["happy"]`, "pet", "ignore"],
      result: `{
  "mood": "hungry",
  "trace": [
    "happy",
    "hungry"
  ],
  "artwork": "pet"
}`,
    }),
    await runnerCaseFromManifest("fixtures-lean.irpkg", "Vir.Fixtures.ExprPrinter.exprKindScore", {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"bvar","index":4}`],
      result: "5",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", {
      input: "[]",
      inputTags: ["TEXTAREA"],
      runInputs: [`["a","bc"]`],
      result: "3",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.ListOption.classifySum", {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["4"],
      result: `{
  "kind": "inr",
  "value": "4"
}`,
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.ListOption.sumScore", {
      input: `{"kind":"inl","value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"inr","value":7}`],
      result: "70",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.uint32Bump", {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["41"],
      result: "42",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.uint64Bump", {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["18446744073709551615"],
      result: "0",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.floatScale", {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["1.5"],
      result: "6",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.float32Roundtrip", {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["1.25"],
      result: "1.25",
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.profileStatsBump", {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"enabled":true,"level":2,"score16":30,"visits":400,"quota":5,"checksum":6000,"tier":"pro","note":"ok"}`],
      result: `{
  "enabled": false,
  "level": 3,
  "score16": 32,
  "visits": 403,
  "quota": "9",
  "checksum": "6005",
  "tier": "elite",
  "note": "ok!"
}`,
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.boxNatBump", {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": "42"
}`,
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.boxUInt32Bump", {
      input: `{"value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": 42
}`,
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.uint32BoxBump", {
      input: `{"value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": 42
}`,
    }),
    await runnerCaseFromManifest("fixtures-basic.irpkg", "Vir.Fixtures.InterfaceShapes.extendedProfileBump", {
      input: `{"nickname":"","active":false,"visits":0,"score":0,"tags":[]}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"nickname":"lean","active":true,"visits":5,"score":7,"tags":["ir"]}`],
      result: `{
  "nickname": "lean!",
  "active": false,
  "visits": 6,
  "score": "8",
  "tags": [
    "ir",
    "extended"
  ]
}`,
    }),
    await runnerCaseFromManifest("fixtures-boundary.irpkg", "Vir.Fixtures.Boundary.floatScaleScore", {
      result: "6",
    }),
  ];

  for (const { url, expected } of runnerCases) {
    await smokeRunner(cdp, server.origin, url, expected);
  }
  await smokeRunnerFailure(
    cdp,
    server.origin,
    "dev.html?package=bad-magic.irpkg",
    {
      packageName: "...",
      entryCount: 0,
      exports: "...",
      result: /IR package load failed: invalid IR package magic `not-lean-vir`/,
    },
  );
  await smokeRunnerFailure(
    cdp,
    server.origin,
    "dev.html?package=unsupported-interface.irpkg",
    {
      packageName: "unsupported-interface.irpkg",
      entryCount: 0,
      result: /package contains unsupported interface exports:[\s\S]*BrowserSmoke\.unsupported/,
    },
  );

  cdp.close();
  console.log("pages browser smoke ok: landing, manifest-driven entry list, local runners, host-call runner, manifest enum runner, manifest Expr runner, manifest JSON runner, and failure paths");
} catch (error) {
  const details = chromium.stderr();
  if (details) {
    console.error(details);
  }
  throw error;
} finally {
  await chromium.close();
  await server.close();
}
