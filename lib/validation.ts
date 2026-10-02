import type { AnyEntity, CollectionKey, Database, EntityRef, GpaRule, MilestoneRef, Settings, Task } from "./types.ts";
import { weekStart } from "./domain.ts";

export class DataError extends Error {
  public status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const statuses = new Set(["not_started", "in_progress", "blocked", "completed", "paused", "delayed"]);
const paperStatuses = new Set(["to_read", "skimmed", "reading", "read", "deep_read", "core"]);
const priorities = new Set(["high", "medium", "low"]);
const titles: Record<Exclude<CollectionKey, "reviews" | "progressEvents">, string> = {
  tasks: "title", learning: "name", research: "name", papers: "title", projects: "name", competitions: "name", goals: "title", grades: "course",
};
const refCollections = { learning: "learning", research: "research", paper: "papers", project: "projects", competition: "competitions", goal: "goals" } as const;

export function assertDate(value: unknown, label: string, optional = false): void {
  if (optional && (value === "" || value === undefined || value === null)) return;
  if (!isDate(value)) throw new DataError(`${label}必须是有效的 YYYY-MM-DD 日期`);
}

export function assertRef(db: Database, value: unknown, label: string, allowArchived = false): asserts value is EntityRef {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string" || !(value.type in refCollections)) throw new DataError(`${label}无效`);
  const collection = refCollections[value.type as keyof typeof refCollections];
  const entity = (db[collection] as AnyEntity[]).find((item) => item.id === value.id);
  if (!entity || (!allowArchived && entity.archived)) throw new DataError(`${label}所指记录不存在或已归档`);
}

export function assertMilestoneRef(db: Database, value: unknown): asserts value is MilestoneRef {
  if (!isRecord(value) || typeof value.goalId !== "string" || typeof value.milestoneId !== "string") throw new DataError("目标里程碑关联无效");
  const goal = db.goals.find((item) => item.id === value.goalId && !item.archived);
  if (!goal?.milestones.some((item) => item.id === value.milestoneId)) throw new DataError("目标里程碑不存在或已归档");
}

export function validateEntity(db: Database, collection: Exclude<CollectionKey, "reviews" | "progressEvents">, entity: AnyEntity, previous?: AnyEntity): void {
  if (!isRecord(entity)) throw new DataError("记录格式无效");
  const current = entity as unknown as Record<string, unknown>;
  if (typeof current[titles[collection]] !== "string" || !(current[titles[collection]] as string).trim()) throw new DataError("名称或标题不能为空");
  if (!Array.isArray(current.tags) || !current.tags.every((tag) => typeof tag === "string")) throw new DataError("标签格式无效");
  if (collection === "papers") {
    if (!paperStatuses.has(String(current.status))) throw new DataError("论文状态无效");
    if (!Array.isArray(current.authors) || !Array.isArray(current.keywords) || !(current.keywords as unknown[]).every((item) => typeof item === "string")) throw new DataError("论文作者或关键词格式无效");
  } else if (collection !== "grades" && !statuses.has(String(current.status))) throw new DataError("状态无效");
  for (const key of ["dueDate", "startDate", "expectedCompletion", "deadline", "date"] as const) if (key in current) assertDate(current[key], key, true);
  const stringArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (collection === "learning") {
    if (!stringArray(current.materials) || !Array.isArray(current.modules)) throw new DataError("课程材料或模块格式无效");
    for (const learningModule of current.modules) {
      if (!isRecord(learningModule) || typeof learningModule.id !== "string" || typeof learningModule.title !== "string" || !statuses.has(String(learningModule.status)) || !Array.isArray(learningModule.topics)) throw new DataError("课程模块格式无效");
      for (const topic of learningModule.topics) if (!isRecord(topic) || typeof topic.id !== "string" || typeof topic.title !== "string" || !statuses.has(String(topic.status))) throw new DataError("课程知识点格式无效");
    }
  }
  if (collection === "research") {
    if (!stringArray(current.collaborators) || !Array.isArray(current.paperIds) || !Array.isArray(current.meetings) || !Array.isArray(current.resources)) throw new DataError("科研合作者、论文、会议或材料格式无效");
    for (const meeting of current.meetings) {
      if (!isRecord(meeting) || typeof meeting.id !== "string" || typeof meeting.title !== "string" || !stringArray(meeting.nextActions)) throw new DataError("科研会议格式无效");
      assertDate(meeting.date, "会议日期");
    }
    if (current.resources.some((item) => !isRecord(item) || typeof item.label !== "string" || typeof item.url !== "string" || typeof item.kind !== "string")) throw new DataError("科研材料格式无效");
  }
  if (collection === "projects") {
    if (!stringArray(current.techStack) || !["my_project", "reference_project"].includes(String(current.type))) throw new DataError("项目类型或技术栈格式无效");
  }
  if (collection === "competitions") {
    if (!stringArray(current.teammates) || !stringArray(current.materials) || !Array.isArray(current.projectIds) || !["high", "medium", "low"].includes(String(current.cvImportance))) throw new DataError("竞赛队友、材料或 CV 重要程度格式无效");
  }
  if (collection === "tasks") {
    const task = entity as Task; const old = previous as Task | undefined;
    if (!priorities.has(task.priority) || !["inbox", "needs_parent", "week", "later"].includes(task.planningState)) throw new DataError("任务优先级或计划状态无效");
    if (typeof task.nextAction !== "string" || typeof task.notes !== "string" || typeof task.category !== "string") throw new DataError("任务内容格式无效");
    if (task.planningState === "week") {
      assertDate(task.plannedWeek, "计划周");
      if (weekStart(task.plannedWeek!) !== task.plannedWeek) throw new DataError("计划周必须从周一开始");
    }
    if (task.primaryParent) assertRef(db, task.primaryParent, "主关联");
    if (task.planningState === "needs_parent" && task.primaryParent) throw new DataError("已有主关联的任务不能标记为待补归属");
    if (!Array.isArray(task.relatedRefs) || !Array.isArray(task.milestoneRefs)) throw new DataError("任务关联格式无效");
    task.relatedRefs.forEach((ref) => assertRef(db, ref, "次要关联"));
    task.milestoneRefs.forEach((ref) => assertMilestoneRef(db, ref));
    if (task.planningState === "week" && !task.primaryParent) throw new DataError("安排到某周前，请先选择主关联对象");
    const newlyPlanned = task.planningState === "week" && (old?.planningState !== "week" || task.plannedWeek !== old.plannedWeek);
    const newlyPinned = task.pinned && !old?.pinned;
    if ((newlyPlanned || newlyPinned || (old && task.primaryParent?.id !== old.primaryParent?.id)) && !task.primaryParent) throw new DataError("安排到某周或置顶前，请先选择主关联对象");
    if (task.pinned && (task.status === "completed" || task.planningState !== "week" || !task.primaryParent)) throw new DataError("置顶任务必须是已安排到某周且有主关联的未完成任务");
    if (db.tasks.filter((item) => !item.archived && item.pinned && item.status !== "completed").length > 5) throw new DataError("当前重点任务最多 5 项");
  }
  if (collection === "grades") {
    const credits = Number(current.credits); const score = Number(current.score);
    if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(score) || score < 0 || score > 100) throw new DataError("学分必须大于 0，成绩必须在 0–100 之间");
  }
  if (collection === "goals") {
    if (!Array.isArray(current.milestones) || !Array.isArray(current.linkedItems)) throw new DataError("目标里程碑或关联格式无效");
    (current.linkedItems as unknown[]).forEach((ref) => assertRef(db, ref, "目标关联"));
    for (const milestone of current.milestones as unknown[]) {
      if (!isRecord(milestone) || typeof milestone.id !== "string" || typeof milestone.title !== "string" || !statuses.has(String(milestone.status))) throw new DataError("里程碑格式无效");
      assertDate(milestone.targetDate, "里程碑日期", true);
      if (milestone.evidence !== undefined && typeof milestone.evidence !== "string") throw new DataError("里程碑证据格式无效");
    }
    const milestoneIds = (current.milestones as { id: string }[]).map((milestone) => milestone.id);
    if (new Set(milestoneIds).size !== milestoneIds.length) throw new DataError("同一目标中的里程碑 ID 不能重复");
    const oldGoal = previous as Database["goals"][number] | undefined;
    const remainingIds = new Set((current.milestones as { id: string }[]).map((milestone) => milestone.id));
    if (oldGoal) for (const milestone of oldGoal.milestones) {
      if (!remainingIds.has(milestone.id) && (db.tasks.some((task) => !task.archived && task.status !== "completed" && task.milestoneRefs?.some((ref) => ref.goalId === oldGoal.id && ref.milestoneId === milestone.id)) || db.progressEvents.some((event) => event.milestoneRefs.some((ref) => ref.goalId === oldGoal.id && ref.milestoneId === milestone.id)))) {
        throw new DataError("此里程碑仍被任务或进展记录引用，请先处理引用后再移除", 409);
      }
    }
  }
  if (collection === "papers") {
    if (!stringArray(current.relatedResearchIds) || !(current.relatedResearchIds as unknown[]).every((id) => db.research.some((item) => item.id === id && !item.archived))) throw new DataError("关联科研项目无效");
    if (!isRecord(current.source) || !["manual", "zotero"].includes(String(current.source.provider))) throw new DataError("论文来源格式无效");
  }
  if (collection === "research" && (!Array.isArray(current.paperIds) || !(current.paperIds as unknown[]).every((id) => typeof id === "string" && db.papers.some((item) => item.id === id && !item.archived)))) throw new DataError("关联论文无效");
  if (collection === "competitions" && (!Array.isArray(current.projectIds) || !(current.projectIds as unknown[]).every((id) => typeof id === "string" && db.projects.some((item) => item.id === id && !item.archived)))) throw new DataError("关联项目无效");
}

