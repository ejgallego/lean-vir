#!/usr/bin/env node

import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { finished } from "node:stream/promises";

function usage(write = console.error) {
  write(`usage: node scripts/quiet-run.mjs [--log PATH] [--tail LINES] -- COMMAND [ARG...]

Run a noisy command with stdout/stderr captured in a local log. Success prints
one summary line; failure prints the log location and its final lines.`);
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) return { help: true };
  const options = { log: null, tail: 40, command: [] };
  let index = 0;
  while (index < argv.length) {
    const argument = argv[index];
    if (argument === "--") {
      options.command = argv.slice(index + 1);
      break;
    }
    if (argument === "--log") {
      options.log = argv[index + 1];
      if (!options.log || options.log.startsWith("--")) {
        throw new Error("`--log` requires a path");
      }
      index += 2;
      continue;
    }
    if (argument === "--tail") {
      options.tail = Number(argv[index + 1]);
      if (!Number.isInteger(options.tail) || options.tail < 0) {
        throw new Error("`--tail` requires a non-negative integer");
      }
      index += 2;
      continue;
    }
    options.command = argv.slice(index);
    break;
  }
  if (options.command.length === 0) throw new Error("a command is required after `--`");
  return options;
}

function defaultLog(command) {
  const safeName = basename(command).replaceAll(/[^A-Za-z0-9_.-]/g, "_");
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return resolve("build", "logs", `${stamp}-${process.pid}-${safeName}.log`);
}

function displayPath(path) {
  const local = relative(process.cwd(), path);
  return local === "" || local.startsWith("..") ? path : local;
}

function tail(path, count) {
  if (count === 0) return "";
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  return lines.slice(-count).join("\n");
}

const started = performance.now();
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  usage();
  process.exit(2);
}

if (options.help) {
  usage(console.log);
} else {
  const logPath = resolve(options.log ?? defaultLog(options.command[0]));
  let child, log, escalation, cancelled, logError, spawnError;
  const grouped = process.platform !== "win32";
  function kill(signal) {
    if (!child?.pid) return;
    try {
      if (grouped) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (error) { if (error.code !== "ESRCH") console.error(`cleanup: ${error.message}`); }
  }
  function stop(signal) {
    kill(signal);
    // An npm/shell command can leave descendants holding the output pipes.
    escalation ??= setTimeout(() => kill("SIGKILL"), 1000);
  }
  const interrupt = signal => {
    cancelled ??= signal;
    stop(signal);
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    log = createWriteStream(logPath);
    // Never start a command unless its diagnostic log can actually be opened.
    await once(log, "open");
    const logDone = finished(log).catch(error => { logError = error; });
    log.on("error", error => { logError = error; stop("SIGTERM"); });
    const [command, ...args] = options.command;
    child = spawn(command, args, {
      detached: grouped, stdio: ["ignore", "pipe", "pipe"],
    });
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    child.on("error", error => { spawnError = error; });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    // Resolve close separately: events.once would reject early on spawn error.
    const [code, signal] = await new Promise(resolve => child.on("close", (...args) => resolve(args)));
    log.end();
    await logDone;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const commandLine = options.command.join(" ");
    if (code === 0 && !cancelled && !logError && !spawnError) {
      console.log(`ok: ${commandLine} (${seconds}s); log: ${displayPath(logPath)}`);
    } else {
      const status = logError ? `log error: ${logError.message}`
        : spawnError ? spawnError.message
        : cancelled || signal ? `signal ${cancelled ?? signal}` : `exit ${code ?? 1}`;
      console.error(`failed: ${commandLine} (${status}, ${seconds}s); log: ${displayPath(logPath)}`);
      if (!logError) {
        const output = tail(logPath, options.tail);
        if (output) console.error(`--- log tail ---\n${output}`);
      }
      process.exitCode = logError || spawnError ? 1
        : cancelled === "SIGINT" ? 130 : cancelled === "SIGTERM" ? 143
        : signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : code ?? 1;
    }
  } catch (error) {
    console.error(`failed: log ${displayPath(logPath)}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    // Keep escalation even if the direct child closed: an uncooperative
    // descendant may have closed its pipes but still belong to our group.
    if (!cancelled && !logError) clearTimeout(escalation);
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    log?.destroy();
  }
}
