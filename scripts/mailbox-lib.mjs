import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";

export const mailboxProtocol = "agent-mailbox/v1";
const messageIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const addressPattern = /^[a-z][a-z0-9-]*\/(?:\*|[a-z][a-z0-9-]*)$/;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const hashPattern = /^[0-9a-fA-F]{7,64}$/;
const worktreePattern = /^\.worktrees\/[a-z0-9][a-z0-9._-]*$/;
const ignoredMetadataNames = new Set(["README.md"]);

const requiredFields = [
  "protocol",
  "message-id",
  "thread-id",
  "in-reply-to",
  "time",
  "from",
  "to",
  "subject",
];

const optionalFields = [
  "kind",
  "state",
  "requires-claim",
  "owner",
  "worktree",
  "branch",
  "base",
  "head",
  "worktree-state",
  "publication",
  "disposition",
  "parent-thread",
  "depends-on",
];
const allowedFields = new Set([...requiredFields, ...optionalFields]);

const kindStates = new Map([
  ["request", new Set(["open"])],
  ["claim", new Set(["claimed"])],
  ["update", new Set(["claimed", "in-progress", "blocked"])],
  ["handoff", new Set(["claimed", "in-progress", "blocked"])],
  ["completion", new Set(["completed"])],
  ["closure", new Set(["closed"])],
  ["cancellation", new Set(["cancelled"])],
]);
const ownerKinds = new Set(["claim", "handoff"]);
const dispositionKinds = new Set(["completion", "closure", "cancellation"]);
const activeWorkStates = new Set(["in-progress", "blocked"]);
const terminalStates = new Set(["closed", "cancelled"]);

const worktreeStates = new Set(["clean", "dirty"]);
const publications = new Set([
  "local-only",
  "pushed",
  "draft-pr",
  "published",
]);
const dispositions = new Set([
  "ready-for-review",
  "implemented",
  "decided",
  "rejected",
  "no-action",
  "landed",
  "superseded",
  "archived",
  "discarded",
]);

function issue(file, message) {
  return `${file}: ${message}`;
}

function advisory(file, message) {
  return issue(file, message);
}

function dependencies(header) {
  return header["depends-on"]
    ? header["depends-on"].split(",").map((value) => value.trim())
    : [];
}

function validBranch(branch) {
  return branch.length > 0
    && !branch.startsWith("-")
    && !branch.startsWith("/")
    && !branch.endsWith("/")
    && !branch.endsWith(".")
    && !branch.includes("..")
    && !branch.includes("//")
    && !branch.includes("@{")
    && !/[\x00-\x20\x7f~^:?*[\\]/.test(branch)
    && branch.split("/").every((component) => component && !component.startsWith(".") && !component.endsWith(".lock"));
}

function validTimestamp(timestamp) {
  const match = timestamp.match(timestampPattern);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (offsetHourText && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return !Number.isNaN(Date.parse(timestamp));
}

export function primaryCheckout(cwd = process.cwd()) {
  const result = spawnSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`cannot resolve primary checkout from ${cwd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || "git worktree list failed";
    throw new Error(`cannot resolve primary checkout from ${cwd}: ${detail}`);
  }
  const first = result.stdout.split("\0").find((field) => field.startsWith("worktree "))?.slice(9);
  if (!first) {
    throw new Error(`cannot resolve primary checkout from ${cwd}: no worktree found`);
  }
  return first;
}

export function resolveMailbox({ cwd = process.cwd(), mailbox } = {}) {
  return mailbox ? resolve(cwd, mailbox) : resolve(primaryCheckout(cwd), ".agents/mailbox");
}

export function parseMessage(source, file = "<message>") {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(issue(file, "message must start with `---` front matter"));
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error(issue(file, "front matter must end with `---` on its own line"));
  }

  const header = {};
  const headerLines = normalized.slice(4, end).split("\n");
  for (let index = 0; index < headerLines.length; index += 1) {
    const line = headerLines[index];
    const match = line.match(/^([a-z][a-z0-9-]*):(?: (.*))?$/);
    if (!match) {
      throw new Error(issue(file, `invalid header line ${index + 2}: ${JSON.stringify(line)}`));
    }
    const [, key, rawValue = ""] = match;
    if (Object.hasOwn(header, key)) {
      throw new Error(issue(file, `duplicate header field \`${key}\``));
    }
    header[key] = rawValue.trim();
  }

  const body = normalized.slice(end + 5).trim();
  return { file, header, body };
}

