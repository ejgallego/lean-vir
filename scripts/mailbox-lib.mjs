import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const mailboxProtocol = "agent-mailbox/v1";
const messageIdPattern = /^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-[0-9]{8}-[0-9]{3}$/;
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
  "kind",
  "state",
  "subject",
];

const optionalFields = [
  "requires-ack",
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
  ["acknowledgement", new Set(["claimed"])],
  ["update", new Set(["claimed", "in-progress", "blocked"])],
  ["handoff", new Set(["claimed", "in-progress", "blocked"])],
  ["completion", new Set(["completed"])],
  ["closure", new Set(["closed"])],
  ["cancellation", new Set(["cancelled"])],
]);
const ownerKinds = new Set(["acknowledgement", "handoff"]);
const dispositionKinds = new Set(["completion", "closure", "cancellation"]);
const activeWorkStates = new Set(["in-progress", "blocked"]);
export const terminalStates = new Set(["closed", "cancelled"]);

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
  for (const field of requiredFields) {
    if (!Object.hasOwn(header, field)) {
      errors.push(issue(file, `missing required field \`${field}\``));
    }
  }
  for (const field of Object.keys(header)) {
    if (!allowedFields.has(field)) {
      errors.push(issue(file, `unknown protocol v1 field \`${field}\``));
    }
  }
  if (errors.length > 0) return errors;

  for (const field of optionalFields) {
    if (Object.hasOwn(header, field) && !header[field]) {
      errors.push(issue(file, `optional field \`${field}\` must be omitted rather than left empty`));
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
  } else if (messageIdPattern.test(header["message-id"])) {
    const idDate = header["message-id"].split("-").at(-2);
    const timestampDate = header.time.slice(0, 10).replaceAll("-", "");
    if (idDate !== timestampDate) {
      errors.push(issue(file, "message ID date must equal the timestamp's local date"));
    }
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
    errors.push(issue(file, `unknown message kind \`${header.kind}\``));
  } else if (!kindStates.get(header.kind).has(header.state)) {
    errors.push(issue(file, `kind \`${header.kind}\` cannot use state \`${header.state}\``));
  }
  if (!header.subject) errors.push(issue(file, "`subject` must not be empty"));
  if (!body) errors.push(issue(file, "message body must not be empty"));

  if (header.kind === "request") {
    if (!Object.hasOwn(header, "requires-ack")) {
      errors.push(issue(file, "a request requires `requires-ack: true` or `requires-ack: false`"));
    } else if (header["requires-ack"] && !["true", "false"].includes(header["requires-ack"])) {
      errors.push(issue(file, "`requires-ack` must be `true` or `false`"));
    }
  } else if (Object.hasOwn(header, "requires-ack")) {
    errors.push(issue(file, "`requires-ack` is valid only on a request"));
  }
  if (ownerKinds.has(header.kind) && !Object.hasOwn(header, "owner")) {
    errors.push(issue(file, `kind \`${header.kind}\` requires an owner`));
  } else if (header.owner && !ownerKinds.has(header.kind)) {
    errors.push(issue(file, "`owner` is valid only on acknowledgement and handoff messages"));
  }
  if (dispositionKinds.has(header.kind) && !Object.hasOwn(header, "disposition")) {
    errors.push(issue(file, `kind \`${header.kind}\` requires a durable disposition`));
  }
  if (header.owner && !addressPattern.test(header.owner)) {
    errors.push(issue(file, "`owner` must be a project/agent address"));
  } else if (header.owner?.endsWith("/*")) {
    errors.push(issue(file, "`owner` must name a concrete agent, not a wildcard"));
  }
  if (header.worktree && header.worktree !== "none" && !worktreePattern.test(header.worktree)) {
    errors.push(issue(file, "`worktree` must be `none` or project-relative `.worktrees/<slug>`"));
  }
  if (header.branch && !validBranch(header.branch)) {
    errors.push(issue(file, "`branch` is not a valid Git branch name"));
  }
  for (const field of ["base", "head"]) {
    if (header[field] && !hashPattern.test(header[field])) {
      errors.push(issue(file, `\`${field}\` must be a 7--64 character hexadecimal Git object ID`));
    }
  }
  if (header["worktree-state"] && !worktreeStates.has(header["worktree-state"])) {
    errors.push(issue(file, `unknown worktree state \`${header["worktree-state"]}\``));
  }
  if (header["worktree-state"] && (!header.worktree || header.worktree === "none")) {
    errors.push(issue(file, "`worktree-state` requires a concrete `worktree` path in the same message"));
  }
  if (header.publication && !publications.has(header.publication)) {
    errors.push(issue(file, `unknown publication state \`${header.publication}\``));
  }
  if (header.disposition && !dispositions.has(header.disposition)) {
    errors.push(issue(file, `unknown disposition \`${header.disposition}\``));
  }
  if (header.disposition && !dispositionKinds.has(header.kind)) {
    errors.push(issue(file, "`disposition` is valid only on completion, closure, and cancellation messages"));
  }
  if (header["parent-thread"] && !messageIdPattern.test(header["parent-thread"])) {
    errors.push(issue(file, "`parent-thread` must be a valid thread ID"));
  }
  if (header["parent-thread"] === header["message-id"]) {
    errors.push(issue(file, "a thread cannot name itself as its parent"));
  }
  if (header["parent-thread"] && header.kind !== "request") {
    errors.push(issue(file, "`parent-thread` is valid only on a request"));
  }
  const seenDependencies = new Set();
  for (const dependency of dependencies(header)) {
    if (!messageIdPattern.test(dependency)) {
      errors.push(issue(file, `invalid dependency thread ID \`${dependency}\``));
    } else if (dependency === header["message-id"]) {
      errors.push(issue(file, "a thread cannot depend on itself"));
    } else if (seenDependencies.has(dependency)) {
      errors.push(issue(file, `duplicate dependency thread ID \`${dependency}\``));
    }
    seenDependencies.add(dependency);
  }
  if (header["depends-on"] && header.kind !== "request") {
    errors.push(issue(file, "`depends-on` is valid only on a request"));
  }
  return errors;
}

