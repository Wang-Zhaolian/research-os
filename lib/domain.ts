import type { AnyEntity, Database, EntityRef, Grade, GpaRule, MilestoneRef, ProgressEvent, Task } from "./types.ts";

export const statusLabels: Record<string, string> = {
  not_started: "未开始", in_progress: "进行中", blocked: "阻塞",
  completed: "已完成", paused: "暂停", delayed: "延期",
  to_read: "待读", skimmed: "快速浏览", reading: "阅读中", read: "已读",
  deep_read: "精读", core: "核心论文",
};

export const SWUFE_2024_GPA_RULES: GpaRule[] = [
  { minScore: 90, point: 4, label: "90–100" }, { minScore: 85, point: 3.7, label: "85–89" },
  { minScore: 80, point: 3.3, label: "80–84" }, { minScore: 76, point: 3, label: "76–79" },
  { minScore: 73, point: 2.7, label: "73–75" }, { minScore: 70, point: 2.3, label: "70–72" },
  { minScore: 66, point: 2, label: "66–69" }, { minScore: 63, point: 1.7, label: "63–65" },
  { minScore: 61, point: 1.3, label: "61–62" }, { minScore: 60, point: 1, label: "60" },
  { minScore: 0, point: 0, label: "0–59" },
];

export function calculateGradePoint(score: number, rules: GpaRule[]): number {
  const match = [...rules].sort((a, b) => b.minScore - a.minScore).find((rule) => score >= rule.minScore);
  return match?.point ?? 0;
}

export function calculateGpa(grades: Grade[], rules: GpaRule[]) {
  const active = grades.filter((grade) => !grade.archived && grade.gradingType === "percentage" && grade.includeInAverage && typeof grade.score === "number");
  const credits = active.reduce((sum, grade) => sum + Number(grade.credits), 0);
  const weighted = active.reduce((sum, grade) => sum + Number(grade.credits) * calculateGradePoint(Number(grade.score), rules), 0);
  return { gpa: credits ? weighted / credits : null, credits };
}

export function calculateWeightedAverage(grades: Grade[]) {
  const active = grades.filter((grade) => !grade.archived && grade.gradingType === "percentage" && grade.includeInAverage && typeof grade.score === "number");
  const credits = active.reduce((sum, grade) => sum + Number(grade.credits), 0);
  const weighted = active.reduce((sum, grade) => sum + Number(grade.credits) * Number(grade.score), 0);
  return { average: credits ? Math.round((weighted / credits + Number.EPSILON) * 100) / 100 : null, credits };
}

export function sortDeadlines(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.archived && task.status !== "completed" && task.dueDate)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

export interface TaskFilters {
  query?: string; status?: string; priority?: string; category?: string; tag?: string;
  deadline?: "all" | "overdue" | "week" | "month" | "has_date" | "no_date";
}
export function filterTasks(tasks: Task[], filters: TaskFilters, today: string): Task[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return tasks.filter((task) => {
    if (task.archived) return false;
    if (query && !JSON.stringify(task).toLocaleLowerCase().includes(query)) return false;
    if (filters.status && filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.priority && filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.category && filters.category !== "all" && task.category !== filters.category) return false;
    if (filters.tag && filters.tag !== "all" && !task.tags.includes(filters.tag)) return false;
    const due = task.dueDate;
    switch (filters.deadline ?? "all") {
      case "overdue": if (!due || due >= today) return false; break;
      case "week": if (!due || due < today || due > addDays(today, 7)) return false; break;
      case "month": if (!due || due < today || due > addDays(today, 30)) return false; break;
      case "has_date": if (!due) return false; break;
      case "no_date": if (due) return false; break;
    }
    return true;
  });
}

export function topPriorities(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.archived && task.pinned && task.status !== "completed" && task.planningState === "week" && Boolean(task.primaryParent))
    .sort((a, b) => a.pinOrder - b.pinOrder).slice(0, 5);
}

