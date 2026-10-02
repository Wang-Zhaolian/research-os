import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse } from "@/lib/api";
import { disconnectChatGpt } from "@/lib/chatgpt-auth";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    if ((await store.read()).settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    return NextResponse.json({ ok: true, ...await disconnectChatGpt() });
  }
  catch (error) { return errorResponse(error); }
}
