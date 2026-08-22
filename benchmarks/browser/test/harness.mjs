import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";

import { appRoot } from "../scripts/package-root.mjs";
export { launchBenchmarkBrowser } from "../scripts/browser-utils.mjs";

export async function startBenchmarkServer({
  port,
  directory = null,
  isolation = true,
  label = "benchmark server",
}) {
  const origin = `http://127.0.0.1:${port}`;
  const args = [join(appRoot, "scripts/serve.mjs"), "--port", String(port)];
  if (directory !== null) args.push("--directory", directory);
  if (!isolation) args.push("--no-isolation");
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child, origin, label);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    origin,
    close: () => stopChild(child),
  };
}

export function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

async function waitForServer(child, origin, label) {
  let startupOutput = "";
  await new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const onStdout = (chunk) => {
      startupOutput += chunk;
      if (startupOutput.includes(`at ${origin}`)) finish(resolveReady);
    };
    const onStderr = (chunk) => {
      startupOutput += chunk;
    };
    const onError = (error) =>
      finish(() => rejectReady(
        new Error(`${label} failed to start: ${error.message}`, { cause: error }),
      ));
    const onExit = (code, signal) =>
      finish(() => rejectReady(
        new Error(
          `${label} exited with ${code ?? signal} before readiness\n${startupOutput}`,
        ),
      ));
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const timeout = setTimeout(
      () => finish(() => rejectReady(
        new Error(`${label} did not announce readiness\n${startupOutput}`),
      )),
      5_000,
    );
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${label} exited with ${child.exitCode ?? child.signalCode}`,
      );
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw lastError ?? new Error(`${label} did not become ready`);
}

async function stopChild(child) {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
