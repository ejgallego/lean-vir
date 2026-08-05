/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
const chromiumDevToolsTimeoutMs = 30000;
const chromiumShutdownTimeoutMs = 5000;

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

export async function fetchJsonWithRetry(url, child, acceptJson = () => true) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childHasExited(child)) {
      throw new Error(`Chromium exited before DevTools became available`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        const json = await response.json();
        if (acceptJson(json)) {
          return json;
        }
        lastError = new Error(`${url}: response is not ready`);
      } else {
        lastError = new Error(`${url}: HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
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

function childHasExited(child) {
  return child.pid === undefined || child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) return true;
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (childHasExited(child)) finish(true);
  });
}

function chromiumError(message, stderr, cause = null) {
  const details = stderr().trim();
  const error = new Error(details === "" ? message : `${message}\nChromium stderr:\n${details}`);
  if (cause !== null) error.cause = cause;
  return error;
}

async function waitForDevToolsPort(profileDir, child, launchError, stderr) {
  const activePortPath = resolve(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + chromiumDevToolsTimeoutMs;
  let lastReadError = null;
  while (Date.now() < deadline) {
    if (launchError() !== null) {
      throw chromiumError("Chromium failed to start", stderr, launchError());
    }
    if (childHasExited(child)) {
      throw chromiumError(
        `Chromium exited before DevTools became available (exit=${child.exitCode}, signal=${child.signalCode})`,
        stderr,
      );
    }
    try {
      const [portText = ""] = (await readFile(activePortPath, "utf8")).split(/\r?\n/, 1);
      if (/^[0-9]+$/.test(portText)) {
        const port = Number(portText);
        if (port > 0 && port <= 65535) return port;
      }
      lastReadError = new Error(`invalid DevTools port ${JSON.stringify(portText)}`);
    } catch (error) {
      if (error?.code !== "ENOENT") lastReadError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const suffix = lastReadError === null ? "" : `: ${lastReadError.message}`;
  throw chromiumError(
    `Chromium did not publish a DevTools port within ${chromiumDevToolsTimeoutMs}ms${suffix}`,
    stderr,
  );
}

export async function launchChromium() {
  const executable = await requireChromiumExecutable();
  const profileDir = await mkdtemp(`${tmpdir()}/lean-vir-chromium-`);
  const child = spawn(executable, [
    "--headless=new",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-sandbox",
    // Let Chromium reserve and publish its port instead of racing another process for a probed port.
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  let launchError = null;
  child.once("error", (error) => {
    launchError = error;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4000);
  });

  let closePromise = null;
  const close = () => {
    closePromise ??= (async () => {
      if (!childHasExited(child)) {
        child.kill("SIGTERM");
        if (!(await waitForChildExit(child, chromiumShutdownTimeoutMs))) {
          child.kill("SIGKILL");
          if (!(await waitForChildExit(child, chromiumShutdownTimeoutMs))) {
            child.stderr.destroy();
            child.unref();
          }
        }
      }
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    })();
    return closePromise;
  };

  const handle = {
    child,
    profileDir,
    stderr: () => stderr,
    close,
  };
  try {
    handle.debugPort = await waitForDevToolsPort(
      profileDir,
      child,
      () => launchError,
      handle.stderr,
    );
    return handle;
  } catch (error) {
    await close();
    throw error;
  }
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
