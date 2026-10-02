import { readLocalFile } from "@/lib/attachments";
import { errorResponse } from "@/lib/api";
import { createAttachmentArchive } from "@/lib/attachment-export";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await store.read();
    const items = [] as { attachment: (typeof db.attachments)[number]; bytes?: Uint8Array }[];
    for (const attachment of db.attachments.filter((item) => !item.archived)) {
      try {
        const local = await readLocalFile(attachment.localFileId, attachment.filename);
        items.push({ attachment, bytes: new Uint8Array(local.bytes) });
      } catch {
        items.push({ attachment });
      }
    }
    const archive = createAttachmentArchive(items);
    const body = Uint8Array.from(archive).buffer;
    return new Response(body, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="research-os-attachments.zip"', "Cache-Control": "no-store", "Content-Length": String(archive.byteLength) } });
  } catch (error) { return errorResponse(error); }
}
