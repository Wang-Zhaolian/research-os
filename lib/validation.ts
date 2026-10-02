import type { AnyEntity, CollectionKey, Database, EntityRef, GpaRule, MilestoneRef, PersonalProfile, Settings, Task } from "./types.ts";
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
const titles: Record<Exclude<CollectionKey, "reviews" | "progressEvents" | "attachments">, string> = {
  tasks: "title", learning: "name", research: "name", papers: "title", projects: "name", competitions: "name", goals: "title", grades: "course",
  pendingItems: "title", activePlans: "title", achievements: "title", internships: "organization",
};
const refCollections = { task: "tasks", learning: "learning", research: "research", paper: "papers", project: "projects", competition: "competitions", goal: "goals", internship: "internships", pending_item: "pendingItems", active_plan: "activePlans", achievement: "achievements" } as const;

function validateEvidenceRefs(db: Database, value: unknown): void {
  if (!Array.isArray(value)) throw new DataError("成果证据格式无效");
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== "string" || typeof item.id !== "string") throw new DataError("成果证据引用无效");
    if (item.type === "attachment") {
      if (!db.attachments.some((attachment) => attachment.id === item.id && !attachment.archived)) throw new DataError("成果引用的本机附件记录不存在或已归档");
      continue;
    }
    if (item.type === "grade") {
      if (!db.grades.some((grade) => grade.id === item.id && !grade.archived)) throw new DataError("成果引用的成绩记录不存在");
      continue;
    }
    assertRef(db, { type: item.type, id: item.id }, "成果证据");
    if (item.subId && item.type === "learning") {
      const course = db.learning.find((candidate) => candidate.id === item.id);
      if (!course?.modules.some((module) => module.id === item.subId || module.topics.some((topic) => topic.id === item.subId))) throw new DataError("成果引用的课程章节不存在");
    }
    if (item.sourceLocation !== undefined && typeof item.sourceLocation !== "string") throw new DataError("证据来源位置格式无效");
  }
}

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