function validateHeader(message) {
  const { file, header, body } = message;
  const errors = [];
  const warnings = [];
  for (const field of requiredFields) {
    if (!Object.hasOwn(header, field)) {
      errors.push(issue(file, `missing required field \`${field}\``));
    }
  }
  for (const field of Object.keys(header)) {
    if (!allowedFields.has(field) && !field.startsWith("x-")) {
      warnings.push(advisory(file, `unknown field \`${field}\`; prefer an \`x-*\` name for extensions`));
    }
  }
  if (errors.length > 0) return { errors, warnings };

  for (const field of [...optionalFields, ...Object.keys(header).filter((field) => field.startsWith("x-"))]) {
    if (Object.hasOwn(header, field) && !header[field]) {
      warnings.push(advisory(file, `optional field \`${field}\` should be omitted rather than left empty`));
    }
  }

  if (header.protocol !== mailboxProtocol) {
    errors.push(issue(file, `protocol must be \`${mailboxProtocol}\``));
  }
  for (const field of ["message-id", "thread-id"]) {
    if (!messageIdPattern.test(header[field])) {
      errors.push(issue(file, `\`${field}\` must match ${messageIdPattern}`));
    }
  }
  if (header["in-reply-to"] && !messageIdPattern.test(header["in-reply-to"])) {
    errors.push(issue(file, `\`in-reply-to\` must be empty or a valid message ID`));
  }
  if (!validTimestamp(header.time)) {
    errors.push(issue(file, "`time` must be a valid ISO 8601 timestamp with an explicit offset"));
  }
  for (const field of ["from", "to"]) {
    if (!addressPattern.test(header[field])) {
      errors.push(issue(file, `\`${field}\` must be a project/agent address`));
    }
  }
  if (header.from.endsWith("/*")) {
    errors.push(issue(file, "`from` must name a concrete agent, not a wildcard"));
  }
  if (!kindStates.has(header.kind)) {
    if (header.kind) warnings.push(advisory(file, `unknown message kind \`${header.kind}\``));
  } else if (!header.state) {
    warnings.push(advisory(file, `kind \`${header.kind}\` normally records a state`));
  } else if (!kindStates.get(header.kind).has(header.state)) {
    warnings.push(advisory(file, `kind \`${header.kind}\` normally does not use state \`${header.state}\``));
  }
  if (header.state && !header.kind) {
    warnings.push(advisory(file, "`state` has no `kind`; free-form messages may omit both"));
  }
  if (!header.subject) errors.push(issue(file, "`subject` must not be empty"));
  if (!body) warnings.push(advisory(file, "message body is empty"));

  if (header.kind === "request") {
    if (!Object.hasOwn(header, "requires-claim")) {
      warnings.push(advisory(file, "a request conventionally records `requires-claim: true` or `requires-claim: false`"));
    } else if (header["requires-claim"] && !["true", "false"].includes(header["requires-claim"])) {
      warnings.push(advisory(file, "`requires-claim` should be `true` or `false`"));
    }
  } else if (Object.hasOwn(header, "requires-claim")) {
    warnings.push(advisory(file, "`requires-claim` is conventionally used only on a request"));
  }
  if (ownerKinds.has(header.kind) && !Object.hasOwn(header, "owner")) {
    warnings.push(advisory(file, `kind \`${header.kind}\` conventionally names an owner`));
  } else if (header.owner && !ownerKinds.has(header.kind)) {
    warnings.push(advisory(file, "`owner` is conventionally used on claim and handoff messages"));
  }
  if (dispositionKinds.has(header.kind) && !Object.hasOwn(header, "disposition")) {
    warnings.push(advisory(file, `kind \`${header.kind}\` conventionally records a durable disposition`));
  }
  if (header.owner && !addressPattern.test(header.owner)) {
    warnings.push(advisory(file, "`owner` should be a project/agent address"));
  } else if (header.owner?.endsWith("/*")) {
    warnings.push(advisory(file, "`owner` should name a concrete agent, not a wildcard"));
  }
  if (header.worktree && header.worktree !== "none" && !worktreePattern.test(header.worktree)) {
    warnings.push(advisory(file, "`worktree` should be `none` or project-relative `.worktrees/<slug>`"));
  }
  if (header.branch && !validBranch(header.branch)) {
    warnings.push(advisory(file, "`branch` is not a valid Git branch name"));
  }
  for (const field of ["base", "head"]) {
    if (header[field] && !hashPattern.test(header[field])) {
      warnings.push(advisory(file, `\`${field}\` should be a 7--64 character hexadecimal Git object ID`));
    }
  }
  if (header["worktree-state"] && !worktreeStates.has(header["worktree-state"])) {
    warnings.push(advisory(file, `unknown worktree state \`${header["worktree-state"]}\``));
  }
  if (header["worktree-state"] && (!header.worktree || header.worktree === "none")) {
    warnings.push(advisory(file, "`worktree-state` should accompany a concrete `worktree` path"));
  }
  if (header.publication && !publications.has(header.publication)) {
    warnings.push(advisory(file, `unknown publication state \`${header.publication}\``));
  }
  if (header.disposition && !dispositions.has(header.disposition)) {
    warnings.push(advisory(file, `unknown disposition \`${header.disposition}\``));
  }
  if (header.disposition && !dispositionKinds.has(header.kind)) {
    warnings.push(advisory(file, "`disposition` is conventionally used on completion, closure, and cancellation messages"));
  }
  if (header["parent-thread"] && !messageIdPattern.test(header["parent-thread"])) {
    warnings.push(advisory(file, "`parent-thread` should be a valid thread ID"));
  }
  if (header["parent-thread"] === header["message-id"]) {
    warnings.push(advisory(file, "a thread should not name itself as its parent"));
  }
  if (header["parent-thread"] && header["in-reply-to"]) {
    warnings.push(advisory(file, "`parent-thread` is conventionally used only on an opening message"));
  }
  const seenDependencies = new Set();
  for (const dependency of dependencies(header)) {
    if (!messageIdPattern.test(dependency)) {
      warnings.push(advisory(file, `invalid dependency thread ID \`${dependency}\``));
    } else if (dependency === header["message-id"]) {
      warnings.push(advisory(file, "a thread should not depend on itself"));
    } else if (seenDependencies.has(dependency)) {
      warnings.push(advisory(file, `duplicate dependency thread ID \`${dependency}\``));
    }
    seenDependencies.add(dependency);
  }
  if (header["depends-on"] && header["in-reply-to"]) {
    warnings.push(advisory(file, "`depends-on` is conventionally used only on an opening message"));
  }
  return { errors, warnings };
}

