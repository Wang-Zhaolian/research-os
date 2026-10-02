import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DataError } from "./validation.ts";

const execFileAsync = promisify(execFile);
const maxTextCharacters = 150_000;
const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
};

function attachmentDirectory() {
  if (process.env.RESEARCH_OS_ATTACHMENTS_DIR) return path.resolve(process.env.RESEARCH_OS_ATTACHMENTS_DIR);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Research OS", "attachments");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Research OS", "attachments");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "research-os", "attachments");
}

async function secure(target: string, directory: boolean) {
  if (process.platform === "win32") {
    const result = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
    const sid = result.stdout.match(/\bS-\d-(?:\d+-)+\d+\b/)?.[0];
    if (!sid) throw new Error("无法识别当前 Windows 用户，附件未写入。");
    const inheritance = directory ? "(OI)(CI)" : "";
    await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:${inheritance}F`, `*S-1-5-18:${inheritance}F`], { windowsHide: true });
  } else await chmod(target, directory ? 0o700 : 0o600);
}

export function inspectUpload(filename: string, mimeType: string, size: number) {
  const extension = path.extname(filename).toLocaleLowerCase();
  const expected = mimeByExtension[extension];
  if (!expected) throw new DataError("只支持 JPG、PNG、WebP、PDF、DOCX、TXT、MD 和 CSV 文件");
  if (!Number.isSafeInteger(size) || size <= 0 || size > 20 * 1024 * 1024) throw new DataError("单个附件必须小于或等于 20 MB");
  const acceptedTypes = new Set([expected, "application/octet-stream", ""]);
  if (!acceptedTypes.has(mimeType)) throw new DataError("文件扩展名与浏览器报告的格式不一致");
  return { extension, mimeType: expected };
}

function verifySignature(extension: string, data: Buffer) {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  if (extension === ".pdf" && data.subarray(0, 1024).indexOf(Buffer.from("%PDF-")) < 0) throw new DataError("PDF 文件头无效");
  if ([".docx"].includes(extension) && !starts(0x50, 0x4b, 0x03, 0x04)) throw new DataError("DOCX 文件不是有效的 Office 文档容器");
  if (extension === ".png" && !starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) throw new DataError("PNG 图片头无效");
  if ([".jpg", ".jpeg"].includes(extension) && !starts(0xff, 0xd8, 0xff)) throw new DataError("JPEG 图片头无效");
  if (extension === ".webp" && (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP")) throw new DataError("WebP 图片头无效");
}

export async function storeLocalFile(filename: string, mimeType: string, bytes: Buffer, sourceKind: "upload" | "pasted_text" = "upload") {
  const checked = inspectUpload(filename, mimeType, bytes.byteLength);
  verifySignature(checked.extension, bytes);
  const directory = attachmentDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 }); await secure(directory, true);
  const id = randomUUID(); const target = path.join(directory, `${id}${checked.extension}`); const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" }); await secure(temporary, false); await rename(temporary, target); await secure(target, false);
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
  return { localFileId: id, filename: path.basename(filename).slice(0, 200), mimeType: checked.mimeType, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), sourceKind };
}

export async function readLocalFile(localFileId: string, filename: string) {
  if (!/^[a-f0-9-]{36}$/i.test(localFileId)) throw new DataError("附件 ID 无效");
  const extension = path.extname(filename).toLocaleLowerCase();
  if (!mimeByExtension[extension]) throw new DataError("附件格式无效");
  const target = path.join(attachmentDirectory(), `${localFileId}${extension}`);
  const bytes = await readFile(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") throw new DataError("此设备缺少该附件原件，请在附件区重新添加", 404); throw error; });
  return { bytes, mimeType: mimeByExtension[extension] };
}

export async function removeLocalFile(localFileId: string, filename: string) {
  if (!/^[a-f0-9-]{36}$/i.test(localFileId)) throw new DataError("附件 ID 无效");
  const extension = path.extname(filename).toLocaleLowerCase();
  if (!mimeByExtension[extension]) throw new DataError("附件格式无效");
  await rm(path.join(attachmentDirectory(), `${localFileId}${extension}`), { force: true });
}

export async function extractAttachmentText(filename: string, mimeType: string, bytes: Buffer) {
  const extension = inspectUpload(filename, mimeType, bytes.byteLength).extension;
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) return { text: "", pageCount: undefined as number | undefined, isImage: true };
  if ([".txt", ".md", ".csv"].includes(extension)) return { text: new TextDecoder("utf-8").decode(bytes).replaceAll("\u0000", "").slice(0, maxTextCharacters), pageCount: undefined, isImage: false };
  if (extension === ".docx") {
    try { const result = await mammoth.extractRawText({ buffer: bytes }); return { text: result.value.slice(0, maxTextCharacters), pageCount: undefined, isImage: false }; }
    catch { throw new DataError("无法从 DOCX 提取文字；请检查文件是否损坏或重新保存", 422); }
  }
  if (extension === ".pdf") {
    try {
      const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
      const document = await loadingTask.promise;
      if (document.numPages > 120) { await loadingTask.destroy(); throw new DataError("PDF 超过 120 页，请拆分后分别导入", 413); }
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber); const content = await page.getTextContent();
        pages.push(content.items.map((item) => "str" in item && typeof item.str === "string" ? item.str : "").join(" "));
        if (pages.join("\n").length >= maxTextCharacters) break;
      }
      await loadingTask.destroy();
      return { text: pages.join("\n\n").slice(0, maxTextCharacters), pageCount: document.numPages, isImage: false };
    } catch (error) { if (error instanceof DataError) throw error; throw new DataError("无法从 PDF 提取文本；若是扫描版，请先用 OCR 转成可检索 PDF 或图片", 422); }
  }
  throw new DataError("此附件格式暂不支持");
}

export function attachmentSummary(text: string) { return text.replace(/\s+/g, " ").trim().slice(0, 260); }
