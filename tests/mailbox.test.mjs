import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  archiveThread,
  deliverMessage,
  inspectArchive,
  inspectMailbox,
  parseMessage,
  primaryCheckout,
  resolveMailbox,
  validateMessages,
} from "../scripts/mailbox-lib.mjs";

const script = resolve(import.meta.dirname, "../scripts/mailbox.mjs");

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
    ...(kind ? { kind } : {}),
    ...(state ? { state } : {}),
    ...(kind === "request" ? { "requires-claim": "true" } : {}),
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

  assert.equal(examples.length, 4, "expected planning, request, claim, and completion examples");
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
      kind: "claim",
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
      branchCount: 1,
      archivable: true,
      subject: "persist interpreted constants across calls",
      from: "lean-zip/root",
      to: "vir/*",
      owner: "vir/runtime",
      messageCount: 4,
      latest: "ROOT-VIR-20260813-002",
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

test("warns about work before a requested claim", () => {
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("must be claimed before work updates")));
});

test("allows threaded forks and warns about replies after a terminal state", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "claim",
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
    fields: { disposition: "discarded", head: "aaaaaaa" },
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
    fields: { branch: "fix/forked-work" },
  }), "VIR-ROOT-20260813-003.md");
  const result = validateMessages([request, claim, cancel, afterCancel, fork]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("terminal state `cancelled`")));
  assert.equal(result.threads[0].messageCount, 5);
  assert.equal(result.threads[0].branchCount, 2);
  assert.equal(result.threads[0].state, "in-progress");
  assert.equal(result.threads[0].branch, "fix/forked-work");
  assert.equal(result.threads[0].head, null);
  assert.equal(result.threads[0].disposition, null);
});

test("warns about malformed advisory operational metadata", () => {
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("project-relative")));
  assert(result.warnings.some((warning) => warning.includes("valid Git branch")));
  assert(result.warnings.some((warning) => warning.includes("Git object ID")));
  assert(result.warnings.some((warning) => warning.includes("unknown publication state")));
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

test("warns about unconventional lifecycle metadata", () => {
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("`owner` is conventionally used")));
  assert(result.warnings.some((warning) => warning.includes("`disposition` is conventionally used")));
  assert(!result.warnings.some((warning) => warning.includes("`parent-thread` is conventionally used")));
  assert(!result.warnings.some((warning) => warning.includes("`depends-on` is conventionally used")));
});

test("allows ad hoc correspondence kinds with advisory warnings", () => {
  const source = message({
    id: "ROOT-VIR-20260813-001",
    kind: "decision",
    state: "considered",
    fields: { "requires-claim": "true" },
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260813-001.md")]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("unknown message kind `decision`")));
  assert(result.warnings.some((warning) => warning.includes("`requires-claim` is conventionally used only")));
});

test("warns about unconventional optional metadata and thread links", () => {
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("optional field `branch` should be omitted")));
  assert(result.warnings.some((warning) => warning.includes("should accompany a concrete `worktree` path")));
  assert(result.warnings.some((warning) => warning.includes("should not name itself as its parent")));
  assert(result.warnings.some((warning) => warning.includes("should not depend on itself")));
  assert(result.warnings.some((warning) => warning.includes("duplicate dependency thread ID")));
});

test("rejects normalized but impossible timestamp dates", () => {
  const source = message({
    id: "ROOT-VIR-20260230-001",
    time: "2026-02-30T14:30:00+02:00",
  });
  const result = validateMessages([parseMessage(source, "ROOT-VIR-20260230-001.md")]);
  assert(result.errors.some((error) => error.includes("valid ISO 8601 timestamp")));
});

test("requires a concrete sender and warns about a wildcard owner", () => {
  const request = parseMessage(message({
    id: "ROOT-VIR-20260813-001",
    from: "lean-zip/*",
  }), "ROOT-VIR-20260813-001.md");
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread: "ROOT-VIR-20260813-001",
    reply: "ROOT-VIR-20260813-001",
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "claim",
    state: "claimed",
    fields: { owner: "vir/*" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, claim]);
  assert(result.errors.some((error) => error.includes("`from` must name a concrete agent")));
  assert(result.warnings.some((warning) => warning.includes("`owner` should name a concrete agent")));
});

