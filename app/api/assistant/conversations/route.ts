import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import type { AIConversation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const epoch = request.headers.get("x-research-os-epoch") ?? "";
    return NextResponse.json(await store.listConversations(epoch), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ title?: string }>(request);
    const now = new Date().toISOString();
    const conversation: AIConversation = { id: randomUUID().replaceAll("-", ""), title: body.title?.trim().slice(0, 100) || "新对话", createdAt: now, updatedAt: now, messages: [], allowGrades: false, dataEpoch: epoch };
    return NextResponse.json(await store.saveConversation(conversation, epoch), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
