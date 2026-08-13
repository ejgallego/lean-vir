#!/usr/bin/env node

import { existsSync } from "node:fs";

import {
  inspectMailbox,
  mailboxProtocol,
  resolveMailbox,
  terminalStates,
} from "./mailbox-lib.mjs";

function usage() {
  console.error("usage: node scripts/mailbox.mjs <check|list> [--mailbox PATH] [--all] [--json]");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["check", "list"]).has(command)) throw new Error("expected `check` or `list`");
  const options = { command, all: false, json: false, mailbox: null };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--mailbox") {
      options.mailbox = rest[index + 1];
      if (!options.mailbox || options.mailbox.startsWith("--")) {
        throw new Error("`--mailbox` requires a path");
      }
      index += 1;
    } else throw new Error(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (command === "check" && (options.all || options.json)) {
    throw new Error("`--all` and `--json` are list options");
  }
  return options;
}

function printWarnings(result) {
  if (result.ignoredFiles.length > 0) {
    console.warn(`warning: ignored non-message file(s): ${result.ignoredFiles.join(", ")}`);
  }
}

function check(result) {
  printWarnings(result);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(`mailbox check failed with ${result.errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`mailbox ok: ${result.threads.length} v1 thread(s), ${result.messages.length} message(s)`);
}

function list(result, options) {
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error("mailbox list requires a valid mailbox; run mailbox:check");
    process.exitCode = 1;
    return;
  }
  const threads = result.threads.filter((thread) => options.all || !terminalStates.has(thread.state));
  if (options.json) {
    console.log(JSON.stringify({
      protocol: mailboxProtocol,
      mailbox: result.mailboxPath,
      ignoredFiles: result.ignoredFiles,
      threads,
    }, null, 2));
    return;
  }
  printWarnings(result);
  if (threads.length === 0) {
    console.log(options.all ? "no v1 mailbox threads" : "no active v1 mailbox threads");
    return;
  }
  for (const thread of threads) {
    const owner = thread.owner ? ` owner=${thread.owner}` : "";
    const disposition = thread.disposition ? ` disposition=${thread.disposition}` : "";
    console.log(`${thread.state.padEnd(11)} ${thread.threadId} ${thread.from} -> ${thread.to}${owner}${disposition}`);
    console.log(`  ${thread.subject} (${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"}, tail ${thread.tail})`);
    const lane = [
      ["worktree", thread.worktree],
      ["branch", thread.branch],
      ["base", thread.base],
      ["head", thread.head],
      ["worktree-state", thread.worktreeState],
      ["publication", thread.publication],
    ].filter(([, value]) => value).map(([name, value]) => `${name}=${value}`);
    if (lane.length > 0) console.log(`  lane: ${lane.join(" ")}`);
    if (thread.parentThread) console.log(`  parent: ${thread.parentThread}`);
    if (thread.dependsOn.length > 0) console.log(`  depends on: ${thread.dependsOn.join(", ")}`);
  }
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  usage();
  process.exit(2);
}

if (options) {
  try {
    const mailboxPath = resolveMailbox({ mailbox: options.mailbox });
    if (options.mailbox && !existsSync(mailboxPath)) {
      throw new Error(`mailbox does not exist: ${mailboxPath}`);
    }
    const result = inspectMailbox(mailboxPath);
    if (options.command === "check") check(result);
    else list(result, options);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
