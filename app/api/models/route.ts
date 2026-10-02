import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { credentialVault } from "@/lib/credentials";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await store.read();
    const chatgpt = await credentialVault.getChatGpt();
    const connections = db.settings.modelConnections.filter((item) => item.kind === "chatgpt_subscription").map((connection) => ({
      ...connection,
      connected: Boolean(chatgpt),
      account: chatgpt?.email,
      isDefault: db.settings.defaultModelConnectionId === connection.id,
    }));
    return NextResponse.json({ connections, defaultModelConnectionId: db.settings.defaultModelConnectionId, subscriptionPrimary: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ action: "set-default" | "remove" | "choose-model"; id?: string; modelId?: string }>(request);
    const db = await store.read();
    if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    let settings = structuredClone(db.settings);
    if (body.action === "set-default") {
      const connection = settings.modelConnections.find((item) => item.id === body.id);
      if (!connection) throw new DataError("模型连接不存在");
      if (connection.kind !== "chatgpt_subscription") throw new DataError("此版本的 AI 助手固定使用 ChatGPT 订阅，不会切换到其他 API。", 403);
      settings.defaultModelConnectionId = connection.id;
    } else if (body.action === "choose-model") {
      if (!body.id || typeof body.modelId !== "string" || body.modelId.length > 200) throw new DataError("模型选择无效");
      const connection = settings.modelConnections.find((item) => item.id === body.id);
      if (!connection) throw new DataError("模型连接不存在", 404);
      if (connection.kind === "chatgpt_subscription") {
        const { getChatGptModels } = await import("@/lib/chatgpt-auth");
        const models = await getChatGptModels();
        if (!models.some((item) => item.id === body.modelId)) throw new DataError("只能选择此账号当前实际可用的模型", 422);
      }
      settings.modelConnections = settings.modelConnections.map((item) => item.id === connection.id ? { ...item, modelId: body.modelId, verifiedAt: item.modelId === body.modelId ? item.verifiedAt : undefined } : item);
    } else if (body.action === "remove") {
      if (!body.id) throw new DataError("缺少模型连接 ID");
      const connection = settings.modelConnections.find((item) => item.id === body.id);
      if (!connection) throw new DataError("模型连接不存在", 404);
      if (connection.kind === "chatgpt_subscription") throw new DataError("订阅连接请使用“断开 ChatGPT”，不可移除其模型配置");
      settings.modelConnections = settings.modelConnections.filter((item) => item.id !== body.id);
      if (settings.defaultModelConnectionId === body.id) settings.defaultModelConnectionId = "";
      await credentialVault.setCustomKey(body.id, undefined);
    } else throw new DataError("模型设置操作无效");
    settings = await store.saveSettings(settings, epoch);
    return NextResponse.json({ ok: true, settings });
  } catch (error) { return errorResponse(error); }
}
