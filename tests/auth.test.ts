import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const authRoot = await mkdtemp(path.join(os.tmpdir(), "research-os-auth-test-"));
const previousAuthPath = process.env.RESEARCH_OS_AUTH_DIR;
process.env.RESEARCH_OS_AUTH_DIR = authRoot;
const auth = await import("../lib/chatgpt-auth.ts");
const { credentialVault } = await import("../lib/credentials.ts");
const originalFetch = globalThis.fetch;

after(async () => {
  globalThis.fetch = originalFetch;
  if (previousAuthPath === undefined) delete process.env.RESEARCH_OS_AUTH_DIR;
  else process.env.RESEARCH_OS_AUTH_DIR = previousAuthPath;
  await rm(authRoot, { recursive: true, force: true });
});

async function waitForTerminalStatus(id: string) {
  for (let index = 0; index < 100; index++) {
    const status = auth.getChatGptLoginStatus(id);
    if (status.status !== "pending" && status.status !== "processing") return status;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("OAuth callback did not reach a terminal status");
}

test("ChatGPT OAuth validates loopback state, cancellation, issued client IDs, and granted scopes", async () => {
  const denied = await auth.beginChatGptLogin();
  const deniedUrl = new URL(denied.authorizationUrl);
  assert.equal(deniedUrl.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(deniedUrl.searchParams.get("agent_name_hint"), "Research OS");
  assert.equal(deniedUrl.searchParams.get("resource"), "https://api.openai.com/v1");
  const callback = new URL(deniedUrl.searchParams.get("redirect_uri")!);
  assert.equal(callback.hostname, "127.0.0.1");
  assert.equal(callback.pathname, "/auth/callback");
  callback.searchParams.set("state", "incorrect-state");
  assert.equal((await originalFetch(callback)).status, 400);
  assert.equal(auth.getChatGptLoginStatus(denied.id).status, "pending");
  auth.cancelChatGptLogin(denied.id);
  assert.match(auth.getChatGptLoginStatus(denied.id).error ?? "", /已取消/);

  const cancelled = await auth.beginChatGptLogin();
  const cancelledUrl = new URL(cancelled.authorizationUrl);
  const cancelledCallback = new URL(cancelledUrl.searchParams.get("redirect_uri")!);
  cancelledCallback.searchParams.set("state", cancelledUrl.searchParams.get("state")!);
  cancelledCallback.searchParams.set("error", "access_denied");
  await originalFetch(cancelledCallback);
  assert.match(auth.getChatGptLoginStatus(cancelled.id).error ?? "", /取消了授权/);

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keyId = "research-os-test-key";
  const publicJwk = { ...jwk, kid: keyId, alg: "RS256", use: "sig" };
  let grantedScope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  const authUrlForCode = new Map<string, string>();
  const oauthFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
    if (url === "https://auth.openai.com/api/accounts/oauth/token") {
      const form = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(form.get("client_id"), form.get("code") === "first-code" ? "oaiapp_research_os_test" : "oaiapp_research_os_test");
      const pending = new URL(authUrlForCode.get(form.get("code")!)!);
      const nonce = pending.searchParams.get("nonce")!;
      const idToken = await new SignJWT({ nonce, email: "student@example.edu" }).setProtectedHeader({ alg: "RS256", kid: keyId }).setIssuer("https://auth.openai.com").setAudience(form.get("client_id")!).setSubject("account-subject-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
      const payload: Record<string, unknown> = { id_token: idToken, access_token: "oauth-access-token", refresh_token: "oauth-refresh-token", expires_in: 3600 };
      if (grantedScope) payload.scope = grantedScope;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://auth.openai.com/.well-known/jwks.json") return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new Error(`Unexpected OAuth test request: ${url}`);
  };
  globalThis.fetch = oauthFetch;

  const success = await auth.beginChatGptLogin();
  const successUrl = new URL(success.authorizationUrl);
  const redirect = new URL(successUrl.searchParams.get("redirect_uri")!);
  const successClientId = "oaiapp_research_os_test";
  authUrlForCode.set("first-code", success.authorizationUrl);
  redirect.searchParams.set("code", "first-code");
  redirect.searchParams.set("state", successUrl.searchParams.get("state")!);
  redirect.searchParams.set("client_id", successClientId);
  redirect.searchParams.set("scope", "openid");
  await originalFetch(redirect);
  const successStatus = await waitForTerminalStatus(success.id);
  assert.equal(successStatus.status, "complete");
  const savedCredential = await credentialVault.getChatGpt();
  assert.equal(savedCredential?.clientId, successClientId);
  assert.equal(savedCredential?.subject, "account-subject-1");
  assert.equal(savedCredential?.email, "student@example.edu");

  await credentialVault.saveChatGpt({ ...savedCredential!, expiresAt: Date.now() - 1 });
  let refreshCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
    const form = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.has("scope"), false);
    refreshCalls++;
    return new Response(JSON.stringify({ access_token: "rotated-access-token", refresh_token: "rotated-refresh-token", expires_in: 3600, scope: "openid offline_access chatgpt.tokens.use.direct" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  assert.deepEqual(await Promise.all([auth.getChatGptAccessToken(), auth.getChatGptAccessToken()]), ["rotated-access-token", "rotated-access-token"]);
  assert.equal(refreshCalls, 1, "parallel requests should serialize rotating refresh tokens");
  assert.equal((await credentialVault.getChatGpt())?.refreshToken, "rotated-refresh-token");
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://api.openai.com/v1/models");
    return new Response(JSON.stringify({ models: [{ slug: "gpt-account-model", display_name: "Account model", visibility: "list" }, { slug: "hidden-model", display_name: "Hidden", visibility: "hidden" }, { display_name: "Malformed", visibility: "list" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  assert.deepEqual(await auth.getChatGptModels(), [{ id: "gpt-account-model", name: "Account model" }]);
  const credentialBeforeNoConsent = await credentialVault.getChatGpt();
  globalThis.fetch = oauthFetch;

  grantedScope = "openid profile email offline_access resource.invoke";
  const noConsent = await auth.beginChatGptLogin();
  const noConsentUrl = new URL(noConsent.authorizationUrl);
  const noConsentRedirect = new URL(noConsentUrl.searchParams.get("redirect_uri")!);
  authUrlForCode.set("missing-consent-code", noConsent.authorizationUrl);
  noConsentRedirect.searchParams.set("code", "missing-consent-code");
  noConsentRedirect.searchParams.set("state", noConsentUrl.searchParams.get("state")!);
  noConsentRedirect.searchParams.set("scope", "chatgpt.tokens.use.direct");
  await originalFetch(noConsentRedirect);
  const noConsentStatus = await waitForTerminalStatus(noConsent.id);
  assert.equal(noConsentStatus.status, "error");
  assert.match(noConsentStatus.error ?? "", /没有授予订阅模型使用权限/);
  assert.equal((await credentialVault.getChatGpt())?.accessToken, credentialBeforeNoConsent?.accessToken);

  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://auth.openai.com/.well-known/openid-configuration") return new Response(JSON.stringify({ revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" }), { status: 200, headers: { "Content-Type": "application/json" } });
    assert.equal(url, "https://auth.openai.com/api/accounts/oauth/revoke");
    const form = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(form.get("token_type_hint"), "refresh_token");
    assert.equal(form.get("token"), "rotated-refresh-token");
    return new Response(null, { status: 200 });
  };
  assert.deepEqual(await auth.disconnectChatGpt(), { remoteRevocationConfirmed: true });
  assert.equal(await credentialVault.getChatGpt(), undefined);
});
