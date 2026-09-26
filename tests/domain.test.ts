import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { calculateGpa, searchDatabase, sortDeadlines, topPriorities } from "../lib/domain.ts";
import { createStore, defaultSettings } from "../lib/store.ts";
import type { Database, Grade, Task } from "../lib/types.ts";

const timestamp = "2026-09-25T00:00:00.000Z";
const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task_1", createdAt: timestamp, updatedAt: timestamp, tags: [], title: "Read paper",
  category: "论文", priority: "high", status: "not_started", dueDate: "2026-10-02",
  notes: "", weekBucket: "this_week", pinned: true, pinOrder: 1, ...overrides,
});
const empty = (): Database => ({ tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], settings: defaultSettings });

test("GPA uses configurable weighted rules", () => {
  const grades: Grade[] = [
    { id: "g1", createdAt: timestamp, updatedAt: timestamp, tags: [], semester: "S1", course: "A", credits: 4, score: 92, courseType: "core", isCore: true },
    { id: "g2", createdAt: timestamp, updatedAt: timestamp, tags: [], semester: "S1", course: "B", credits: 2, score: 78, courseType: "core", isCore: true },
  ];
  const result = calculateGpa(grades, defaultSettings.gpa.rules);
  assert.equal(result.credits, 6);
  assert.equal(result.gpa.toFixed(2), "3.67");
});

test("dashboard priorities and deadlines are sorted", () => {
  const tasks = [task({ id: "later", dueDate: "2026-11-01", pinOrder: 2 }), task({ id: "first", dueDate: "2026-09-28", pinOrder: 1 })];
  assert.deepEqual(topPriorities(tasks).map((item) => item.id), ["first", "later"]);
  assert.deepEqual(sortDeadlines(tasks).map((item) => item.id), ["first", "later"]);
});

test("cross-module references are searchable", () => {
  const db = empty();
  db.tasks.push(task({ relation: { type: "research", id: "research_1", label: "Scheduling Lab" } }));
  assert.equal(searchDatabase(db, "Scheduling Lab")[0]?.entity.id, "task_1");
});

test("file store persists create, edit, archive and restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "research-os-test-"));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())));
  try {
    const first = createStore(root);
    await first.replace(empty());
    const created = await first.upsert("tasks", task({ id: undefined as unknown as string, title: "Persistent task" }));
    await first.upsert("tasks", { id: created.id, status: "in_progress" });
    const restarted = createStore(root);
    assert.equal(restarted.root, root);
    let db = await restarted.read();
    assert.equal(db.tasks[0].title, "Persistent task");
    assert.equal(db.tasks[0].status, "in_progress");
    await restarted.archive("tasks", created.id);
    db = await restarted.read();
    assert.equal(db.tasks[0].archived, true);
    assert.doesNotReject(() => readFile(path.join(root, "tasks.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
