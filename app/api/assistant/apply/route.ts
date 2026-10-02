import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import type { AIProposalChange } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ conversationId: string; proposalId: string; operationId: string; indexes: number[]; expectedRevision: number; validateOnly?: boolean; editedChanges?: AIProposalChange[] }>(request);
    return NextResponse.json(await store.applyAIProposal({ ...body, expectedEpoch: epoch, dryRun: body.validateOnly }));
  } catch (error) { return errorResponse(error); }
}
