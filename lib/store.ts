import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnyEntity, CollectionKey, Database, EveningReview, ProgressEvent, ReviewSubmission, Settings, Task } from "./types.ts";
import { dateInZone, weekStart } from "./domain.ts";
import { assertDate, assertRef, DataError, isReferenced, validateEntity, validateSettings } from "./validation.ts";

const collectionKeys: CollectionKey[] = ["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades", "reviews", "progressEvents"];
type StoredKey = CollectionKey | "settings";
type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;
const iso = () => new Date().toISOString();
const todayFor = (settings: Settings) => dateInZone(new Date(), settings.timeZone);

export const defaultSettings: Settings = {
  schemaVersion: 2,
  demoData: true,
  timeZone: "Asia/Shanghai",
  stalledDays: 7,
  gpa: { scale: 4, rules: [
    { minScore: 90, point: 4, label: "A" }, { minScore: 85, point: 3.7, label: "A-" },
    { minScore: 82, point: 3.3, label: "B+" }, { minScore: 78, point: 3, label: "B" },
    { minScore: 75, point: 2.7, label: "B-" }, { minScore: 72, point: 2.3, label: "C+" },
    { minScore: 68, point: 2, label: "C" }, { minScore: 64, point: 1.5, label: "D" },
    { minScore: 60, point: 1, label: "D-" }, { minScore: 0, point: 0, label: "F" },
  ] },
};

export const createId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

