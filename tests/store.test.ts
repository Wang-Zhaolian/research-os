import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore, defaultSettings } from "../lib/store.ts";
import type { AIConversation, AIProposalChange, Database, LearningCourse, ResearchProject, ReviewSubmission, Task } from "../lib/types.ts";

const stamp = "2026-09-25T00:00:00.000Z";
const learning = (id = "learning_1"): LearningCourse => ({ id, createdAt: stamp, updatedAt: stamp, tags: [], name: "优化理论", field: "运筹优化", status: "in_progress", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "读对偶理论", notes: "", modules: [] });
const research = (id = "research_1"): ResearchProject => ({ id, createdAt: stamp, updatedAt: stamp, tags: [], name: "AI + 项目调度", advisor: "", collaborators: [], startDate: "2026-09-01", status: "in_progress", stage: "Literature Review", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "确定研究问题", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] });
const task = (overrides: Partial<Task> = {}): Task => ({ id: "task_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "确定研究问题", category: "科研", priority: "high", status: "in_progress", nextAction: "整理文献缺口", primaryParent: { type: "research", id: "research_1" }, relatedRefs: [], milestoneRefs: [], planningState: "week", plannedWeek: "2026-09-21", notes: "", pinned: false, pinOrder: 1, ...overrides });
const newTask = (overrides: Partial<Task> = {}) => ({ ...task(overrides), id: undefined });
const empty = (): Database => ({ tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], progressEvents: [], profile: { displayName: "", university: "", major: "", currentSemester: "", developmentDirections: [], onboardingComplete: false }, settings: structuredClone(defaultSettings) });
const tempRoot = () => mkdtemp(path.join(tmpdir(), "research-os-test-"));
const submission = (overrides: Partial<ReviewSubmission> = {}): ReviewSubmission => ({ date: "2026-10-02", operationId: "operation-0001", expectedRevision: 0, completeTaskIds: [], undoTaskIds: [], progressUpdates: [], unfinishedNote: "", researchProgress: "", inboxPlans: [], priorityTaskIds: [], reflection: "", ...overrides });

test("create, edit, archive and restart persist JSON; unknown update IDs fail", async () => {
  const root = await tempRoot();
  try {
    const first = createStore(root);
    await first.replace(empty());
    const created = await first.upsert("tasks", { ...task({ planningState: "inbox", plannedWeek: undefined, primaryParent: undefined, pinned: false }), id: undefined });
    await first.upsert("tasks", { id: created.id, status: "paused", title: "Revised task" });
    await assert.rejects(first.upsert("tasks", { id: "missing", title: "No record" }), /不存在/);
    await first.archive("tasks", created.id);
    const restarted = createStore(root);
    const db = await restarted.read();
    assert.equal(db.tasks[0].title, "Revised task");
    assert.equal(db.tasks[0].status, "paused");
    assert.equal(db.tasks[0].archived, true);
    assert.doesNotReject(() => readFile(path.join(root, "tasks.json"), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("weekly task creation requires a real primary parent; IDs and dates are validated", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.learning.push(learning()); await store.replace(db);
    await assert.rejects(store.upsert("tasks", newTask({ primaryParent: undefined })), /主关联/);
    await assert.rejects(store.upsert("tasks", newTask({ primaryParent: { type: "learning", id: "missing" } })), /不存在或已归档/);
    await assert.rejects(store.upsert("tasks", newTask({ dueDate: "2026-02-30" })), /有效的 YYYY-MM-DD/);
    const saved = await store.upsert("tasks", newTask({ primaryParent: { type: "learning", id: "learning_1" } }));
    assert.equal((saved as Task).planningState, "week");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("archiving is type-aware, blocks live relations, and hard deletion protects referenced records", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty();
    db.learning.push(learning("shared-id")); db.research.push(research("shared-id"));
    db.tasks.push(task({ primaryParent: { type: "research", id: "shared-id" } })); await store.replace(db);
    await store.archive("learning", "shared-id");
    await assert.rejects(store.archive("research", "shared-id"), /未完成任务关联/);
    await assert.rejects(store.archive("research", "shared-id", true), /仍被其他内容引用/);
    await store.upsert("tasks", { id: "task_1", status: "completed" });
    await store.archive("research", "shared-id");
    const after = await store.read();
    assert.equal(after.research[0].archived, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("research-paper links stay bidirectional and goal multi-links are preserved", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); const r = research();
    const paper = { id: "paper_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Paper", authors: [], year: 2025, venue: "", doiUrl: "", researchArea: "", keywords: [], status: "to_read" as const, importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" as const } };
    r.paperIds = [paper.id]; db.research.push(r); db.papers.push(paper);
    db.learning.push(learning("l1"), learning("l2"));
    db.goals.push({ id: "goal_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Goal", type: "long_term", timeframe: "本科", status: "in_progress", description: "", milestones: [], linkedItems: [], nextAction: "" });
    await store.replace(db);
    await store.upsert("research", { id: r.id, paperIds: [] });
    let current = await store.read();
    assert.deepEqual(current.papers[0].relatedResearchIds, []);
    await store.upsert("papers", { id: paper.id, relatedResearchIds: [r.id] });
    await store.upsert("goals", { id: "goal_1", linkedItems: [{ type: "learning", id: "l1" }, { type: "learning", id: "l2" }] });
    current = await store.read();
    assert.deepEqual(current.research[0].paperIds, [paper.id]);
    assert.equal(current.goals[0].linkedItems.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("goal milestones with active task references cannot be removed", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.research.push(research());
    db.goals.push({ id: "goal_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Goal", type: "long_term", timeframe: "本科", status: "in_progress", description: "", milestones: [{ id: "m1", title: "Research foundation", status: "in_progress", evidence: "" }], linkedItems: [], nextAction: "" });
    db.tasks.push(task({ milestoneRefs: [{ goalId: "goal_1", milestoneId: "m1" }] })); await store.replace(db);
    await assert.rejects(store.upsert("goals", { id: "goal_1", milestones: [] }), /仍被任务或进展记录引用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("evening review is atomic, idempotent, records progress, and validates inbox triage", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.research.push(research()); db.tasks.push(task({ planningState: "inbox", plannedWeek: undefined, primaryParent: undefined })); await store.replace(db);
    await assert.rejects(store.submitReview(submission({ inboxPlans: [{ taskId: "task_1", planningState: "week", plannedWeek: "2026-09-28" }] })), /主关联/);
    const unchanged = await store.read(); assert.equal(unchanged.reviews.length, 0); assert.equal(unchanged.tasks[0].status, "in_progress");
    const request = submission({ completeTaskIds: ["task_1"], newPaper: { title: "New paper", url: "https://example.org/paper" }, researchProjectId: "research_1", researchProgress: "研究问题缩小到可验证的实验", reflection: "有效推进" });
    const first = await store.submitReview(request);
    const second = await store.submitReview(request);
    const saved = await store.read();
    assert.equal(first.id, second.id);
    assert.equal(saved.papers.length, 1);
    assert.equal(saved.reviews.length, 1);
    assert.equal(saved.tasks[0].status, "completed");
    assert.equal(saved.progressEvents.filter((event) => event.taskId === "task_1").length, 1);
    assert.equal(saved.progressEvents.filter((event) => event.parentRef?.id === "research_1").length, 1);
    assert.equal((await readdir(path.join(root, ".backups"))).filter((name) => name.startsWith("review-")).length, 1);
    const undo = await store.submitReview(submission({ operationId: "operation-0002", expectedRevision: 1, undoTaskIds: ["task_1"] }));
    const corrected = await store.read();
    assert.equal(undo.revision, 2);
    assert.equal(corrected.tasks[0].status, "in_progress");
    assert.deepEqual(undo.completedTaskIds, []);
    assert.equal(corrected.progressEvents.filter((event) => event.kind === "replan").length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("selected archive preserves records and takes a pre-action snapshot", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.tasks.push(task({ planningState: "inbox", plannedWeek: undefined, primaryParent: undefined })); await store.replace(db);
    await store.archiveDemo("tasks", ["task_1"]);
    const archived = await store.read();
    assert.equal(archived.tasks.length, 1);
    assert.equal(archived.tasks[0].archived, true);
    const backups = await readdir(path.join(root, ".backups"));
    assert.equal(backups.filter((name) => name.startsWith("before-archive-")).length, 1);
    const before = JSON.parse(await readFile(path.join(root, ".backups", backups[0], "tasks.json"), "utf8"));
    assert.equal(before[0].archived, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("review snapshots keep only the latest 30 copies", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); await store.replace(empty());
    for (let revision = 0; revision < 31; revision++) {
      await store.submitReview(submission({ operationId: `operation-${String(revision).padStart(4, "0")}`, expectedRevision: revision }));
    }
    const db = await store.read();
    const backups = (await readdir(path.join(root, ".backups"))).filter((name) => name.startsWith("review-"));
    assert.equal(db.reviews[0].revision, 31);
    assert.equal(backups.length, 30);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("interrupted multi-file commit recovers from journal before reading", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); await store.replace(empty());
    const recoveredTask = task({ id: "recovered", planningState: "inbox", plannedWeek: undefined, primaryParent: undefined });
    const event = { id: "event_recovered", createdAt: stamp, updatedAt: stamp, tags: [], date: "2026-10-02", taskId: "recovered", milestoneRefs: [], note: "Recovered", kind: "progress" };
    await writeFile(path.join(root, ".pending-transaction.json"), JSON.stringify({ version: 1, transactionId: "txn", changes: { tasks: [recoveredTask], progressEvents: [event] } }));
    const recovered = await createStore(root).read();
    assert.equal(recovered.tasks[0].id, "recovered");
    assert.equal(recovered.progressEvents[0].id, "event_recovered");
    await assert.rejects(readFile(path.join(root, ".pending-transaction.json")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("v1 migration backs up and preserves tasks, goal links, and research-paper references", async () => {
  const root = await tempRoot();
  try {
    const v1Task = (id: string, relation?: object) => ({ id, createdAt: stamp, updatedAt: stamp, tags: [], title: id, category: "学习", priority: "high", status: "in_progress", relation, notes: "legacy", weekBucket: "this_week", pinned: true, pinOrder: 1 });
    const files: Record<string, unknown> = {
      tasks: [v1Task("linked", { type: "research", id: "r1", label: "Old relation" }), v1Task("orphan")], learning: [learning("l1")],
      research: [{ ...research("r1"), paperIds: ["p1"] }], papers: [{ id: "p1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Old paper", relatedResearchIds: [] }],
      projects: [], competitions: [], goals: [{ id: "g1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Old goal", type: "year", timeframe: "2026", status: "in_progress", description: "", linkedItems: [{ type: "learning", id: "l1" }], milestones: [{ id: "m1", title: "M1", status: "in_progress" }], nextAction: "" }], grades: [],
      reviews: [{ id: "rev1", createdAt: stamp, updatedAt: stamp, tags: [], date: "2026-10-01", completedTaskIds: [], unfinishedNote: "", researchProgress: "", priorityTaskIds: [], reflection: "" }],
      settings: { ...defaultSettings, schemaVersion: 1, timeZone: undefined, stalledDays: undefined },
    };
    for (const [key, value] of Object.entries(files)) await writeFile(path.join(root, `${key}.json`), JSON.stringify(value));
    const migrated = await createStore(root).read();
    assert.equal(migrated.settings.schemaVersion, 3);
    assert.equal(migrated.tasks.find((item) => item.id === "linked")?.primaryParent?.id, "r1");
    assert.equal(migrated.tasks.find((item) => item.id === "linked")?.planningState, "week");
    assert.equal(migrated.tasks.find((item) => item.id === "linked")?.pinned, true);
    assert.equal(migrated.tasks.find((item) => item.id === "orphan")?.planningState, "needs_parent");
    assert.equal(migrated.tasks.find((item) => item.id === "orphan")?.pinned, false);
    assert.equal(migrated.papers[0].relatedResearchIds.includes("r1"), true);
    assert.equal(migrated.goals[0].linkedItems[0].id, "l1");
    assert.equal(migrated.goals[0].milestones[0].evidence, "");
    assert.equal(migrated.reviews[0].revision, 1);
    const backups = await readdir(path.join(root, ".backups"));
    assert.equal(backups.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(root, ".backups", backups[0], "settings.json"), "utf8")).schemaVersion, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("v2 migration routes unassociated weekly tasks to the visible needs-parent inbox", async () => {
  const root = await tempRoot();
  try {
    const orphan = task({ primaryParent: undefined, planningState: "week", plannedWeek: "2026-09-21", pinned: true });
    const db = empty(); db.settings.schemaVersion = 2; db.tasks.push(orphan);
    const v2 = { ...db, profile: undefined, grades: undefined } as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(v2)) if (value !== undefined && key !== "profile" && key !== "grades") await writeFile(path.join(root, `${key}.json`), JSON.stringify(value));
    const migrated = await createStore(root).read();
    assert.equal(migrated.tasks[0].planningState, "needs_parent");
    assert.equal(migrated.tasks[0].plannedWeek, undefined);
    assert.equal(migrated.tasks[0].pinned, false);
    assert.equal(migrated.tasks[0].title, orphan.title);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("initialization requires a valid backup, advances data epoch, and a whole-workspace restore is recoverable", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.learning.push(learning()); db.research.push(research()); db.tasks.push(task());
    db.profile = { displayName: "同学", university: "西南财经大学", major: "待确认", currentSemester: "大二", developmentDirections: ["机器学习"], onboardingComplete: true };
    await store.replace(db);
    const epoch = db.settings.dataEpoch;
    const conversation: AIConversation = { id: "conversation_1", title: "课程安排", createdAt: stamp, updatedAt: stamp, messages: [{ id: "message_1", role: "user", text: "安排优化理论学习", createdAt: stamp, status: "complete", usesGradeContext: true }], allowGrades: true, dataEpoch: epoch };
    await store.saveConversation(conversation, epoch);
    const preview = await store.previewInitialization();
    assert.equal(preview.total, 3);
    await assert.rejects(store.initializeWorkspace({ expectedEpoch: epoch, expectedRevision: preview.dataRevision, confirmation: "开始" }), /清空并开始/);
    assert.equal((await store.read()).tasks.length, 1);
    const initialized = await store.initializeWorkspace({ expectedEpoch: epoch, expectedRevision: preview.dataRevision, confirmation: "清空并开始" });
    assert.notEqual(initialized.dataEpoch, epoch);
    const blank = await store.read();
    assert.equal(blank.tasks.length + blank.learning.length + blank.research.length, 0);
    assert.equal(blank.profile.onboardingComplete, false);
    await assert.rejects(store.upsert("tasks", { ...task(), id: undefined }, epoch), /刷新页面/);
    await assert.rejects(store.getConversation(conversation.id, initialized.dataEpoch), /对话不存在/);
    const backup = (await store.listBackups()).find((item) => item.valid && item.counts.tasks === 1);
    assert.ok(backup);
    const restorePreview = await store.previewRestore(backup.id);
    assert.equal(restorePreview.profile.displayName, "同学");
    const restored = await store.restoreBackup({ id: backup.id, expectedEpoch: initialized.dataEpoch, expectedRevision: initialized.dataRevision, confirmation: "恢复此备份" });
    assert.notEqual(restored.dataEpoch, initialized.dataEpoch);
    const afterRestore = await store.read();
    assert.equal(afterRestore.tasks[0].id, "task_1");
    const restoredConversation = await store.getConversation(conversation.id, restored.dataEpoch);
    assert.equal(restoredConversation.allowGrades, false);
    assert.equal(restoredConversation.messages[0].usesGradeContext, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed pre-initialization backup never clears business data", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.tasks.push(task()); await store.replace(db);
    await writeFile(path.join(root, ".backups"), "not a directory");
    await assert.rejects(store.initializeWorkspace({ expectedEpoch: db.settings.dataEpoch, expectedRevision: 0, confirmation: "清空并开始" }));
    const unchanged = await store.read();
    assert.equal(unchanged.tasks.length, 1);
    assert.equal(unchanged.tasks[0].id, "task_1");
    assert.equal(unchanged.settings.dataEpoch, db.settings.dataEpoch);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile confirmation applies the exact editable SWUFE 2024 GPA preset only for eligible entry years", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty();
    db.settings.gpa.rules = [{ minScore: 60, point: 1, label: "old" }];
    await store.replace(db);
    const profile = { displayName: "", university: "西南财经大学", major: "", currentSemester: "", developmentDirections: [], onboardingComplete: true, entryYear: 2025 };
    await assert.rejects(store.saveProfile({ ...profile, entryYear: 2023 }, true, db.settings.dataEpoch), /2024 级及以后/);
    await store.saveProfile(profile, true, db.settings.dataEpoch);
    const confirmed = await store.read();
    assert.equal(confirmed.settings.gpaConfigured, true);
    assert.deepEqual(confirmed.settings.gpa.rules.map(({ minScore, point }) => [minScore, point]), [[90, 4], [85, 3.7], [80, 3.3], [76, 3], [73, 2.7], [70, 2.3], [66, 2], [63, 1.7], [61, 1.3], [60, 1], [0, 0]]);
    await store.saveProfile({ ...profile, entryYear: undefined }, false, db.settings.dataEpoch);
    assert.equal((await store.read()).settings.gpaConfigured, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AI suggestions are dry-run only until confirmed, support same-batch references, and are idempotent", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); await store.replace(db);
    const changes: AIProposalChange[] = [
      { action: "create", collection: "projects", id: "draft-project", explanation: "创建非科研项目记录", entity: { name: "Personal Quant Platform", type: "my_project", status: "in_progress", nextAction: "建立数据模型" } },
      { action: "create", collection: "tasks", id: "draft-task", explanation: "建立关联的第一个交付任务", entity: { title: "建立量化平台数据模型", category: "项目", priority: "high", status: "not_started", planningState: "week", plannedWeek: "2026-10-05", primaryParent: { type: "project", id: "draft-project" }, nextAction: "定义行情与持仓表", notes: "" } },
    ];
    const conversation: AIConversation = { id: "ai_conversation", title: "测试草稿", createdAt: stamp, updatedAt: stamp, messages: [{ id: "ai_message", role: "assistant", text: "建议如下", createdAt: stamp, status: "complete", proposal: { id: "proposal_1", dataEpoch: db.settings.dataEpoch, dataRevision: 0, changes } }], allowGrades: false, dataEpoch: db.settings.dataEpoch };
    await store.saveConversation(conversation, db.settings.dataEpoch);
    const request = { conversationId: conversation.id, proposalId: "proposal_1", operationId: "operation-ai-0001", indexes: [0, 1], expectedEpoch: db.settings.dataEpoch, expectedRevision: 0 };
    await store.applyAIProposal({ ...request, dryRun: true });
    assert.equal((await store.read()).projects.length, 0);
    const saved = await store.applyAIProposal(request);
    assert.equal(saved.ids.length, 2);
    const after = await store.read();
    assert.equal(after.projects.length, 1);
    assert.equal(after.tasks.length, 1);
    assert.equal(after.tasks[0].primaryParent?.id, after.projects[0].id);
    assert.equal(after.settings.dataRevision, 1);
    assert.deepEqual(await store.applyAIProposal(request), { ok: true, repeated: true, ids: [] });
    assert.equal((await store.read()).tasks.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AI proposal rejects illegal fields and stale versions without writing", async () => {
  const root = await tempRoot();
  try {
    const store = createStore(root); const db = empty(); db.learning.push(learning()); await store.replace(db);
    const changes: AIProposalChange[] = [{ action: "update", collection: "learning", id: "learning_1", explanation: "修改课程", entity: { nextAction: "读线性规划", credential: "must-not-be-stored" } }];
    const conversation: AIConversation = { id: "ai_conversation", title: "非法草稿", createdAt: stamp, updatedAt: stamp, messages: [{ id: "ai_message", role: "assistant", text: "建议", createdAt: stamp, status: "complete", proposal: { id: "proposal_2", dataEpoch: db.settings.dataEpoch, dataRevision: 0, changes } }], allowGrades: false, dataEpoch: db.settings.dataEpoch };
    await store.saveConversation(conversation, db.settings.dataEpoch);
    const request = { conversationId: conversation.id, proposalId: "proposal_2", operationId: "operation-ai-0002", indexes: [0], expectedEpoch: db.settings.dataEpoch, expectedRevision: 0, dryRun: true };
    await assert.rejects(store.applyAIProposal(request), /系统字段或未知字段/);
    assert.equal((await store.read()).learning[0].nextAction, "读对偶理论");
    await store.upsert("learning", { id: "learning_1", notes: "人工修改后产生新版本" }, db.settings.dataEpoch);
    await assert.rejects(store.applyAIProposal({ ...request, dryRun: false, editedChanges: [{ ...changes[0], entity: { nextAction: "读线性规划" } }] }), /数据已变化/);
    assert.equal((await store.read()).learning[0].nextAction, "读对偶理论");
  } finally { await rm(root, { recursive: true, force: true }); }
});
