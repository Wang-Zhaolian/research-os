import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import type { AIConversation } from "@/lib/types";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const epoch = request.headers.get("x-research-os-epoch") ?? ""; return NextResponse.json(await store.getConversation((await context.params).id, epoch), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const epoch = assertLocalMutation(request); const body = await readJson<AIConversation>(request); if (body.id !== (await context.params).id) throw new DataError("对话 ID 不匹配"); return NextResponse.json(await store.saveConversation(body, epoch)); }
  catch (error) { return errorResponse(error); }
}
