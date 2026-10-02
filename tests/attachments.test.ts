import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import { extractAttachmentText, inspectUpload, readLocalFile, removeLocalFile, storeLocalFile } from "../lib/attachments.ts";
import { createAttachmentArchive } from "../lib/attachment-export.ts";
import type { LocalAttachment } from "../lib/types.ts";

const stamp = "2026-10-02T00:00:00.000Z";

test("local source files stay outside JSON data and are represented by metadata and hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-os-attachments-test-"));
  const previous = process.env.RESEARCH_OS_ATTACHMENTS_DIR;
  process.env.RESEARCH_OS_ATTACHMENTS_DIR = path.join(root, "private-attachments");
  const secretSource = "PRIVATE_SOURCE_TEXT_42: this text must never be written into chat JSON.";
  try {
    const bytes = Buffer.from(secretSource, "utf8");
    const metadata = await storeLocalFile("materials.txt", "text/plain", bytes, "pasted_text");
    const loaded = await readLocalFile(metadata.localFileId, metadata.filename);
    assert.equal(loaded.bytes.toString("utf8"), secretSource);
    assert.equal((await extractAttachmentText(metadata.filename, loaded.mimeType, loaded.bytes)).text, secretSource);
    assert.equal(metadata.sha256.length, 64);
    assert.equal(metadata.localFileId.includes("/"), false);
    assert.equal(await stat(path.join(root, "private-attachments", `${metadata.localFileId}.txt`)).then(() => true), true);
    const serializedMetadata = JSON.stringify(metadata);
    assert.doesNotMatch(serializedMetadata, /PRIVATE_SOURCE_TEXT_42/);
    assert.doesNotMatch(serializedMetadata, /this text must never/);
    assert.notEqual(path.dirname(path.join(root, "private-attachments", `${metadata.localFileId}.txt`)), root);
    await removeLocalFile(metadata.localFileId, metadata.filename);
    await assert.rejects(readLocalFile(metadata.localFileId, metadata.filename), /缺少该附件原件/);
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_OS_ATTACHMENTS_DIR;
    else process.env.RESEARCH_OS_ATTACHMENTS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("attachment type and size checks reject unsupported or spoofed files", () => {
  assert.throws(() => inspectUpload("notes.exe", "application/octet-stream", 20), /只支持/);
  assert.throws(() => inspectUpload("notes.txt", "image/png", 20), /格式不一致/);
  assert.throws(() => inspectUpload("huge.pdf", "application/pdf", 21 * 1024 * 1024), /20 MB/);
  assert.throws(() => inspectUpload("empty.md", "text/markdown", 0), /20 MB/);
});

test("attachment export ZIP contains a hash manifest and marks missing originals", () => {
  const present: LocalAttachment = { id: "attachment_1", createdAt: stamp, updatedAt: stamp, tags: [], filename: "成绩/成绩.csv", mimeType: "text/csv", size: 8, sha256: "a".repeat(64), localFileId: "local-1", sourceKind: "upload", extractedSummary: "摘要" };
  const missing: LocalAttachment = { ...present, id: "attachment_2", filename: "缺失.pdf", sha256: "b".repeat(64) };
  const archive = unzipSync(createAttachmentArchive([{ attachment: present, bytes: new TextEncoder().encode("a,b\n1,2\n") }, { attachment: missing }], stamp));
  const manifest = JSON.parse(new TextDecoder().decode(archive["manifest.json"])) as { format: string; files: { id: string; available: boolean; archivePath?: string; sha256: string }[] };
  assert.equal(manifest.format, "research-os-attachments-v1");
  assert.equal(manifest.files[0].available, true);
  assert.match(manifest.files[0].archivePath ?? "", /^attachments\/attachment_1_/);
  assert.equal(new TextDecoder().decode(archive[manifest.files[0].archivePath!]), "a,b\n1,2\n");
  assert.equal(manifest.files[0].sha256, "a".repeat(64));
  assert.deepEqual(manifest.files[1], { id: "attachment_2", filename: "缺失.pdf", mimeType: "text/csv", size: 8, sha256: "b".repeat(64), available: false });
});