function loadMessageFile(path, label, expectedThread = null) {
  try {
    const message = parseMessage(readFileSync(path, "utf8"), label);
    const errors = [];
    const messageId = message.header["message-id"];
    const expectedName = messageId ? `${messageId}.md` : null;
    if (expectedName && basename(path) !== expectedName) {
      errors.push(issue(label, `filename must be \`${expectedName}\``));
    }
    if (expectedThread && message.header["thread-id"]
        && message.header["thread-id"] !== expectedThread) {
      errors.push(issue(label, `archived message must belong to directory thread \`${expectedThread}\``));
    }
    return { message, errors };
  } catch (error) {
    return { message: null, errors: [error.message] };
  }
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function mailboxPathProblem(mailboxPath) {
  if (!lstatIfExists(mailboxPath)) return null;
  try {
    if (statSync(mailboxPath).isDirectory()) return null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return issue(mailboxPath, "mailbox path must be a directory");
}

function ensureMailboxDirectory(mailboxPath) {
  const problem = mailboxPathProblem(mailboxPath);
  if (problem) throw new Error(problem);
  try {
    mkdirSync(mailboxPath, { recursive: true });
  } catch (error) {
    if (["EEXIST", "ENOTDIR"].includes(error.code)) {
      throw new Error(issue(mailboxPath, "mailbox path must be a directory"));
    }
    throw error;
  }
}

function project(address) {
  return typeof address === "string" ? address.split("/", 1)[0] : "";
}

function acceptsAgent(address, agent) {
  return project(address) === project(agent)
    && (address.endsWith("/*") || address === agent);
}

function latestField(chain, field) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (chain[index].header[field]) return chain[index].header[field];
  }
  return null;
}

