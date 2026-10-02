import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { attachmentSummary, extractAttachmentText, inspectUpload, readLocalFile, removeLocalFile, storeLocalFile } from "@/lib/attachments";
import { assertLocalMutation, errorResponse } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { LocalAttachment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await store.read();
    const attachments = await Promise.all(db.attachments.filter((item) => !item.archived).map(async (item) => {
      try { await readLocalFile(item.localFileId, item.filename); return { ...item, available: true }; }
      catch { return { ...item, available: false }; }
    }));
    return NextResponse.json(attachments, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const created: LocalAttachment[] = [];
  try {
    const epoch = assertLocalMutation(request);
    const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length || files.length > 5) throw new DataError("每次可添加 1–5 个附件");
    const sourceKind = form.get("sourceKind") === "pasted_text" ? "pasted_text" : "upload";
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 40 * 1024 * 1024) throw new DataError("单次附件总大小不能超过 40 MB");
    const prepared = [] as { file: File; bytes: Buffer; extraction: Awaited<ReturnType<typeof extractAttachmentText>>; mimeType: string; sha256: string }[];
    for (const file of files) {
      const checked = inspectUpload(file.name, file.type, file.size); const bytes = Buffer.from(await file.arrayBuffer());
      const extraction = await extractAttachmentText(file.name, checked.mimeType, bytes);
      prepared.push({ file, bytes, extraction, mimeType: checked.mimeType, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const previews = [];
    for (const item of prepared) {
      const duplicate = db.attachments.find((attachment) => attachment.sha256 === item.sha256 && !attachment.archived);
      let metadata: LocalAttachment; let isDuplicate = false;
      if (duplicate) { metadata = duplicate; isDuplicate = true; }
      else {
        const local = await storeLocalFile(item.file.name, item.mimeType, item.bytes, sourceKind);
        metadata = { ...local, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [], extractedSummary: attachmentSummary(item.extraction.text) };
        try { await store.registerAttachment(metadata, epoch); created.push(metadata); }
        catch (error) { await removeLocalFile(metadata.localFileId, metadata.filename).catch(() => undefined); throw error; }
      }
      previews.push({ attachment: metadata, duplicate: isDuplicate, previewText: item.extraction.text.slice(0, 8_000), textLength: item.extraction.text.length, pageCount: item.extraction.pageCount, isImage: item.extraction.isImage });
    }
    return NextResponse.json({ attachments: previews }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    for (const item of created.reverse()) {
      await store.removeAttachment(item.id, request.headers.get("x-research-os-epoch") ?? "").catch(() => undefined);
      await removeLocalFile(item.localFileId, item.filename).catch(() => undefined);
    }
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const epoch = assertLocalMutation(request); const url = new URL(request.url); const id = url.searchParams.get("id");
    if (!id) throw new DataError("缺少附件 ID");
    const item = await store.removeAttachment(id, epoch);
    await removeLocalFile(item.localFileId, item.filename);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