export function validateEntity(db: Database, collection: Exclude<CollectionKey, "reviews" | "progressEvents" | "attachments">, entity: AnyEntity, previous?: AnyEntity): void {
  if (!isRecord(entity)) throw new DataError("记录格式无效");
  const current = entity as unknown as Record<string, unknown>;
  if (typeof current[titles[collection]] !== "string" || !(current[titles[collection]] as string).trim()) throw new DataError("名称或标题不能为空");
  if (!Array.isArray(current.tags) || !current.tags.every((tag) => typeof tag === "string")) throw new DataError("标签格式无效");
  if (collection === "papers") {
    if (!paperStatuses.has(String(current.status))) throw new DataError("论文状态无效");
    if (!Array.isArray(current.authors) || !Array.isArray(current.keywords) || !(current.keywords as unknown[]).every((item) => typeof item === "string")) throw new DataError("论文作者或关键词格式无效");
  } else if (!["grades", "pendingItems", "achievements"].includes(collection) && !statuses.has(String(current.status))) throw new DataError("状态无效");
  for (const key of ["dueDate", "startDate", "expectedCompletion", "deadline", "date"] as const) if (key in current) assertDate(current[key], key, true);
  const stringArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (collection === "learning") {
    if (!stringArray(current.materials) || !Array.isArray(current.modules) || typeof current.syllabusComplete !== "boolean") throw new DataError("课程材料、章节清单确认状态或模块格式无效");
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
    if (task.activePlanId && !db.activePlans.some((plan) => plan.id === task.activePlanId && !plan.archived)) throw new DataError("任务所属进行中计划不存在");
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
    if (!Number.isFinite(credits) || credits <= 0) throw new DataError("学分必须大于 0");
    if (!["percentage", "pass_fail", "exempt"].includes(String(current.gradingType)) || typeof current.includeInAverage !== "boolean") throw new DataError("成绩类型或统计选项无效");
    if (current.gradingType === "percentage" && current.score !== null && current.score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) throw new DataError("百分制成绩必须在 0–100 之间");
    if (current.gradingType === "pass_fail" && !["pass", "fail"].includes(String(current.result))) throw new DataError("合格制成绩请选择合格或不合格");
    if (current.evidenceRefs !== undefined) validateEvidenceRefs(db, current.evidenceRefs);
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
  if (["pendingItems", "activePlans", "achievements", "internships"].includes(collection)) {
    const categoryId = current.categoryId;
    if (collection !== "internships" && (typeof categoryId !== "string" || !db.settings.stageCategories.some((item) => item.id === categoryId && !item.archived))) throw new DataError("类别不存在或已归档");
    if (collection === "pendingItems") {
      if (!["open", "promoted", "cancelled"].includes(String(current.status)) || typeof current.description !== "string" || typeof current.desiredOutcome !== "string" || !Array.isArray(current.linkedRefs) || !Array.isArray(current.evidenceRefs)) throw new DataError("待开始事项字段无效");
      (current.linkedRefs as unknown[]).forEach((ref) => assertRef(db, ref, "关联记录"));
      validateEvidenceRefs(db, current.evidenceRefs);
      assertDate(current.targetDate, "目标日期", true);
      if (current.status === "promoted" && (typeof current.promotedPlanId !== "string" || !db.activePlans.some((plan) => plan.id === current.promotedPlanId))) throw new DataError("已启动事项必须关联进行中计划");
    }
    if (collection === "activePlans") {
      if (!statuses.has(String(current.status)) || typeof current.description !== "string" || typeof current.nextAction !== "string" || !Array.isArray(current.linkedRefs) || !Array.isArray(current.taskIds)) throw new DataError("进行中计划字段无效");
      if (typeof current.horizonId !== "string" || !db.settings.planningHorizons.some((item) => item.id === current.horizonId && !item.archived)) throw new DataError("时间范围不存在或已归档");
      (current.linkedRefs as unknown[]).forEach((ref) => assertRef(db, ref, "关联记录"));
      if (!(current.taskIds as unknown[]).every((id) => typeof id === "string" && db.tasks.some((task) => task.id === id && task.activePlanId === current.id))) throw new DataError("计划关联任务无效");
      assertDate(current.startDate, "开始日期", true); assertDate(current.targetDate, "目标日期", true);
      if (current.completedAt !== undefined && (typeof current.completedAt !== "string" || Number.isNaN(Date.parse(current.completedAt)))) throw new DataError("计划完成时间无效");
      if (current.status === "completed" && (typeof current.achievementId !== "string" || !db.achievements.some((item) => item.id === current.achievementId))) throw new DataError("完成计划必须同时建立关联成果卡");
    }
    if (collection === "achievements") {
      if (typeof current.summary !== "string" || !["user_recorded", "source_supported"].includes(String(current.verification)) || !Array.isArray(current.linkedRefs)) throw new DataError("已完成成果字段无效");
      (current.linkedRefs as unknown[]).forEach((ref) => assertRef(db, ref, "成果关联"));
      validateEvidenceRefs(db, current.evidenceRefs);
      assertDate(current.achievedDate, "完成日期", true);
      if (current.sourcePlanId && !db.activePlans.some((plan) => plan.id === current.sourcePlanId)) throw new DataError("成果来源计划不存在");
    }
    if (collection === "internships") {
      if (!statuses.has(String(current.status)) || typeof current.role !== "string" || typeof current.description !== "string" || typeof current.responsibilities !== "string" || typeof current.outcomes !== "string" || typeof current.mentor !== "string" || typeof current.location !== "string") throw new DataError("实习记录字段无效");
      assertDate(current.startDate, "实习开始日期", true); assertDate(current.endDate, "实习结束日期", true);
      validateEvidenceRefs(db, current.evidenceRefs);
      if (current.linkedPlanId && !db.activePlans.some((plan) => plan.id === current.linkedPlanId)) throw new DataError("实习来源计划不存在");
    }
  }
}

export function validateSettings(settings: Settings): void {
  if (!isRecord(settings) || !isRecord(settings.gpa) || !Number.isFinite(settings.gpa.scale) || settings.gpa.scale <= 0 || !Array.isArray(settings.gpa.rules) || !settings.gpa.rules.length) throw new DataError("GPA 配置无效");
  const rules = settings.gpa.rules as GpaRule[];
  if (rules.some((rule) => !Number.isFinite(rule.minScore) || rule.minScore < 0 || rule.minScore > 100 || !Number.isFinite(rule.point) || rule.point < 0 || rule.point > settings.gpa.scale || typeof rule.label !== "string")) throw new DataError("GPA 换算规则无效");
  if (typeof settings.timeZone !== "string" || !settings.timeZone) throw new DataError("时区不能为空");
  try { new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone }); } catch { throw new DataError("时区无效"); }
  if (!Number.isInteger(settings.stalledDays) || settings.stalledDays < 1 || settings.stalledDays > 365) throw new DataError("停滞天数需在 1–365 天之间");
  if (settings.schemaVersion !== 4 || typeof settings.dataEpoch !== "string" || !settings.dataEpoch || !Number.isInteger(settings.dataRevision) || settings.dataRevision < 0) throw new DataError("工作区数据版本无效");
  if (!Array.isArray(settings.modelConnections) || typeof settings.defaultModelConnectionId !== "string") throw new DataError("模型连接设置无效");
  if (settings.modelConnections.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || !["chatgpt_subscription", "openai_compatible"].includes(String(item.kind)) || "apiKey" in item || "accessToken" in item)) throw new DataError("模型连接只能保存非敏感配置，密钥必须留在本机凭据文件");
  if (settings.defaultModelConnectionId && !settings.modelConnections.some((item) => item.id === settings.defaultModelConnectionId)) throw new DataError("默认模型连接不存在");
  if (!Array.isArray(settings.stageCategories) || settings.stageCategories.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || typeof item.icon !== "string" || typeof item.color !== "string" || !Number.isInteger(item.sortOrder)) || new Set(settings.stageCategories.map((item) => item.id)).size !== settings.stageCategories.length) throw new DataError("三阶段类别配置无效");
  if (!Array.isArray(settings.planningHorizons) || settings.planningHorizons.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || !Number.isInteger(item.sortOrder) || item.minDays !== undefined && (!Number.isInteger(item.minDays) || item.minDays < 0) || item.maxDays !== undefined && (!Number.isInteger(item.maxDays) || item.maxDays < 0) || item.minDays !== undefined && item.maxDays !== undefined && item.maxDays < item.minDays) || new Set(settings.planningHorizons.map((item) => item.id)).size !== settings.planningHorizons.length) throw new DataError("计划时限配置无效");
}

