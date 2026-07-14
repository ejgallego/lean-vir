/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";

import { generatedPublicFiles } from "./browser-package-config.mjs";
import { pathExists, requireChromiumExecutable } from "./file-utils.mjs";
import { readIrPackageFile } from "./irpkg-format.mjs";

export const distRoot = fileURLToPath(new URL("../web/dist/", import.meta.url));
export const basePath = "/lean-vir/";
export const requiredDistFiles = Object.freeze([
  "index.html",
  "dev.html",
  "format.html",
  "react.html",
  "runtime-example.html",
  ...generatedPublicFiles,
]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".irpkg", "application/octet-stream"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

export async function assertDistReady(root = distRoot) {
  const missing = [];
  for (const path of requiredDistFiles) {
    if (!(await pathExists(resolve(root, path)))) {
      missing.push(path);
    }
  }
  if (missing.length !== 0) {
    throw new Error(
      `web/dist is missing browser smoke artifacts (${missing.join(", ")}); run npm run build:site first`,
    );
  }
  await assertBrowserPackagesCompatible(
    root,
    generatedPublicFiles.filter((path) => path.endsWith(".irpkg")),
  );
}

async function assertBrowserPackagesCompatible(root, packageFiles) {
  const incompatible = [];
  for (const path of packageFiles) {
    try {
      await readIrPackageFile(resolve(root, path));
    } catch (error) {
      incompatible.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (incompatible.length !== 0) {
    throw new Error(
      `web/dist has incompatible browser smoke packages (${incompatible.join("; ")}); run npm run build:site first`,
    );
  }
}

export async function distAssetPath(prefix) {
  const files = await readdir(resolve(distRoot, "assets"));
  const file = files.find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".js"));
  assert.ok(file, `missing built asset matching ${prefix}*.js`);
  return `assets/${file}`;
}

export async function freePort() {
  const server = createNetServer();
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

export async function serveDist() {
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

export async function fetchJsonWithRetry(url, child) {
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

export async function openCdp(wsUrl) {
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

export async function launchChromium(debugPort) {
  const executable = await requireChromiumExecutable();
  const profileDir = await mkdtemp(`${tmpdir()}/lean-vir-chromium-`);
  const child = spawn(executable, [
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
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

export async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
}

export async function evaluate(cdp, expression) {
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

export async function waitForReady(cdp, selector = "#status") {
  return waitForStatus(cdp, "Ready", selector);
}

export async function waitForStatus(cdp, expected, selector = "#status") {
  return evaluate(cdp, `new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const poll = () => {
      const status = document.querySelector(${JSON.stringify(selector)})?.textContent?.trim();
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

function isInside(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}
