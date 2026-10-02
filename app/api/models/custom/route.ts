import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { credentialVault } from "@/lib/credentials";
import { normalizeCustomBaseUrl } from "@/lib/model-runtime";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { ModelConnection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ id?: string; name: string; baseUrl: string; protocol: "chat_completions" | "responses"; modelId?: string; apiKey?: string }>(request);
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100) throw new DataError("请填写连接名称");
    if (!(["chat_completions", "responses"] as string[]).includes(body.protocol)) throw new DataError("API 协议无效");
    const baseUrl = normalizeCustomBaseUrl(body.baseUrl);
    if (typeof body.modelId !== "string" || body.modelId.length > 200) throw new DataError("模型 ID 格式无效");
    if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || body.apiKey.length > 1000 || body.apiKey.trim() !== body.apiKey)) throw new DataError("API Key 格式无效");
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const previous = body.id ? db.settings.modelConnections.find((item) => item.id === body.id) : undefined;
    if (body.id && (!previous || previous.kind !== "openai_compatible")) throw new DataError("模型连接不存在", 404);
    const connection: ModelConnection = { id: previous?.id ?? `custom_${randomUUID().replaceAll("-", "").slice(0, 12)}`, kind: "openai_compatible", name: body.name.trim(), baseUrl, protocol: body.protocol, modelId: body.modelId.trim(), createdAt: previous?.createdAt ?? new Date().toISOString() };
    const settings = { ...db.settings, modelConnections: [...db.settings.modelConnections.filter((item) => item.id !== connection.id), connection] };
    await store.saveSettings(settings, epoch);
    if (body.apiKey) await credentialVault.setCustomKey(connection.id, body.apiKey);
    return NextResponse.json({ connection, needsKey: !body.apiKey && !await credentialVault.getCustomKey(connection.id) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const { id } = await readJson<{ id: string }>(request);
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    if (!db.settings.modelConnections.some((item) => item.id === id && item.kind === "openai_compatible")) throw new DataError("自定义 API 连接不存在", 404);
    await credentialVault.setCustomKey(id, undefined);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
