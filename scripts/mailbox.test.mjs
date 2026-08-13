import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  inspectMailbox,
  parseMessage,
  primaryCheckout,
  resolveMailbox,
  validateMessages,
} from "./mailbox-lib.mjs";

const script = resolve(import.meta.dirname, "mailbox.mjs");

function message({
  id,
  thread = id,
  reply = "",
  time = "2026-08-13T14:30:00+02:00",
  from = "lean-zip/root",
  to = "vir/*",
  kind = "request",
  state = "open",
  subject = "persist interpreted constants across calls",
  fields = {},
  body = "## Request\n\nPreserve the package-scoped cache.",
}) {
  const headers = {
    protocol: "agent-mailbox/v1",
    "message-id": id,
    "thread-id": thread,
    "in-reply-to": reply,
    time,
    from,
    to,
    kind,
    state,
    ...(kind === "request" ? { "requires-ack": "true" } : {}),
    ...fields,
    subject,
  };
  return `---\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n${body}\n`;
}

async function withMailbox(run) {
  const root = await mkdtemp(join(tmpdir(), "vir-mailbox-"));
  const mailbox = join(root, ".agents", "mailbox");
  await mkdir(mailbox, { recursive: true });
  try {
    await run(mailbox);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function put(mailbox, id, source) {
  await writeFile(join(mailbox, `${id}.md`), source);
}

test("documentation message examples conform to the protocol", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../docs/MAILBOX_PROTOCOL.md"), "utf8");
  const examples = [...source.matchAll(/```markdown\n(---\n[\s\S]*?\n---\n[\s\S]*?)\n```/g)]
    .map((match, index) => parseMessage(`${match[1]}\n`, `documentation example ${index + 1}`));

  assert.equal(examples.length, 3, "expected request, acknowledgement, and completion examples");
  assert.deepEqual(validateMessages(examples).errors, []);
});

test("validates and summarizes a complete cross-project lifecycle", async () => {
  await withMailbox(async (mailbox) => {
    const thread = "ROOT-VIR-20260813-001";
    await put(mailbox, thread, message({ id: thread }));
    await put(mailbox, "VIR-ROOT-20260813-001", message({
      id: "VIR-ROOT-20260813-001",
      thread,
      reply: thread,
      time: "2026-08-13T15:10:00+02:00",
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "acknowledgement",
      state: "claimed",
      fields: {
        owner: "vir/runtime",
        worktree: ".worktrees/persist-ir-cache",
        branch: "fix/persist-ir-cache",
        base: "5703203",
        publication: "local-only",
      },
    }));
    await put(mailbox, "VIR-ROOT-20260813-002", message({
      id: "VIR-ROOT-20260813-002",
      thread,
      reply: "VIR-ROOT-20260813-001",
      time: "2026-08-13T18:20:00+02:00",
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "completion",
      state: "completed",
      fields: {
        worktree: ".worktrees/persist-ir-cache",
        branch: "fix/persist-ir-cache",
        base: "5703203",
        head: "abc1234",
        "worktree-state": "clean",
        publication: "local-only",
        disposition: "ready-for-review",
      },
    }));
    await put(mailbox, "ROOT-VIR-20260813-002", message({
      id: "ROOT-VIR-20260813-002",
      thread,
      reply: "VIR-ROOT-20260813-002",
      time: "2026-08-13T19:00:00+02:00",
      from: "lean-zip/root",
      to: "vir/runtime",
      kind: "closure",
      state: "closed",
      fields: { disposition: "landed" },
    }));

    const result = inspectMailbox(mailbox);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.threads, [{
      threadId: thread,
      state: "closed",
      subject: "persist interpreted constants across calls",
      from: "lean-zip/root",
      to: "vir/*",
      owner: "vir/runtime",
      messageCount: 4,
      tail: "ROOT-VIR-20260813-002",
      updatedAt: "2026-08-13T19:00:00+02:00",
      disposition: "landed",
      worktree: ".worktrees/persist-ir-cache",
      branch: "fix/persist-ir-cache",
      base: "5703203",
      head: "abc1234",
      worktreeState: "clean",
      publication: "local-only",
      parentThread: null,
      dependsOn: [],
    }]);
  });
});

test("rejects work before a required acknowledgement", () => {
  const thread = "ROOT-VIR-20260813-001";
  const messages = [
    parseMessage(message({ id: thread }), `${thread}.md`),
    parseMessage(message({
      id: "VIR-ROOT-20260813-001",
      thread,
      reply: thread,
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "update",
      state: "in-progress",
    }), "VIR-ROOT-20260813-001.md"),
  ];
  const result = validateMessages(messages);
  assert(result.errors.some((error) => error.includes("must be claimed before work updates")));
});

