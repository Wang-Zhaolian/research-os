import assert from "node:assert/strict";
import test from "node:test";
import { allDeadlines, calculateGpa, dateInZone, filterTasks, isStalled, priorityCandidates, progressFor, searchDatabase, sortDeadlines, taskPlanBucket, topPriorities, weekStart } from "../lib/domain.ts";
import { defaultSettings } from "../lib/store.ts";
import type { Database, Grade, Task } from "../lib/types.ts";

const stamp = "2026-09-25T00:00:00.000Z";
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Read paper", category: "论文", priority: "high", status: "not_started",
  nextAction: "Read section 2", relatedRefs: [], milestoneRefs: [], planningState: "inbox", notes: "", pinned: false, pinOrder: 1, ...overrides,
});
const empty = (): Database => ({ tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], progressEvents: [], settings: defaultSettings });

test("GPA uses configurable weighted rules", () => {
  const grades: Grade[] = [
    { id: "g1", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "A", credits: 4, score: 92, courseType: "core", isCore: true },
    { id: "g2", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "B", credits: 2, score: 78, courseType: "core", isCore: true },
  ];
  const result = calculateGpa(grades, defaultSettings.gpa.rules);
  assert.equal(result.credits, 6);
  assert.equal(result.gpa.toFixed(2), "3.67");
});

test("dashboard priorities and deadlines are sorted", () => {
  const tasks = [
    task({ id: "later", dueDate: "2026-11-01", planningState: "week", plannedWeek: "2026-09-21", primaryParent: { type: "research", id: "r1" }, pinned: true, pinOrder: 2 }),
    task({ id: "first", dueDate: "2026-09-28", planningState: "week", plannedWeek: "2026-09-21", primaryParent: { type: "research", id: "r1" }, pinned: true, pinOrder: 1 }),
  ];
  assert.deepEqual(topPriorities(tasks).map((item) => item.id), ["first", "later"]);
  assert.deepEqual(sortDeadlines(tasks).map((item) => item.id), ["first", "later"]);
});

test("cross-module references are searchable and week rollover is explicit", () => {
  const db = empty();
  db.tasks.push(task());
  db.tasks[0].primaryParent = { type: "research", id: "research_1", label: "Scheduling Lab" };
  assert.equal(searchDatabase(db, "Scheduling Lab")[0]?.entity.id, "task_1");
  assert.equal(weekStart("2026-10-02"), "2026-09-28");
  assert.equal(taskPlanBucket(task({ planningState: "week", plannedWeek: "2026-09-21" }), "2026-10-02"), "leftover");
  assert.equal(taskPlanBucket(task({ planningState: "needs_parent", plannedWeek: "2026-09-28" }), "2026-10-02"), "inbox");
});

test("priority suggestions explain urgency and stalling", () => {
  const db = empty();
  const candidate = task({ id: "urgent", createdAt: "2026-09-01T00:00:00.000Z", dueDate: "2026-09-30", priority: "high", planningState: "week", plannedWeek: "2026-09-28", primaryParent: { type: "research", id: "r1" } });
  db.tasks.push(candidate);
  db.progressEvents.push({ id: "event_1", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: stamp, date: "2026-09-01", tags: [], taskId: candidate.id, milestoneRefs: [], note: "Started", kind: "progress" });
  assert.equal(isStalled(db, candidate, "2026-10-02"), true);
  assert.deepEqual(priorityCandidates(db, "2026-10-02")[0]?.reasons, ["已逾期", "高优先级", "已停滞"]);
  assert.equal(dateInZone(new Date("2026-10-01T18:00:00.000Z"), "Asia/Shanghai"), "2026-10-02");
});

test("deadlines combine tasks, research, competitions and goal milestones", () => {
  const db = empty();
  db.tasks.push(task({ dueDate: "2026-10-10" }));
  db.research.push({ id: "r1", createdAt: stamp, updatedAt: stamp, tags: [], name: "Research", advisor: "", collaborators: [], startDate: "2026-09-01", status: "in_progress", stage: "Idea", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "", deadline: "2026-10-03", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] });
  db.competitions.push({ id: "c1", createdAt: stamp, updatedAt: stamp, tags: [], name: "Competition", level: "", date: "2026-10-04", teammates: [], advisor: "", status: "in_progress", deadline: "2026-10-05", preparationStage: "", currentTask: "", finalResult: "", award: "", cvImportance: "medium", materials: [], projectIds: [] });
  db.goals.push({ id: "g1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Goal", type: "year", timeframe: "2026", status: "in_progress", description: "", milestones: [{ id: "m1", title: "Milestone", status: "in_progress", targetDate: "2026-10-02" }], linkedItems: [], nextAction: "" });
  assert.deepEqual(allDeadlines(db).map((item) => item.date), ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-10"]);
});

test("one progress event is visible through its task, parent, and goal milestone", () => {
  const db = empty();
  db.tasks.push(task({ milestoneRefs: [{ goalId: "g1", milestoneId: "m1" }] }));
  db.progressEvents.push({ id: "e1", createdAt: stamp, updatedAt: stamp, tags: [], date: "2026-10-02", taskId: "task_1", parentRef: { type: "research", id: "r1" }, milestoneRefs: [{ goalId: "g1", milestoneId: "m1" }], note: "Baseline 已复现", kind: "progress" });
  assert.equal(progressFor(db, "task_1")[0]?.id, "e1");
  assert.equal(progressFor(db, undefined, { type: "research", id: "r1" })[0]?.id, "e1");
  assert.equal(progressFor(db, undefined, { type: "goal", id: "g1" })[0]?.id, "e1");
  assert.equal(progressFor(db, undefined, undefined, { goalId: "g1", milestoneId: "m1" })[0]?.id, "e1");
});

test("task filters combine text, status, priority, category, tag and deadlines", () => {
  const tasks = [
    task({ id: "match", title: "ML baseline", status: "in_progress", priority: "high", category: "科研", tags: ["ml"], dueDate: "2026-10-05" }),
    task({ id: "late", title: "Old paper", status: "not_started", priority: "low", category: "论文", tags: ["reading"], dueDate: "2026-09-30" }),
  ];
  assert.deepEqual(filterTasks(tasks, { query: "baseline", status: "in_progress", priority: "high", category: "科研", tag: "ml", deadline: "week" }, "2026-10-02").map((item) => item.id), ["match"]);
  assert.deepEqual(filterTasks(tasks, { deadline: "overdue" }, "2026-10-02").map((item) => item.id), ["late"]);
});