function ancestry(message, opener, byId) {
  const chain = [];
  const seen = new Set();
  let current = message;
  while (current && !seen.has(current.header["message-id"])) {
    chain.push(current);
    if (current === opener) break;
    seen.add(current.header["message-id"]);
    current = byId.get(current.header["in-reply-to"]);
  }
  return chain.reverse();
}

function inheritedOwner(message, opener, byId) {
  return latestField(ancestry(message, opener, byId), "owner");
}

function workStateError(kind, previousState, currentState) {
  if (previousState === "claimed") return null;
  if (activeWorkStates.has(previousState) && activeWorkStates.has(currentState)) {
    return null;
  }
  return `${kind} cannot move state from \`${previousState}\` to \`${currentState}\``;
}

function transitionWarning(previous, current, opener, owner) {
  const requesterProject = project(opener.header.from);
  const recipientProject = project(opener.header.to);
  const sender = current.header.from;
  const senderProject = project(sender);
  const destinationProject = project(current.header.to);

  if ([requesterProject, recipientProject].includes(senderProject)) {
    const expectedDestination = senderProject === requesterProject
      ? recipientProject
      : requesterProject;
    if (destinationProject !== expectedDestination) {
      return `reply from project \`${senderProject}\` must address project \`${expectedDestination}\``;
    }
  }

  if (previous.header.state === "completed") {
    if (current.header.kind !== "closure") return "a completed thread accepts only closure";
    if (senderProject !== requesterProject) {
      return "closure must come from the project that opened the request";
    }
    return null;
  }
  if (terminalStates.has(previous.header.state)) {
    return `terminal state \`${previous.header.state}\` cannot have a reply`;
  }
  if (current.header.kind === "closure") return "closure must reply to completion";
  if (current.header.kind === "request") return "a request cannot reply inside an existing thread";

  const previousState = previous.header.state;
  const kind = current.header.kind;
  const state = current.header.state;
  if (previousState === "open") {
    if (kind === "claim") {
      if (sender !== current.header.owner) return "claim sender must equal its owner";
      if (!acceptsAgent(opener.header.to, sender)) {
        return "claim owner must match the requested project/agent address";
      }
      return null;
    }
    if (kind === "cancellation") {
      return senderProject === requesterProject
        ? null
        : "an open request may be cancelled only by the requesting project";
    }
    if (opener.header["requires-claim"] === "true") {
      return "a request requiring a claim must be claimed before work updates";
    }
    if (kind === "completion") {
      return acceptsAgent(opener.header.to, sender)
        ? null
        : "unclaimed completion must match the requested project/agent address";
    }
    return "an open request accepts a claim, completion without a required claim, or cancellation";
  }
  if (kind === "claim") return "claim must reply to an open request";
  if (kind === "cancellation") {
    return senderProject === requesterProject || sender === owner
      ? null
      : "cancellation must come from the requesting project or current owner";
  }
  if (kind === "completion") {
    return sender === owner ? null : "completion must come from the current owner";
  }
  if (kind === "handoff") {
    if (sender !== owner) return "handoff must come from the current owner";
    if (project(current.header.owner) !== recipientProject) {
      return "handoff owner must remain in the requested project";
    }
    return workStateError(kind, previousState, state);
  }
  if (kind !== "update") return `kind \`${kind}\` cannot follow state \`${previousState}\``;
  if (senderProject !== requesterProject && sender !== owner) {
    return "update must come from the requesting project or current owner";
  }
  return workStateError(kind, previousState, state);
}

