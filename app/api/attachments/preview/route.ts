import { NextResponse } from "next/server";
import { extractAttachmentText, readLocalFile } from "@/lib/attachments";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ ids: string[] }>(request);
    if (!Array.isArray(body.ids) || body.ids.length > 5 || body.ids.some((id) => typeof id !== "string") || new Set(body.ids).size !== body.ids.length) throw new DataError("附件预览列表无效");
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const result = [];
    for (const id of body.ids) {
      const item = db.attachments.find((entry) => entry.id === id && !entry.archived);
      if (!item) throw new DataError("附件记录不存在或已归档", 404);
      const local = await readLocalFile(item.localFileId, item.filename);
      const extracted = await extractAttachmentText(item.filename, local.mimeType, local.bytes);
      result.push({ attachment: item, previewText: extracted.text.slice(0, 8_000), textLength: extracted.text.length, pageCount: extracted.pageCount, isImage: extracted.isImage, available: true });
    }
    return NextResponse.json({ attachments: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
