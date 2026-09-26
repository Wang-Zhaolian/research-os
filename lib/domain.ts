import type { AnyEntity, Database, Grade, GpaRule, Task } from "./types";

export const statusLabels: Record<string, string> = {
  not_started: "未开始", in_progress: "进行中", blocked: "阻塞",
  completed: "已完成", paused: "暂停", delayed: "延期",
  to_read: "待读", skimmed: "快速浏览", reading: "阅读中", read: "已读",
  deep_read: "精读", core: "核心论文",
};

export function calculateGradePoint(score: number, rules: GpaRule[]): number {
  const match = [...rules].sort((a, b) => b.minScore - a.minScore).find((rule) => score >= rule.minScore);
  return match?.point ?? 0;
}

export function calculateGpa(grades: Grade[], rules: GpaRule[]) {
  const active = grades.filter((grade) => !grade.archived);
  const credits = active.reduce((sum, grade) => sum + Number(grade.credits), 0);
  const weighted = active.reduce((sum, grade) => sum + Number(grade.credits) * calculateGradePoint(Number(grade.score), rules), 0);
  return { gpa: credits ? weighted / credits : 0, credits };
}

export function sortDeadlines(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.archived && task.status !== "completed" && task.dueDate)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

export function topPriorities(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.archived && task.pinned && task.status !== "completed")
    .sort((a, b) => a.pinOrder - b.pinOrder).slice(0, 5);
}

export function searchDatabase(db: Database, query: string): { collection: string; entity: AnyEntity; title: string }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const titleFor = (collection: string, entity: AnyEntity) => {
    if (collection === "tasks" || collection === "papers" || collection === "goals") return (entity as { title: string }).title;
    if (collection === "grades") return (entity as Grade).course;
    if (collection === "learning") return (entity as { name: string }).name;
    return (entity as { name?: string }).name ?? "记录";
  };
  return (["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"] as const)
    .flatMap((collection) => db[collection].filter((entity) => !entity.archived && JSON.stringify(entity).toLocaleLowerCase().includes(needle))
      .map((entity) => ({ collection, entity, title: titleFor(collection, entity) })));
}
