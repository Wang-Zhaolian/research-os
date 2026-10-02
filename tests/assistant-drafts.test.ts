import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAssistantDraft, listAssistantDrafts, removeAssistantDraft, saveAssistantDraft } from "../lib/assistant-drafts.ts";
import type { AIProposal } from "../lib/types.ts";

test("unconfirmed AI actions are private, epoch-bound drafts and can be cancelled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-os-ai-drafts-"));
  const previous = process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR;
  process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR = path.join(root, "private-drafts");
  const proposal: AIProposal = { id: "proposal_123", dataEpoch: "epoch_current", dataRevision: 12, changes: [{ action: "create", collection: "achievements", id: "draft-one", explanation: "从本轮资料提取出的个人成果", entity: { title: "真实经历", summary: "仅待确认" } }] };
  try {
    const draft = { conversationId: "conversation_1", messageId: "message_1", proposal };
    await saveAssistantDraft(draft);
    assert.deepEqual(await getAssistantDraft(draft.conversationId, proposal.id, proposal.dataEpoch), draft);
    assert.equal((await listAssistantDrafts(draft.conversationId, proposal.dataEpoch)).length, 1);
    if (process.platform !== "win32") assert.equal((await stat(path.join(root, "private-drafts", `${draft.conversationId}_${proposal.id}.json`))).mode & 0o077, 0);
    assert.equal(await getAssistantDraft(draft.conversationId, proposal.id, "epoch_after_restore"), undefined, "a proposal from an old workspace epoch must be discarded");
    assert.deepEqual(await readdir(path.join(root, "private-drafts")), []);
    await saveAssistantDraft(draft);
    await removeAssistantDraft(draft.conversationId, proposal.id);
    assert.equal(await getAssistantDraft(draft.conversationId, proposal.id, proposal.dataEpoch), undefined);
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR;
    else process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