export function validateSettings(settings: Settings): void {
  if (!isRecord(settings) || !isRecord(settings.gpa) || !Number.isFinite(settings.gpa.scale) || settings.gpa.scale <= 0 || !Array.isArray(settings.gpa.rules) || !settings.gpa.rules.length) throw new DataError("GPA 配置无效");
  const rules = settings.gpa.rules as GpaRule[];
  if (rules.some((rule) => !Number.isFinite(rule.minScore) || rule.minScore < 0 || rule.minScore > 100 || !Number.isFinite(rule.point) || rule.point < 0 || rule.point > settings.gpa.scale || typeof rule.label !== "string")) throw new DataError("GPA 换算规则无效");
  if (typeof settings.timeZone !== "string" || !settings.timeZone) throw new DataError("时区不能为空");
  try { new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone }); } catch { throw new DataError("时区无效"); }
  if (!Number.isInteger(settings.stalledDays) || settings.stalledDays < 1 || settings.stalledDays > 365) throw new DataError("停滞天数需在 1–365 天之间");
}

export function isReferenced(db: Database, collection: CollectionKey, id: string): boolean {
  const type = Object.entries(refCollections).find(([, key]) => key === collection)?.[0];
  if (type && db.tasks.some((task) => task.primaryParent?.type === type && task.primaryParent.id === id || task.relatedRefs?.some((ref) => ref.type === type && ref.id === id))) return true;
  if (type && db.progressEvents.some((event) => event.parentRef?.type === type && event.parentRef.id === id)) return true;
  if (collection === "tasks" && (db.progressEvents.some((event) => event.taskId === id) || db.reviews.some((review) => review.completedTaskIds.includes(id) || review.priorityTaskIds.includes(id) || review.newDeadlineTaskId === id))) return true;
  if (collection === "research" && db.reviews.some((review) => review.researchProjectId === id)) return true;
  if (collection === "papers" && db.reviews.some((review) => review.newPaperId === id)) return true;
  if (collection === "goals" && db.tasks.some((task) => task.milestoneRefs?.some((ref) => ref.goalId === id))) return true;
  if (collection === "goals" && db.progressEvents.some((event) => event.milestoneRefs.some((ref) => ref.goalId === id))) return true;
  if (collection === "research" && db.papers.some((paper) => paper.relatedResearchIds.includes(id))) return true;
  if (collection === "papers" && db.research.some((research) => research.paperIds.includes(id))) return true;
  if (collection === "projects" && db.competitions.some((competition) => competition.projectIds.includes(id))) return true;
  if (type && db.goals.some((goal) => goal.linkedItems.some((ref) => ref.type === type && ref.id === id))) return true;
  return false;
}
