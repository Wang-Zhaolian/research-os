import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse } from "@/lib/api";
import { beginChatGptLogin } from "@/lib/chatgpt-auth";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const db = await store.read();
    if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const settings = structuredClone(db.settings);
    if (!settings.modelConnections.some((item) => item.kind === "chatgpt_subscription")) settings.modelConnections.push({ id: "chatgpt-subscription", kind: "chatgpt_subscription", name: "ChatGPT 订阅", createdAt: new Date().toISOString() });
    if (!settings.defaultModelConnectionId) settings.defaultModelConnectionId = "chatgpt-subscription";
    if (settings.modelConnections.length !== db.settings.modelConnections.length || settings.defaultModelConnectionId !== db.settings.defaultModelConnectionId) await store.saveSettings(settings, epoch);
    return NextResponse.json(await beginChatGptLogin(), { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return errorResponse(error); }
}