test("rejects forks and replies after a terminal state", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const acknowledgement = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const cancel = parseMessage(message({
    id: "ROOT-VIR-20260813-002",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "lean-zip/root",
    to: "vir/runtime",
    kind: "cancellation",
    state: "cancelled",
    fields: { disposition: "discarded" },
  }), "ROOT-VIR-20260813-002.md");
  const afterCancel = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: "ROOT-VIR-20260813-002",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "update",
    state: "in-progress",
  }), "VIR-ROOT-20260813-002.md");
  const fork = parseMessage(message({
    id: "VIR-ROOT-20260813-003",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "update",
    state: "in-progress",
  }), "VIR-ROOT-20260813-003.md");
  const result = validateMessages([request, acknowledgement, cancel, afterCancel, fork]);
  assert(result.errors.some((error) => error.includes("thread forks")));
  assert(result.errors.some((error) => error.includes("terminal state `cancelled`")));
});

test("rejects malformed operational metadata", () => {
  const source = message({
    id: "ROOT-VIR-20260813-001",
    fields: {
      worktree: "/tmp/not-project-relative",
      branch: "bad branch",
      base: "not-a-hash",
      publication: "maybe",
    },
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260813-001.md")]);
  assert(result.errors.some((error) => error.includes("project-relative")));
  assert(result.errors.some((error) => error.includes("valid Git branch")));
  assert(result.errors.some((error) => error.includes("Git object ID")));
  assert(result.errors.some((error) => error.includes("unknown publication state")));
});

test("invalid required fields remain diagnostics instead of graph-validation crashes", () => {
  const parsed = parseMessage(message({
    id: "ROOT-VIR-20260813-001",
    from: "invalid-address",
  }), "ROOT-VIR-20260813-001.md");
  assert.doesNotThrow(() => validateMessages([parsed]));
  const result = validateMessages([parsed]);
  assert(result.errors.some((error) => error.includes("project/agent address")));
  assert.deepEqual(result.threads, []);
});

test("rejects lifecycle metadata on kinds that cannot own it", () => {
  const source = message({
    id: "ROOT-VIR-20260813-001",
    fields: {
      owner: "vir/runtime",
      disposition: "implemented",
      "parent-thread": "ROOT-VIR-20260812-001",
      "depends-on": "ROOT-VIR-20260812-002",
    },
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260813-001.md")]);
  assert(result.errors.some((error) => error.includes("`owner` is valid only")));
  assert(result.errors.some((error) => error.includes("`disposition` is valid only")));
  assert(!result.errors.some((error) => error.includes("`parent-thread` is valid only")));
  assert(!result.errors.some((error) => error.includes("`depends-on` is valid only")));
});

test("rejects ad hoc correspondence kinds and states", () => {
  const source = message({
    id: "ROOT-VIR-20260813-001",
    kind: "decision",
    state: "acknowledged",
    fields: { "requires-ack": "true" },
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260813-001.md")]);
  assert(result.errors.some((error) => error.includes("unknown message kind `decision`")));
  assert(result.errors.some((error) => error.includes("`requires-ack` is valid only on a request")));
});

test("rejects empty optional fields and cyclic or duplicate thread links", () => {
  const thread = "ROOT-VIR-20260813-001";
  const source = message({
    id: thread,
    fields: {
      branch: "",
      worktree: "none",
      "worktree-state": "clean",
      "parent-thread": thread,
      "depends-on": `${thread}, ROOT-VIR-20260812-001, ROOT-VIR-20260812-001`,
    },
  });
  const result = validateMessages([parseMessage(source, `${thread}.md`)]);
  assert(result.errors.some((error) => error.includes("optional field `branch` must be omitted")));
  assert(result.errors.some((error) => error.includes("requires a concrete `worktree` path")));
  assert(result.errors.some((error) => error.includes("cannot name itself as its parent")));
  assert(result.errors.some((error) => error.includes("cannot depend on itself")));
  assert(result.errors.some((error) => error.includes("duplicate dependency thread ID")));
});

test("rejects normalized but impossible timestamp dates", () => {
  const source = message({
    id: "ROOT-VIR-20260230-001",
    time: "2026-02-30T14:30:00+02:00",
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260230-001.md")]);
  assert(result.errors.some((error) => error.includes("valid ISO 8601 timestamp")));
});

test("requires concrete sender and owner addresses", () => {
  const request = parseMessage(message({
    id: "ROOT-VIR-20260813-001",
    from: "lean-zip/*",
  }), "ROOT-VIR-20260813-001.md");
  const acknowledgement = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread: "ROOT-VIR-20260813-001",
    reply: "ROOT-VIR-20260813-001",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/*" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, acknowledgement]);
  assert(result.errors.some((error) => error.includes("`from` must name a concrete agent")));
  assert(result.errors.some((error) => error.includes("`owner` must name a concrete agent")));
});

test("enforces requested-project claims and current-owner completion", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const wrongClaim = parseMessage(message({
    id: "OTHER-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "other/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "other/runtime" },
  }), "OTHER-ROOT-20260813-001.md");
  let result = validateMessages([request, wrongClaim]);
  assert(result.errors.some((error) => error.includes("must match the requested project/agent address")));

  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const wrongCompletion = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "vir/other",
    to: "lean-zip/root",
    kind: "completion",
    state: "completed",
    fields: { disposition: "implemented" },
  }), "VIR-ROOT-20260813-002.md");
  result = validateMessages([request, claim, wrongCompletion]);
  assert(result.errors.some((error) => error.includes("completion must come from the current owner")));
});

test("cross-project replies address the other participating project", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const wrongDestination = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "other/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, wrongDestination]);
  assert(result.errors.some((error) => error.includes("must address project `lean-zip`")));
});

test("concrete recipients cannot be claimed by sibling agents", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({
    id: thread,
    to: "vir/runtime",
  }), `${thread}.md`);
  const siblingClaim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/performance",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/performance" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, siblingClaim]);
  assert(result.errors.some((error) => error.includes("must match the requested project/agent address")));
});

test("handoff transfers completion ownership while requester updates remain allowed", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const requesterUpdate = parseMessage(message({
    id: "ROOT-VIR-20260813-002",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "lean-zip/root",
    to: "vir/runtime",
    kind: "update",
    state: "in-progress",
  }), "ROOT-VIR-20260813-002.md");
  const handoff = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: "ROOT-VIR-20260813-002",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "handoff",
    state: "in-progress",
    fields: { owner: "vir/performance" },
  }), "VIR-ROOT-20260813-002.md");
  const completion = parseMessage(message({
    id: "VIR-ROOT-20260813-003",
    thread,
    reply: "VIR-ROOT-20260813-002",
    from: "vir/performance",
    to: "lean-zip/root",
    kind: "completion",
    state: "completed",
    fields: { disposition: "ready-for-review" },
  }), "VIR-ROOT-20260813-003.md");
  const result = validateMessages([request, claim, requesterUpdate, handoff, completion]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.threads[0].owner, "vir/performance");
});

test("handoff cannot regress an active work state", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const progress = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "update",
    state: "in-progress",
  }), "VIR-ROOT-20260813-002.md");
  const handoff = parseMessage(message({
    id: "VIR-ROOT-20260813-003",
    thread,
    reply: "VIR-ROOT-20260813-002",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "handoff",
    state: "claimed",
    fields: { owner: "vir/performance" },
  }), "VIR-ROOT-20260813-003.md");
  const result = validateMessages([request, claim, progress, handoff]);
  assert(result.errors.some((error) => error.includes("handoff cannot move state")));
});

test("requires-ack false permits only requested-project direct completion", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({
    id: thread,
    fields: { "requires-ack": "false" },
  }), `${thread}.md`);
  const completion = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/root",
    to: "lean-zip/root",
    kind: "completion",
    state: "completed",
    fields: { disposition: "decided" },
  }), "VIR-ROOT-20260813-001.md");
  assert.deepEqual(validateMessages([request, completion]).errors, []);

  const update = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: thread,
    from: "vir/root",
    to: "lean-zip/root",
    kind: "update",
    state: "in-progress",
  }), "VIR-ROOT-20260813-002.md");
  const result = validateMessages([request, update]);
  assert(result.errors.some((error) => error.includes("accepts acknowledgement, completion")));
});

test("same-project replies remain addressed within the shared project", () => {
  const thread = "VIR-VIR-20260813-001";
  const request = parseMessage(message({
    id: thread,
    from: "vir/root",
    to: "vir/*",
  }), `${thread}.md`);
  const wrongDestination = parseMessage(message({
    id: "VIR-VIR-20260813-002",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "other/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-VIR-20260813-002.md");
  const result = validateMessages([request, wrongDestination]);
  assert(result.errors.some((error) => error.includes("must address project `vir`")));
});

test("rejects state regressions and terminal messages without disposition", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const acknowledgement = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "acknowledgement",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const progress = parseMessage(message({
    id: "VIR-ROOT-20260813-002",
    thread,
    reply: "VIR-ROOT-20260813-001",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "update",
    state: "in-progress",
  }), "VIR-ROOT-20260813-002.md");
  const regression = parseMessage(message({
    id: "VIR-ROOT-20260813-003",
    thread,
    reply: "VIR-ROOT-20260813-002",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "update",
    state: "claimed",
  }), "VIR-ROOT-20260813-003.md");
  const completion = parseMessage(message({
    id: "VIR-ROOT-20260813-004",
    thread,
    reply: "VIR-ROOT-20260813-003",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "completion",
    state: "completed",
  }), "VIR-ROOT-20260813-004.md");
  const result = validateMessages([request, acknowledgement, progress, regression, completion]);
  assert(result.errors.some((error) => error.includes("cannot move state from `in-progress` to `claimed`")));
  assert(result.errors.some((error) => error.includes("requires a durable disposition")));
});

test("rejects obsolete directional ledgers as malformed messages", async () => {
  await withMailbox(async (mailbox) => {
    await writeFile(join(mailbox, "root-to-vir.md"), "# legacy\n");
    await writeFile(join(mailbox, "README.md"), "# Local mailbox\n");
    const result = inspectMailbox(mailbox);
    assert(result.errors.some((error) => error.includes("message must start with `---`")));
    assert.deepEqual(result.ignoredFiles, ["README.md"]);
    assert.deepEqual(result.threads, []);
  });
});

test("reports malformed messages and filename mismatches", async () => {
  await withMailbox(async (mailbox) => {
    const id = "ROOT-VIR-20260813-001";
    await writeFile(join(mailbox, "WRONG-VIR-20260813-001.md"), message({ id }));
    await writeFile(join(mailbox, "BROKEN-VIR-20260813-001.md"), "not front matter\n");
    const result = inspectMailbox(mailbox);
    assert(result.errors.some((error) => error.includes(`filename must be \`${id}.md\``)));
    assert(result.errors.some((error) => error.includes("message must start with `---`")));
  });
});

test("CLI lists active threads and hides terminal threads by default", async () => {
  await withMailbox(async (mailbox) => {
    const open = "ROOT-VIR-20260813-001";
    const closed = "ROOT-VIR-20260813-002";
    await put(mailbox, open, message({
      id: open,
      subject: "active request",
      fields: {
        "parent-thread": "ROOT-VIR-20260812-001",
        "depends-on": "ROOT-VIR-20260812-002, ROOT-VIR-20260812-003",
      },
    }));
    await put(mailbox, "VIR-ROOT-20260813-001", message({
      id: "VIR-ROOT-20260813-001",
      thread: open,
      reply: open,
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "acknowledgement",
      state: "claimed",
      fields: {
        owner: "vir/runtime",
        branch: "fix/active-request",
        base: "abc1234",
        publication: "local-only",
      },
    }));
    await writeFile(join(mailbox, "README.md"), "# Local mailbox\n");
    await put(mailbox, closed, message({
      id: closed,
      time: "2026-08-13T15:00:00+02:00",
      subject: "closed request",
      fields: { "requires-ack": "false" },
    }));
    await put(mailbox, "ROOT-VIR-20260813-003", message({
      id: "ROOT-VIR-20260813-003",
      thread: closed,
      reply: closed,
      time: "2026-08-13T15:05:00+02:00",
      from: "lean-zip/root",
      to: "vir/*",
      kind: "cancellation",
      state: "cancelled",
      fields: { disposition: "discarded" },
    }));

    const listed = spawnSync(process.execPath, [script, "list", "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /active request/);
    assert.match(listed.stdout, /lane: branch=fix\/active-request base=abc1234 publication=local-only/);
    assert.match(listed.stdout, /parent: ROOT-VIR-20260812-001/);
    assert.match(listed.stdout, /depends on: ROOT-VIR-20260812-002, ROOT-VIR-20260812-003/);
    assert.doesNotMatch(listed.stdout, /closed request/);

    const all = spawnSync(process.execPath, [script, "list", "--mailbox", mailbox, "--all", "--json"], {
      encoding: "utf8",
    });
    assert.equal(all.status, 0, all.stderr);
    const payload = JSON.parse(all.stdout);
    assert.deepEqual(payload.ignoredFiles, ["README.md"]);
    assert.deepEqual(payload.threads.map((thread) => thread.state), ["claimed", "cancelled"]);
    assert.deepEqual(payload.threads[0].dependsOn, ["ROOT-VIR-20260812-002", "ROOT-VIR-20260812-003"]);
  });
});

test("CLI rejects a missing mailbox option value", () => {
  const result = spawnSync(process.execPath, [script, "list", "--mailbox", "--all"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /`--mailbox` requires a path/);
});

test("CLI rejects a nonexistent explicit mailbox", () => {
  const mailbox = join(tmpdir(), `vir-mailbox-missing-${process.pid}`);
  const result = spawnSync(process.execPath, [script, "check", "--mailbox", mailbox], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mailbox does not exist/);
});

test("default mailbox resolves to the primary checkout from a linked worktree", () => {
  const primary = primaryCheckout(process.cwd());
  assert.equal(resolveMailbox(), join(primary, ".agents", "mailbox"));
});
