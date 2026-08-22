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
  if ((result.status ?? 1) !== 0) {
    const detail = capture && result.stderr ? `\n${result.stderr.trim()}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${result.status ?? 1}${detail}`,
    );
  }
  return capture ? result.stdout.trim() : "";
}