function project(address) {
  return address.split("/", 1)[0];
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

function inheritedOwner(message, request, byId) {
  const seen = new Set();
  let current = message;
  while (current && !seen.has(current.header["message-id"])) {
    if (current.header.owner) return current.header.owner;
    seen.add(current.header["message-id"]);
    current = current === request ? null : byId.get(current.header["in-reply-to"]);
  }
  return null;
}

function workStateError(kind, previousState, currentState) {
  if (previousState === "claimed") return null;
  if (activeWorkStates.has(previousState) && activeWorkStates.has(currentState)) {
    return null;
  }
  return `${kind} cannot move state from \`${previousState}\` to \`${currentState}\``;
}

function transitionError(previous, current, request, owner) {
  const requesterProject = project(request.header.from);
  const recipientProject = project(request.header.to);
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
    if (kind === "acknowledgement") {
      if (sender !== current.header.owner) return "acknowledgement sender must equal its owner";
      if (!acceptsAgent(request.header.to, sender)) {
        return "acknowledgement owner must match the requested project/agent address";
      }
      return null;
    }
    if (kind === "cancellation") {
      return senderProject === requesterProject
        ? null
        : "an open request may be cancelled only by the requesting project";
    }
    if (request.header["requires-ack"] === "true") {
      return "a request requiring acknowledgement must be claimed before work updates";
    }
    if (kind === "completion") {
      return acceptsAgent(request.header.to, sender)
        ? null
        : "unclaimed completion must match the requested project/agent address";
    }
    return "an open request accepts acknowledgement, completion without required acknowledgement, or cancellation";
  }
  if (kind === "acknowledgement") return "acknowledgement must reply to an open request";
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
  const headerErrors = new Map(messages.map((message) => [message, validateHeader(message)]));
  const errors = [...headerErrors.values()].flat();
  const graphMessages = messages.filter((message) => headerErrors.get(message).length === 0);
  const byId = new Map();
  for (const message of graphMessages) {
    const id = message.header["message-id"];
    if (!id) continue;
    if (byId.has(id)) errors.push(issue(message.file, `duplicate message ID \`${id}\``));
    else byId.set(id, message);
  }

  for (const message of graphMessages) {
    const { file, header } = message;
    if (!header["message-id"] || !header.kind) continue;
    const isRequest = header.kind === "request";
    if (isRequest) {
      if (header["thread-id"] !== header["message-id"])
        errors.push(issue(file, "request `thread-id` must equal its `message-id`"));
      if (header["in-reply-to"])
        errors.push(issue(file, "request `in-reply-to` must be empty"));
    } else {
      if (!header["in-reply-to"])
        errors.push(issue(file, "non-request message requires `in-reply-to`"));
      if (header["thread-id"] === header["message-id"])
        errors.push(issue(file, "only a request may begin a thread"));
    }
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
    const request = byId.get(threadId);
    if (!request || request.header.kind !== "request") {
      for (const member of members) errors.push(issue(member.file, `thread request \`${threadId}\` is missing`));
      continue;
    }
    const children = new Map();
    for (const member of members) {
      if (member === request) continue;
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
      if (replies.length > 1) {
        for (const reply of replies) errors.push(issue(reply.file, `thread forks after \`${parentId}\`; reply to the current tail`));
      }
      const parent = byId.get(parentId);
      for (const reply of replies) {
        if (Date.parse(reply.header.time) < Date.parse(parent.header.time)) {
          errors.push(issue(reply.file, `reply timestamp precedes \`${parentId}\``));
        }
        const problem = transitionError(parent, reply, request, inheritedOwner(parent, request, byId));
        if (problem) errors.push(issue(reply.file, problem));
      }
    }

    const chain = [];
    const seen = new Set();
    let current = request;
    while (current && !seen.has(current.header["message-id"])) {
      chain.push(current);
      seen.add(current.header["message-id"]);
      const replies = children.get(current.header["message-id"]) ?? [];
      current = replies.length === 1 ? replies[0] : null;
    }
    if (seen.size !== members.length) {
      for (const member of members.filter((item) => !seen.has(item.header["message-id"]))) {
        errors.push(issue(member.file, "message is not reachable through the thread's linear reply chain"));
      }
    }
    const tail = chain.at(-1);
    summaries.push({
      threadId,
      state: tail.header.state,
      subject: request.header.subject,
      from: request.header.from,
      to: request.header.to,
      owner: latestField(chain, "owner"),
      messageCount: chain.length,
      tail: tail.header["message-id"],
      updatedAt: tail.header.time,
      disposition: latestField(chain, "disposition"),
      worktree: latestField(chain, "worktree"),
      branch: latestField(chain, "branch"),
      base: latestField(chain, "base"),
      head: latestField(chain, "head"),
      worktreeState: latestField(chain, "worktree-state"),
      publication: latestField(chain, "publication"),
      parentThread: request.header["parent-thread"] || null,
      dependsOn: dependencies(request.header),
    });
  }

  summaries.sort((left, right) => left.threadId.localeCompare(right.threadId));
  return { errors, threads: summaries };
}

function loadMailbox(mailboxPath) {
  const ignoredFiles = [];
  const messages = [];
  const parseErrors = [];
  if (!existsSync(mailboxPath)) {
    return { mailboxPath, messages, ignoredFiles, parseErrors };
  }
  for (const entry of readdirSync(mailboxPath, { withFileTypes: true })) {
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
    try {
      const message = parseMessage(readFileSync(file, "utf8"), entry.name);
      const messageId = message.header["message-id"];
      const expected = messageId ? `${messageId}.md` : null;
      if (expected && entry.name !== expected) {
        parseErrors.push(issue(entry.name, `filename must be \`${expected}\``));
      }
      messages.push(message);
    } catch (error) {
      parseErrors.push(error.message);
    }
  }
  ignoredFiles.sort();
  parseErrors.sort();
  messages.sort((left, right) => left.file.localeCompare(right.file));
  return { mailboxPath, messages, ignoredFiles, parseErrors };
}

export function inspectMailbox(mailboxPath) {
  const loaded = loadMailbox(mailboxPath);
  const validated = validateMessages(loaded.messages);
  return {
    ...loaded,
    errors: [...loaded.parseErrors, ...validated.errors],
    threads: validated.threads,
  };
}