test("warns about requested-project claims and current-owner completion", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const wrongClaim = parseMessage(message({
    id: "OTHER-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "other/runtime",
    to: "lean-zip/root",
    kind: "claim",
    state: "claimed",
    fields: { owner: "other/runtime" },
  }), "OTHER-ROOT-20260813-001.md");
  let result = validateMessages([request, wrongClaim]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("must match the requested project/agent address")));

  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "claim",
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("completion must come from the current owner")));
});

test("warns when cross-project replies address another project", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const wrongDestination = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "other/root",
    kind: "claim",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, wrongDestination]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("must address project `lean-zip`")));
});

test("warns when a sibling agent claims a concrete recipient", () => {
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
    kind: "claim",
    state: "claimed",
    fields: { owner: "vir/performance" },
  }), "VIR-ROOT-20260813-001.md");
  const result = validateMessages([request, siblingClaim]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("must match the requested project/agent address")));
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
    kind: "claim",
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

test("warns when handoff regresses an active work state", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "claim",
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("handoff cannot move state")));
});

test("recommends direct completion for a no-claim request", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({
    id: thread,
    fields: { "requires-claim": "false" },
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
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("accepts a claim, completion")));
});

test("warns when same-project replies address another project", () => {
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
    kind: "claim",
    state: "claimed",
    fields: { owner: "vir/runtime" },
  }), "VIR-VIR-20260813-002.md");
  const result = validateMessages([request, wrongDestination]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("must address project `vir`")));
});

