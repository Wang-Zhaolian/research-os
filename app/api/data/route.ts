import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return NextResponse.json(await store.read(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ settings?: Settings; reset?: boolean }>(request);
    if (body.reset) throw new DataError("全库清空接口已移除；请在归档页逐项归档记录", 410);
    if (!body.settings) throw new DataError("缺少设置");
    return NextResponse.json(await store.saveSettings(body.settings, epoch));
  } catch (error) { return errorResponse(error); }
}