export function createStore(root = process.env.RESEARCH_OS_DATA_DIR || path.join(process.cwd(), "data")) {
  let writeQueue: Promise<void> = Promise.resolve();
  const journal = path.join(root, ".pending-transaction.json");
  const backups = path.join(root, ".backups");
  const file = (key: StoredKey) => path.join(root, `${key}.json`);
  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const atomicWrite = async (target: string, value: unknown) => {
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  };
  const readFileJson = async <T>(target: string): Promise<T> => JSON.parse(await readFile(target, "utf8")) as T;

  const recover = async () => {
    let pending: { version: number; transactionId: string; changes: Partial<Record<StoredKey, unknown>> };
    try { pending = await readFileJson(journal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new DataError("发现损坏的事务恢复记录，请先备份 data 目录并联系维护者", 500);
    }
    if (pending.version !== 1 || !pending.changes || typeof pending.changes !== "object") throw new DataError("事务恢复记录格式无效，已停止写入以保护数据", 500);
    for (const [key, value] of Object.entries(pending.changes) as [StoredKey, unknown][]) await atomicWrite(file(key), value);
    await rm(journal, { force: true });
  };

  const commit = async (changes: Partial<Record<StoredKey, unknown>>) => {
    await mkdir(root, { recursive: true });
    const payload = { version: 1, transactionId: randomUUID(), changes };
    await atomicWrite(journal, payload);
    for (const [key, value] of Object.entries(changes) as [StoredKey, unknown][]) await atomicWrite(file(key), value);
    await rm(journal, { force: true });
  };

  const readRaw = async (): Promise<Database> => {
    await mkdir(root, { recursive: true });
    let settings: Settings;
    try { settings = await readFileJson<Settings>(file("settings")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DataError("缺少 data/settings.json；为避免把数据目录误当成空库，已停止启动。请从 Git 或备份恢复数据。", 500);
      throw error;
    }
    const values = await Promise.all(collectionKeys.map(async (key) => {
      if (key === "progressEvents" && settings.schemaVersion < 2) {
        try { return await readFileJson<AnyEntity[]>(file(key)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      }
      try { return await readFileJson<AnyEntity[]>(file(key)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DataError(`缺少 data/${key}.json；为避免误写空数据，已停止启动。请从 Git 或备份恢复。`, 500); throw error; }
    }));
    return Object.fromEntries([...collectionKeys.map((key, index) => [key, values[index]]), ["settings", settings]]) as unknown as Database;
  };

  const snapshot = async (label: string, limit?: number) => {
    await mkdir(backups, { recursive: true });
    const target = path.join(backups, `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await mkdir(target, { recursive: true });
    for (const key of [...collectionKeys, "settings"] as StoredKey[]) {
      try { await copyFile(file(key), path.join(target, `${key}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (limit) {
      const dirs = (await readdir(backups, { withFileTypes: true })).filter((item) => item.isDirectory() && item.name.startsWith(`${label}-`));
      const sorted = await Promise.all(dirs.map(async (item) => ({ name: item.name, time: (await stat(path.join(backups, item.name))).mtimeMs })));
      sorted.sort((a, b) => b.time - a.time);
      for (const item of sorted.slice(limit)) await rm(path.join(backups, item.name), { recursive: true, force: true });
    }
    return target;
  };

  const hasReviewSnapshot = async (review: EveningReview): Promise<boolean> => {
    let dirs;
    try { dirs = (await readdir(backups, { withFileTypes: true })).filter((item) => item.isDirectory() && item.name.startsWith("review-")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    for (const dir of dirs) {
      try {
        const reviews = await readFileJson<EveningReview[]>(path.join(backups, dir.name, "reviews.json"));
        if (reviews.some((item) => item.id === review.id && item.revision === review.revision)) return true;
      } catch { /* incomplete older snapshots do not prove the current review was captured */ }
    }
    return false;
  };

  const migrate = async (legacy: Database): Promise<Database> => {
    const migrationDate = todayFor({ ...defaultSettings, ...legacy.settings, timeZone: legacy.settings.timeZone || "Asia/Shanghai" });
    const currentWeek = weekStart(migrationDate);
    const nextWeek = new Date(`${currentWeek}T00:00:00.000Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const nextWeekDate = nextWeek.toISOString().slice(0, 10);
    const tasks = legacy.tasks.map((old) => {
      const legacyTask = old as Task & { weekBucket?: string; relation?: Task["primaryParent"] };
      const { weekBucket: legacyBucket, relation: legacyRelation, ...task } = legacyTask;
      const primaryParent = task.primaryParent ?? legacyRelation;
      const planningState: Task["planningState"] = legacyBucket === "later" ? "later" : primaryParent ? "week" : "needs_parent";
      const plannedWeek = legacyBucket === "later" ? undefined : legacyBucket === "next_week" ? nextWeekDate : currentWeek;
      return { ...task, nextAction: task.nextAction ?? "", primaryParent, relatedRefs: task.relatedRefs ?? [], milestoneRefs: task.milestoneRefs ?? [], planningState, plannedWeek, pinned: planningState === "week" && Boolean(primaryParent) && task.pinned };
    });
    const papers = legacy.papers.map((paper) => ({ ...paper, keywords: paper.keywords ?? [], relatedResearchIds: [...new Set(paper.relatedResearchIds ?? [])], source: paper.source ?? { provider: "manual" as const } }));
    const research = legacy.research.map((item) => ({ ...item, paperIds: [...new Set(item.paperIds ?? [])] }));
    for (const item of research) for (const paperId of item.paperIds) {
      const paper = papers.find((candidate) => candidate.id === paperId);
      if (paper) paper.relatedResearchIds = [...new Set([...paper.relatedResearchIds, item.id])];
    }
    for (const item of research) item.paperIds = papers.filter((paper) => paper.relatedResearchIds.includes(item.id)).map((paper) => paper.id);
    const db: Database = {
      ...legacy,
      tasks,
      papers,
      research,
      goals: legacy.goals.map((goal) => ({ ...goal, linkedItems: goal.linkedItems ?? [], milestones: goal.milestones.map((milestone) => ({ ...milestone, evidence: milestone.evidence ?? "" })) })),
      reviews: legacy.reviews.map((review) => ({ ...review, revision: review.revision ?? 1, operationIds: review.operationIds ?? [] })),
      progressEvents: legacy.progressEvents ?? [],
      settings: { ...defaultSettings, ...legacy.settings, schemaVersion: 2, timeZone: legacy.settings.timeZone || "Asia/Shanghai", stalledDays: legacy.settings.stalledDays ?? 7 },
    };
    await snapshot("migration-v1");
    return db;
  };

  const ensure = async (): Promise<Database> => {
    await recover();
    const db = await readRaw();
    if (db.settings.schemaVersion === 1) {
      const migrated = await migrate(db);
      const changes: Partial<Record<StoredKey, unknown>> = { ...Object.fromEntries(collectionKeys.map((key) => [key, migrated[key]])), settings: migrated.settings };
      await commit(changes);
      return migrated;
    }
    if (db.settings.schemaVersion !== 2) throw new DataError(`不支持的数据版本 ${db.settings.schemaVersion}，请先升级应用。`, 500);
    return db;
  };

  const writeDatabase = async (db: Database, keys: CollectionKey[]) => {
    const changes: Partial<Record<StoredKey, unknown>> = Object.fromEntries(keys.map((key) => [key, db[key]]));
    await commit(changes);
  };

  const appendEvent = (db: Database, event: Omit<ProgressEvent, keyof import("./types").BaseEntity | "id" | "createdAt" | "updatedAt" | "tags">) => {
    const now = iso();
    const saved: ProgressEvent = { ...event, id: createId("event"), createdAt: now, updatedAt: now, tags: [] };
    db.progressEvents.push(saved);
    return saved;
  };

  const applyPriorities = (db: Database, ids: string[]) => {
    if (!Array.isArray(ids) || ids.length > 5 || new Set(ids).size !== ids.length) throw new DataError("重点任务最多 5 项且不能重复");
    const tasks = ids.map((id) => db.tasks.find((task) => task.id === id && !task.archived));
    if (tasks.some((task) => !task || task.status === "completed" || task.planningState !== "week")) throw new DataError("重点任务必须是未完成且已安排到某周的任务");
    for (const task of tasks as Task[]) if (!task.primaryParent) throw new DataError(`任务“${task.title}”置顶前请先选择主关联对象`);
    for (const task of db.tasks) {
      const index = ids.indexOf(task.id);
      const pinned = index >= 0;
      if (task.pinned !== pinned || (pinned && task.pinOrder !== index + 1)) task.updatedAt = iso();
      task.pinned = pinned;
      if (pinned) task.pinOrder = index + 1;
    }
  };

  const syncCanonicalRelations = (db: Database, collection: EditableCollection, entity: AnyEntity, previous?: AnyEntity) => {
    if (collection === "research") {
      const item = entity as Database["research"][number];
      const oldIds = (previous as Database["research"][number] | undefined)?.paperIds ?? [];
      for (const paper of db.papers) {
        if (item.paperIds.includes(paper.id)) paper.relatedResearchIds = [...new Set([...paper.relatedResearchIds, item.id])];
        else if (oldIds.includes(paper.id)) paper.relatedResearchIds = paper.relatedResearchIds.filter((id) => id !== item.id);
      }
    }
    if (collection === "papers") {
      for (const research of db.research) research.paperIds = db.papers.filter((paper) => paper.relatedResearchIds.includes(research.id)).map((paper) => paper.id);
    }
  };

  return {
    root,
    async read(): Promise<Database> { return queue(ensure); },
    async replace(db: Database) { return queue(async () => { await commit({ ...Object.fromEntries(collectionKeys.map((key) => [key, db[key]])), settings: db.settings }); }); },
    async upsert(collection: EditableCollection, input: Partial<AnyEntity> & { id?: string }): Promise<AnyEntity> {
      return queue(async () => {
        const db = await ensure();
        const items = db[collection] as AnyEntity[];
        const index = input.id ? items.findIndex((item) => item.id === input.id) : -1;
        if (input.id && index < 0) throw new DataError("要更新的记录不存在", 404);
        const now = iso();
        const previous = index >= 0 ? items[index] : undefined;
        const saved = { ...(previous ?? {}), ...input, id: previous?.id ?? input.id ?? createId(collection.slice(0, 4)), createdAt: previous?.createdAt ?? now, updatedAt: now, tags: input.tags ?? previous?.tags ?? [] } as AnyEntity;
        const candidate = structuredClone(db);
        const candidateItems = candidate[collection] as AnyEntity[];
        if (index >= 0) candidateItems[index] = saved; else candidateItems.push(saved);
        validateEntity(candidate, collection, saved, previous);
        syncCanonicalRelations(candidate, collection, saved, previous);
        const keys: CollectionKey[] = [collection];
        if (collection === "papers" || collection === "research") keys.push(collection === "papers" ? "research" : "papers");
        await writeDatabase(candidate, keys);
        return saved;
      });
    },
    async saveSettings(settings: Settings): Promise<Settings> {
      return queue(async () => {
        await ensure();
        const next = { ...settings, schemaVersion: 2 };
        validateSettings(next);
        await commit({ settings: next });
        return next;
      });
    },
    async archive(collection: EditableCollection, id: string, hard = false): Promise<void> {
      return queue(async () => {
        const db = await ensure();
        const items = db[collection] as AnyEntity[];
        const entity = items.find((item) => item.id === id);
        if (!entity) throw new DataError("记录不存在", 404);
        if (hard && isReferenced(db, collection, id)) throw new DataError("这条记录仍被其他内容引用，请先解除关联后再永久删除", 409);
        if (!hard && collection !== "tasks") {
          const refType = ({ learning: "learning", research: "research", papers: "paper", projects: "project", competitions: "competition", goals: "goal" } as const)[collection as "learning" | "research" | "papers" | "projects" | "competitions" | "goals"];
          const activeTasks = db.tasks.filter((task) => !task.archived && task.status !== "completed" && ((refType && task.primaryParent?.type === refType && task.primaryParent.id === id) || (refType && task.relatedRefs?.some((ref) => ref.type === refType && ref.id === id)) || (collection === "goals" && task.milestoneRefs?.some((ref) => ref.goalId === id))));
          if (activeTasks.length) throw new DataError(`仍有 ${activeTasks.length} 个未完成任务关联此对象，请先完成、改挂或移回收件箱。`, 409);
        }
        await snapshot(hard ? "before-delete" : "before-archive", 30);
        const next = structuredClone(db);
        const target = next[collection] as AnyEntity[];
        if (hard) target.splice(target.findIndex((item) => item.id === id), 1);
        else {
          const index = target.findIndex((item) => item.id === id);
          target[index] = { ...target[index], archived: true, updatedAt: iso() } as AnyEntity;
        }
        await writeDatabase(next, [collection]);
      });
    },
    async setPriorities(ids: string[]): Promise<void> {
      return queue(async () => { const db = structuredClone(await ensure()); applyPriorities(db, ids); await writeDatabase(db, ["tasks"]); });
    },
    async recordProgress(input: { taskId?: string; note: string; nextAction?: string; complete?: boolean }): Promise<ProgressEvent> {
      return queue(async () => {
        const db = structuredClone(await ensure());
        if (!input.note.trim()) throw new DataError("请先记录具体进展");
        const task = input.taskId ? db.tasks.find((item) => item.id === input.taskId && !item.archived) : undefined;
        if (input.taskId && !task) throw new DataError("任务不存在", 404);
        if (!task) throw new DataError("当前只支持记录关联任务的进展");
        if (task.status === "completed" && !input.complete) throw new DataError("已完成任务不能继续记录进展；如需修正，请编辑任务状态");
        const previousStatus = task.status;
        task.nextAction = input.nextAction?.trim() ?? task.nextAction;
        const kind: ProgressEvent["kind"] = input.complete ? "completed" : previousStatus === "blocked" ? "unblocked" : "progress";
        if (input.complete) { task.status = "completed"; task.completedAt = iso(); task.pinned = false; }
        else if (task.status === "blocked") task.status = "in_progress";
        task.updatedAt = iso();
        const event = appendEvent(db, { date: todayFor(db.settings), taskId: task.id, parentRef: task.primaryParent, milestoneRefs: task.milestoneRefs ?? [], note: input.note.trim(), nextAction: task.nextAction, kind, previousStatus, reviewDate: input.complete ? todayFor(db.settings) : undefined });
        await writeDatabase(db, ["tasks", "progressEvents"]);
        return event;
      });
    },
    async submitReview(input: ReviewSubmission): Promise<EveningReview> {
      return queue(async () => {
        if (!input || typeof input.operationId !== "string" || input.operationId.length < 8 || input.operationId.length > 100) throw new DataError("复盘请求格式无效");
        assertDate(input.date, "复盘日期");
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new DataError("复盘版本号无效");
        if (!Array.isArray(input.completeTaskIds) || !Array.isArray(input.undoTaskIds) || !Array.isArray(input.progressUpdates) || !Array.isArray(input.inboxPlans) || !Array.isArray(input.priorityTaskIds)) throw new DataError("复盘列表格式无效");
        if (input.completeTaskIds.some((id) => typeof id !== "string") || input.undoTaskIds.some((id) => typeof id !== "string") || input.priorityTaskIds.some((id) => typeof id !== "string")) throw new DataError("复盘任务 ID 格式无效");
        if (new Set(input.completeTaskIds).size !== input.completeTaskIds.length || new Set(input.undoTaskIds).size !== input.undoTaskIds.length || input.completeTaskIds.some((id) => input.undoTaskIds.includes(id))) throw new DataError("完成/撤销任务不能重复或互相冲突");
        if (input.progressUpdates.some((item) => !item || typeof item.taskId !== "string" || typeof item.note !== "string" || typeof item.nextAction !== "string")) throw new DataError("任务进展格式无效");
        if (input.inboxPlans.some((item) => !item || typeof item.taskId !== "string" || !["week", "later"].includes(item.planningState))) throw new DataError("收件箱分流格式无效");
        if (new Set(input.progressUpdates.map((item) => item.taskId)).size !== input.progressUpdates.length || new Set(input.inboxPlans.map((item) => item.taskId)).size !== input.inboxPlans.length) throw new DataError("同一任务只能有一条进展或一项分流调整");
        if (input.unfinishedNote !== undefined && typeof input.unfinishedNote !== "string" || input.researchProgress !== undefined && typeof input.researchProgress !== "string" || input.reflection !== undefined && typeof input.reflection !== "string") throw new DataError("复盘文本格式无效");
        if ((input.newPaper && (typeof input.newPaper.title !== "string" || typeof input.newPaper.url !== "string")) || (input.newDeadline && (typeof input.newDeadline.title !== "string" || typeof input.newDeadline.date !== "string"))) throw new DataError("新论文或截止事项格式无效");
        if (input.researchProjectId !== undefined && typeof input.researchProjectId !== "string") throw new DataError("科研项目 ID 格式无效");
        const db = structuredClone(await ensure());
        const existing = db.reviews.find((item) => item.date === input.date);
        if (existing?.operationIds.includes(input.operationId)) { if (!(await hasReviewSnapshot(existing))) await snapshot("review", 30); return existing; }
        if ((existing?.revision ?? 0) !== input.expectedRevision) throw new DataError("这份复盘已在其他窗口更新，请刷新后再提交", 409);
        const byId = (id: string) => db.tasks.find((task) => task.id === id && !task.archived);
        const completed = new Set(existing?.completedTaskIds ?? []);
        for (const id of input.completeTaskIds ?? []) {
          const task = byId(id); if (!task) throw new DataError(`任务 ${id} 不存在或已归档`, 404);
          if (task.status === "completed") continue;
          const previousStatus = task.status;
          task.status = "completed"; task.completedAt = iso(); task.pinned = false; task.updatedAt = iso(); completed.add(id);
          appendEvent(db, { date: input.date, taskId: id, parentRef: task.primaryParent, milestoneRefs: task.milestoneRefs ?? [], note: "今晚更新：标记为完成", kind: "completed", previousStatus, reviewDate: input.date });
        }
        for (const id of input.undoTaskIds ?? []) {
          const task = byId(id); if (!task) throw new DataError(`任务 ${id} 不存在或已归档`, 404);
          const event = [...db.progressEvents].reverse().find((item) => item.taskId === id && item.kind === "completed" && item.reviewDate === input.date);
          if (!event || task.status !== "completed") throw new DataError(`任务“${task.title}”没有可撤销的本次复盘完成记录`, 409);
          task.status = event.previousStatus ?? "in_progress"; delete task.completedAt; task.updatedAt = iso(); completed.delete(id);
          appendEvent(db, { date: input.date, taskId: id, parentRef: task.primaryParent, milestoneRefs: task.milestoneRefs ?? [], note: "复盘修订：明确撤销完成状态", kind: "replan", reviewDate: input.date });
        }
        for (const update of input.progressUpdates ?? []) {
          const task = byId(update.taskId); if (!task || task.status === "completed") throw new DataError(`进展任务 ${update.taskId} 不存在或已完成`, 409);
          if (!update.note.trim()) continue;
          const previousStatus = task.status;
          if (update.nextAction.trim()) task.nextAction = update.nextAction.trim();
          if (task.status === "blocked") task.status = "in_progress";
          task.updatedAt = iso();
          appendEvent(db, { date: input.date, taskId: task.id, parentRef: task.primaryParent, milestoneRefs: task.milestoneRefs ?? [], note: update.note.trim(), nextAction: task.nextAction, kind: previousStatus === "blocked" ? "unblocked" : "progress", reviewDate: input.date });
        }
        if (input.researchProjectId && input.researchProgress?.trim()) {
          const research = db.research.find((item) => item.id === input.researchProjectId && !item.archived);
          if (!research) throw new DataError("科研项目不存在或已归档", 404);
          research.recentProgress = input.researchProgress.trim(); research.updatedAt = iso();
          appendEvent(db, { date: input.date, parentRef: { type: "research", id: research.id, label: research.name }, milestoneRefs: [], note: input.researchProgress.trim(), kind: "progress", reviewDate: input.date });
        }
        let newPaperId = existing?.newPaperId;
        if (input.newPaper?.title.trim()) {
          const previousPaper = db.papers.find((item) => item.id === existing?.newPaperId);
          if (previousPaper) { previousPaper.title = input.newPaper.title.trim(); previousPaper.doiUrl = input.newPaper.url.trim(); previousPaper.updatedAt = iso(); newPaperId = previousPaper.id; }
          else {
            const paper = { id: createId("pape"), createdAt: iso(), updatedAt: iso(), tags: [], title: input.newPaper.title.trim(), authors: [], venue: "", doiUrl: input.newPaper.url.trim(), researchArea: "", keywords: [], status: "to_read" as const, importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" as const } };
            db.papers.push(paper); newPaperId = paper.id;
          }
        }
        let newDeadlineTaskId = existing?.newDeadlineTaskId;
        if (input.newDeadline?.title.trim()) {
          assertDate(input.newDeadline.date, "新截止日期");
          const parent = input.newDeadline.primaryParent;
          if (parent) assertRef(db, parent, "新任务主关联");
          const previousTask = db.tasks.find((item) => item.id === existing?.newDeadlineTaskId);
          if (previousTask) { previousTask.title = input.newDeadline.title.trim(); previousTask.dueDate = input.newDeadline.date; previousTask.primaryParent = parent; previousTask.updatedAt = iso(); newDeadlineTaskId = previousTask.id; }
          else {
            const task: Task = { id: createId("task"), createdAt: iso(), updatedAt: iso(), tags: [], title: input.newDeadline.title.trim(), category: "截止事项", priority: "high", status: "not_started", dueDate: input.newDeadline.date, nextAction: "", primaryParent: parent, relatedRefs: [], milestoneRefs: [], planningState: "inbox", notes: "由今晚更新收录", pinned: false, pinOrder: 6 };
            db.tasks.push(task); newDeadlineTaskId = task.id;
          }
        }
        for (const plan of input.inboxPlans ?? []) {
          const task = byId(plan.taskId); if (!task) throw new DataError(`收件箱任务 ${plan.taskId} 不存在或已归档`, 404);
          const parent = plan.primaryParent ?? task.primaryParent;
          if (plan.planningState === "week") {
            assertDate(plan.plannedWeek, "计划周");
            if (weekStart(plan.plannedWeek!) !== plan.plannedWeek) throw new DataError("计划周必须从周一开始");
            if (!parent) throw new DataError("安排到某周前，请先为任务选择主关联对象");
            assertRef(db, parent, "任务主关联");
          }
          task.planningState = plan.planningState;
          task.plannedWeek = plan.planningState === "week" ? plan.plannedWeek : undefined;
          if (parent) task.primaryParent = parent;
          task.updatedAt = iso();
        }
        applyPriorities(db, input.priorityTaskIds ?? []);
        const operationIds = [...new Set([...(existing?.operationIds ?? []), input.operationId])].slice(-100);
        const review: EveningReview = {
          ...(existing ?? { id: createId("revi"), createdAt: iso(), tags: [] }),
          updatedAt: iso(), date: input.date, completedTaskIds: [...completed], unfinishedNote: input.unfinishedNote ?? "",
          researchProjectId: input.researchProjectId ?? existing?.researchProjectId,
          researchProgress: input.researchProgress ?? existing?.researchProgress ?? "",
          newPaperId, newDeadlineTaskId, priorityTaskIds: input.priorityTaskIds ?? [], reflection: input.reflection ?? "",
          revision: (existing?.revision ?? 0) + 1, operationIds,
        };
        if (existing) db.reviews[db.reviews.findIndex((item) => item.id === existing.id)] = review; else db.reviews.push(review);
        await writeDatabase(db, collectionKeys);
        await snapshot("review", 30);
        return review;
      });
    },
    async archiveDemo(collection: EditableCollection, ids: string[]): Promise<void> {
      return queue(async () => {
        const db = structuredClone(await ensure());
        if (!ids.length || ids.length > 100) throw new DataError("请选择 1–100 条待归档记录");
        const items = db[collection] as AnyEntity[];
        const selected = new Set(ids);
        if (selected.size !== ids.length || ids.some((id) => !items.some((item) => item.id === id && !item.archived))) throw new DataError("所选记录中有重复项或已不存在的记录", 409);
        const refType = ({ learning: "learning", research: "research", papers: "paper", projects: "project", competitions: "competition", goals: "goal" } as const)[collection as "learning" | "research" | "papers" | "projects" | "competitions" | "goals"];
        for (const id of ids) {
          if (collection !== "tasks" && db.tasks.some((task) => !task.archived && task.status !== "completed" && ((refType && task.primaryParent?.type === refType && task.primaryParent.id === id) || (refType && task.relatedRefs?.some((ref) => ref.type === refType && ref.id === id)) || (collection === "goals" && task.milestoneRefs?.some((ref) => ref.goalId === id))))) throw new DataError("所选内容仍有关联的未完成任务，请先处理这些任务", 409);
        }
        await snapshot("before-archive");
        for (const entity of items) if (selected.has(entity.id)) { entity.archived = true; entity.updatedAt = iso(); }
        await writeDatabase(db, [collection]);
      });
    },
  };
}

export const store = createStore();
