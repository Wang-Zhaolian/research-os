import { NextResponse } from "next/server";
import { readLocalFile } from "@/lib/attachments";
import { errorResponse } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new DataError("附件 ID 无效");
    const db = await store.read(); const item = db.attachments.find((attachment) => attachment.id === id && !attachment.archived);
    if (!item) throw new DataError("附件不存在", 404);
    const { bytes, mimeType } = await readLocalFile(item.localFileId, item.filename);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": mimeType, "Content-Length": String(bytes.byteLength), "Cache-Control": "no-store", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.filename)}`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