export function validateProfile(profile: PersonalProfile): void {
  if (!isRecord(profile) || typeof profile.displayName !== "string" || typeof profile.university !== "string" || typeof profile.major !== "string" || typeof profile.currentSemester !== "string" || !Array.isArray(profile.developmentDirections) || !profile.developmentDirections.every((item) => typeof item === "string") || typeof profile.onboardingComplete !== "boolean") throw new DataError("个人档案格式无效");
  if (profile.displayName.length > 120 || profile.university.length > 200 || profile.major.length > 200 || profile.currentSemester.length > 120 || profile.developmentDirections.length > 12 || profile.developmentDirections.some((item) => item.length > 100)) throw new DataError("个人档案内容过长");
  if (profile.entryYear !== undefined && (!Number.isInteger(profile.entryYear) || profile.entryYear < 1900 || profile.entryYear > 2200)) throw new DataError("入学年份无效");
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
  if (collection === "pendingItems" && db.activePlans.some((plan) => plan.sourcePendingId === id)) return true;
  if (collection === "activePlans" && (db.pendingItems.some((item) => item.promotedPlanId === id) || db.tasks.some((task) => task.activePlanId === id) || db.achievements.some((item) => item.sourcePlanId === id) || db.internships.some((item) => item.linkedPlanId === id))) return true;
  if (collection === "achievements" && db.activePlans.some((plan) => plan.achievementId === id)) return true;
  if (collection === "internships" && db.achievements.some((item) => item.linkedRefs.some((ref) => ref.type === "internship" && ref.id === id))) return true;
  if (collection === "attachments" && [
    ...db.pendingItems.map((item) => item.evidenceRefs),
    ...db.achievements.map((item) => item.evidenceRefs),
    ...db.internships.map((item) => item.evidenceRefs),
    ...db.grades.map((item) => item.evidenceRefs ?? []),
  ].some((refs) => refs.some((ref) => ref.type === "attachment" && ref.id === id))) return true;
  return false;
}
