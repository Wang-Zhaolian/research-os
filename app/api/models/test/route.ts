import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { getChatGptModels } from "@/lib/chatgpt-auth";
import { runChatGptModel } from "@/lib/model-runtime";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request); const body = await readJson<{ connectionId: string }>(request);
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const connection = db.settings.modelConnections.find((item) => item.id === body.connectionId);
    if (!connection || connection.kind !== "chatgpt_subscription") throw new DataError("此平台版本只启用 ChatGPT 订阅模型；其他 API 适配器暂不开放。", 403);
    if (!connection.modelId) throw new DataError("请先从该账号的实际可用模型列表选择模型");
    const models = await getChatGptModels();
    if (!models.some((model) => model.id === connection.modelId)) throw new DataError("所选模型已不在此账号的当前模型列表中，请刷新列表后选择", 409);
    const text = await runChatGptModel(connection.modelId, "请严格只回复：Research OS 连接测试成功。", []);
    if (!text.trim()) throw new DataError("模型请求完成但没有返回文字内容，暂不能标记为已验证。", 502);
    const settings = structuredClone(db.settings);
    settings.modelConnections = settings.modelConnections.map((item) => item.id === connection.id ? { ...item, verifiedAt: new Date().toISOString() } : item);
    await store.saveSettings(settings, epoch);
    return NextResponse.json({ ok: true, response: text.slice(0, 200), channel: "ChatGPT 订阅", verifiedAt: new Date().toISOString() });
  } catch (error) { return errorResponse(error); }
}