export function validateMessages(messages) {
  const headerResults = new Map(messages.map((message) => [message, validateHeader(message)]));
  const errors = [...headerResults.values()].flatMap((result) => result.errors);
  const warnings = [...headerResults.values()].flatMap((result) => result.warnings);
  const graphMessages = messages.filter((message) => headerResults.get(message).errors.length === 0);
  const byId = new Map();
  for (const message of graphMessages) {
    const id = message.header["message-id"];
    if (!id) continue;
    if (byId.has(id)) errors.push(issue(message.file, `duplicate message ID \`${id}\``));
    else byId.set(id, message);
  }

  for (const message of graphMessages) {
    const { file, header } = message;
    if (!header["message-id"]) continue;
    const isOpeningMessage = !header["in-reply-to"];
    if (isOpeningMessage) {
      if (header["thread-id"] !== header["message-id"])
        errors.push(issue(file, "opening message `thread-id` must equal its `message-id`"));
    } else {
      if (header["thread-id"] === header["message-id"])
        errors.push(issue(file, "a reply cannot begin its own thread"));
    }
    if (header.kind === "request" && !isOpeningMessage)
      warnings.push(advisory(file, "a request conventionally opens a thread rather than replying inside one"));
  }

  const threads = new Map();
  for (const message of graphMessages) {
    const threadId = message.header["thread-id"];
    if (!threadId) continue;
    if (!threads.has(threadId)) threads.set(threadId, []);
    threads.get(threadId).push(message);
  }

  const summaries = [];
  for (const [threadId, members] of threads) {
    const opener = byId.get(threadId);
    if (!opener || opener.header["thread-id"] !== threadId || opener.header["in-reply-to"]) {
      for (const member of members) errors.push(issue(member.file, `thread opener \`${threadId}\` is missing`));
      continue;
    }
    const children = new Map();
    for (const member of members) {
      if (member === opener) continue;
      const parentId = member.header["in-reply-to"];
      const parent = byId.get(parentId);
      if (!parent) {
        errors.push(issue(member.file, `reply target \`${parentId}\` is missing`));
        continue;
      }
      if (parent.header["thread-id"] !== threadId) {
        errors.push(issue(member.file, `reply target \`${parentId}\` belongs to another thread`));
        continue;
      }
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(member);
    }
    for (const [parentId, replies] of children) {
      const parent = byId.get(parentId);
      for (const reply of replies) {
        if (Date.parse(reply.header.time) < Date.parse(parent.header.time)) {
          warnings.push(advisory(reply.file, `reply timestamp precedes \`${parentId}\``));
        }
        if (opener.header.kind === "request" && reply.header.kind) {
          const problem = transitionWarning(parent, reply, opener, inheritedOwner(parent, opener, byId));
          if (problem) warnings.push(advisory(reply.file, problem));
        }
      }
    }

    const reachable = [];
    const seen = new Set();
    const pending = [opener];
    while (pending.length > 0) {
      const current = pending.pop();
      const id = current.header["message-id"];
      if (seen.has(id)) continue;
      seen.add(id);
      reachable.push(current);
      pending.push(...(children.get(id) ?? []));
    }
    if (seen.size !== members.length) {
      for (const member of members.filter((item) => !seen.has(item.header["message-id"]))) {
        errors.push(issue(member.file, "message is not reachable from the thread opener"));
      }
    }
    reachable.sort((left, right) => Date.parse(left.header.time) - Date.parse(right.header.time)
      || left.header["message-id"].localeCompare(right.header["message-id"]));
    const latest = reachable.at(-1);
    const latestPath = ancestry(latest, opener, byId);
    const leaves = reachable.filter((message) => !(children.get(message.header["message-id"])?.length));
    const leafStates = new Set(leaves.map((message) => message.header.state || "active"));
    const allLeavesTerminal = leaves.every((message) => terminalStates.has(message.header.state));
    const state = leafStates.size === 1 ? [...leafStates][0] : allLeavesTerminal ? "terminal" : "active";
    summaries.push({
      threadId,
      state,
      branchCount: leaves.length,
      archivable: leaves.length > 0 && allLeavesTerminal,
      subject: opener.header.subject,
      from: opener.header.from,
      to: opener.header.to,
      owner: latestField(latestPath, "owner"),
      messageCount: reachable.length,
      latest: latest.header["message-id"],
      updatedAt: latest.header.time,
      disposition: latestField(latestPath, "disposition"),
      worktree: latestField(latestPath, "worktree"),
      branch: latestField(latestPath, "branch"),
      base: latestField(latestPath, "base"),
      head: latestField(latestPath, "head"),
      worktreeState: latestField(latestPath, "worktree-state"),
      publication: latestField(latestPath, "publication"),
      parentThread: opener.header["parent-thread"] || null,
      dependsOn: dependencies(opener.header),
    });
  }

  summaries.sort((left, right) => left.threadId.localeCompare(right.threadId));
  return { errors, warnings, threads: summaries };
}

