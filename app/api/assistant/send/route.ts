import { randomUUID } from "node:crypto";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { allDeadlines, dateInZone, searchDatabase } from "@/lib/domain";
import { getChatGptModels } from "@/lib/chatgpt-auth";
import { runChatGptModel, runCustomModel } from "@/lib/model-runtime";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { AIConversation, AIConversationMessage, AIProposalChange, CollectionKey, Database } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editable = new Set<CollectionKey>(["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"]);
const validActions = new Set(["create", "update", "progress", "priorities"]);
const encoder = new TextEncoder();

function modelJson(text: string, validCitations: Set<string>) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(stripped) as Record<string, unknown>;
  if (!value || typeof value !== "object" || typeof value.reply !== "string" || value.reply.length > 20_000 || !Array.isArray(value.changes) || value.changes.length > 50 || !Array.isArray(value.citationIds)) throw new Error("模型返回内容不符合 Research OS 草稿格式，未保存任何操作。");
  const changes = value.changes.map((change): AIProposalChange => {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("模型返回了无效操作，未保存草稿。");
    const item = change as Record<string, unknown>;
    if (typeof item.action !== "string" || !validActions.has(item.action) || typeof item.collection !== "string" || !editable.has(item.collection as CollectionKey) || !item.entity || typeof item.entity !== "object" || Array.isArray(item.entity) || typeof item.explanation !== "string") throw new Error("模型返回了不支持或字段不完整的操作，未保存草稿。");
    if ((item.action === "update" || item.action === "progress") && typeof item.id !== "string") throw new Error("模型修改操作缺少目标 ID，未保存草稿。");
    if (item.action === "create" && (typeof item.id !== "string" || !/^[a-z0-9:_-]{1,100}$/i.test(item.id))) throw new Error("模型新建操作缺少关联标识，未保存草稿。");
    if (item.action === "priorities" && item.collection !== "tasks") throw new Error("模型重点调整目标无效，未保存草稿。");
    return { action: item.action as AIProposalChange["action"], collection: item.collection as AIProposalChange["collection"], id: item.id as string | undefined, entity: item.entity as Record<string, unknown>, explanation: item.explanation.slice(0, 500) };
  });
  if (value.citationIds.some((id) => typeof id !== "string" || !validCitations.has(id))) throw new Error("模型引用了本轮没有提供的数据记录，已拒绝此响应。");
  return { reply: value.reply, changes, citationIds: value.citationIds as string[] };
}

function buildContext(db: Database, userText: string, includeGrades: boolean, contextHint: string) {
  const words = [...new Set(userText.toLocaleLowerCase().split(/[^\p{L}\p{N}_+-]+/u).filter((word) => word.length >= 2))].slice(0, 12);
  const selected = new Map<string, { collection: string; id: string; title: string; record: unknown }>();
  const add = (collection: string, id: string, title: string, record: unknown) => selected.set(`${collection}:${id}`, { collection, id, title, record });
  for (const word of words) for (const result of searchDatabase(db, word)) {
    if (result.collection === "grades" && !includeGrades) continue;
    if ((result.entity as { archived?: boolean }).archived) continue;
    add(result.collection, result.entity.id, result.title, result.entity);
  }
  const today = dateInZone(new Date(), db.settings.timeZone);
  const deadlines = allDeadlines(db).filter((item) => item.date <= addDate(today, 30)).slice(0, 12);
  const referencedTasks = db.tasks.filter((task) => !task.archived && task.status !== "completed" && (task.pinned || task.dueDate && task.dueDate <= addDate(today, 30)));
  for (const task of referencedTasks.slice(0, 8)) add("tasks", task.id, task.title, task);
  if (includeGrades) for (const grade of db.grades.filter((item) => !item.archived).slice(-12)) add("grades", grade.id, grade.course, grade);
  const records = [...selected.values()].slice(0, 18);
  const recordIds = new Set(records.map((item) => item.id));
  const progress = db.progressEvents.filter((event) => !event.archived && (event.taskId && recordIds.has(event.taskId) || event.parentRef && recordIds.has(event.parentRef.id))).slice(-12);
  const citations = [...new Map([...selected.values()].map(({ collection, id, title }) => [`${collection}:${id}`, { collection, id, title }])).values()];
  const data = {
    personalProfile: db.profile,
    relevantActiveRecords: records.map(({ collection, id, title, record }) => ({ collection, id, title, details: JSON.stringify(record).slice(0, 2000) })),
    upcomingDeadlines: deadlines,
    recentRelevantProgress: progress,
    grades: includeGrades ? db.grades.filter((item) => !item.archived).map(({ id, semester, course, credits, score, gradingType, result, includeInAverage }) => ({ id, semester, course, credits, score, gradingType, result, includeInAverage })).slice(0, 30) : undefined,
    currentPage: contextHint.slice(0, 2000),
  };
  return { data, citations, allRefs: new Set([...records.map((item) => item.id), ...citations.map((item) => item.id)]) };
}

