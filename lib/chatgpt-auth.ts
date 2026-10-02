import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { credentialVault, type ChatGptCredential } from "./credentials.ts";

const issuer = "https://auth.openai.com";
const authorizeEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const requiredScope = "chatgpt.tokens.use.direct";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
type LoginSession = { id: string; state: string; nonce: string; verifier: string; redirectUri: string; clientId: string; firstRegistration: boolean; expectedSubject?: string; server: Server; status: "pending" | "processing" | "complete" | "error"; error?: string; expires: NodeJS.Timeout };
type SessionRegistry = typeof globalThis & { __researchOsLoginSessions?: Map<string, LoginSession> };
const registry = (globalThis as SessionRegistry).__researchOsLoginSessions ?? new Map<string, LoginSession>();
(globalThis as SessionRegistry).__researchOsLoginSessions = registry;

const b64url = (value: Buffer) => value.toString("base64url");
const safeJson = async (response: Response) => response.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export async function beginChatGptLogin() {
  const current = await credentialVault.getChatGpt();
  const registration = current ? { clientId: current.clientId, subject: current.subject } : await credentialVault.getRegistration();
  const firstRegistration = !registration;
  const clientId = registration?.clientId ?? "dynamic_agent_client";
  const state = b64url(randomBytes(32)); const nonce = b64url(randomBytes(32)); const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法创建安全的本机授权回调");
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  const id = randomUUID();
  const session: LoginSession = {
    id, state, nonce, verifier, redirectUri, clientId, firstRegistration, expectedSubject: registration?.subject,
    server, status: "pending", expires: setTimeout(() => finish(session, "error", "授权已超时，请重新连接。"), 5 * 60_000),
  };
  registry.set(id, session);
  server.on("request", (request, response) => {
    if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }).end("Method not allowed"); return; }
    void handleCallback(session, request.url ?? "/", response);
  });

  const url = new URL(authorizeEndpoint);
  const params: Record<string, string> = {
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource,
    state, nonce, code_challenge_method: "S256", code_challenge: challenge,
  };
  if (firstRegistration) params.agent_name_hint = "Research OS";
  if (current?.idToken && !firstRegistration) params.id_token_hint = current.idToken;
  if (current?.email && !firstRegistration) params.login_hint = current.email;
  params.ext_agent_host_id = await credentialVault.getHostId();
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { id, authorizationUrl: url.toString(), expiresInSeconds: 300 };
}

async function handleCallback(session: LoginSession, requestUrl: string, response: import("node:http").ServerResponse) {
  const url = new URL(requestUrl, session.redirectUri);
  if (url.pathname !== "/auth/callback") { response.writeHead(404).end("Not found"); return; }
  if (url.searchParams.get("state") !== session.state) { response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("授权校验失败，请返回 Research OS 重试。"); return; }
  if (session.status !== "pending") { response.writeHead(409).end("此授权请求已结束，请返回 Research OS。"); return; }
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description");
    finish(session, "error", oauthError === "access_denied" ? "你取消了授权。ChatGPT 订阅连接仍未启用；不会自动切换到 API。" : `授权未完成：${cleanOauthError(description ?? oauthError)}`);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(doneHtml(false)); return;
  }
  const code = url.searchParams.get("code");
  const returnedClientId = url.searchParams.get("client_id");
  if (!code || (session.firstRegistration && !returnedClientId) || (returnedClientId && !session.firstRegistration && returnedClientId !== session.clientId)) {
    finish(session, "error", "授权回调缺少授权码或客户端注册信息不匹配，请重新连接。");
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(doneHtml(false)); return;
  }
  session.status = "processing";
  const actualClientId = returnedClientId ?? session.clientId;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(processingHtml());
  try {
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: actualClientId, code, code_verifier: session.verifier, redirect_uri: session.redirectUri, resource });
    const tokenResponse = await fetch(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000), redirect: "error" });
    const payload = await safeJson(tokenResponse);
    if (!tokenResponse.ok) throw new Error(tokenErrorMessage(payload.error));
    const idToken = typeof payload.id_token === "string" ? payload.id_token : "";
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
    if (!idToken || !accessToken || !refreshToken) throw new Error("授权服务未返回完整的续期凭据。");
    const verified = await jwtVerify(idToken, jwks, { issuer, audience: actualClientId });
    if (verified.payload.nonce !== session.nonce) throw new Error("授权票据的 nonce 与本次登录不匹配，已拒绝保存。");
    const subject = verified.payload.sub;
    if (!subject || (session.expectedSubject && subject !== session.expectedSubject)) throw new Error("授权账号与原连接账号不一致；为避免覆盖其他账号，凭据未更改。");
    const scopes = parseGrantedScopes(payload.scope);
    if (!hasDirectChatGptScope(scopes)) throw new Error("该 ChatGPT 账号没有授予订阅模型使用权限。请在官方授权页同意 ChatGPT plan usage，或在模型设置中主动选择备用 API。");
    const credential: ChatGptCredential = {
      issuer, subject, email: typeof verified.payload.email === "string" ? verified.payload.email : undefined,
      clientId: actualClientId, hostId: await credentialVault.getHostId(), idToken, accessToken, refreshToken,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000, scopes,
    };
    await credentialVault.saveChatGpt(credential);
    await credentialVault.saveRegistration({ clientId: actualClientId, subject, email: credential.email });
    finish(session, "complete");
  } catch (error) { finish(session, "error", error instanceof Error ? error.message : "授权验证失败；凭据未保存。"); }
}