function loadMailbox(mailboxPath) {
  const ignoredFiles = [];
  const messages = [];
  const parseErrors = [];
  const pathProblem = mailboxPathProblem(mailboxPath);
  if (pathProblem) {
    parseErrors.push(pathProblem);
    return { mailboxPath, messages, ignoredFiles, parseErrors };
  }
  if (!existsSync(mailboxPath)) {
    return { mailboxPath, messages, ignoredFiles, parseErrors };
  }
  for (const entry of readdirSync(mailboxPath, { withFileTypes: true })) {
    if (entry.name === "tmp") {
      if (!entry.isDirectory()) {
        parseErrors.push(issue("tmp", "reserved `tmp` path must be a directory"));
      } else {
        for (const pending of readdirSync(resolve(mailboxPath, entry.name), { withFileTypes: true })) {
          ignoredFiles.push(`tmp/${pending.name}${pending.isDirectory() ? "/" : ""}`);
        }
      }
      continue;
    }
    if (entry.name === "archive") {
      if (!entry.isDirectory()) {
        parseErrors.push(issue("archive", "reserved `archive` path must be a directory"));
      }
      continue;
    }
    if (!entry.isFile()) {
      ignoredFiles.push(`${entry.name}/`);
      continue;
    }
    if (ignoredMetadataNames.has(entry.name)) {
      ignoredFiles.push(entry.name);
      continue;
    }
    if (!entry.name.endsWith(".md")) {
      ignoredFiles.push(entry.name);
      continue;
    }
    const file = resolve(mailboxPath, entry.name);
    const loaded = loadMessageFile(file, entry.name);
    parseErrors.push(...loaded.errors);
    if (loaded.message) messages.push(loaded.message);
  }
  ignoredFiles.sort();
  parseErrors.sort();
  messages.sort((left, right) => left.file.localeCompare(right.file));
  return { mailboxPath, messages, ignoredFiles, parseErrors };
}

function loadArchive(mailboxPath) {
  const archivePath = resolve(mailboxPath, "archive");
  const messages = [];
  const parseErrors = [];
  const pathProblem = mailboxPathProblem(mailboxPath);
  if (pathProblem) {
    parseErrors.push(pathProblem);
    return { mailboxPath, archivePath, messages, parseErrors };
  }
  if (!existsSync(mailboxPath)) return { mailboxPath, archivePath, messages, parseErrors };
  const archiveEntry = lstatIfExists(archivePath);
  if (!archiveEntry) return { mailboxPath, archivePath, messages, parseErrors };
  if (!archiveEntry.isDirectory()) {
    parseErrors.push(issue("archive", "reserved `archive` path must be a directory"));
    return { mailboxPath, archivePath, messages, parseErrors };
  }
  for (const threadEntry of readdirSync(archivePath, { withFileTypes: true })) {
    if (!threadEntry.isDirectory()) {
      parseErrors.push(issue(`archive/${threadEntry.name}`, "archive entries must be thread directories"));
      continue;
    }
    const threadPath = resolve(archivePath, threadEntry.name);
    let messageCount = 0;
    for (const entry of readdirSync(threadPath, { withFileTypes: true })) {
      const label = `archive/${threadEntry.name}/${entry.name}`;
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        parseErrors.push(issue(label, "archive thread directories may contain only message files"));
        continue;
      }
      const file = resolve(threadPath, entry.name);
      const loaded = loadMessageFile(file, label, threadEntry.name);
      parseErrors.push(...loaded.errors);
      if (loaded.message) {
        messages.push(loaded.message);
        messageCount += 1;
      }
    }
    if (messageCount === 0) {
      parseErrors.push(issue(`archive/${threadEntry.name}/`, "archive thread directory contains no messages"));
    }
  }
  messages.sort((left, right) => left.file.localeCompare(right.file));
  parseErrors.sort();
  return { mailboxPath, archivePath, messages, parseErrors };
}

