import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { getAssistantDraft, removeAssistantDraft } from "@/lib/assistant-drafts";
import { store } from "@/lib/store";
import type { AIProposalChange } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ conversationId: string; proposalId: string; operationId: string; indexes: number[]; expectedRevision: number; validateOnly?: boolean; editedChanges?: AIProposalChange[] }>(request);
    const draft = await getAssistantDraft(body.conversationId, body.proposalId, epoch);
    const result = await store.applyAIProposal({ ...body, expectedEpoch: epoch, dryRun: body.validateOnly, externalProposal: draft?.proposal });
    if (!body.validateOnly) await removeAssistantDraft(body.conversationId, body.proposalId);
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error); }
}