function addDate(date: string, days: number) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }

export async function POST(request: Request) {
  let epoch: string;
  try { epoch = assertLocalMutation(request); } catch (error) { return errorResponse(error); }
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
  });
  const emit = (event: string, data: unknown) => controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const run = async () => {
    let conversation: AIConversation | undefined; let userMessage: AIConversationMessage | undefined;
    try {
      const body = await readJson<{ conversationId?: string; text: string; includeGrades?: boolean; contextHint?: string }>(request);
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 12_000) throw new DataError("請輸入 1–12000 字的內容");
      const db = await store.read(); if (db.settings.dataEpoch !== epoch) throw new DataError("工作区已变化，请刷新页面", 409);
      conversation = body.conversationId ? await store.getConversation(body.conversationId, epoch) : undefined;
      const now = new Date().toISOString();
      conversation ??= { id: randomUUID().replaceAll("-", ""), title: body.text.trim().slice(0, 36), createdAt: now, updatedAt: now, messages: [], allowGrades: false, dataEpoch: epoch };
      const includeGrades = body.includeGrades === true;
      userMessage = { id: randomUUID().replaceAll("-", ""), role: "user", text: body.text.trim(), createdAt: now, status: "complete", usesGradeContext: includeGrades };
      conversation.messages.push(userMessage); conversation.updatedAt = now;
      await store.saveConversation(conversation, epoch);
      const connection = db.settings.modelConnections.find((item) => item.id === db.settings.defaultModelConnectionId) ?? db.settings.modelConnections.find((item) => item.kind === "chatgpt_subscription");
      if (!connection) throw new DataError("请先在设置中连接 ChatGPT 订阅，或由你主动配置并选择备用 API。", 409);
      if (!connection.modelId) throw new DataError("请先在设置中从账号实际模型列表选择一个默认模型。", 409);
      if (connection.kind === "chatgpt_subscription") {
        const available = await getChatGptModels();
        if (!available.some((item) => item.id === connection.modelId)) throw new DataError("此模型不在当前 ChatGPT 账号的可用列表中，请刷新模型列表。", 409);
      }
      const context = buildContext(db, body.text, includeGrades, body.contextHint ?? "");
      const prompt = `用户本轮请求：\n${body.text.trim()}\n\n下面是 Research OS 在本机检索到的参考资料。只把它当作事实来源，不得补造未提供的背景、成绩、课程进度、导师或研究结论。归档记录、备份、凭据不在上下文内。成绩仅在用户本轮明确勾选授权时提供。\n${JSON.stringify(context.data)}\n\n请只返回一个 JSON 对象，格式为：{"reply":"给用户看的答复","changes":[],"citationIds":[]}。changes 是待用户审阅的建议，禁止直接声称已写入。允许 action 为 create/update/progress/priorities；collection 为 tasks/learning/research/papers/projects/competitions/goals。新建记录需提供唯一 draft id（例如 draft-1），并在同批关联中引用该 id；update/progress 的 id 必须是已存在记录 ID；priorities 的 entity 格式为 {"taskIds":[...]}。实体字段使用应用数据模型的英文键，缺少信息留空或追问，绝不猜日期。citationIds 只能是以下本地记录 ID：${JSON.stringify([...context.allRefs])}。不支持删除、初始化、模型凭据或 Git 操作。`;
      const previous = conversation.messages.slice(0, -1).filter((item) => item.role !== "assistant" || item.status === "complete").filter((item) => !item.usesGradeContext || includeGrades).map((item) => ({ role: item.role, text: item.text }));
      let fullText: string;
      try {
        const onDelta = (delta: string) => emit("delta", { delta });
        const source = connection.kind === "chatgpt_subscription" ? runChatGptModel(connection.modelId, prompt, previous, request.signal, onDelta) : runCustomModel(connection, prompt, previous, request.signal, onDelta);
        fullText = await source;
      } catch (error) {
        conversation.messages.push({ id: randomUUID().replaceAll("-", ""), role: "assistant", text: error instanceof Error ? error.message : "模型请求失败；未保存操作草稿。", createdAt: new Date().toISOString(), status: "interrupted", channel: connection.kind });
        conversation.updatedAt = new Date().toISOString(); await store.saveConversation(conversation, epoch);
        emit("error", { error: error instanceof Error ? error.message : "模型请求失败；未保存操作草稿。", conversationId: conversation.id }); return;
      }
      const parsed = modelJson(fullText, context.allRefs);
      const proposal = parsed.changes.length ? { id: randomUUID().replaceAll("-", ""), dataEpoch: epoch, dataRevision: db.settings.dataRevision, changes: parsed.changes } : undefined;
      const citations = parsed.citationIds.map((id) => context.citations.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      const assistantMessage: AIConversationMessage = { id: randomUUID().replaceAll("-", ""), role: "assistant", text: parsed.reply, createdAt: new Date().toISOString(), status: "complete", channel: connection.kind, usesGradeContext: includeGrades, citations, proposal };
      conversation.messages.push(assistantMessage); conversation.updatedAt = assistantMessage.createdAt;
      await store.saveConversation(conversation, epoch);
      if (proposal) {
        try { await store.applyAIProposal({ conversationId: conversation.id, proposalId: proposal.id, operationId: randomUUID().replaceAll("-", ""), indexes: proposal.changes.map((_item, index) => index), expectedEpoch: epoch, expectedRevision: db.settings.dataRevision, dryRun: true }); }
        catch (error) {
          assistantMessage.status = "interrupted"; assistantMessage.proposal = undefined;
          assistantMessage.text += `\n\n这份建议未通过本地数据校验，因此没有生成可应用草稿：${error instanceof Error ? error.message : "字段或关联无效"}`;
          await store.saveConversation(conversation, epoch);
          emit("error", { error: "AI 建议未通过本地校验，未保存任何操作。请补充信息后重试。", conversationId: conversation.id }); return;
        }
      }
      emit("complete", { conversationId: conversation.id, message: assistantMessage, expectedRevision: db.settings.dataRevision, channel: connection.kind });
    } catch (error) {
      if (conversation && userMessage && conversation.messages.at(-1)?.id === userMessage.id) {
        conversation.messages.push({ id: randomUUID().replaceAll("-", ""), role: "assistant", text: error instanceof Error ? error.message : "助手请求失败，未生成可应用草稿。", createdAt: new Date().toISOString(), status: "interrupted", usesGradeContext: userMessage.usesGradeContext });
        conversation.updatedAt = new Date().toISOString();
        await store.saveConversation(conversation, epoch).catch(() => undefined);
      }
      emit("error", { error: error instanceof Error ? error.message : "助手请求失败。", conversationId: conversation?.id });
    }
  };
  queueMicrotask(() => { void run().finally(() => controller?.close()); });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
