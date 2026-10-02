import assert from "node:assert/strict";
import test from "node:test";
import { allDeadlines, calculateGpa, calculateGradePoint, calculateWeightedAverage, dateInZone, filterTasks, isStalled, priorityCandidates, progressFor, searchDatabase, sortDeadlines, taskPlanBucket, topPriorities, weekStart, SWUFE_2024_GPA_RULES } from "../lib/domain.ts";
import { defaultSettings } from "../lib/store.ts";
import type { Database, Grade, Task } from "../lib/types.ts";

const stamp = "2026-09-25T00:00:00.000Z";
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task_1", createdAt: stamp, updatedAt: stamp, tags: [], title: "Read paper", category: "论文", priority: "high", status: "not_started",
  nextAction: "Read section 2", relatedRefs: [], milestoneRefs: [], planningState: "inbox", notes: "", pinned: false, pinOrder: 1, ...overrides,
});
const empty = (): Database => ({ tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], pendingItems: [], activePlans: [], achievements: [], internships: [], attachments: [], reviews: [], progressEvents: [], profile: { displayName: "", university: "", major: "", currentSemester: "", developmentDirections: [], onboardingComplete: false }, settings: defaultSettings });

test("GPA uses configurable weighted rules", () => {
  const grades: Grade[] = [
    { id: "g1", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "A", credits: 4, score: 92, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true },
    { id: "g2", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "B", credits: 2, score: 78, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true },
  ];
  const result = calculateGpa(grades, defaultSettings.gpa.rules);
  assert.equal(result.credits, 6);
  assert.equal(result.gpa?.toFixed(2), "3.67");
});

test("SWUFE 2024 GPA lower-bound edges are exact", () => {
  for (const rule of SWUFE_2024_GPA_RULES) assert.equal(calculateGradePoint(rule.minScore, SWUFE_2024_GPA_RULES), rule.point, `score ${rule.minScore}`);
  assert.equal(calculateGradePoint(59, SWUFE_2024_GPA_RULES), 0);
  assert.equal(calculateGradePoint(89, SWUFE_2024_GPA_RULES), 3.7);
  assert.equal(calculateGradePoint(100, SWUFE_2024_GPA_RULES), 4);
});

test("weighted average and GPA exclude pending, pass/fail, exempt, archived and manually excluded grades", () => {
  const grades: Grade[] = [
    { id: "scored-4", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "A", credits: 4, score: 90, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true },
    { id: "scored-2", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "B", credits: 2, score: 60, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true },
    { id: "pending", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "待出分", credits: 8, score: null, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true },
    { id: "pass", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "合格", credits: 8, courseType: "elective", isCore: false, gradingType: "pass_fail", includeInAverage: true, result: "pass" },
    { id: "exempt", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "免修", credits: 5, courseType: "elective", isCore: false, gradingType: "exempt", includeInAverage: true },
    { id: "excluded", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "重修未计入", credits: 10, score: 100, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: false },
    { id: "archived", createdAt: stamp, updatedAt: stamp, tags: [], semester: "S1", course: "旧记录", credits: 10, score: 0, courseType: "core", isCore: true, gradingType: "percentage", includeInAverage: true, archived: true },
  ];
  assert.deepEqual(calculateWeightedAverage(grades), { average: 80, credits: 6 });
  assert.deepEqual(calculateGpa(grades, SWUFE_2024_GPA_RULES), { gpa: 3, credits: 6 });
  assert.deepEqual(calculateWeightedAverage([]), { average: null, credits: 0 });
  assert.deepEqual(calculateGpa([], SWUFE_2024_GPA_RULES), { gpa: null, credits: 0 });
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
