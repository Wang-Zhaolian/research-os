import { createHash, randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AIConversation, AIProposal, AnyEntity, CollectionKey, Database, EveningReview, LocalAttachment, PersonalProfile, ProgressEvent, ReviewSubmission, Settings, Task } from "./types.ts";
import { createEntityDefaults, type EditableCollection } from "./entity-defaults.ts";
import { dateInZone, SWUFE_2024_GPA_RULES, weekStart } from "./domain.ts";
import { assertDate, assertRef, DataError, isReferenced, validateEntity, validateProfile, validateSettings } from "./validation.ts";

const collectionKeys: CollectionKey[] = ["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades", "pendingItems", "activePlans", "achievements", "internships", "attachments", "reviews", "progressEvents"];
const optionalEntityFields: Partial<Record<EditableCollection, string[]>> = { tasks: ["plannedWeek", "primaryParent"], papers: ["year"], competitions: ["date", "deadline"] };
type StoredKey = CollectionKey | "settings" | "profile";
const iso = () => new Date().toISOString();
const todayFor = (settings: Settings) => dateInZone(new Date(), settings.timeZone);
const conversationsRootName = "ai-conversations";
export const emptyProfile: PersonalProfile = { displayName: "", university: "", major: "", currentSemester: "", developmentDirections: [], onboardingComplete: false };

const defaultStageCategories = [
  { id: "learning", name: "学科基础", icon: "BookOpen", color: "blue", sortOrder: 1 },
  { id: "grades", name: "课程成绩", icon: "GraduationCap", color: "indigo", sortOrder: 2 },
  { id: "research", name: "科研经历", icon: "FlaskConical", color: "violet", sortOrder: 3 },
  { id: "competition", name: "竞赛经历", icon: "Trophy", color: "amber", sortOrder: 4 },
  { id: "internship", name: "实习经历", icon: "BriefcaseBusiness", color: "teal", sortOrder: 5 },
  { id: "project", name: "项目经历", icon: "FolderKanban", color: "cyan", sortOrder: 6 },
  { id: "personal", name: "个人生活", icon: "Sparkles", color: "rose", sortOrder: 7 },
  { id: "general", name: "其他", icon: "CircleDot", color: "slate", sortOrder: 8 },
];
const defaultPlanningHorizons = [
  { id: "short", name: "短期", minDays: 3, maxDays: 7, sortOrder: 1 },
  { id: "medium", name: "中期", minDays: 14, maxDays: 180, sortOrder: 2 },
  { id: "long", name: "长期", minDays: 365, sortOrder: 3 },
];

export const defaultSettings: Settings = {
  schemaVersion: 4,
  demoData: false,
  timeZone: "Asia/Shanghai",
  stalledDays: 7,
  dataEpoch: randomUUID(),
  dataRevision: 0,
  gpaPresetId: "swufe-2024",
  gpaConfigured: false,
  modelConnections: [],
  defaultModelConnectionId: "",
  stageCategories: defaultStageCategories,
  planningHorizons: defaultPlanningHorizons,
  gpa: { scale: 4, rules: SWUFE_2024_GPA_RULES },
};

export const createId = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function ensureNestedIds(collection: EditableCollection, entity: AnyEntity): AnyEntity {
  const value = entity as unknown as Record<string, unknown>;
  if (collection === "goals" && Array.isArray(value.milestones)) value.milestones = (value.milestones as Record<string, unknown>[]).map((item) => ({ ...item, id: typeof item.id === "string" && item.id ? item.id : createId("mile") }));
  if (collection === "learning" && Array.isArray(value.modules)) value.modules = (value.modules as Record<string, unknown>[]).map((item) => ({ ...item, id: typeof item.id === "string" && item.id ? item.id : createId("modu"), topics: Array.isArray(item.topics) ? (item.topics as Record<string, unknown>[]).map((topic) => ({ ...topic, id: typeof topic.id === "string" && topic.id ? topic.id : createId("topi") })) : [] }));
  if (collection === "research") {
    if (Array.isArray(value.meetings)) value.meetings = (value.meetings as Record<string, unknown>[]).map((item) => ({ ...item, id: typeof item.id === "string" && item.id ? item.id : createId("meet"), nextActions: Array.isArray(item.nextActions) ? item.nextActions : [] }));
    if (Array.isArray(value.resources)) value.resources = (value.resources as Record<string, unknown>[]).map((item) => ({ ...item, id: typeof item.id === "string" && item.id ? item.id : createId("reso") }));
  }
  return entity;
}

function removeUnconfirmedProposals(conversation: AIConversation): AIConversation {
  for (const message of conversation.messages) delete message.proposal;
  return conversation;
}