export function inspectMailbox(mailboxPath) {
  const loaded = loadMailbox(mailboxPath);
  const validated = validateMessages(loaded.messages);
  const archivedIds = new Set(loadArchive(mailboxPath).messages
    .map((message) => message.header["message-id"])
    .filter(Boolean));
  const reusedIds = loaded.messages
    .filter((message) => message.header["message-id"]
      && archivedIds.has(message.header["message-id"]))
    .map((message) => issue(message.file, `message ID \`${message.header["message-id"]}\` already exists in the archive`));
  return {
    ...loaded,
    errors: [...loaded.parseErrors, ...validated.errors, ...reusedIds],
    warnings: validated.warnings,
    threads: validated.threads,
  };
}

export function inspectArchive(mailboxPath) {
  const loaded = loadArchive(mailboxPath);
  const validated = validateMessages(loaded.messages);
  const activeIds = new Set(loadMailbox(mailboxPath).messages
    .map((message) => message.header["message-id"])
    .filter(Boolean));
  const reusedIds = loaded.messages
    .filter((message) => message.header["message-id"]
      && activeIds.has(message.header["message-id"]))
    .map((message) => issue(message.file, `message ID \`${message.header["message-id"]}\` also exists in the active mailbox`));
  const activeThreads = validated.threads
    .filter((thread) => !thread.archivable)
    .map((thread) => issue(`archive/${thread.threadId}/`, "archived thread has a nonterminal reply"));
  return {
    ...loaded,
    errors: [...loaded.parseErrors, ...validated.errors, ...reusedIds, ...activeThreads],
    warnings: validated.warnings,
    threads: validated.threads,
  };
}

function withMailboxLock(mailboxPath, operation) {
  const temporaryPath = resolve(mailboxPath, "tmp");
  const lockPath = resolve(temporaryPath, "operation.lock");
  const temporaryEntry = lstatIfExists(temporaryPath);
  if (temporaryEntry && !temporaryEntry.isDirectory()) {
    throw new Error("reserved `tmp` path must be a directory");
  }
  try {
    mkdirSync(temporaryPath, { recursive: true });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("reserved `tmp` path must be a directory");
    throw error;
  }

  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`mailbox operation lock already exists: ${relative(mailboxPath, lockPath)}`);
    }
    throw error;
  }

  try {
    return operation(temporaryPath);
  } finally {
    try { closeSync(descriptor); } catch {}
    try { unlinkSync(lockPath); } catch {}
  }
}

