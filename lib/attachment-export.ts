import { zipSync } from "fflate";
import type { LocalAttachment } from "./types.ts";

export function createAttachmentArchive(items: { attachment: LocalAttachment; bytes?: Uint8Array }[], exportedAt = new Date().toISOString()) {
  const entries: Record<string, Uint8Array> = {};
  const files = items.map(({ attachment, bytes }) => {
    const available = Boolean(bytes);
    const safeName = attachment.filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\.+$/g, "").slice(0, 160) || "attachment";
    const archivePath = available ? `attachments/${attachment.id}_${safeName}` : undefined;
    if (archivePath && bytes) entries[archivePath] = bytes;
    return { id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size, sha256: attachment.sha256, available, ...(archivePath ? { archivePath } : {}) };
  });
  entries["manifest.json"] = new TextEncoder().encode(`${JSON.stringify({ format: "research-os-attachments-v1", exportedAt, files }, null, 2)}\n`);
  return zipSync(entries, { level: 1 });
}