async function readConversationsFrom(directory: string): Promise<Record<string, AIConversation>> {
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const result: Record<string, AIConversation> = {};
  for (const name of names.filter((value) => /^[a-z0-9_-]+\.json$/i.test(value))) {
    const value = JSON.parse(await readFile(path.join(directory, name), "utf8")) as AIConversation;
    if (value && typeof value.id === "string" && Array.isArray(value.messages)) result[value.id] = value;
  }
  return result;
}

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
    let pending: { version: number; transactionId: string; changes: Partial<Record<StoredKey, unknown>>; clearConversations?: boolean; conversations?: Record<string, unknown> };
    try { pending = await readFileJson(journal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new DataError("发现损坏的事务恢复记录，请先备份 data 目录并联系维护者", 500);
    }
    if (pending.version !== 1 || !pending.changes || typeof pending.changes !== "object" || Object.keys(pending.changes).some((key) => ![...collectionKeys, "settings", "profile"].includes(key as StoredKey))) throw new DataError("事务恢复记录格式无效，已停止写入以保护数据", 500);
    for (const [key, value] of Object.entries(pending.changes) as [StoredKey, unknown][]) await atomicWrite(file(key), value);
    if (pending.conversations) await replaceConversations(pending.conversations);
    else if (pending.clearConversations) await rm(path.join(root, conversationsRootName), { recursive: true, force: true });
    await rm(journal, { force: true });
  };

  const replaceConversations = async (conversations: Record<string, unknown>) => {
    const directory = path.join(root, conversationsRootName);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    for (const [id, value] of Object.entries(conversations)) await atomicWrite(path.join(directory, `${id}.json`), value);
  };

  const commit = async (changes: Partial<Record<StoredKey, unknown>>, options: { clearConversations?: boolean; conversations?: Record<string, unknown> } = {}) => {
    await mkdir(root, { recursive: true });
    const payload = { version: 1, transactionId: randomUUID(), changes, ...options };
    await atomicWrite(journal, payload);
    for (const [key, value] of Object.entries(changes) as [StoredKey, unknown][]) await atomicWrite(file(key), value);
    if (options.conversations) await replaceConversations(options.conversations);
    else if (options.clearConversations) await rm(path.join(root, conversationsRootName), { recursive: true, force: true });
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
      if ((key === "progressEvents" && settings.schemaVersion < 2) || (key === "grades" && settings.schemaVersion < 3)) {
        try { return await readFileJson<AnyEntity[]>(file(key)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
      }
      try { return await readFileJson<AnyEntity[]>(file(key)); }
      catch (error) {
        const introducedInV4 = ["pendingItems", "activePlans", "achievements", "internships", "attachments"].includes(key);
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && introducedInV4 && settings.schemaVersion < 4) return [];
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DataError(`缺少 data/${key}.json；为避免误写空数据，已停止启动。请从 Git 或备份恢复。`, 500);
        throw error;
      }
    }));
    let profile = emptyProfile;
    try { profile = await readFileJson<PersonalProfile>(file("profile")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || settings.schemaVersion >= 3) throw new DataError("缺少 data/profile.json；请从 Git 或本机快照恢复。", 500); }
    return Object.fromEntries([...collectionKeys.map((key, index) => [key, values[index]]), ["settings", settings], ["profile", profile]]) as unknown as Database;
  };

  const snapshot = async (label: string, limit?: number) => {
    await mkdir(backups, { recursive: true });
    const target = path.join(backups, `${label}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await mkdir(target, { recursive: true });
    for (const key of [...collectionKeys, "settings"] as StoredKey[]) {
      try { await copyFile(file(key), path.join(target, `${key}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    try { await copyFile(file("profile"), path.join(target, "profile.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await cp(path.join(root, conversationsRootName), path.join(target, conversationsRootName), { recursive: true, errorOnExist: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const checksums: Record<string, string> = {};
    const hashTree = async (directory: string, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await hashTree(full, name);
        else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "snapshot.json") {
          const contents = await readFile(full);
          JSON.parse(contents.toString("utf8"));
          checksums[name] = createHash("sha256").update(contents).digest("hex");
        }
      }
    };
    await hashTree(target);
    const snapshotSettings = await readFileJson<Settings>(path.join(target, "settings.json"));
    if (!checksums["settings.json"] || !checksums["tasks.json"] || (snapshotSettings.schemaVersion >= 3 && !checksums["profile.json"])) throw new DataError("快照缺少必要数据文件，未将其标记为可恢复", 500);
    const counts: Record<string, number> = {};
    for (const key of collectionKeys) {
      try {
        const value = await readFileJson<unknown>(path.join(target, `${key}.json`));
        if (!Array.isArray(value)) throw new DataError(`快照中的 ${key}.json 格式无效`, 500);
        counts[key] = value.length;
      } catch (error) {
        const introducedIn = key === "progressEvents" ? 2 : key === "grades" ? 3 : ["pendingItems", "activePlans", "achievements", "internships", "attachments"].includes(key) ? 4 : 1;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || snapshotSettings.schemaVersion >= introducedIn) throw error;
        counts[key] = 0;
      }
    }
    await atomicWrite(path.join(target, "snapshot.json"), { id: path.basename(target), label, createdAt: iso(), schemaVersion: snapshotSettings.schemaVersion, counts, checksums });
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

  const migrate = async (legacy: Database, makeSnapshot = true): Promise<Database> => {
    const migrationDate = todayFor({ ...defaultSettings, ...legacy.settings, timeZone: legacy.settings.timeZone || "Asia/Shanghai" });
    const currentWeek = weekStart(migrationDate);
    const nextWeek = new Date(`${currentWeek}T00:00:00.000Z`);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const nextWeekDate = nextWeek.toISOString().slice(0, 10);
    const tasks = legacy.tasks.map((old) => {
      if (legacy.settings.schemaVersion >= 2) {
        const planningState = old.planningState ?? (old.primaryParent ? "week" : "needs_parent");
        const needsParent = planningState === "week" && !old.primaryParent;
        return { ...old, nextAction: old.nextAction ?? "", relatedRefs: old.relatedRefs ?? [], milestoneRefs: old.milestoneRefs ?? [], planningState: needsParent ? "needs_parent" : planningState, plannedWeek: needsParent ? undefined : old.plannedWeek, pinned: needsParent ? false : old.pinned };
      }
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
    const modelConnections = legacy.settings.modelConnections ?? [];
    const subscriptionConnection = modelConnections.find((item) => item.kind === "chatgpt_subscription");
    const requestedDefault = modelConnections.find((item) => item.id === legacy.settings.defaultModelConnectionId && item.kind === "chatgpt_subscription");
    const db: Database = {
      ...legacy,
      tasks,
      learning: legacy.learning.map((course) => ({ ...course, syllabusComplete: course.syllabusComplete ?? false, modules: course.modules ?? [] })),
      papers,
      research,
      goals: legacy.goals.map((goal) => ({ ...goal, linkedItems: goal.linkedItems ?? [], milestones: goal.milestones.map((milestone) => ({ ...milestone, evidence: milestone.evidence ?? "" })) })),
      reviews: legacy.reviews.map((review) => ({ ...review, revision: review.revision ?? 1, operationIds: review.operationIds ?? [] })),
      progressEvents: legacy.progressEvents ?? [],
      pendingItems: legacy.pendingItems ?? [], activePlans: legacy.activePlans ?? [], achievements: legacy.achievements ?? [], internships: legacy.internships ?? [], attachments: legacy.attachments ?? [],
      grades: (legacy.grades as Database["grades"]).map((grade) => ({ ...grade, gradingType: grade.gradingType ?? "percentage", includeInAverage: grade.includeInAverage ?? true })),
      profile: legacy.profile ?? emptyProfile,
      settings: {
        ...defaultSettings, ...legacy.settings, schemaVersion: 4, demoData: false,
        dataEpoch: legacy.settings.dataEpoch ?? randomUUID(), dataRevision: legacy.settings.dataRevision ?? 0,
        gpaPresetId: legacy.settings.gpaPresetId ?? "swufe-2024", gpaConfigured: legacy.settings.gpaConfigured ?? false,
        modelConnections, defaultModelConnectionId: requestedDefault?.id ?? subscriptionConnection?.id ?? "",
        stageCategories: legacy.settings.stageCategories ?? structuredClone(defaultStageCategories),
        planningHorizons: legacy.settings.planningHorizons ?? structuredClone(defaultPlanningHorizons),
        timeZone: legacy.settings.timeZone || "Asia/Shanghai", stalledDays: legacy.settings.stalledDays ?? 7,
      },
    };
    if (makeSnapshot) await snapshot(`migration-v${legacy.settings.schemaVersion}`);
    return db;
  };

  const ensure = async (): Promise<Database> => {
    await recover();
    const db = await readRaw();
    if (db.settings.schemaVersion < 4) {
      const migrated = await migrate(db);
      migrated.settings.dataEpoch = randomUUID();
      migrated.settings.dataRevision = db.settings.dataRevision + 1;
      const changes: Partial<Record<StoredKey, unknown>> = { ...Object.fromEntries(collectionKeys.map((key) => [key, migrated[key]])), settings: migrated.settings, profile: migrated.profile };
      const conversations = await loadConversations();
      for (const conversation of Object.values(conversations)) { conversation.dataEpoch = migrated.settings.dataEpoch; conversation.allowGrades = false; removeUnconfirmedProposals(conversation); }
      await commit(changes, { conversations });
      return migrated;
    }
    if (db.settings.schemaVersion !== 4) throw new DataError(`不支持的数据版本 ${db.settings.schemaVersion}，请先升级应用。`, 500);
    return db;
  };

  const assertEpoch = (db: Database, expectedEpoch?: string) => {
    if (expectedEpoch !== undefined && expectedEpoch !== db.settings.dataEpoch) throw new DataError("工作区已在其他窗口初始化或恢复。为避免旧数据写回，请刷新页面后重试。", 409);
  };

  const verifySnapshot = async (id: string) => {
    if (!/^[a-z0-9-]+-\d+-[a-f0-9-]+$/i.test(id)) throw new DataError("备份编号无效");
    const directory = path.join(backups, id);
    const manifest = await readFileJson<{ id: string; schemaVersion: number; counts: Record<string, number>; checksums: Record<string, string> }>(path.join(directory, "snapshot.json"));
    if (manifest.id !== id || !manifest.checksums || typeof manifest.checksums !== "object") throw new DataError("备份清单无效");
    for (const [relative, expected] of Object.entries(manifest.checksums)) {
      if (relative.startsWith("/") || relative.split(/[\\/]/).includes("..")) throw new DataError("备份中包含非法文件路径");
      const bytes = await readFile(path.join(directory, relative));
      if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new DataError(`备份文件校验失败：${relative}`);
      JSON.parse(bytes.toString("utf8"));
    }
    if (!manifest.checksums["settings.json"] || !manifest.checksums["tasks.json"]) throw new DataError("备份缺少必要数据");
    return { directory, manifest };
  };

  const writeDatabase = async (db: Database, keys: CollectionKey[]) => {
    db.settings.dataRevision++;
    const changes: Partial<Record<StoredKey, unknown>> = { ...Object.fromEntries(keys.map((key) => [key, db[key]])), settings: db.settings };
    await commit(changes);
  };

  const loadConversations = async (): Promise<Record<string, AIConversation>> => {
    const directory = path.join(root, conversationsRootName);
    let names: string[];
    try { names = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
    const result: Record<string, AIConversation> = {};
    for (const name of names.filter((value) => /^[a-z0-9_-]+\.json$/i.test(value))) {
      const conversation = await readFileJson<AIConversation>(path.join(directory, name));
      if (conversation && typeof conversation.id === "string" && Array.isArray(conversation.messages)) result[conversation.id] = conversation;
    }
    return result;
  };

  const snapshotDatabase = async (id: string): Promise<Database> => {
    const { directory, manifest } = await verifySnapshot(id);
    const oldSettings = await readFileJson<Settings>(path.join(directory, "settings.json"));
    const lists = await Promise.all(collectionKeys.map(async (key) => {
      try { const value = await readFileJson<AnyEntity[]>(path.join(directory, `${key}.json`)); if (!Array.isArray(value)) throw new DataError(`备份中的 ${key}.json 格式无效`); return value; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && (key === "progressEvents" && manifest.schemaVersion < 2 || key === "grades" && manifest.schemaVersion < 3 || ["pendingItems", "activePlans", "achievements", "internships", "attachments"].includes(key) && manifest.schemaVersion < 4)) return []; throw error; }
    }));
    let profile = emptyProfile;
    try { profile = await readFileJson<PersonalProfile>(path.join(directory, "profile.json")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || manifest.schemaVersion >= 3) throw error; }
    const legacy = Object.fromEntries([...collectionKeys.map((key, index) => [key, lists[index]]), ["settings", oldSettings], ["profile", profile]]) as unknown as Database;
    return manifest.schemaVersion < 4 ? migrate(legacy, false) : legacy;
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
    if (collection === "tasks") {
      const task = entity as Task;
      const oldTask = previous as Task | undefined;
      for (const plan of db.activePlans) {
        plan.taskIds = plan.taskIds.filter((id) => id !== task.id);
        if (plan.id === task.activePlanId) plan.taskIds.push(task.id);
      }
      if (oldTask?.activePlanId && oldTask.activePlanId !== task.activePlanId) {
        const oldPlan = db.activePlans.find((item) => item.id === oldTask.activePlanId);
        if (oldPlan) oldPlan.taskIds = oldPlan.taskIds.filter((id) => id !== task.id);
      }
    }
  };

  return {
    root,
    async read(): Promise<Database> { return queue(ensure); },
    async replace(db: Database) { return queue(async () => { const fixed = { ...db, profile: db.profile ?? emptyProfile }; await commit({ ...Object.fromEntries(collectionKeys.map((key) => [key, fixed[key]])), settings: fixed.settings, profile: fixed.profile }); }); },
    async upsert(collection: EditableCollection, input: Partial<AnyEntity> & { id?: string }, expectedEpoch?: string): Promise<AnyEntity> {
      return queue(async () => {
        const db = await ensure();
        assertEpoch(db, expectedEpoch);
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
        if (collection === "tasks" && ((saved as Task).activePlanId || (previous as Task | undefined)?.activePlanId)) keys.push("activePlans");
        await writeDatabase(candidate, keys);
        return saved;
      });
    },
    async saveSettings(settings: Settings, expectedEpoch?: string): Promise<Settings> {
      return queue(async () => {
        const current = await ensure();
        assertEpoch(current, expectedEpoch);
        const next = { ...settings, schemaVersion: 4, dataEpoch: current.settings.dataEpoch, dataRevision: current.settings.dataRevision + 1 };
        validateSettings(next);
        await commit({ settings: next });
        return next;
      });
    },
    async saveProfile(profile: PersonalProfile, confirmGpaPreset: boolean, expectedEpoch: string): Promise<PersonalProfile> {
      return queue(async () => {
        const db = await ensure(); assertEpoch(db, expectedEpoch);
        validateProfile(profile);
        const nextProfile = structuredClone(profile);
        const settings = { ...db.settings, dataRevision: db.settings.dataRevision + 1 };
        if (confirmGpaPreset && (!nextProfile.entryYear || nextProfile.entryYear < 2024)) throw new DataError("“西南财经大学本科 2024 版”绩点预设仅适用于确认过的 2024 级及以后入学学生");
        if (confirmGpaPreset) {
          settings.gpaPresetId = "swufe-2024";
          settings.gpa = { scale: 4, rules: structuredClone(SWUFE_2024_GPA_RULES) };
        }
        settings.gpaConfigured = Boolean(confirmGpaPreset);
        await commit({ profile: nextProfile, settings });
        return nextProfile;
      });
    },
    async registerAttachment(attachment: LocalAttachment, expectedEpoch: string): Promise<LocalAttachment> {
      return queue(async () => {
        const db = structuredClone(await ensure()); assertEpoch(db, expectedEpoch);
        if (!attachment || !/^[a-f0-9-]{36}$/i.test(attachment.id) || !/^[a-f0-9-]{36}$/i.test(attachment.localFileId) || !/^[a-f0-9]{64}$/i.test(attachment.sha256) || !attachment.filename || !Number.isSafeInteger(attachment.size) || attachment.size <= 0 || !["upload", "pasted_text"].includes(attachment.sourceKind)) throw new DataError("附件元数据无效");
        if (db.attachments.some((item) => item.id === attachment.id || item.sha256 === attachment.sha256 && !item.archived)) throw new DataError("相同附件已存在，请从列表中继续使用原记录", 409);
        db.attachments.push(attachment);
        await writeDatabase(db, ["attachments"]);
        return attachment;
      });
    },
    async removeAttachment(id: string, expectedEpoch: string): Promise<LocalAttachment> {
      return queue(async () => {
        const db = structuredClone(await ensure()); assertEpoch(db, expectedEpoch);
        const attachment = db.attachments.find((item) => item.id === id && !item.archived);
        if (!attachment) throw new DataError("附件记录不存在", 404);
        if (isReferenced(db, "attachments", id)) throw new DataError("此附件已被成果或待开始事项引用；请先移除引用再删除", 409);
        await snapshot("before-attachment-delete", 30);
        db.attachments = db.attachments.filter((item) => item.id !== id);
        await writeDatabase(db, ["attachments"]);
        return attachment;
      });
    },
    async promotePending(input: { id: string; expectedEpoch: string; expectedRevision: number; horizonId: string; startDate?: string; targetDate?: string; nextAction?: string }) {
      return queue(async () => {
        const db = structuredClone(await ensure()); assertEpoch(db, input.expectedEpoch);
        if (db.settings.dataRevision !== input.expectedRevision) throw new DataError("数据已变化，请刷新后再启动此事项", 409);
        const pending = db.pendingItems.find((item) => item.id === input.id && !item.archived);
        if (!pending) throw new DataError("待开始事项不存在", 404);
        if (pending.status === "promoted" && pending.promotedPlanId) {
          const existing = db.activePlans.find((item) => item.id === pending.promotedPlanId);
          if (existing) return { pending, plan: existing, repeated: true };
        }
        if (pending.status !== "open") throw new DataError("只有待开始事项可以启动", 409);
        const now = iso();
        const plan = { ...createEntityDefaults("activePlans"), id: createId("plan"), createdAt: now, updatedAt: now, tags: [...pending.tags], title: pending.title, categoryId: pending.categoryId, horizonId: input.horizonId, status: "in_progress" as const, description: pending.description, nextAction: input.nextAction?.trim() ?? pending.desiredOutcome, startDate: input.startDate, targetDate: input.targetDate, linkedRefs: [...pending.linkedRefs], taskIds: [], sourcePendingId: pending.id };
        db.activePlans.push(plan);
        pending.status = "promoted"; pending.promotedPlanId = plan.id; pending.updatedAt = now;
        validateEntity(db, "activePlans", plan);
        await writeDatabase(db, ["pendingItems", "activePlans"]);
        return { pending, plan, repeated: false };
      });
    },
    async completeActivePlan(input: { id: string; expectedEpoch: string; expectedRevision: number; title?: string; summary?: string; achievedDate?: string }) {
      return queue(async () => {
        const db = structuredClone(await ensure()); assertEpoch(db, input.expectedEpoch);
        const plan = db.activePlans.find((item) => item.id === input.id && !item.archived);
        if (!plan) throw new DataError("进行中计划不存在", 404);
        if (plan.status === "completed" && plan.achievementId) {
          const existing = db.achievements.find((item) => item.id === plan.achievementId);
          if (existing) return { plan, achievement: existing, repeated: true };
        }
        if (db.settings.dataRevision !== input.expectedRevision) throw new DataError("数据已变化，请刷新后再完成此计划", 409);
        if (plan.status === "completed") throw new DataError("此计划已结束，但关联成果卡缺失；请联系维护者检查工作区", 409);
        const unfinished = plan.taskIds.map((id) => db.tasks.find((task) => task.id === id)).filter((task) => task && !task.archived && task.status !== "completed");
        if (unfinished.length) throw new DataError(`请先完成关联的 ${unfinished.length} 项任务，或解除这些任务与计划的关联。`, 409);
        const now = iso();
        const evidenceRefs = [
          ...plan.taskIds.map((id) => ({ type: "task" as const, id })),
          ...plan.linkedRefs.map((ref) => ({ type: ref.type, id: ref.id, label: ref.label })),
          { type: "active_plan" as const, id: plan.id, label: plan.title },
        ];
        const achievement = { ...createEntityDefaults("achievements"), id: createId("achi"), createdAt: now, updatedAt: now, tags: [...plan.tags], title: input.title?.trim() || plan.title, categoryId: plan.categoryId, summary: input.summary?.trim() || plan.description, achievedDate: input.achievedDate || todayFor(db.settings), linkedRefs: [...plan.linkedRefs], evidenceRefs, sourcePlanId: plan.id, verification: "user_recorded" as const };
        plan.status = "completed"; plan.completedAt = now; plan.achievementId = achievement.id; plan.updatedAt = now;
        db.achievements.push(achievement);
        validateEntity(db, "achievements", achievement);
        validateEntity(db, "activePlans", plan);
        await writeDatabase(db, ["activePlans", "achievements"]);
        return { plan, achievement, repeated: false };
      });
    },
    async previewInitialization() {
      return queue(async () => {
        const db = await ensure();
        const counts = Object.fromEntries(collectionKeys.map((key) => [key, db[key].length]));
        return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), dataEpoch: db.settings.dataEpoch, dataRevision: db.settings.dataRevision };
      });
    },
    async initializeWorkspace(input: { expectedEpoch: string; expectedRevision: number; confirmation: string }) {
      return queue(async () => {
        const db = structuredClone(await ensure());
        assertEpoch(db, input.expectedEpoch);
        if (input.expectedRevision !== db.settings.dataRevision) throw new DataError("数据已变化，请重新预览初始化内容", 409);
        if (input.confirmation !== "清空并开始") throw new DataError("请输入“清空并开始”确认初始化");
        await snapshot("before-initialization");
        const next = Object.fromEntries(collectionKeys.map((key) => [key, []])) as unknown as Database;
        const settings = { ...db.settings, dataEpoch: randomUUID(), dataRevision: db.settings.dataRevision + 1, demoData: false, gpaConfigured: false };
        await commit({ ...Object.fromEntries(collectionKeys.map((key) => [key, next[key]])), settings, profile: emptyProfile });
        return { dataEpoch: settings.dataEpoch, dataRevision: settings.dataRevision };
      });
    },
    async listBackups() {
      return queue(async () => {
        await ensure();
        let dirs: string[];
        try { dirs = (await readdir(backups, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
        const results = [];
        for (const id of dirs) {
          try {
            const { manifest } = await verifySnapshot(id);
            results.push({ id, createdAt: (await stat(path.join(backups, id))).mtime.toISOString(), schemaVersion: manifest.schemaVersion, counts: manifest.counts, valid: true as const });
          } catch (error) { results.push({ id, createdAt: (await stat(path.join(backups, id))).mtime.toISOString(), schemaVersion: 0, counts: {}, valid: false as const, error: error instanceof Error ? error.message : "校验失败" }); }
        }
        return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    },
    async previewRestore(id: string) {
      return queue(async () => {
        const data = await snapshotDatabase(id);
        return { id, counts: Object.fromEntries(collectionKeys.map((key) => [key, data[key].length])), profile: data.profile, schemaVersion: data.settings.schemaVersion };
      });
    },
    async restoreBackup(input: { id: string; expectedEpoch: string; expectedRevision: number; confirmation: string }) {
      return queue(async () => {
        const current = structuredClone(await ensure()); assertEpoch(current, input.expectedEpoch);
        if (input.expectedRevision !== current.settings.dataRevision) throw new DataError("数据已变化，请重新预览恢复", 409);
        if (input.confirmation !== "恢复此备份") throw new DataError("请输入“恢复此备份”确认恢复");
        const restored = await snapshotDatabase(input.id);
        await snapshot("before-restore");
        const epoch = randomUUID();
        const restoredSettings = { ...restored.settings, schemaVersion: 4, dataEpoch: epoch, dataRevision: current.settings.dataRevision + 1 };
        const conversations = await readConversationsFrom(path.join(backups, input.id, conversationsRootName));
        for (const conversation of Object.values(conversations)) { conversation.dataEpoch = epoch; conversation.allowGrades = false; removeUnconfirmedProposals(conversation); }
        await commit({ ...Object.fromEntries(collectionKeys.map((key) => [key, restored[key]])), settings: restoredSettings, profile: restored.profile ?? emptyProfile }, { conversations });
        return { dataEpoch: epoch, dataRevision: restoredSettings.dataRevision };
      });
    },
    async listConversations(expectedEpoch: string) {
      return queue(async () => { const db = await ensure(); assertEpoch(db, expectedEpoch); return Object.values(await loadConversations()).filter((item) => item.dataEpoch === db.settings.dataEpoch).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, createdAt, updatedAt, messages }) => ({ id, title, createdAt, updatedAt, messageCount: messages.length })); });
    },
    async getConversation(id: string, expectedEpoch: string) {
      return queue(async () => { const db = await ensure(); assertEpoch(db, expectedEpoch); const item = (await loadConversations())[id]; if (!item || item.dataEpoch !== db.settings.dataEpoch) throw new DataError("对话不存在，或属于已初始化/恢复前的数据代次", 404); return item; });
    },
    async saveConversation(conversation: AIConversation, expectedEpoch: string) {
      return queue(async () => {
        const db = await ensure(); assertEpoch(db, expectedEpoch);
        if (!/^[a-z0-9_-]{1,80}$/i.test(conversation.id) || conversation.dataEpoch !== db.settings.dataEpoch || !Array.isArray(conversation.messages) || conversation.messages.length > 1000) throw new DataError("对话数据格式无效或已经过期");
        const current = (await loadConversations())[conversation.id];
        if (current && current.createdAt !== conversation.createdAt) throw new DataError("对话创建时间校验失败", 409);
        for (const message of conversation.messages) if (!message || !["user", "assistant"].includes(message.role) || typeof message.text !== "string" || message.text.length > 30_000) throw new DataError("对话消息无效或过长");
        const safeConversation = removeUnconfirmedProposals(structuredClone(conversation));
        safeConversation.appliedOperations = current?.appliedOperations ?? [];
        await atomicWrite(path.join(root, conversationsRootName, `${conversation.id}.json`), safeConversation);
        return safeConversation;
      });
    },
    async applyAIProposal(input: { conversationId: string; proposalId: string; operationId: string; indexes: number[]; expectedEpoch: string; expectedRevision: number; dryRun?: boolean; editedChanges?: AIProposal["changes"]; externalProposal?: AIProposal }) {
      return queue(async () => {
        const current = structuredClone(await ensure()); assertEpoch(current, input.expectedEpoch);
        const conversations = await loadConversations();
        const conversation = conversations[input.conversationId];
        if (!conversation || conversation.dataEpoch !== current.settings.dataEpoch) throw new DataError("对话已经过期，请重新开始", 409);
        const priorOperation = (conversation.appliedOperations ?? []).find((item) => item.proposalId === input.proposalId);
        if (priorOperation) {
          if (priorOperation.operationId === input.operationId) return { ok: true, repeated: true, ids: [] };
          throw new DataError("这份草稿已经提交；如需再次操作，请重新生成草稿", 409);
        }
        const message = conversation.messages.find((item) => item.proposal?.id === input.proposalId);
        const proposal = message?.proposal ?? input.externalProposal;
        if (!proposal || proposal.id !== input.proposalId) throw new DataError("待确认草稿不存在", 404);
        if (input.editedChanges) {
          if (!Array.isArray(input.editedChanges) || input.editedChanges.length > 50) throw new DataError("编辑后的操作草稿格式无效");
          proposal.changes = structuredClone(input.editedChanges);
        }
        if (proposal.dataEpoch !== current.settings.dataEpoch || proposal.dataRevision !== current.settings.dataRevision || input.expectedRevision !== current.settings.dataRevision) throw new DataError("草稿生成后数据已变化。请刷新并重新审阅 AI 草稿。", 409);
        if (!/^[a-z0-9_-]{8,100}$/i.test(input.operationId) || !Array.isArray(input.indexes) || !input.indexes.length || input.indexes.length > 50 || new Set(input.indexes).size !== input.indexes.length || input.indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= proposal.changes.length)) throw new DataError("AI 操作确认请求格式无效");
        const candidate = structuredClone(current);
        const selected = input.indexes.map((index) => proposal.changes[index]);
        const tempIds = new Map<string, string>();
        for (const change of selected) if (change.action === "create") {
          if (!change.id || typeof change.id !== "string" || change.id.length > 100 || !/^[a-z0-9:_-]+$/i.test(change.id) || tempIds.has(change.id)) throw new DataError("AI 新建对象缺少有效的草稿关联 ID");
          tempIds.set(change.id, createId(change.collection.slice(0, 4)));
        }
        const remap = (value: unknown): unknown => {
          if (typeof value === "string") return tempIds.get(value) ?? value;
          if (Array.isArray(value)) return value.map(remap);
          if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
          return value;
        };
        const changed = new Set<CollectionKey>();
        const records: { collection: EditableCollection; entity: AnyEntity; previous?: AnyEntity }[] = [];
        const newIds: string[] = [];
        for (const change of selected) {
          if (!change || !["create", "update", "progress", "priorities"].includes(change.action) || !Object.hasOwn(current, change.collection) || ["reviews", "progressEvents"].includes(change.collection) || typeof change.explanation !== "string" || change.explanation.length > 500) throw new DataError("AI 草稿包含不支持的操作类型或模块");
          if (!change.entity || typeof change.entity !== "object" || Array.isArray(change.entity)) throw new DataError("AI 操作内容必须是对象");
          const entity = remap(change.entity) as Record<string, unknown>;
          if (change.action === "priorities") {
            if (change.collection !== "tasks" || !Array.isArray(entity.taskIds) || entity.taskIds.some((id) => typeof id !== "string")) throw new DataError("重点调整草稿格式无效");
            applyPriorities(candidate, entity.taskIds as string[]); changed.add("tasks"); continue;
          }
          if (change.action === "progress") {
            if (change.collection !== "tasks" || typeof change.id !== "string" || typeof entity.note !== "string" || !entity.note.trim() || entity.note.length > 3000 || entity.nextAction !== undefined && typeof entity.nextAction !== "string" || entity.complete !== undefined && typeof entity.complete !== "boolean") throw new DataError("AI 进展草稿格式无效");
            const taskId = tempIds.get(change.id) ?? change.id;
            const task = candidate.tasks.find((item) => item.id === taskId && !item.archived);
            if (!task || task.status === "completed" && !entity.complete) throw new DataError("进展所指任务不存在或已完成", 409);
            const previousStatus = task.status;
            if (typeof entity.nextAction === "string" && entity.nextAction.trim()) task.nextAction = entity.nextAction.trim();
            if (entity.complete === true) { task.status = "completed"; task.completedAt = iso(); task.pinned = false; }
            else if (task.status === "blocked") task.status = "in_progress";
            task.updatedAt = iso();
            appendEvent(candidate, { date: todayFor(candidate.settings), taskId: task.id, parentRef: task.primaryParent, milestoneRefs: task.milestoneRefs ?? [], note: entity.note.trim(), nextAction: task.nextAction, kind: entity.complete === true ? "completed" : previousStatus === "blocked" ? "unblocked" : "progress", previousStatus });
            changed.add("tasks"); changed.add("progressEvents"); newIds.push(task.id); continue;
          }
          const collection = change.collection as EditableCollection;
          if (collection === "grades" && (!Array.isArray(entity.evidenceRefs) || !(entity.evidenceRefs as Record<string, unknown>[]).some((ref) => ref && ref.type === "attachment" && typeof ref.id === "string"))) throw new DataError("AI 提议成绩时必须附带当前本机附件的来源引用");
          const defaults = createEntityDefaults(collection) as unknown as Record<string, unknown>;
          if (collection === "learning" && Object.hasOwn(entity, "syllabusComplete")) throw new DataError("AI 不能替用户判断课程大纲是否完整；请在课程详情中亲自确认完整章节清单");
          const protectedFields = new Set(["id", "createdAt", "updatedAt", "archived", "completedAt", "pinOrder"]);
          const allowedFields = new Set([...Object.keys(defaults), ...(optionalEntityFields[collection] ?? [])]);
          const illegalFields = Object.keys(entity).filter((key) => !allowedFields.has(key) || protectedFields.has(key));
          if (illegalFields.length) throw new DataError(`AI 草稿尝试修改不允许的系统字段或未知字段：${illegalFields.join(", ")}`);
          let saved: AnyEntity; let previous: AnyEntity | undefined;
          const items = candidate[collection] as AnyEntity[];
          if (change.action === "create") {
            const assignedId = tempIds.get(change.id!)!;
            const createValue = { ...defaults, ...entity, id: assignedId, createdAt: iso(), updatedAt: iso(), tags: Array.isArray(entity.tags) ? entity.tags : [] } as unknown as AnyEntity;
            if (collection === "learning" && (createValue as Database["learning"][number]).status === "completed") throw new DataError("AI 不能直接创建‘已完成整门课程’记录；请先建立课程清单并由你确认其完整性", 422);
            saved = ensureNestedIds(collection, createValue); items.push(saved); newIds.push(saved.id);
          } else {
            const id = typeof change.id === "string" ? tempIds.get(change.id) ?? change.id : "";
            const index = items.findIndex((item) => item.id === id && !item.archived);
            if (index < 0) throw new DataError("AI 草稿要修改的记录不存在或已归档", 409);
            previous = items[index];
            if (collection === "learning" && entity.status === "completed") {
              const course = previous as Database["learning"][number];
              const proposedCourse = { ...course, ...entity } as Database["learning"][number];
              if (!course.syllabusComplete || !proposedCourse.modules.length || proposedCourse.modules.some((module) => module.status !== "completed" || module.topics.some((topic) => topic.status !== "completed"))) throw new DataError("AI 不能总结为已学完整门课程：请先在资料库确认完整章节清单，并将全部模块与知识点标记为完成", 422);
            }
            saved = ensureNestedIds(collection, { ...previous, ...entity, id, createdAt: previous.createdAt, updatedAt: iso(), tags: Array.isArray(entity.tags) ? entity.tags : previous.tags } as AnyEntity);
            if (collection === "tasks" && (saved as Task).status === "completed" && (previous as Task).status !== "completed") {
              const completedTask = saved as Task; completedTask.completedAt = iso(); completedTask.pinned = false;
              appendEvent(candidate, { date: todayFor(candidate.settings), taskId: completedTask.id, parentRef: completedTask.primaryParent, milestoneRefs: completedTask.milestoneRefs ?? [], note: `AI 草稿经用户确认：${change.explanation}`, kind: "completed", previousStatus: (previous as Task).status });
              changed.add("progressEvents");
            }
            items[index] = saved;
          }
          records.push({ collection, entity: saved, previous }); changed.add(collection);
        }
        for (const record of records) syncCanonicalRelations(candidate, record.collection, record.entity, record.previous);
        for (const record of records) validateEntity(candidate, record.collection, record.entity, record.previous);
        if (records.some((record) => record.collection === "research" || record.collection === "papers")) { changed.add("research"); changed.add("papers"); }
        if (records.some((record) => record.collection === "tasks" && ((record.entity as Task).activePlanId || (record.previous as Task | undefined)?.activePlanId))) changed.add("activePlans");
        if (selected.some((change) => change.action === "update" && change.collection === "tasks")) changed.add("progressEvents");
        if (input.dryRun) return { ok: true, repeated: false, ids: newIds };
        current.settings.dataRevision++;
        conversation.updatedAt = iso();
        conversation.appliedOperations = [...(conversation.appliedOperations ?? []), { proposalId: input.proposalId, operationId: input.operationId, appliedAt: iso(), ids: newIds }].slice(-100);
        const nextConversations = { ...conversations, [conversation.id]: conversation };
        const changes = { ...Object.fromEntries([...changed].map((key) => [key, candidate[key]])), settings: current.settings };
        await commit(changes, { conversations: nextConversations });
        return { ok: true, repeated: false, ids: newIds };
      });
    },
    async archive(collection: EditableCollection, id: string, hard = false, expectedEpoch?: string): Promise<void> {
      return queue(async () => {
        const db = await ensure();
        assertEpoch(db, expectedEpoch);
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
    async setPriorities(ids: string[], expectedEpoch?: string): Promise<void> {
      return queue(async () => { const db = structuredClone(await ensure()); assertEpoch(db, expectedEpoch); applyPriorities(db, ids); await writeDatabase(db, ["tasks"]); });
    },
    async recordProgress(input: { taskId?: string; note: string; nextAction?: string; complete?: boolean }, expectedEpoch?: string): Promise<ProgressEvent> {
      return queue(async () => {
        const db = structuredClone(await ensure());
        assertEpoch(db, expectedEpoch);
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
    async submitReview(input: ReviewSubmission & { dataEpoch?: string }): Promise<EveningReview> {
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
        assertEpoch(db, input.dataEpoch);
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
    async archiveDemo(collection: EditableCollection, ids: string[], expectedEpoch?: string): Promise<void> {
      return queue(async () => {
        const db = structuredClone(await ensure());
        assertEpoch(db, expectedEpoch);
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