export function deliverMessage(mailboxPath, draftPath) {
  const sourcePath = resolve(draftPath);
  const source = readFileSync(sourcePath, "utf8");
  const parsed = parseMessage(source, basename(sourcePath));
  const headerResult = validateHeader(parsed);
  if (headerResult.errors.length > 0) {
    throw new Error(`draft message is invalid:\n${headerResult.errors.join("\n")}`);
  }

  const messageId = parsed.header["message-id"];
  const filename = `${messageId}.md`;
  const message = { ...parsed, file: filename };
  ensureMailboxDirectory(mailboxPath);

  return withMailboxLock(mailboxPath, (temporaryPath) => {
    const active = inspectMailbox(mailboxPath);
    if (active.errors.length > 0) {
      throw new Error(`mailbox must pass integrity checks before delivery:\n${active.errors.join("\n")}`);
    }
    const archive = inspectArchive(mailboxPath);
    if (archive.errors.length > 0) {
      throw new Error(`mailbox archive must pass integrity checks before delivery:\n${archive.errors.join("\n")}`);
    }
    if (archive.messages.some((candidate) => candidate.header["message-id"] === messageId)) {
      throw new Error(`message ID \`${messageId}\` already exists in the archive`);
    }

    const prospective = validateMessages([...active.messages, message]);
    if (prospective.errors.length > 0) {
      throw new Error(`message cannot be delivered:\n${prospective.errors.join("\n")}`);
    }

    const staging = resolve(temporaryPath, `deliver-${messageId}-${randomUUID()}.md`);
    const destination = resolve(mailboxPath, filename);

    let descriptor;
    try {
      descriptor = openSync(staging, "wx", 0o600);
      writeFileSync(descriptor, source, "utf8");
      fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }

    try {
      linkSync(staging, destination);
    } catch (error) {
      try { unlinkSync(staging); } catch {}
      if (error.code === "EEXIST") {
        throw new Error(`active message \`${messageId}\` already exists; no file was overwritten`);
      }
      throw error;
    }

    let cleanupWarning = null;
    try {
      unlinkSync(staging);
    } catch {
      cleanupWarning = `delivered message, but temporary file remains at ${relative(mailboxPath, staging)}`;
    }
    const warnings = prospective.warnings.filter((warning) => warning.startsWith(`${filename}:`));
    if (cleanupWarning) warnings.push(cleanupWarning);
    return {
      messageId,
      destination: relative(mailboxPath, destination),
      warnings,
    };
  });
}

export function archiveThread(mailboxPath, threadId) {
  if (!messageIdPattern.test(threadId)) {
    throw new Error(`thread ID must match ${messageIdPattern}`);
  }
  const pathProblem = mailboxPathProblem(mailboxPath);
  if (pathProblem) throw new Error(pathProblem);
  if (!existsSync(mailboxPath)) throw new Error(`unknown active thread \`${threadId}\``);
  ensureMailboxDirectory(mailboxPath);

  return withMailboxLock(mailboxPath, (temporaryPath) => {
    const result = inspectMailbox(mailboxPath);
    if (result.errors.length > 0) {
      throw new Error(`mailbox must pass integrity checks before archiving:\n${result.errors.join("\n")}`);
    }
    const archive = inspectArchive(mailboxPath);
    if (archive.errors.length > 0) {
      throw new Error(`mailbox archive must pass integrity checks before archiving:\n${archive.errors.join("\n")}`);
    }
    const thread = result.threads.find((candidate) => candidate.threadId === threadId);
    if (!thread) throw new Error(`unknown active thread \`${threadId}\``);
    if (!thread.archivable) {
      throw new Error(`thread \`${threadId}\` has nonterminal replies; only wholly closed or cancelled threads may be archived`);
    }
    const members = result.messages.filter((message) => message.header["thread-id"] === threadId);
    const archivePath = resolve(mailboxPath, "archive");
    const staging = resolve(temporaryPath, `archive-${threadId}`);
    const destination = resolve(archivePath, threadId);
    if (existsSync(destination)) throw new Error(`archive destination already exists: ${destination}`);
    mkdirSync(archivePath, { recursive: true });
    try {
      mkdirSync(staging);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`archive staging already exists: ${staging}`);
      throw error;
    }
    try {
      for (const message of members) {
        const source = resolve(mailboxPath, message.file);
        renameSync(source, resolve(staging, basename(message.file)));
      }
      renameSync(staging, destination);
    } catch (error) {
      for (const message of members) {
        const staged = resolve(staging, basename(message.file));
        if (existsSync(staged)) renameSync(staged, resolve(mailboxPath, basename(message.file)));
      }
      try { rmdirSync(staging); } catch {}
      throw error;
    }
    return {
      threadId,
      destination: relative(mailboxPath, destination),
      messageCount: members.length,
    };
  });
}
