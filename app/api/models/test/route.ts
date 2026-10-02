import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { getChatGptModels } from "@/lib/chatgpt-auth";
import { runChatGptModel, runCustomModel } from "@/lib/model-runtime";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request); const body = await readJson<{ connectionId: string }>(request);
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const connection = db.settings.modelConnections.find((item) => item.id === body.connectionId);
    if (!connection?.modelId) throw new DataError("请先选择或填写模型 ID");
    const output = connection.kind === "chatgpt_subscription"
      ? (await (async () => { const models = await getChatGptModels(); if (!models.some((model) => model.id === connection.modelId)) throw new DataError("所选模型已不在此账号的当前模型列表中，请刷新列表后选择", 409); return runChatGptModel(connection.modelId!, "请严格只回复：Research OS 连接测试成功。", []); })())
      : runCustomModel(connection, "请严格只回复：Research OS 连接测试成功。", []);
    const text = await output;
    return NextResponse.json({ ok: true, response: text.slice(0, 200), channel: connection.kind === "chatgpt_subscription" ? "ChatGPT 订阅" : "备用 API" });
  } catch (error) { return errorResponse(error); }
}
