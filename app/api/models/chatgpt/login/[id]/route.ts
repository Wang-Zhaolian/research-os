import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse } from "@/lib/api";
import { cancelChatGptLogin, getChatGptLoginStatus } from "@/lib/chatgpt-auth";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(getChatGptLoginStatus((await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const epoch = assertLocalMutation(request);
    if ((await store.read()).settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    cancelChatGptLogin((await context.params).id);
    return NextResponse.json({ ok: true });
  }
  catch (error) { return errorResponse(error); }
}