test("warns about state regressions and terminal messages without disposition", () => {
  const thread = "ROOT-VIR-20260813-001";
  const request = parseMessage(message({ id: thread }), `${thread}.md`);
  const claim = parseMessage(message({
    id: "VIR-ROOT-20260813-001",
    thread,
    reply: thread,
    from: "vir/runtime",
    to: "lean-zip/root",
    kind: "claim",
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
  const result = validateMessages([request, claim, progress, regression, completion]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("cannot move state from `in-progress` to `claimed`")));
  assert(result.warnings.some((warning) => warning.includes("conventionally records a durable disposition")));
});

test("allows free-form messages, extension metadata, and simple IDs", () => {
  const source = message({ id: "note-1", kind: null, state: null, fields: {
    "x-codex-session": "abc123",
    mood: "curious",
  } });
  const parsed = parseMessage(source, "note-1.md");
  const result = validateMessages([parsed]);
  assert.deepEqual(result.errors, []);
  assert(result.warnings.some((warning) => warning.includes("prefer an `x-*` name")));
  assert(!result.warnings.some((warning) => warning.includes("x-codex-session")));
  assert.equal(result.threads[0].state, "active");
});

test("links executable and free-form child threads to a planning thread", () => {
  const planningId = "plan-runtime-boundary";
  const planning = parseMessage(message({
    id: planningId,
    kind: null,
    state: null,
    subject: "choose the runtime boundary",
  }), `${planningId}.md`);
  const laneId = "implement-runtime-boundary";
  const lane = parseMessage(message({
    id: laneId,
    fields: { "parent-thread": planningId },
    subject: "implement the selected runtime boundary",
  }), `${laneId}.md`);
  const followupId = "record-runtime-boundary-notes";
  const followup = parseMessage(message({
    id: followupId,
    kind: null,
    state: null,
    fields: {
      "parent-thread": planningId,
      "depends-on": laneId,
    },
    subject: "record follow-up observations",
  }), `${followupId}.md`);

  const result = validateMessages([planning, lane, followup]);
  assert.deepEqual(result.errors, []);
  assert(!result.warnings.some((warning) => warning.includes("conventionally used only on an opening message")));
  assert.equal(result.threads.find((thread) => thread.threadId === planningId).state, "active");
  assert.equal(result.threads.find((thread) => thread.threadId === laneId).parentThread, planningId);
  assert.deepEqual(result.threads.find((thread) => thread.threadId === followupId).dependsOn, [laneId]);
});

test("keeps missing reply targets and cross-thread parents as integrity errors", () => {
  const first = parseMessage(message({ id: "thread-a", kind: null, state: null }), "thread-a.md");
  const second = parseMessage(message({ id: "thread-b", kind: null, state: null }), "thread-b.md");
  const missing = parseMessage(message({
    id: "reply-missing",
    thread: "thread-a",
    reply: "not-present",
    kind: null,
    state: null,
  }), "reply-missing.md");
  const crossed = parseMessage(message({
    id: "reply-crossed",
    thread: "thread-a",
    reply: "thread-b",
    kind: null,
    state: null,
  }), "reply-crossed.md");
  const result = validateMessages([first, second, missing, crossed]);
  assert(result.errors.some((error) => error.includes("reply target `not-present` is missing")));
  assert(result.errors.some((error) => error.includes("reply target `thread-b` belongs to another thread")));
});

test("archives an entirely terminal thread and leaves active threads in place", async () => {
  await withMailbox(async (mailbox) => {
    const closed = "ROOT-VIR-20260813-001";
    const active = "ROOT-VIR-20260813-002";
    await put(mailbox, closed, message({ id: closed, fields: { "requires-claim": "false" } }));
    await put(mailbox, "ROOT-VIR-20260813-003", message({
      id: "ROOT-VIR-20260813-003",
      thread: closed,
      reply: closed,
      time: "2026-08-13T15:00:00+02:00",
      kind: "cancellation",
      state: "cancelled",
      fields: { disposition: "discarded" },
    }));
    await put(mailbox, active, message({ id: active }));

    const archived = spawnSync(process.execPath, [script, "archive", closed, "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(archived.status, 0, archived.stderr);
    assert.match(archived.stdout, /2 message\(s\) -> archive\/ROOT-VIR-20260813-001/);
    assert.deepEqual(inspectMailbox(mailbox).threads.map((thread) => thread.threadId), [active]);
    const archive = inspectArchive(mailbox);
    assert.deepEqual(archive.errors, []);
    assert.deepEqual(archive.threads.map((thread) => thread.threadId), [closed]);
    const listedArchive = spawnSync(process.execPath, [script, "list", "--archive", "--json", "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(listedArchive.status, 0, listedArchive.stderr);
    assert.deepEqual(JSON.parse(listedArchive.stdout).threads.map((thread) => thread.threadId), [closed]);

    const archivedDraft = join(mailbox, "..", "archived-duplicate.md");
    await writeFile(archivedDraft, message({ id: closed }));
    assert.throws(() => deliverMessage(mailbox, archivedDraft), /already exists in the archive/);
    assert.equal(existsSync(join(mailbox, `${closed}.md`)), false);

    const refused = spawnSync(process.execPath, [script, "archive", active, "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /nonterminal replies/);

    await put(mailbox, closed, message({ id: closed }));
    const activeMailbox = inspectMailbox(mailbox);
    assert(activeMailbox.errors.some((error) => error.includes("already exists in the archive")));
    assert(inspectArchive(mailbox).errors.some((error) => error.includes("also exists in the active mailbox")));
  });
});

test("archive inspection rejects manually stored nonterminal threads", async () => {
  await withMailbox(async (mailbox) => {
    const thread = "active-note";
    const destination = join(mailbox, "archive", thread);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, `${thread}.md`), message({
      id: thread,
      kind: null,
      state: null,
    }));
    const result = inspectArchive(mailbox);
    assert(result.errors.some((error) => error.includes("archived thread has a nonterminal reply")));
  });
});

test("archive inspection reports empty directories and unexpected entries", async () => {
  await withMailbox(async (mailbox) => {
    const closed = "closed-thread";
    await put(mailbox, closed, message({ id: closed, fields: { "requires-claim": "false" } }));
    await put(mailbox, "close-message", message({
      id: "close-message",
      thread: closed,
      reply: closed,
      kind: "cancellation",
      state: "cancelled",
      fields: { disposition: "discarded" },
    }));
    await mkdir(join(mailbox, "archive", "empty-thread"), { recursive: true });
    await writeFile(join(mailbox, "archive", "stray.txt"), "not a thread\n");
    await writeFile(join(mailbox, "archive", "empty-thread", "note.txt"), "not a message\n");
    const result = inspectArchive(mailbox);
    assert(result.errors.some((error) => error.includes("archive entries must be thread directories")));
    assert(result.errors.some((error) => error.includes("may contain only message files")));
    assert(result.errors.some((error) => error.includes("contains no messages")));
    assert.throws(() => archiveThread(mailbox, closed), /archive must pass integrity checks/);
  });
});

test("active inspection reports interrupted temporary delivery", async () => {
  await withMailbox(async (mailbox) => {
    await mkdir(join(mailbox, "tmp", "archive-interrupted"), { recursive: true });
    await writeFile(join(mailbox, "tmp", "deliver-interrupted.md"), "partial delivery\n");
    const result = inspectMailbox(mailbox);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.ignoredFiles, ["tmp/archive-interrupted/", "tmp/deliver-interrupted.md"]);
  });
});

test("reports malformed reserved mailbox paths without throwing", async () => {
  await withMailbox(async (mailbox) => {
    const draft = join(mailbox, "..", "draft.md");
    await writeFile(draft, message({ id: "ROOT-VIR-20260814-RESERVED" }));

    await writeFile(join(mailbox, "tmp"), "not a directory\n");
    let active = inspectMailbox(mailbox);
    assert(active.errors.some((error) => error.includes("reserved `tmp` path must be a directory")));
    assert.throws(() => deliverMessage(mailbox, draft), /reserved `tmp` path must be a directory/);

    await rm(join(mailbox, "tmp"));
    await writeFile(join(mailbox, "archive"), "not a directory\n");
    active = inspectMailbox(mailbox);
    const archive = inspectArchive(mailbox);
    assert(active.errors.some((error) => error.includes("reserved `archive` path must be a directory")));
    assert(archive.errors.some((error) => error.includes("reserved `archive` path must be a directory")));
    assert.throws(() => deliverMessage(mailbox, draft), /reserved `archive` path must be a directory/);

    await rm(join(mailbox, "archive"));
    await symlink(join(mailbox, "missing-archive"), join(mailbox, "archive"));
    active = inspectMailbox(mailbox);
    assert(active.errors.some((error) => error.includes("reserved `archive` path must be a directory")));
    assert(inspectArchive(mailbox).errors.some((error) => error.includes("reserved `archive` path must be a directory")));
  });

  const root = await mkdtemp(join(tmpdir(), "vir-mailbox-file-"));
  const mailboxFile = join(root, "mailbox");
  const draft = join(root, "draft.md");
  try {
    await writeFile(mailboxFile, "not a directory\n");
    await writeFile(draft, message({ id: "ROOT-VIR-20260814-ROOT-FILE" }));
    assert(inspectMailbox(mailboxFile).errors.some((error) => error.includes("mailbox path must be a directory")));
    assert(inspectArchive(mailboxFile).errors.some((error) => error.includes("mailbox path must be a directory")));
    assert.throws(() => deliverMessage(mailboxFile, draft), /mailbox path must be a directory/);
    assert.throws(() => archiveThread(mailboxFile, "ROOT-VIR-20260814-ROOT-FILE"), /mailbox path must be a directory/);

    await rm(mailboxFile);
    await symlink(join(root, "missing-mailbox"), mailboxFile);
    assert(inspectMailbox(mailboxFile).errors.some((error) => error.includes("mailbox path must be a directory")));
    assert(inspectArchive(mailboxFile).errors.some((error) => error.includes("mailbox path must be a directory")));
    assert.throws(() => deliverMessage(mailboxFile, draft), /mailbox path must be a directory/);
    assert.throws(() => archiveThread(mailboxFile, "ROOT-VIR-20260814-ROOT-FILE"), /mailbox path must be a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes delivery and archival across different threads", async () => {
  await withMailbox(async (mailbox) => {
    const archivedThread = "ROOT-VIR-20260814-ARCHIVE";
    await put(mailbox, archivedThread, message({
      id: archivedThread,
      fields: { "requires-claim": "false" },
    }));
    const cancellation = "ROOT-VIR-20260814-CANCEL";
    await put(mailbox, cancellation, message({
      id: cancellation,
      thread: archivedThread,
      reply: archivedThread,
      kind: "cancellation",
      state: "cancelled",
      fields: { disposition: "discarded" },
    }));
    const deliveryThread = "ROOT-VIR-20260814-ACTIVE";
    await put(mailbox, deliveryThread, message({ id: deliveryThread }));
    const reply = "VIR-ROOT-20260814-LOCKED";
    const draft = join(mailbox, "..", "locked-reply.md");
    await writeFile(draft, message({
      id: reply,
      thread: deliveryThread,
      reply: deliveryThread,
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "claim",
      state: "claimed",
      fields: { owner: "vir/runtime" },
    }));
    const lock = join(mailbox, "tmp", "operation.lock");
    await mkdir(join(mailbox, "tmp"), { recursive: true });
    await writeFile(lock, "");

    assert.throws(() => deliverMessage(mailbox, draft), /mailbox operation lock already exists/);
    assert.throws(() => archiveThread(mailbox, archivedThread), /mailbox operation lock already exists/);
    assert.equal(existsSync(join(mailbox, `${reply}.md`)), false);

    await rm(lock);
    assert.equal(deliverMessage(mailbox, draft).messageId, reply);
    assert.equal(archiveThread(mailbox, archivedThread).threadId, archivedThread);
    assert.deepEqual(readdirSync(join(mailbox, "tmp")), []);
  });
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
    await writeFile(join(mailbox, "MISSING-ID.md"), message({ id }).replace(`message-id: ${id}\n`, ""));
    const result = inspectMailbox(mailbox);
    assert(result.errors.some((error) => error.includes(`filename must be \`${id}.md\``)));
    assert(result.errors.some((error) => error.includes("message must start with `---`")));
    assert(result.errors.some((error) => error.includes("missing required field `message-id`")));
    assert(!result.errors.some((error) => error.includes("undefined.md")));
  });
});

test("atomically delivers a validated draft and preserves its source", async () => {
  await withMailbox(async (mailbox) => {
    const id = "ROOT-VIR-20260814-001";
    const draft = join(mailbox, "..", "draft.md");
    const source = message({ id });
    await writeFile(draft, source);

    const delivered = deliverMessage(mailbox, draft);
    assert.deepEqual(delivered, {
      messageId: id,
      destination: `${id}.md`,
      warnings: [],
    });
    assert.equal(readFileSync(draft, "utf8"), source);
    assert.equal(readFileSync(join(mailbox, `${id}.md`), "utf8"), source);
    assert.deepEqual(readdirSync(join(mailbox, "tmp")), []);
    assert.deepEqual(inspectMailbox(mailbox).errors, []);
  });
});

test("delivery rejects an invalid graph or duplicate identity without publishing", async () => {
  await withMailbox(async (mailbox) => {
    const draft = join(mailbox, "..", "draft.md");
    const orphan = "VIR-ROOT-20260814-001";
    await writeFile(draft, message({
      id: orphan,
      thread: "ROOT-VIR-20260814-001",
      reply: "ROOT-VIR-20260814-001",
      from: "vir/runtime",
      to: "lean-zip/root",
      kind: "update",
      state: "in-progress",
    }));
    assert.throws(() => deliverMessage(mailbox, draft), /thread opener .* is missing/);
    assert.equal(existsSync(join(mailbox, `${orphan}.md`)), false);

    const existing = "ROOT-VIR-20260814-002";
    const original = message({ id: existing, body: "## Request\n\nOriginal body." });
    await put(mailbox, existing, original);
    await writeFile(draft, message({ id: existing, body: "## Request\n\nReplacement body." }));
    assert.throws(() => deliverMessage(mailbox, draft), /duplicate message ID/);
    assert.equal(readFileSync(join(mailbox, `${existing}.md`), "utf8"), original);
  });
});

test("CLI delivers a draft through the canonical delivery path", async () => {
  await withMailbox(async (mailbox) => {
    const id = "ROOT-VIR-20260814-003";
    const draft = join(mailbox, "..", "cli-draft.md");
    await writeFile(draft, message({ id, kind: "observation", state: null }));
    const delivered = spawnSync(process.execPath, [script, "deliver", draft, "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(delivered.status, 0, delivered.stderr);
    assert.match(delivered.stdout, new RegExp(`delivered ${id} -> ${id}\\.md`));
    assert.match(delivered.stderr, /warning: .*unknown message kind `observation`/);
    assert.equal(existsSync(draft), true);
    assert.equal(existsSync(join(mailbox, `${id}.md`)), true);
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
      kind: "claim",
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
      fields: { "requires-claim": "false" },
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

test("CLI reports advisory warnings without failing validation", async () => {
  await withMailbox(async (mailbox) => {
    const id = "free-form-note";
    await put(mailbox, id, message({
      id,
      kind: "observation",
      state: null,
      fields: { mood: "curious" },
    }));
    const checked = spawnSync(process.execPath, [script, "check", "--mailbox", mailbox], {
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stderr, /warning: .*unknown message kind `observation`/);
    assert.match(checked.stderr, /warning: .*prefer an `x-\*` name/);
    assert.match(checked.stdout, /mailbox ok: 1 v1 thread\(s\), 1 message\(s\)/);
  });
});

test("CLI rejects a missing mailbox option value", () => {
  const result = spawnSync(process.execPath, [script, "list", "--mailbox", "--all"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /`--mailbox` requires a path/);
});

test("CLI help describes commands and exits successfully", () => {
  const result = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deliver DRAFT/);
  assert.match(result.stdout, /archive THREAD-ID/);
  assert.equal(result.stderr, "");
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
