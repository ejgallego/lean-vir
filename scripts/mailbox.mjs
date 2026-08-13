#!/usr/bin/env node

import { existsSync } from "node:fs";

import {
  archiveThread,
  deliverMessage,
  inspectArchive,
  inspectMailbox,
  mailboxProtocol,
  resolveMailbox,
} from "./mailbox-lib.mjs";

function usage(write = console.error) {
  write(`usage: node scripts/mailbox.mjs <check|list|deliver|archive> [THREAD-ID|DRAFT] [OPTIONS]

commands:
  check                  validate the active mailbox
  list                   list active threads
  deliver DRAFT          validate and publish a draft message
  archive THREAD-ID      archive a wholly terminal thread

options:
  --mailbox PATH         use an explicit mailbox
  --archive              inspect archived threads with check or list
  --all                  include terminal threads when listing
  --json                 emit JSON when listing
  -h, --help             show this help`);
}

function parseArgs(argv) {
  if (argv.includes("-h") || argv.includes("--help")) return { help: true };
  const [command, ...rest] = argv;
  if (!new Set(["check", "list", "archive", "deliver"]).has(command)) {
    throw new Error("expected `check`, `list`, `archive`, or `deliver`");
  }
  const options = {
    command,
    all: false,
    archive: false,
    json: false,
    mailbox: null,
    threadId: null,
    draft: null,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--all") options.all = true;
    else if (argument === "--archive") options.archive = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--mailbox") {
      options.mailbox = rest[index + 1];
      if (!options.mailbox || options.mailbox.startsWith("--")) {
        throw new Error("`--mailbox` requires a path");
      }
      index += 1;
    } else if (command === "archive" && !options.threadId) options.threadId = argument;
    else if (command === "deliver" && !options.draft) options.draft = argument;
    else throw new Error(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (command !== "list" && (options.all || options.json)) {
    throw new Error("`--all` and `--json` are list options");
  }
  if (!new Set(["check", "list"]).has(command) && options.archive) {
    throw new Error("`--archive` inspects the archive with check or list");
  }
  if (command === "archive" && !options.threadId) throw new Error("archive requires a thread ID");
  if (command === "deliver" && !options.draft) throw new Error("deliver requires a draft message path");
  return options;
}

function printWarnings(result) {
  if (result.ignoredFiles?.length > 0) {
    console.warn(`warning: ignored non-message file(s): ${result.ignoredFiles.join(", ")}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
}

function check(result, options) {
  printWarnings(result);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(`mailbox check failed with ${result.errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  const label = options.archive ? "mailbox archive" : "mailbox";
  console.log(`${label} ok: ${result.threads.length} v1 thread(s), ${result.messages.length} message(s)`);
}

function list(result, options) {
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(options.archive
      ? "archive list requires a valid archive; run mailbox:check -- --archive"
      : "mailbox list requires a valid mailbox; run mailbox:check");
    process.exitCode = 1;
    return;
  }
  const threads = result.threads.filter((thread) => options.archive || options.all || !thread.archivable);
  if (options.json) {
    console.log(JSON.stringify({
      protocol: mailboxProtocol,
      mailbox: options.archive ? result.archivePath : result.mailboxPath,
      ignoredFiles: result.ignoredFiles ?? [],
      warnings: result.warnings,
      threads,
    }, null, 2));
    return;
  }
  printWarnings(result);
  if (threads.length === 0) {
    console.log(options.archive ? "no archived v1 mailbox threads"
      : options.all ? "no v1 mailbox threads" : "no active v1 mailbox threads");
    return;
  }
  for (const thread of threads) {
    const owner = thread.owner ? ` owner=${thread.owner}` : "";
    const disposition = thread.disposition ? ` disposition=${thread.disposition}` : "";
    console.log(`${thread.state.padEnd(11)} ${thread.threadId} ${thread.from} -> ${thread.to}${owner}${disposition}`);
    const branches = thread.branchCount === 1 ? "" : `, ${thread.branchCount} branches`;
    console.log(`  ${thread.subject} (${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"}${branches}, latest ${thread.latest})`);
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

if (options?.help) {
  usage(console.log);
} else if (options) {
  try {
    const mailboxPath = resolveMailbox({ mailbox: options.mailbox });
    if (options.mailbox && !existsSync(mailboxPath)) {
      throw new Error(`mailbox does not exist: ${mailboxPath}`);
    }
    if (options.command === "archive") {
      const archived = archiveThread(mailboxPath, options.threadId);
      console.log(`archived ${archived.threadId}: ${archived.messageCount} message(s) -> ${archived.destination}`);
    } else if (options.command === "deliver") {
      const delivered = deliverMessage(mailboxPath, options.draft);
      for (const warning of delivered.warnings) console.warn(`warning: ${warning}`);
      console.log(`delivered ${delivered.messageId} -> ${delivered.destination}`);
    } else {
      const result = options.archive ? inspectArchive(mailboxPath) : inspectMailbox(mailboxPath);
      if (options.command === "check") check(result, options);
      else list(result, options);
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
