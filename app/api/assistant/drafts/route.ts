import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse } from "@/lib/api";
import { removeAssistantDraft } from "@/lib/assistant-drafts";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const db = await store.read();
    if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const url = new URL(request.url); const conversationId = url.searchParams.get("conversationId"); const proposalId = url.searchParams.get("proposalId");
    if (!conversationId || !proposalId) throw new DataError("取消草稿所需 ID 缺失");
    await removeAssistantDraft(conversationId, proposalId);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
