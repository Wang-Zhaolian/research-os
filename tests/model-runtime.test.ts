import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const authRoot = await mkdtemp(path.join(os.tmpdir(), "research-os-runtime-test-"));
const previousAuthPath = process.env.RESEARCH_OS_AUTH_DIR;
process.env.RESEARCH_OS_AUTH_DIR = authRoot;
const { credentialVault } = await import("../lib/credentials.ts");
const { runChatGptModel } = await import("../lib/model-runtime.ts");
const originalFetch = globalThis.fetch;
let nextEvents: Record<string, unknown>[] = [];
const requests: Record<string, unknown>[] = [];

after(async () => {
  globalThis.fetch = originalFetch;
  if (previousAuthPath === undefined) delete process.env.RESEARCH_OS_AUTH_DIR;
  else process.env.RESEARCH_OS_AUTH_DIR = previousAuthPath;
  await rm(authRoot, { recursive: true, force: true });
});

function streamResponse(events: Record<string, unknown>[]) {
  const body = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("Pi adapter sends compliant, stateless ChatGPT plan requests and accepts only completed responses", async () => {
  await credentialVault.saveChatGpt({ issuer: "https://auth.openai.com", subject: "test-subject", clientId: "oaiapp_test", hostId: "urn:uuid:test", accessToken: "test-oauth-token", refreshToken: "test-refresh-token", expiresAt: Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] });
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    assert.equal(url, "https://api.openai.com/v1/responses");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    assert.equal(headers.get("authorization"), "Bearer test-oauth-token");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push(body);
    return streamResponse(nextEvents);
  };

  const item = { type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Research OS 连接测试成功。", annotations: [] }] };
  nextEvents = [
    { type: "response.created", response: { id: "resp_test" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "Research OS 连接测试成功。" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_test", status: "completed", output: [item] } },
  ];
  const deltas: string[] = [];
  assert.equal(await runChatGptModel("account-model", "请确认连接", [], undefined, (delta) => deltas.push(delta)), "Research OS 连接测试成功。");
  assert.deepEqual(deltas, ["Research OS 连接测试成功。"]);
  const request = requests[0];
  assert.equal(request.model, "account-model");
  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  assert.equal("max_output_tokens" in request, false);
  assert.equal("temperature" in request, false);
  assert.equal("previous_response_id" in request, false);
  const input = request.input as { role: string }[];
  assert.equal(input[0]?.role, "developer");
  assert.equal(input.some((message) => message.role === "system"), false);

  nextEvents = [
    { type: "response.created", response: { id: "resp_incomplete" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", output_index: 0, item_id: item.id, content_index: 0, delta: "partial" },
    { type: "response.incomplete", response: { id: "resp_incomplete", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [item] } },
  ];
  await assert.rejects(runChatGptModel("account-model", "请确认连接", []), /不会自动切换到其他渠道/);

  nextEvents = [{ type: "response.failed", response: { id: "resp_limited", status: "failed", error: { code: "subscription_sharing_usage_limit_exceeded", message: "usage limit reached" } } }];
  await assert.rejects(runChatGptModel("account-model", "请确认连接", []), /不会自动切换到 API/);
});
