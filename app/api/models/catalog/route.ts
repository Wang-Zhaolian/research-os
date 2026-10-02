import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getChatGptModels } from "@/lib/chatgpt-auth";
import { credentialVault } from "@/lib/credentials";
import { normalizeCustomBaseUrl } from "@/lib/model-runtime";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const db = await store.read();
    const id = new URL(request.url).searchParams.get("connectionId");
    const connection = db.settings.modelConnections.find((item) => item.id === id);
    if (!connection) throw new DataError("模型连接不存在", 404);
    if (connection.kind === "chatgpt_subscription") return NextResponse.json({ models: await getChatGptModels() }, { headers: { "Cache-Control": "no-store" } });
    const key = await credentialVault.getCustomKey(connection.id);
    if (!key) throw new DataError("此设备需要填写备用 API Key", 409);
    const base = normalizeCustomBaseUrl(connection.baseUrl ?? "");
    const url = new URL(base);
    if (!url.pathname.replace(/\/$/, "").endsWith("/v1")) url.pathname = `${url.pathname.replace(/\/$/, "")}/v1`;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/models`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { data?: unknown; models?: unknown };
    if (!response.ok) throw new DataError("此服务未提供模型列表；可在模型配置中手工填写模型 ID", 422);
    const list = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    const models = list.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string" ? [{ id: (item as Record<string, string>).id, name: (item as Record<string, string>).id }] : []);
    if (!models.length) throw new DataError("此服务未返回可识别的模型列表；可手工填写模型 ID", 422);
    return NextResponse.json({ models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
