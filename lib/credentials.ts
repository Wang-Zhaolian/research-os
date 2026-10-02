import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

const execFileAsync = promisify(execFile);

export interface ChatGptCredential {
  issuer: string; subject: string; email?: string; clientId: string; hostId: string;
  idToken?: string; accessToken: string; refreshToken: string; expiresAt: number; scopes: string[];
}
interface VaultFile {
  version: 1; hostId: string; chatgpt?: ChatGptCredential; registration?: { clientId: string; subject: string; email?: string };
  pi: Record<string, Credential>; customKeys: Record<string, string>;
}

function credentialDirectory() {
  if (process.env.RESEARCH_OS_AUTH_DIR) return path.resolve(process.env.RESEARCH_OS_AUTH_DIR);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Research OS", "credentials");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Research OS", "credentials");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "research-os", "credentials");
}

export class CredentialVault implements CredentialStore {
  readonly directory: string;
  #queue: Promise<unknown> = Promise.resolve();
  #memory: VaultFile | undefined;

  constructor(directory = credentialDirectory()) { this.directory = directory; }

  async #secure(target: string, directory: boolean) {
    if (process.platform === "win32") {
      const who = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
      const sid = who.stdout.match(/\bS-\d-(?:\d+-)+\d+\b/)?.[0];
      if (!sid) throw new Error("无法识别当前 Windows 用户，凭据未写入。");
      const inheritance = directory ? "(OI)(CI)" : "";
      await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:${inheritance}F`, `*S-1-5-18:${inheritance}F`], { windowsHide: true });
      return;
    }
    await chmod(target, directory ? 0o700 : 0o600);
  }

  async #load(): Promise<VaultFile> {
    if (this.#memory) return structuredClone(this.#memory);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.#secure(this.directory, true);
    try {
      const target = path.join(this.directory, "credentials.json");
      await access(target);
      await this.#secure(target, false);
      const data = JSON.parse(await readFile(target, "utf8")) as Partial<VaultFile>;
      if (data.version !== 1 || typeof data.hostId !== "string" || !data.pi || !data.customKeys) throw new Error("vault-format");
      this.#memory = { version: 1, hostId: data.hostId, chatgpt: data.chatgpt, registration: data.registration, pi: data.pi, customKeys: data.customKeys };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("本机凭据文件无法读取或格式无效；为保护凭据，已停止访问");
      this.#memory = { version: 1, hostId: `urn:uuid:${randomUUID()}`, pi: {}, customKeys: {} };
      await this.#save(this.#memory);
    }
    return structuredClone(this.#memory);
  }

  async #save(next: VaultFile) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.#secure(this.directory, true);
    const target = path.join(this.directory, "credentials.json");
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await this.#secure(temp, false);
      await rename(temp, target);
      await this.#secure(target, false);
      this.#memory = structuredClone(next);
    } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
  }

  async update<T>(fn: (current: VaultFile) => Promise<{ next: VaultFile; value: T }> | { next: VaultFile; value: T }): Promise<T> {
    const result = this.#queue.then(async () => {
      const current = await this.#load();
      const { next, value } = await fn(current);
      await this.#save(next);
      return value;
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async getChatGpt() { return (await this.#load()).chatgpt; }
  async saveChatGpt(chatgpt: ChatGptCredential) { return this.update((current) => ({ next: { ...current, chatgpt, registration: { clientId: chatgpt.clientId, subject: chatgpt.subject, email: chatgpt.email }, pi: { ...current.pi, openai: { type: "oauth", access: chatgpt.accessToken, refresh: chatgpt.refreshToken, expires: chatgpt.expiresAt, id_token: chatgpt.idToken, client_id: chatgpt.clientId, scope: chatgpt.scopes.join(" ") } } }, value: undefined })); }
  async getRegistration() { return (await this.#load()).registration; }
  async saveRegistration(registration: NonNullable<VaultFile["registration"]>) { return this.update((current) => ({ next: { ...current, registration }, value: undefined })); }
  async disconnectChatGpt() { return this.update((current) => { const pi = { ...current.pi }; delete pi.openai; return { next: { ...current, chatgpt: undefined, pi }, value: undefined }; }); }
  async getCustomKey(connectionId: string) { return (await this.#load()).customKeys[connectionId]; }
  async setCustomKey(connectionId: string, key: string | undefined) { return this.update((current) => { const customKeys = { ...current.customKeys }; if (key) customKeys[connectionId] = key; else delete customKeys[connectionId]; return { next: { ...current, customKeys }, value: undefined }; }); }
  async getHostId() { return (await this.#load()).hostId; }

  async read(providerId: string): Promise<Credential | undefined> { return (await this.#load()).pi[providerId]; }
  async list(): Promise<readonly CredentialInfo[]> { return Object.entries((await this.#load()).pi).map(([providerId, value]) => ({ providerId, type: value.type })); }
  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.update(async (current) => {
      const value = await fn(current.pi[providerId]);
      const pi = { ...current.pi };
      if (value) pi[providerId] = value; else delete pi[providerId];
      return { next: { ...current, pi }, value };
    });
  }
  async delete(providerId: string): Promise<void> { await this.update((current) => { const pi = { ...current.pi }; delete pi[providerId]; return { next: { ...current, pi }, value: undefined }; }); }
}

export const credentialVault = new CredentialVault();
