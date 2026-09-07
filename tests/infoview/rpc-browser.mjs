/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  CancellationTokenSource,
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import {
  launchChromium,
  openChromiumPage,
  navigate,
  evaluate,
} from "../browser/harness.mjs";
import { prepareVirIrpkgSync } from "../../scripts/packages/irpkg-generator.mjs";

// Test-only transport. The official RpcSessions implementation lives in the
// browser; vscode-jsonrpc owns framing and cancellation over the real Lean LSP.
const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = join(root, "fixtures/infoview/RpcBrowserServer.lean");
const uri = pathToFileURL(sourcePath).href;
const source = await readFile(sourcePath, "utf8");
const position = (marker) => ({
  line: source.split("\n").findIndex((line) => line.includes(marker)) + 2,
  character: 2,
});
const temp = await mkdtemp(join(tmpdir(), "vir-rpc-browser-"));
let child, connection, server, chrome, cdp;
const keepalives = new Map();
const pending = new Map();
const cancelledIds = new Set();
const calls = [];
const diagnostics = [];
let stderr = "";
let deadline;
const timedOut = new Promise((_, reject) => {
  deadline = setTimeout(
    () => reject(new Error(`RPC browser acceptance timed out: ${stderr}`)),
    120000,
  );
});
// Attach a handler while synchronous artifact preparation runs.
timedOut.catch(() => {});

try {
  const packagePath = join(temp, "rpc.irpkg");
  const generator = prepareVirIrpkgSync(root, { lakeTargets: ["VirInfoview"] });
  assert.equal(
    generator.ok,
    true,
    "RPC fixture requires the current generator and infoview imports",
  );
  const generated = spawnSync(
    generator.path,
    [
      packagePath,
      join(temp, "rpc.report.md"),
      "--target",
      "examples/RpcReferenceWidget.lean",
      ...[
        "request",
        "reference",
        "readReference",
        "message",
        "View",
        "render",
      ].map((n) => `RpcReferenceWidget.${n}`),
    ],
    { cwd: root, env: generator.env, encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const [irPackage, wasm, bundle] = await Promise.all([
    readFile(packagePath),
    readFile(join(root, "web/public/vir-upstream.wasm")),
    build({
      entryPoints: [join(root, "tests/infoview/rpc-browser-entry.js")],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "chrome120",
      write: false,
      define: { "process.env.NODE_ENV": '"development"' },
    }),
  ]);
  child = spawn("lake", ["serve", "--", "-DstderrAsMessages=false"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.onNotification("textDocument/publishDiagnostics", (value) => {
    diagnostics.push(value);
  });
  connection.listen();
  const initialized = await Promise.race([
    connection.sendRequest("initialize", {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: { lean: { rpcWireFormat: "v1" } },
      initializationOptions: { hasWidgets: true },
    }),
    timedOut,
  ]);
  await connection.sendNotification("initialized", {});
  await connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "lean", version: 1, text: source },
  });
  await Promise.race([
    connection.sendRequest("textDocument/waitForDiagnostics", {
      uri,
      version: 1,
    }),
    timedOut,
  ]);
  const config = {
    uri,
    capabilities: initialized.capabilities,
    a: position("rpc-position-a"),
    b: position("rpc-position-b"),
  };
  const assets = new Map([
    [
      "/",
      [
        "text/html",
        '<!doctype html><div id="app"></div><script src="/probe.js"></script>',
      ],
    ],
    ["/probe.js", ["text/javascript", bundle.outputFiles[0].contents]],
    ["/runtime.wasm", ["application/wasm", wasm]],
    ["/rpc.irpkg", ["application/octet-stream", irPackage]],
    ["/config", ["application/json", JSON.stringify(config)]],
  ]);
  server = createServer(async (req, res) => {
    try {
      const asset = assets.get(req.url);
      if (req.method === "GET" && asset) {
        res.writeHead(200, { "content-type": asset[0] });
        res.end(asset[1]);
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      let result;
      if (req.url === "/connect") {
        result = await connection.sendRequest("$/lean/rpc/connect", { uri });
        const { sessionId } = result;
        keepalives.set(
          sessionId,
          setInterval(
            () =>
              connection.sendNotification("$/lean/rpc/keepAlive", {
                uri,
                sessionId,
              }),
            5000,
          ),
        );
      } else if (req.url === "/close") {
        clearInterval(keepalives.get(body.sessionId));
        keepalives.delete(body.sessionId);
      } else if (req.url === "/release") {
        await connection.sendNotification("$/lean/rpc/release", body);
      } else if (req.url === "/cancel") {
        if (pending.has(body.id)) pending.get(body.id).cancel();
        else cancelledIds.add(body.id);
      } else if (req.url === "/call") {
        const token = new CancellationTokenSource();
        pending.set(body.id, token);
        if (cancelledIds.delete(body.id)) token.cancel();
        calls.push(body.params);
        try {
          result = await connection.sendRequest(
            "$/lean/rpc/call",
            body.params,
            token.token,
          );
        } finally {
          pending.delete(body.id);
          token.dispose();
        }
      } else {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { code: error.code, message: error.message } }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  chrome = await launchChromium();
  cdp = await openChromiumPage(chrome);
  await Promise.race([
    navigate(cdp, `http://127.0.0.1:${server.address().port}/`),
    timedOut,
  ]);
  const result = await Promise.race([
    evaluate(cdp, "globalThis.rpcAcceptance"),
    timedOut,
  ]);
  assert.equal(
    result.ok,
    true,
    JSON.stringify({ result, diagnostics, stderr }, null, 2),
  );
  assert.ok(calls.some((call) => call.position.line === config.a.line));
  assert.ok(calls.some((call) => call.position.line === config.b.line));
  assert.ok(
    !diagnostics.some((report) =>
      report.diagnostics.some((d) => d.severity === 1),
    ),
    JSON.stringify(diagnostics),
  );
  console.log("real infoview RPC browser acceptance ok", result.value);
} finally {
  clearTimeout(deadline);
  for (const interval of keepalives.values()) clearInterval(interval);
  for (const token of pending.values()) token.cancel();
  cdp?.close();
  await chrome?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (connection && child?.exitCode === null) {
    try {
      await connection.sendNotification("textDocument/didClose", {
        textDocument: { uri },
      });
      await Promise.race([
        connection.sendRequest("shutdown"),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      await connection.sendNotification("exit");
    } catch {
      /* A failed server may already have closed its pipe. */
    }
  }
  child?.stdin.end();
  if (child && child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  connection?.dispose();
  await rm(temp, { recursive: true, force: true });
}
