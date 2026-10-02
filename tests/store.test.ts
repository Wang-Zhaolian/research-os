import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createStore, defaultSettings } from "../lib/store.ts";
import type { Database, LearningCourse, ResearchProject, ReviewSubmission, Task } from "../lib/types.ts";

const stamp = "2026-09-25T00:00:00.000Z";
const learning = (id = "learning_1"): LearningCourse => ({ id, createdAt: stamp, updatedAt: stamp, tags: [], name: "优化理论", field: "运筹优化", status: "in_progress", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "读对偶理论", notes: "", modules: [] });
const research = (id = "research_1"): ResearchProject => ({ id, createdAt: stamp, updatedAt: stamp, tags: [], name: "AI + 项目调度", advisor: "", collaborators: [], startDate: "2026-09-01", status: "in_progress", stage: "Literature Review", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "确定研究问题", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] });
const task = (overrides: Partial<Task> = {}): Task => ({ id: "task_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "确定研究问题", category: "科研", priority: "high", status: "in_progress", nextAction: "整理文献缺口", primaryParent: { type: "research", id: "research_1" }, relatedRefs: [], milestoneRefs: [], planningState: "week", plannedWeek: "2026-09-21", notes: "", pinned: false, pinOrder: 1, ...overrides });
const newTask = (overrides: Partial<Task> = {}) => ({ ...task(overrides), id: undefined });
const empty = (): Database => ({ tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], progressEvents: [], settings: structuredClone(defaultSettings) });
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
    assert.equal(migrated.settings.schemaVersion, 2);
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
