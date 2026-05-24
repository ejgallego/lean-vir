/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";

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
  return evaluate(cdp, `new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const status = document.querySelector("#status")?.textContent?.trim();
      if (status === "Ready") {
        resolve(status);
      } else if (Date.now() > deadline) {
        reject(new Error("page did not become Ready; last status: " + status));
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
  assert.equal(state.packageName, "vir-demo.irpkg");
  assert.equal(state.mood, "happy");
  assert.ok(state.links.includes("dev.html?package=local-fib.irpkg&entry=fib"));
  assert.ok(state.links.includes("dev.html?package=local-mergesort.irpkg&entry=SortDemo_demoFromArray"));
}

async function smokeRunner(cdp, origin, url, expected) {
  await navigate(cdp, `${origin}${basePath}${url}`);
  await waitForReady(cdp);
  const before = await evaluate(cdp, `({
    location: window.location.href,
    packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
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
  assert.equal(before.entry, expected.entry);
  if (expected.entryCount !== undefined) {
    assert.equal(before.entryCount, expected.entryCount);
  }
  if (expected.entryCountAtLeast !== undefined) {
    assert.ok(before.entryCount >= expected.entryCountAtLeast, `expected at least ${expected.entryCountAtLeast} entries, got ${before.entryCount}`);
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
}

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
  await smokeRunner(
    cdp,
    server.origin,
    "dev.html?package=local-fib.irpkg&entry=fib",
    {
      packageName: "local-fib.irpkg",
      entry: "fib",
      entryCount: 1,
      input: "0",
      runInput: "12",
      result: "144",
    },
  );
  await smokeRunner(
    cdp,
    server.origin,
    "dev.html?package=local-mergesort.irpkg&entry=SortDemo_demoFromArray",
    {
      packageName: "local-mergesort.irpkg",
      entry: "SortDemo_demoFromArray",
      entryCount: 2,
      input: "",
      runInput: "4, 1, 3, 2",
      result: "30",
    },
  );
  await smokeRunner(
    cdp,
    server.origin,
    "dev.html?package=vir-demo.irpkg&entry=Tamagotchi_step",
    {
      packageName: "vir-demo.irpkg",
      entry: "Tamagotchi_step",
      entryCountAtLeast: 6,
      inputs: ["happy", "feed"],
      inputTags: ["SELECT", "SELECT"],
      runInputs: ["happy", "ignore"],
      result: "hungry",
    },
  );
  await smokeRunner(
    cdp,
    server.origin,
    "dev.html?package=vir-demo.irpkg&entry=Vir_Fixtures_ExprPrinter_exprKindScore",
    {
      packageName: "vir-demo.irpkg",
      entry: "Vir_Fixtures_ExprPrinter_exprKindScore",
      entryCountAtLeast: 6,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"bvar","index":4}`],
      result: "5",
    },
  );
  await smokeRunner(
    cdp,
    server.origin,
    "dev.html?package=vir-demo.irpkg&entry=Vir_Fixtures_InterfaceShapes_arrayStringTotalLength",
    {
      packageName: "vir-demo.irpkg",
      entry: "Vir_Fixtures_InterfaceShapes_arrayStringTotalLength",
      entryCountAtLeast: 6,
      input: "[]",
      inputTags: ["TEXTAREA"],
      runInputs: [`["a","bc"]`],
      result: "3",
    },
  );

  cdp.close();
  console.log("pages browser smoke ok: landing, local runners, manifest enum runner, manifest Expr runner, and manifest JSON runner");
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
