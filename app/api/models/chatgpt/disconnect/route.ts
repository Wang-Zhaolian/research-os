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
    const db = await store.read();
    if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const result = await disconnectChatGpt();
    const settings = structuredClone(db.settings);
    settings.modelConnections = settings.modelConnections.map((item) => item.kind === "chatgpt_subscription" ? { ...item, verifiedAt: undefined } : item);
    await store.saveSettings(settings, epoch);
    return NextResponse.json({ ok: true, ...result });
  }
  catch (error) { return errorResponse(error); }
}
