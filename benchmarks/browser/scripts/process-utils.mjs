import { spawnSync } from "node:child_process";

export function runSync(
  command,
  args,
  { cwd, env, capture = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const invocation = [command, ...args].join(" ");
  const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : "";
  if (result.error) {
    throw new Error(`${invocation} failed to start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.signal !== null) {
    throw new Error(
      `${invocation} terminated by signal ${result.signal}${detail}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${invocation} failed with status ${result.status}${detail}`,
    );
  }
  return capture ? result.stdout.trim() : "";
}
