/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { fixturePosition, withCleanup } from "./rpc-test-support.js";
import { finishLeanProcess } from "./rpc-process-test-support.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Gate a genuine server outcome, including rejection, without replacing it.
// Cancellation after settlement cannot retract that already-completed outcome.
export async function awaitRpcOutcome(request, gate) {
  try {
    return await request;
  } finally {
    if (gate) {
      gate.ready = true;
      await gate.promise;
    }
  }
}

// Test-only transport shared by the RPC boundary and shell-lifetime probes.
// Official RpcSessions lives in each browser entry; vscode-jsonrpc owns framing.
// Asset/package preparation and success reporting stay with the calling script.
export async function runRpcBrowserAcceptance({
  sourcePath = join(root, "fixtures/infoview/RpcBrowserServer.lean"),
  assets,
  resultExpression = "globalThis.rpcAcceptance",
  label = "RPC browser acceptance",
}) {
  const uri = pathToFileURL(sourcePath).href;
  const source = await readFile(sourcePath, "utf8");
  const positions = {
    a: fixturePosition(source, "rpc-position-a"),
    b: fixturePosition(source, "rpc-position-b"),
  };
  let child, connection, server, chrome, cdp;
  const keepalives = new Map();
  const pending = new Map();
  const cancelledIds = new Set();
  const gates = new Map();
  const calls = [];
  const diagnostics = [];
  let documentVersion = 1;
  let stderr = "";
  let deadline;

  return withCleanup(async () => {
    // Builds use their existing preparation policy. The acceptance deadline starts
    // only once the package, Wasm and browser bundle are ready.
    const timedOut = new Promise((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error(`${label} timed out: ${stderr}`)),
        120000,
      );
    });
    void timedOut.catch(() => {});
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
      ...positions,
    };
    const servedAssets = new Map([
      [
        "/",
        [
          "text/html",
          '<!doctype html><div id="app"></div><script src="/probe.js"></script>',
        ],
      ],
      ...assets,
      ["/config", ["application/json", JSON.stringify(config)]],
    ]);
    server = createServer(async (req, res) => {
      try {
        const asset = servedAssets.get(req.url);
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
        } else if (req.url === "/started") {
          result = calls.some((call) => call.params?.message === body.message);
        } else if (req.url === "/gate") {
          if (body.action === "arm") {
            assert.ok(!gates.has(body.message), "duplicate response gate");
            gates.set(body.message, {
              ...Promise.withResolvers(),
              ready: false,
            });
          }
          const gate = gates.get(body.message);
          assert.ok(gate, "unknown response gate");
          if (body.action === "open") gate.resolve();
          result = gate.ready;
        } else if (req.url === "/edit") {
          const params = {
            textDocument: { uri, version: ++documentVersion },
            contentChanges: [{ text: `${source}\n-- browser edit ${documentVersion}\n` }],
          };
          await connection.sendNotification("textDocument/didChange", params);
          await connection.sendRequest("textDocument/waitForDiagnostics", {
            uri, version: documentVersion,
          });
          result = params;
        } else if (req.url === "/call") {
          const token = new CancellationTokenSource();
          pending.set(body.id, token);
          if (cancelledIds.delete(body.id)) token.cancel();
          calls.push(body.params);
          try {
            result = await awaitRpcOutcome(
              connection.sendRequest(
                "$/lean/rpc/call",
                body.params,
                token.token,
              ),
              gates.get(body.params.params?.message),
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
          JSON.stringify({
            error: { code: error.code, message: error.message },
          }),
        );
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    chrome = await launchChromium();
    cdp = await openChromiumPage(chrome);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.__virRpcBrowserErrors = [];
        addEventListener("error", event => __virRpcBrowserErrors.push(event.message));
        addEventListener("unhandledrejection", event =>
          __virRpcBrowserErrors.push(String(event.reason?.stack ?? event.reason)));
      `,
    });
    await Promise.race([
      navigate(cdp, `http://127.0.0.1:${server.address().port}/`),
      timedOut,
    ]);
    const result = await Promise.race([
      evaluate(cdp, resultExpression),
      timedOut,
    ]);
    assert.equal(
      result.ok,
      true,
      JSON.stringify({ result, diagnostics, stderr }, null, 2),
    );
    assert.deepEqual(
      await Promise.race([
        evaluate(cdp, "globalThis.__virRpcBrowserErrors"),
        timedOut,
      ]),
      [],
      `${label}: uncaught browser errors`,
    );
    assert.ok(calls.some((call) => call.position.line === config.a.line));
    assert.ok(calls.some((call) => call.position.line === config.b.line));
    assert.ok(
      !diagnostics.some((report) =>
        report.diagnostics.some((d) => d.severity === 1),
      ),
      JSON.stringify(diagnostics),
    );
    return result.value;
  }, [
    ["deadline", () => clearTimeout(deadline)],
    [
      "keepalives",
      () => {
        for (const interval of keepalives.values()) clearInterval(interval);
      },
    ],
    [
      "pending RPC",
      () =>
        withCleanup(
          async () => {},
          Array.from(pending.values(), (token) => [
            "cancel",
            () => token.cancel(),
          ]),
        ),
    ],
    [
      "response gates",
      () => {
        for (const gate of gates.values()) gate.resolve();
      },
    ],
    ["CDP", () => cdp?.close()],
    ["Chromium", () => chrome?.close()],
    [
      "HTTP server",
      async () => {
        if (server) {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      },
    ],
    [
      "Lean shutdown",
      async () => {
        if (
          connection &&
          child?.exitCode === null &&
          child.signalCode === null
        ) {
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
      },
    ],
    ["Lean stdin", () => child?.stdin.end()],
    ["Lean process", () => finishLeanProcess(child)],
    ["LSP connection", () => connection?.dispose()],
  ]);
}