export function dateInZone(at = new Date(), timeZone = "Asia/Shanghai"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function weekStart(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export type PlanBucket = "inbox" | "this_week" | "next_week" | "leftover" | "later" | "future" | "completed";
export function taskPlanBucket(task: Task, today: string): PlanBucket {
  if (task.status === "completed") return "completed";
  if (task.planningState === "inbox" || task.planningState === "needs_parent") return "inbox";
  if (task.planningState === "later") return "later";
  if (!task.plannedWeek) return "inbox";
  const current = weekStart(today);
  if (task.plannedWeek < current) return "leftover";
  if (task.plannedWeek === current) return "this_week";
  if (task.plannedWeek === addDays(current, 7)) return "next_week";
  return "future";
}

const refCollections = { learning: "learning", research: "research", paper: "papers", project: "projects", competition: "competitions", goal: "goals", task: "tasks", grade: "grades", internship: "internships", pending_item: "pendingItems", active_plan: "activePlans", achievement: "achievements" } as const;
export function resolveRef(db: Database, ref?: EntityRef): AnyEntity | undefined {
  if (!ref) return undefined;
  return (db[refCollections[ref.type]] as AnyEntity[]).find((item) => item.id === ref.id);
}

export function effectiveNextAction(db: Database, task: Task): string {
  if (task.nextAction?.trim()) return task.nextAction.trim();
  const parent = resolveRef(db, task.primaryParent);
  if (!parent) return "";
  if ("nextAction" in parent && typeof parent.nextAction === "string") return parent.nextAction.trim();
  if ("currentTask" in parent && typeof parent.currentTask === "string") return parent.currentTask.trim();
  return "";
}

export function progressFor(db: Database, taskId?: string, parentRef?: EntityRef, milestoneRef?: MilestoneRef): ProgressEvent[] {
  return db.progressEvents.filter((item) => !item.archived && (
    (taskId && item.taskId === taskId) ||
    (parentRef && (item.parentRef?.type === parentRef.type && item.parentRef.id === parentRef.id || parentRef.type === "goal" && item.milestoneRefs.some((ref) => ref.goalId === parentRef.id))) ||
    (milestoneRef && item.milestoneRefs.some((ref) => ref.goalId === milestoneRef.goalId && ref.milestoneId === milestoneRef.milestoneId))
  )).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isStalled(db: Database, task: Task, today: string): boolean {
  if (task.archived || ["completed", "paused"].includes(task.status)) return false;
  const last = progressFor(db, task.id)[0]?.date ?? dateInZone(new Date(task.createdAt), db.settings.timeZone);
  return last <= addDays(today, -db.settings.stalledDays);
}

export function priorityCandidates(db: Database, today: string) {
  return db.tasks.filter((task) => !task.archived && !["completed", "paused"].includes(task.status) && task.planningState !== "inbox" && !task.pinned)
    .map((task) => {
      let score = 0;
      const reasons: string[] = [];
      if (task.dueDate && task.dueDate < today) { score += 40; reasons.push("已逾期"); }
      else if (task.dueDate && task.dueDate <= addDays(today, 7)) { score += 30; reasons.push("7 天内截止"); }
      else if (task.dueDate && task.dueDate <= addDays(today, 30)) { score += 10; reasons.push("30 天内截止"); }
      if (task.priority === "high") { score += 20; reasons.push("高优先级"); }
      else if (task.priority === "medium") score += 10;
      const goalLinked = task.primaryParent?.type === "goal" || task.relatedRefs?.some((ref) => ref.type === "goal") || task.milestoneRefs?.some((ref) => db.goals.some((goal) => !goal.archived && goal.id === ref.goalId && goal.milestones.some((milestone) => milestone.id === ref.milestoneId && milestone.status !== "completed")));
      if (goalLinked) { score += 20; reasons.push("推进长期目标"); }
      if (isStalled(db, task, today)) { score += 10; reasons.push("已停滞"); }
      return { task, score, reasons };
    }).sort((a, b) => b.score - a.score || (a.task.dueDate || "9999").localeCompare(b.task.dueDate || "9999") || a.task.id.localeCompare(b.task.id)).slice(0, 5);
}

export interface DeadlineItem { id: string; date: string; title: string; type: string }
export function allDeadlines(db: Database): DeadlineItem[] {
  const items: DeadlineItem[] = sortDeadlines(db.tasks).map((task) => ({ id: task.id, date: task.dueDate!, title: task.title, type: task.category }));
  db.research.filter((item) => !item.archived && item.deadline && item.status !== "completed").forEach((item) => items.push({ id: item.id, date: item.deadline!, title: item.name, type: "科研" }));
  db.activePlans.filter((item) => !item.archived && item.targetDate && item.status !== "completed").forEach((item) => items.push({ id: item.id, date: item.targetDate!, title: item.title, type: "计划" }));
  db.pendingItems.filter((item) => !item.archived && item.status === "open" && item.targetDate).forEach((item) => items.push({ id: item.id, date: item.targetDate!, title: item.title, type: "待开始" }));
  db.internships.filter((item) => !item.archived && item.endDate && item.status !== "completed").forEach((item) => items.push({ id: item.id, date: item.endDate!, title: `${item.organization} · ${item.role}`, type: "实习" }));
  db.competitions.filter((item) => !item.archived && item.status !== "completed").forEach((item) => {
    if (item.deadline) items.push({ id: `${item.id}:deadline`, date: item.deadline, title: `${item.name} · 报名/提交截止`, type: "竞赛" });
    if (item.date && item.date !== item.deadline) items.push({ id: `${item.id}:event`, date: item.date, title: `${item.name} · 比赛日期`, type: "竞赛" });
  });
  db.goals.filter((item) => !item.archived).forEach((goal) => goal.milestones.filter((milestone) => milestone.targetDate && milestone.status !== "completed").forEach((milestone) => items.push({ id: `${goal.id}:${milestone.id}`, date: milestone.targetDate!, title: `${goal.title} · ${milestone.title}`, type: "目标" })));
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function searchDatabase(db: Database, query: string): { collection: string; entity: AnyEntity; title: string }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const titleFor = (collection: string, entity: AnyEntity) => {
    if (collection === "tasks" || collection === "papers" || collection === "goals") return (entity as { title: string }).title;
    if (collection === "grades") return (entity as Grade).course;
    if (collection === "pendingItems" || collection === "activePlans" || collection === "achievements") return (entity as { title: string }).title;
    if (collection === "internships") return `${(entity as Database["internships"][number]).organization} · ${(entity as Database["internships"][number]).role}`;
    if (collection === "learning") return (entity as { name: string }).name;
    return (entity as { name?: string }).name ?? "记录";
  };
  return (["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades", "pendingItems", "activePlans", "achievements", "internships"] as const)
    .flatMap((collection) => db[collection].filter((entity) => !entity.archived && JSON.stringify(entity).toLocaleLowerCase().includes(needle))
      .map((entity) => ({ collection, entity, title: titleFor(collection, entity) })));
}