function doneHtml(success: boolean) {
  const text = success ? "授权信息已安全返回。你可以关闭此页并回到 Research OS。" : "授权未完成。你可以关闭此页并回到 Research OS 查看原因。";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Research OS 授权</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#172033"><h1>Research OS</h1><p>${text}</p></body></html>`;
}
function processingHtml() { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Research OS 授权</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#172033"><h1>Research OS</h1><p>授权码已返回，Research OS 正在验证登录信息。请回到应用查看连接结果。</p></body></html>`; }
function cleanOauthError(value: string) { return value.replace(/[\r\n<>]/g, " ").slice(0, 160); }
export function parseGrantedScopes(value: unknown) { return typeof value === "string" ? value.split(/[\s+]+/).filter(Boolean) : []; }
export function hasDirectChatGptScope(scopes: string[]) { return scopes.includes(requiredScope); }
function tokenErrorMessage(value: unknown) {
  if (value === "invalid_grant") return "授权码已过期或无法使用，请重新开始登录。";
  if (value === "access_denied") return "你取消了 ChatGPT 订阅授权。";
  return "授权服务拒绝了令牌交换；请重新登录后重试。";
}
function finish(session: LoginSession, status: LoginSession["status"], error?: string) {
  session.status = status; session.error = error;
  clearTimeout(session.expires);
  session.server.close();
  setTimeout(() => registry.delete(session.id), 10 * 60_000).unref();
}

export function getChatGptLoginStatus(id: string) {
  const session = registry.get(id);
  return session ? { status: session.status, error: session.error } : { status: "expired" as const, error: "授权请求已过期，请重新开始。" };
}
export function cancelChatGptLogin(id: string) {
  const session = registry.get(id);
  if (session?.status === "pending") finish(session, "error", "已取消授权。");
}

let tokenRefresh: Promise<string> | undefined;
export async function getChatGptAccessToken() {
  const credential = await credentialVault.getChatGpt();
  if (!credential) throw new Error("ChatGPT 订阅尚未连接。可在设置中连接订阅，或明确选择备用 API。");
  if (credential.scopes.includes(requiredScope) && credential.expiresAt > Date.now() + 60_000) return credential.accessToken;
  if (!tokenRefresh) tokenRefresh = refreshChatGptToken().finally(() => { tokenRefresh = undefined; });
  return tokenRefresh;
}
async function refreshChatGptToken() {
  return credentialVault.update(async (vault) => {
    const current = vault.chatgpt;
    if (!current) throw new Error("ChatGPT 订阅连接已断开。");
    if (current.expiresAt > Date.now() + 60_000) return { next: vault, value: current.accessToken };
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: current.clientId, refresh_token: current.refreshToken, resource });
    const response = await fetch(tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20_000), redirect: "error" });
    const payload = await safeJson(response);
    if (!response.ok || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") throw new Error(response.status === 401 || response.status === 400 ? "ChatGPT 登录已失效，请重新登录。" : "ChatGPT 订阅令牌续期失败；未切换到 API。请稍后重试或重新登录。");
    const scopes = String(payload.scope ?? current.scopes.join(" ")).split(/[\s+]+/).filter(Boolean);
    if (!scopes.includes(requiredScope)) throw new Error("续期后没有订阅模型权限。请重新连接 ChatGPT；不会自动切换到 API。");
    const expiresAt = Date.now() + (Number(payload.expires_in) || 3600) * 1000;
    const nextCredential = { ...current, accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresAt, scopes, idToken: typeof payload.id_token === "string" ? payload.id_token : current.idToken };
    const next = { ...vault, chatgpt: nextCredential, pi: { ...vault.pi, openai: { type: "oauth" as const, access: payload.access_token, refresh: payload.refresh_token, expires: expiresAt, id_token: nextCredential.idToken, client_id: current.clientId, scope: scopes.join(" ") } } };
    return { next, value: payload.access_token };
  });
}

export async function getChatGptModels() {
  const accessToken = await getChatGptAccessToken();
  const response = await fetch(`${resource}/models`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000), redirect: "error", cache: "no-store" });
  const payload = await safeJson(response);
  if (!response.ok || !Array.isArray(payload.models)) throw new Error(response.status === 401 ? "ChatGPT 登录已过期，请重新登录。" : "无法读取此账号的订阅模型列表；请检查连接状态。不会切换到 API。");
  return payload.models.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const model = item as Record<string, unknown>;
    return model.visibility === "list" && typeof model.slug === "string" ? [{ id: model.slug, name: typeof model.display_name === "string" ? model.display_name : model.slug }] : [];
  });
}

export async function disconnectChatGpt() {
  const current = await credentialVault.getChatGpt();
  let remoteRevocationConfirmed = !current?.refreshToken;
  if (current?.refreshToken) {
    try {
      const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
      const discovery = await safeJson(discoveryResponse);
      const endpoint = typeof discovery.revocation_endpoint === "string" ? new URL(discovery.revocation_endpoint) : undefined;
      if (!discoveryResponse.ok || !endpoint || endpoint.protocol !== "https:" || endpoint.origin !== issuer) throw new Error("无法确认官方会话撤销地址");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: current.clientId, token: current.refreshToken, token_type_hint: "refresh_token" }), signal: AbortSignal.timeout(5000), redirect: "error" });
      remoteRevocationConfirmed = response.status === 200;
    } catch { remoteRevocationConfirmed = false; }
  }
  await credentialVault.disconnectChatGpt();
  return { remoteRevocationConfirmed };
}
