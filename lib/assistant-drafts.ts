import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AIProposal } from "./types.ts";

const execFileAsync = promisify(execFile);
export interface StoredAssistantDraft { conversationId: string; messageId: string; proposal: AIProposal }

function directory() {
  if (process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR) return path.resolve(process.env.RESEARCH_OS_ASSISTANT_DRAFTS_DIR);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Research OS", "assistant-drafts");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Research OS", "assistant-drafts");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "research-os", "assistant-drafts");
}

function safe(value: string) { return /^[a-z0-9_-]{1,100}$/i.test(value); }
function filename(conversationId: string, proposalId: string) {
  if (!safe(conversationId) || !safe(proposalId)) throw new Error("待确认草稿 ID 无效");
  return path.join(directory(), `${conversationId}_${proposalId}.json`);
}

async function secure(target: string, isDirectory: boolean) {
  if (process.platform === "win32") {
    const who = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
    const sid = who.stdout.match(/\bS-\d-(?:\d+-)+\d+\b/)?.[0];
    if (!sid) throw new Error("无法识别当前 Windows 用户，待确认 AI 草稿未写入。");
    const inheritance = isDirectory ? "(OI)(CI)" : "";
    await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:${inheritance}F`, `*S-1-5-18:${inheritance}F`], { windowsHide: true });
  } else await chmod(target, isDirectory ? 0o700 : 0o600);
}

export async function saveAssistantDraft(value: StoredAssistantDraft) {
  if (value.proposal.id.length > 100 || value.proposal.changes.length > 50 || !value.messageId || !value.proposal.dataEpoch) throw new Error("待确认 AI 草稿格式无效");
  const root = directory();
  await mkdir(root, { recursive: true, mode: 0o700 }); await secure(root, true);
  const target = filename(value.conversationId, value.proposal.id); const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await secure(temporary, false);
    await rename(temporary, target); await secure(target, false);
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

export async function getAssistantDraft(conversationId: string, proposalId: string, dataEpoch: string) {
  const target = filename(conversationId, proposalId);
  try {
    const value = JSON.parse(await readFile(target, "utf8")) as StoredAssistantDraft;
    if (value.conversationId !== conversationId || value.proposal.id !== proposalId) throw new Error("待确认 AI 草稿文件不匹配");
    if (value.proposal.dataEpoch !== dataEpoch) { await rm(target, { force: true }); return undefined; }
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export async function listAssistantDrafts(conversationId: string, dataEpoch: string) {
  if (!safe(conversationId)) throw new Error("对话 ID 无效");
  const root = directory();
  const names = await readdir(/*turbopackIgnore: true*/ root).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const prefix = `${conversationId}_`;
  const proposals = await Promise.all(names.filter((name) => name.startsWith(prefix) && name.endsWith(".json")).map(async (name) => {
    const proposalId = name.slice(prefix.length, -5);
    if (!safe(proposalId)) return undefined;
    return getAssistantDraft(conversationId, proposalId, dataEpoch);
  }));
  return proposals.filter((item): item is StoredAssistantDraft => Boolean(item));
}

export async function removeAssistantDraft(conversationId: string, proposalId: string) {
  await rm(filename(conversationId, proposalId), { force: true });
}
