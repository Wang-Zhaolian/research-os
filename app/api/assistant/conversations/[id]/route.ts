import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { listAssistantDrafts } from "@/lib/assistant-drafts";
import { store } from "@/lib/store";
import type { AIConversation } from "@/lib/types";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const epoch = request.headers.get("x-research-os-epoch") ?? "";
    const conversation = await store.getConversation((await context.params).id, epoch);
    const drafts = await listAssistantDrafts(conversation.id, epoch);
    const byMessage = new Map(drafts.map((draft) => [draft.messageId, draft.proposal]));
    const messages = conversation.messages.map((message) => byMessage.has(message.id) ? { ...message, proposal: byMessage.get(message.id) } : message);
    return NextResponse.json({ ...conversation, messages }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const epoch = assertLocalMutation(request); const body = await readJson<AIConversation>(request); if (body.id !== (await context.params).id) throw new DataError("对话 ID 不匹配"); return NextResponse.json(await store.saveConversation(body, epoch)); }
  catch (error) { return errorResponse(error); }
}
