import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export { launchBenchmarkBrowser } from "../scripts/browser-utils.mjs";

export const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function startBenchmarkServer({
  root = appRoot,
  port,
  directory = null,
  isolation = true,
  label = "benchmark server",
}) {
  const origin = `http://127.0.0.1:${port}`;
  const args = [join(root, "scripts/serve.mjs"), "--port", String(port)];
  if (directory !== null) args.push("--directory", directory);
  if (!isolation) args.push("--no-isolation");
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child, origin, label);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return {
    child,
    origin,
    close: () => child.kill("SIGTERM"),
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
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(
      () => finish(() => rejectReady(
        new Error(`${label} did not announce readiness\n${startupOutput}`),
      )),
      5_000,
    );
    child.stdout.on("data", (chunk) => {
      startupOutput += chunk;
      if (startupOutput.includes(`at ${origin}`)) finish(resolveReady);
    });
    child.stderr.on("data", (chunk) => {
      startupOutput += chunk;
    });
    child.once("exit", (code) =>
      finish(() => rejectReady(
        new Error(`${label} exited with ${code} before readiness\n${startupOutput}`),
      )),
    );
  });

  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited with ${child.exitCode}`);
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
