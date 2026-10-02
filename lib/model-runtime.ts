import type { Context, ImageContent, Model } from "@earendil-works/pi-ai";
import { streamSimple as piCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as piResponses } from "@earendil-works/pi-ai/api/openai-responses";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type { ModelConnection } from "./types.ts";
import { getChatGptAccessToken } from "./chatgpt-auth.ts";
import { credentialVault } from "./credentials.ts";

const textFromError = (event: { error?: { content?: unknown } }) => {
  const error = event.error as (Record<string, unknown> & { content?: unknown }) | undefined;
  const content = Array.isArray(error?.content) ? error.content : [];
  const parts = content.flatMap((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : []);
  for (const key of ["errorMessage", "message", "rawStopReason"]) if (typeof error?.[key] === "string") parts.unshift(error[key] as string);
  return parts.join(" ");
};

function makeResponseModel(id: string, baseUrl: string, provider: string, useDeveloperInstructions = false): Model<"openai-responses"> { return { id, name: id, api: "openai-responses", provider, baseUrl, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: useDeveloperInstructions, thinkingLevelMap: useDeveloperInstructions ? { off: null } : undefined, contextWindow: 64_000, maxTokens: 8_192 }; }
function makeCompletionModel(id: string, baseUrl: string, provider: string): Model<"openai-completions"> { return { id, name: id, api: "openai-completions", provider, baseUrl, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, contextWindow: 64_000, maxTokens: 8_192 }; }

async function consume(stream: ReturnType<typeof piResponses>, onDelta?: (delta: string) => void, terminalIsComplete?: () => boolean): Promise<string> {
  let text = ""; let finished = false; let failure = ""; let doneReason = "";
  for await (const event of stream) {
    if (event.type === "text_delta") { text += event.delta; onDelta?.(event.delta); }
    if (event.type === "done") { doneReason = event.reason; finished = event.reason === "stop"; }
    if (event.type === "error") { failure = textFromError(event) || "模型流中断，未收到完整响应。"; break; }
  }
  if (!finished || terminalIsComplete && !terminalIsComplete()) throw new Error(summarizeModelError(failure || (doneReason ? `响应未完整结束（${doneReason}）。` : "响应流未收到完整结束事件。")));
  if (!text.trim()) throw new Error("模型返回了空响应。");
  return text;
}

export function summarizeModelError(message: string): string {
  const value = message.toLowerCase();
  if (value.includes("subscription_sharing_unsupported_capability") || /unsupported[^.\n]*(image|file|input)/i.test(message) || /does not support[^.\n]*(image|file|input)/i.test(message)) return "当前所选 ChatGPT 模型不支持本轮附件格式或能力。请手动选择支持该输入的模型，或移除附件后重试；不会自动切换到其他渠道。";
  if (value.includes("subscription_sharing_usage_limit_exceeded") || value.includes("usage limit")) return "ChatGPT 订阅的当前使用额度不可用。请稍后重试；不会自动切换到 API。";
  if (value.includes("subscription_sharing_usage_unavailable")) return "此账号当前没有可用的 ChatGPT 订阅模型权限。请检查授权状态；不会自动切换到 API。";
  if (value.includes("incomplete") || value.includes("response.completed") || value.includes("响应未完整") || value.includes("未收到完整结束")) return "模型响应未完整结束，因此没有生成可确认草稿。请重试；不会自动切换到其他渠道。";
  if (value.includes("401") || value.includes("unauthorized")) return "模型连接认证失败，请重新登录或检查所选连接；不会自动切换到其他渠道。";
  if (value.includes("429") || value.includes("rate limit")) return "模型服务繁忙或触发频率限制，请稍后重试；不会自动切换到其他渠道。";
  return "模型请求失败或连接中断。请检查模型连接后重试；不会自动切换到其他渠道。";
}

export async function runChatGptModel(modelId: string, prompt: string, history: { role: "user" | "assistant"; text: string }[], signal?: AbortSignal, onDelta?: (delta: string) => void, imageInputs: ImageContent[] = []) {
  const apiKey = await getChatGptAccessToken();
  const model = { ...makeResponseModel(modelId, "https://api.openai.com/v1", "openai", true), input: imageInputs.length ? ["text", "image"] as ("text" | "image")[] : ["text"] as ("text" | "image")[] };
  const content = [{ type: "text" as const, text: prompt }, ...imageInputs];
  const context: Context = { systemPrompt: "你是 Research OS 的个人科研与学习助手。不得虚构用户背景或已完成的进展。以中文清晰回答；涉及写入时只输出可供审阅的 JSON 草稿，不代表用户已确认。\n\n此前对话：\n" + history.slice(-20).map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.text}`).join("\n"), messages: [{ role: "user", content, timestamp: Date.now() }] };
  let receivedCompletedEvent = false;
  const stream = piResponses(model, normalizeContext(context), { apiKey, signal, timeoutMs: 90_000, maxRetries: 0, cacheRetention: "none", onProviderStreamEvent(event) { if (event && typeof event === "object" && "type" in event && event.type === "response.completed") receivedCompletedEvent = true; } });
  return consume(stream, onDelta, () => receivedCompletedEvent);
}

export async function runCustomModel(connection: ModelConnection, prompt: string, history: { role: "user" | "assistant"; text: string }[], signal?: AbortSignal, onDelta?: (delta: string) => void) {
  if (!connection.baseUrl || !connection.modelId || !connection.protocol) throw new Error("备用 API 配置不完整。");
  const apiKey = await credentialVault.getCustomKey(connection.id);
  if (!apiKey) throw new Error("此设备尚未填写该 API Key。");
  const baseUrl = normalizeCustomBaseUrl(connection.baseUrl);
  const provider = `research-os-custom-${connection.id}`;
  const context: Context = { systemPrompt: "你是 Research OS 的个人科研与学习助手。不得虚构用户背景或已完成的进展。以中文清晰回答；涉及写入时只输出可供审阅的 JSON 草稿，不代表用户已确认。\n\n此前对话：\n" + history.slice(-20).map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.text}`).join("\n"), messages: [{ role: "user", content: prompt, timestamp: Date.now() }] };
  const allowedOrigin = new URL(baseUrl).origin;
  const safeFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== allowedOrigin) throw new Error("备用 API 请求目标与已配置服务不一致。");
    return fetch(input, { ...init, redirect: "error" });
  };
  const normalized = normalizeContext(context);
  if (connection.protocol === "responses") {
    let receivedCompletedEvent = false;
    const stream = piResponses(makeResponseModel(connection.modelId, baseUrl, provider), normalized, { apiKey, signal, timeoutMs: 90_000, maxRetries: 0, fetch: safeFetch, onProviderStreamEvent(event) { if (event && typeof event === "object" && "type" in event && event.type === "response.completed") receivedCompletedEvent = true; } });
    return consume(stream, onDelta, () => receivedCompletedEvent);
  }
  const stream = piCompletions(makeCompletionModel(connection.modelId, baseUrl, provider), normalized, { apiKey, signal, timeoutMs: 90_000, maxRetries: 0, fetch: safeFetch });
  return consume(stream as ReturnType<typeof piResponses>, onDelta);
}

export function normalizeCustomBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Base URL 格式无效。"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  if (!(["https:"].includes(url.protocol) || local && url.protocol === "http:") || url.username || url.password || url.search || url.hash) throw new Error("备用 API 必须使用 HTTPS；本机/局域网服务可使用 HTTP，且 URL 不能含账号、密码或查询参数。");
  return url.toString().replace(/\/$/, "");
}
