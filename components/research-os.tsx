"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Archive, ArrowDown, ArrowUp, BookOpen, Check,
  CircleGauge, ClipboardCheck, FlaskConical, FolderGit2, GraduationCap, LibraryBig, Menu,
  Moon, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings, Sun, Target, Trash2,
  Bot, Compass, DatabaseBackup,
  Trophy, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { addDays, allDeadlines, calculateGpa, calculateGradePoint, calculateWeightedAverage, dateInZone, effectiveNextAction, filterTasks, isStalled, priorityCandidates, progressFor, searchDatabase, statusLabels, taskPlanBucket, topPriorities, weekStart, type TaskFilters } from "@/lib/domain";
import { createEntityDefaults } from "@/lib/entity-defaults";
import type {
  AIConversation, AIConversationMessage, AIProposalChange, AnyEntity, CollectionKey, Competition, Database, EntityKind, EntityRef, EveningReview,
  Goal, Grade, LearningCourse, LearningModule, Milestone, MilestoneRef, Paper, PersonalProject,
  ParentEntityRef, PersonalProfile, ResearchProject, ReviewSubmission, Settings as AppSettings, Status, Task,
} from "@/lib/types";

type ViewKey = "onboarding" | "dashboard" | "tonight" | "learning" | "research" | "papers" | "projects" | "competitions" | "goals" | "gpa" | "assistant" | "archive" | "settings";
type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;
type FieldType = "text" | "textarea" | "date" | "number" | "select" | "list" | "checkbox" | "relation" | "relationMulti" | "relationRefs" | "milestoneRefs" | "modules" | "milestones" | "resources" | "meetings";
type FieldDef = { key: string; label: string; type?: FieldType; wide?: boolean; options?: [string, string][]; help?: string; relationType?: EntityKind };

const nav: { key: ViewKey; label: string; icon: typeof CircleGauge; section?: string }[] = [
  { key: "onboarding", label: "初始化", icon: Compass, section: "开始" },
  { key: "dashboard", label: "总览", icon: CircleGauge, section: "现在" },
  { key: "tonight", label: "今晚更新", icon: ClipboardCheck },
  { key: "learning", label: "自主学习", icon: BookOpen, section: "工作区" },
  { key: "research", label: "科研", icon: FlaskConical },
  { key: "papers", label: "论文", icon: LibraryBig },
  { key: "projects", label: "项目", icon: FolderGit2 },
  { key: "competitions", label: "竞赛", icon: Trophy },
  { key: "goals", label: "长期目标", icon: Target },
  { key: "gpa", label: "成绩 / GPA", icon: GraduationCap },
  { key: "assistant", label: "AI 助手", icon: Bot, section: "系统" },
  { key: "archive", label: "归档", icon: Archive },
  { key: "settings", label: "设置", icon: Settings },
];

const statusOptions: [string, string][] = [
  ["not_started", "未开始"], ["in_progress", "进行中"], ["blocked", "阻塞"],
  ["completed", "已完成"], ["paused", "暂停"], ["delayed", "延期"],
];
const paperStatusOptions: [string, string][] = [
  ["to_read", "待读"], ["skimmed", "快速浏览"], ["reading", "阅读中"],
  ["read", "已读"], ["deep_read", "精读"], ["core", "核心论文"],
];

const fields: Record<EditableCollection, FieldDef[]> = {
  tasks: [
    { key: "title", label: "标题", wide: true },
    { key: "category", label: "分类" },
    { key: "priority", label: "优先级", type: "select", options: [["high", "高"], ["medium", "中"], ["low", "低"]] },
    { key: "status", label: "状态", type: "select", options: statusOptions },
    { key: "planningState", label: "计划位置", type: "select", options: [["inbox", "收件箱"], ["needs_parent", "待补归属"], ["week", "安排到某周"], ["later", "以后"]] },
    { key: "plannedWeek", label: "计划周（选周一）", type: "date", help: "本周任务和下周任务按当前日期自动归类；过期周会进入遗留待安排。" },
    { key: "dueDate", label: "截止日期", type: "date" },
    { key: "primaryParent", label: "主关联对象", type: "relation", wide: true, help: "安排到某周或置顶前必须选择课程、科研、论文、项目、竞赛或目标。" },
    { key: "relatedRefs", label: "次要关联", type: "relationRefs", wide: true },
    { key: "milestoneRefs", label: "关联目标里程碑", type: "milestoneRefs", wide: true },
    { key: "nextAction", label: "当前下一步行动", type: "textarea", wide: true, help: "写一个现在就能开始的动作；标题写最终交付结果。" },
    { key: "notes", label: "简短备注", type: "textarea", wide: true },
    { key: "tags", label: "标签", type: "list", wide: true, help: "用逗号分隔" },
  ],
  learning: [
    { key: "name", label: "课程名称", wide: true }, { key: "field", label: "所属领域" },
    { key: "status", label: "状态", type: "select", options: statusOptions },
    { key: "materials", label: "学习材料", type: "list", wide: true },
    { key: "progressSummary", label: "当前进度", type: "textarea", wide: true },
    { key: "completedContent", label: "已完成内容", type: "textarea", wide: true },
    { key: "currentContent", label: "当前内容", type: "textarea", wide: true },
    { key: "nextAction", label: "下一步", type: "textarea", wide: true },
    { key: "modules", label: "课程模块与 Topics", type: "modules", wide: true },
    { key: "notes", label: "备注", type: "textarea", wide: true },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
  research: [
    { key: "name", label: "研究名称", wide: true }, { key: "advisor", label: "导师" },
    { key: "collaborators", label: "合作者", type: "list" }, { key: "startDate", label: "开始时间", type: "date" },
    { key: "expectedCompletion", label: "预计完成", type: "date" }, { key: "status", label: "状态", type: "select", options: statusOptions },
    { key: "stage", label: "当前研究阶段", wide: true },
    { key: "researchQuestion", label: "研究问题", type: "textarea", wide: true },
    { key: "background", label: "研究背景", type: "textarea", wide: true },
    { key: "literatureReview", label: "文献综述", type: "textarea", wide: true },
    { key: "researchGap", label: "研究空白", type: "textarea", wide: true },
    { key: "hypothesis", label: "研究假设 / 研究构想", type: "textarea", wide: true },
    { key: "method", label: "研究方法", type: "textarea", wide: true }, { key: "dataset", label: "数据集", type: "textarea", wide: true },
    { key: "experiment", label: "实验", type: "textarea", wide: true }, { key: "results", label: "研究结果", type: "textarea", wide: true },
    { key: "writing", label: "论文写作", type: "textarea", wide: true }, { key: "submission", label: "投稿情况", type: "textarea", wide: true },
    { key: "currentTask", label: "当前任务", type: "textarea", wide: true }, { key: "nextAction", label: "下一步行动", type: "textarea", wide: true },
    { key: "deadline", label: "截止日期", type: "date" }, { key: "blockers", label: "阻塞问题", type: "textarea", wide: true },
    { key: "recentProgress", label: "最近进展", type: "textarea", wide: true },
    { key: "paperIds", label: "相关论文", type: "relationMulti", relationType: "paper", wide: true },
    { key: "meetings", label: "会议 / 导师沟通", type: "meetings", wide: true },
    { key: "resources", label: "科研材料与代码", type: "resources", wide: true, help: "每行：名称 | URL 或本地路径 | 类型" },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
  papers: [
    { key: "title", label: "论文标题", wide: true }, { key: "authors", label: "作者", type: "list", wide: true },
    { key: "year", label: "年份", type: "number" }, { key: "venue", label: "期刊 / 会议" },
    { key: "doiUrl", label: "DOI / 链接", wide: true }, { key: "researchArea", label: "研究领域" },
    { key: "keywords", label: "关键词", type: "list", wide: true },
    { key: "status", label: "阅读状态", type: "select", options: paperStatusOptions },
    { key: "importance", label: "重要程度（1–5）", type: "number" },
    { key: "relatedResearchIds", label: "关联科研", type: "relationMulti", relationType: "research", wide: true },
    { key: "abstract", label: "摘要", type: "textarea", wide: true },
    { key: "researchQuestion", label: "研究问题", type: "textarea", wide: true },
    { key: "coreMethod", label: "核心方法", type: "textarea", wide: true }, { key: "dataset", label: "数据集", type: "textarea", wide: true },
    { key: "mainResults", label: "主要结果", type: "textarea", wide: true }, { key: "contribution", label: "主要贡献", type: "textarea", wide: true },
    { key: "limitation", label: "局限性", type: "textarea", wide: true }, { key: "myUnderstanding", label: "我的理解", type: "textarea", wide: true },
    { key: "researchUse", label: "对我的科研有什么用", type: "textarea", wide: true }, { key: "nextAction", label: "后续行动", type: "textarea", wide: true },
    { key: "worthDeepReading", label: "值得精读", type: "checkbox" }, { key: "tags", label: "关键词 / 标签", type: "list", wide: true },
  ],
  projects: [
    { key: "name", label: "项目名称", wide: true },
    { key: "type", label: "类型", type: "select", options: [["my_project", "我的项目"], ["reference_project", "参考项目"]] },
    { key: "status", label: "状态", type: "select", options: statusOptions }, { key: "techStack", label: "技术栈", type: "list", wide: true },
    { key: "description", label: "简介", type: "textarea", wide: true }, { key: "github", label: "GitHub", wide: true },
    { key: "demo", label: "Demo", wide: true }, { key: "progress", label: "当前进度", type: "textarea", wide: true },
    { key: "nextAction", label: "下一步", type: "textarea", wide: true }, { key: "learnings", label: "我从中学到了什么", type: "textarea", wide: true },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
  competitions: [
    { key: "name", label: "竞赛名称", wide: true }, { key: "level", label: "级别" }, { key: "date", label: "比赛时间", type: "date" },
    { key: "teammates", label: "队友", type: "list" }, { key: "advisor", label: "指导老师" },
    { key: "status", label: "状态", type: "select", options: statusOptions }, { key: "deadline", label: "截止日期", type: "date" },
    { key: "preparationStage", label: "准备阶段", wide: true }, { key: "currentTask", label: "当前任务", type: "textarea", wide: true },
    { key: "finalResult", label: "最终结果", type: "textarea", wide: true }, { key: "award", label: "获奖情况", wide: true },
    { key: "cvImportance", label: "对 CV 的重要性", type: "select", options: [["high", "高"], ["medium", "中"], ["low", "低"]] },
    { key: "materials", label: "对应材料", type: "list", wide: true },
    { key: "projectIds", label: "关联项目", type: "relationMulti", relationType: "project", wide: true },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
  goals: [
    { key: "title", label: "Goal", wide: true },
    { key: "type", label: "类型", type: "select", options: [["year", "年度目标"], ["semester", "学期目标"], ["long_term", "长期目标"]] },
    { key: "timeframe", label: "时间范围" }, { key: "status", label: "状态", type: "select", options: statusOptions },
    { key: "description", label: "说明", type: "textarea", wide: true },
    { key: "milestones", label: "里程碑", type: "milestones", wide: true },
    { key: "linkedItems", label: "关联对象", type: "relationRefs", wide: true },
    { key: "nextAction", label: "下一步行动", type: "textarea", wide: true }, { key: "tags", label: "标签", type: "list", wide: true },
  ],
  grades: [
    { key: "semester", label: "学期" }, { key: "course", label: "课程", wide: true },
    { key: "credits", label: "学分", type: "number" }, { key: "gradingType", label: "考核方式", type: "select", options: [["percentage", "百分制（计均分）"], ["pass_fail", "合格制（不计均分）"], ["exempt", "免修（不计均分）"]] },
    { key: "score", label: "百分制成绩（待出分可留空）", type: "number" },
    { key: "result", label: "合格制结果", type: "select", options: [["pass", "合格"], ["fail", "不合格"]] },
    { key: "includeInAverage", label: "计入均分与 GPA", type: "checkbox" },
    { key: "courseType", label: "课程类型" }, { key: "isCore", label: "核心课程", type: "checkbox" },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
};

const pageMeta: Record<ViewKey, [string, string, string]> = {
  onboarding: ["个人初始化", "先把真实情况录进来", "从个人档案到当前进行中的事项；AI 只整理为待确认草稿。"],
  dashboard: ["总览", "今天最值得推进什么", "把注意力放在少数真正重要的下一步。"],
  tonight: ["晚间复盘", "今晚更新", "用 3–5 分钟让计划重新贴合现实。"],
  learning: ["学习", "自主学习", "按课程、模块与知识点管理知识进展。"],
  research: ["研究", "科研", "从研究问题到投稿，保留每一步上下文。"],
  papers: ["论文库", "论文阅读", "记录理解、贡献、局限，以及它对研究的实际作用。"],
  projects: ["项目", "非科研项目", "只管理个人开发与参考项目；科研代码留在科研模块。"],
  competitions: ["竞赛", "竞赛", "只参加值得投入的竞赛，并跟踪准备与结果。"],
  goals: ["发展方向", "长期目标", "用里程碑和下一步行动连接多年目标与本周工作。"],
  gpa: ["学业记录", "成绩 / GPA", "按可配置规则计算学期与累计 GPA。"],
  assistant: ["模型助手", "AI 助手", "本地检索你的活动数据；每项修改都先审阅再确认保存。"],
  archive: ["归档", "归档", "从当前工作区移出的内容仍可恢复。"],
  settings: ["系统", "设置", "配置 GPA 规则、外观与本地数据。"],
};

const collectionView: Partial<Record<EditableCollection, ViewKey>> = {
  tasks: "dashboard", learning: "learning", research: "research", papers: "papers", projects: "projects",
  competitions: "competitions", goals: "goals", grades: "gpa",
};
const viewCollection: Partial<Record<ViewKey, EditableCollection>> = {
  learning: "learning", research: "research", papers: "papers", projects: "projects", competitions: "competitions", goals: "goals",
};

const today = (timeZone = "Asia/Shanghai") => dateInZone(new Date(), timeZone);
let activeEpoch = "";
const emptyDatabase: Database = { tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], progressEvents: [], profile: { displayName: "", university: "", major: "", currentSemester: "", developmentDirections: [], onboardingComplete: false }, settings: { schemaVersion: 3, demoData: false, timeZone: "Asia/Shanghai", stalledDays: 7, dataEpoch: "loading", dataRevision: 0, gpaPresetId: "swufe-2024", gpaConfigured: false, modelConnections: [], defaultModelConnectionId: "", gpa: { scale: 4, rules: [] } } };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers); headers.set("Content-Type", "application/json");
  if (activeEpoch) headers.set("x-research-os-epoch", activeEpoch);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed: ${response.status}`);
  const value = await response.json() as T;
  if (url === "/api/data" && method === "GET" && value && typeof value === "object" && "settings" in value) activeEpoch = (value as unknown as Database).settings.dataEpoch;
  return value;
}

function entityTitle(collection: EditableCollection, entity: AnyEntity) {
  if (collection === "tasks" || collection === "papers" || collection === "goals") return (entity as Task | Paper | Goal).title;
  if (collection === "grades") return (entity as Grade).course;
  return (entity as LearningCourse | ResearchProject | PersonalProject | Competition).name;
}

function defaultEntity(collection: EditableCollection): Record<string, unknown> {
  const entity = { ...createEntityDefaults(collection) } as unknown as Record<string, unknown>;
  delete entity.id;
  delete entity.createdAt;
  delete entity.updatedAt;
  return entity;
}

export function ResearchOS() {
  const [db, setDb] = useState<Database>(emptyDatabase);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>("onboarding");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ collection: EditableCollection; entity?: AnyEntity } | null>(null);
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const { theme, setTheme } = useTheme();

  const refresh = useCallback(async () => {
    try { const next = await api<Database>("/api/data"); setDb(next); setView(next.profile.onboardingComplete ? "dashboard" : "onboarding"); }
    catch (error) { toast.error(`读取数据失败：${(error as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void api<Database>("/api/data").then((data) => { if (active) { setDb(data); setView(data.profile.onboardingComplete ? "dashboard" : "onboarding"); setLoading(false); } }).catch((error) => { if (active) { toast.error(`读取数据失败：${(error as Error).message}`); setLoading(false); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useWebMcp(db);

  const results = useMemo(() => searchDatabase(db, query).slice(0, 12), [db, query]);
  const go = (next: ViewKey) => { setView(next); setSidebarOpen(false); setQuery(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const save = async (collection: EditableCollection, entity: Partial<AnyEntity> & { id?: string }) => {
    try {
      await api("/api/entities", { method: entity.id ? "PUT" : "POST", body: JSON.stringify({ collection, entity }) });
      toast.success(entity.id ? "已保存修改" : "已创建记录"); setEditor(null); await refresh();
    } catch (error) { toast.error(`保存失败：${(error as Error).message}`); }
  };
  const archiveEntity = async (collection: EditableCollection, id: string, hard = false) => {
    try { await api(`/api/entities?collection=${collection}&id=${id}${hard ? "&hard=1" : ""}`, { method: "DELETE" }); toast.success(hard ? "已永久删除" : "已移入归档"); await refresh(); }
    catch (error) { toast.error(`操作失败：${(error as Error).message}`); }
  };
  const updateTask = async (task: Task, patch: Partial<Task>) => {
    if (patch.status === "completed") await api("/api/progress", { method: "POST", body: JSON.stringify({ taskId: task.id, note: "标记为完成", complete: true }) });
    else await api("/api/entities", { method: "PUT", body: JSON.stringify({ collection: "tasks", entity: { id: task.id, ...patch } }) });
    await refresh();
  };

  if (loading) return <div className="loading"><div><div className="spinner" /><p>正在打开 Research OS…</p></div></div>;

  const [eyebrow, title, description] = pageMeta[view];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark">R</span><span><strong>Research OS</strong><small>个人科研与学习控制台</small></span></div>
        <nav className="nav" aria-label="主导航">
          {nav.map((item) => <div key={item.key}>{item.section && <div className="nav-label">{item.section}</div>}<button className={`nav-button ${view === item.key ? "active" : ""}`} onClick={() => go(item.key)}><item.icon />{item.label}</button></div>)}
        </nav>
        <div className="sidebar-footer">本地优先 · JSON 数据保存在本机，可用私人 Git 同步</div>
      </aside>
      {sidebarOpen && <button aria-label="关闭菜单" className="fixed inset-0 z-10 bg-black/35 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <div className="content-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="search-wrap">
            <Search className="search-icon" />
            <input id="global-search" className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索科研、论文、课程、任务…" />
            <span className="search-hint">Ctrl K</span>
            {query && <div className="search-results">{results.length ? results.map((result) => {
              const collection = result.collection as EditableCollection;
              return <button key={`${collection}-${result.entity.id}`} className="search-result" onClick={() => { go(collectionView[collection] ?? "dashboard"); setEditor({ collection, entity: result.entity }); }}><span>{result.title}</span><small>{collectionLabel(collection)}</small></button>;
            }) : <div className="empty">没有找到匹配内容</div>}</div>}
          </div>
          <div className="topbar-actions">
            <Button className="hide-mobile" variant="outline" size="sm" onClick={() => go("tonight")}><ClipboardCheck />今晚更新</Button>
            <Button variant="ghost" size="icon-sm" aria-label="切换深浅模式" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun /> : <Moon />}</Button>
          </div>
        </header>
        <main className="main">
          <div className="page-head"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{viewCollection[view] && <Button onClick={() => setEditor({ collection: viewCollection[view]! })}><Plus />新增</Button>}{view === "gpa" && <Button onClick={() => setEditor({ collection: "grades" })}><Plus />录入成绩</Button>}</div>
          {view === "onboarding" && <OnboardingPage db={db} refresh={refresh} go={go} addEntity={(collection, entity) => save(collection, entity)} />}
          {view === "dashboard" && <Dashboard db={db} edit={(collection, entity) => setEditor({ collection, entity })} updateTask={updateTask} addTask={() => setEditor({ collection: "tasks" })} progressTask={setProgressTask} go={go} />}
          {view === "tonight" && <TonightReview db={db} refresh={refresh} go={go} />}
          {viewCollection[view] && <EntityPage collection={viewCollection[view]!} db={db} edit={(entity) => setEditor({ collection: viewCollection[view]!, entity })} archive={(id) => archiveEntity(viewCollection[view]!, id)} />}
          {view === "gpa" && <GpaPage db={db} edit={(entity) => setEditor({ collection: "grades", entity })} archive={(id) => archiveEntity("grades", id)} />}
          {view === "archive" && <ArchivePage db={db} restore={async (collection, entity) => save(collection, { id: entity.id, archived: false })} remove={archiveEntity} />}
          {view === "settings" && <SettingsPage db={db} setDb={setDb} />}
          {view === "assistant" && <AssistantPage db={db} refresh={refresh} go={go} />}
        </main>
      </div>
      <EntityEditor key={`${editor?.collection ?? "closed"}-${editor?.entity?.id ?? "new"}`} open={Boolean(editor)} collection={editor?.collection ?? "tasks"} entity={editor?.entity} db={db} onClose={() => setEditor(null)} onSave={save} />
      <ProgressDialog key={progressTask?.id ?? "progress-closed"} task={progressTask} onClose={() => setProgressTask(null)} onSaved={refresh} />
    </div>
  );
}

function PageEmpty({ children }: { children: React.ReactNode }) { return <div className="empty"><MoreHorizontal />{children}</div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`badge ${status}`}>{statusLabels[status] ?? status}</span>; }

function OnboardingPage({ db, refresh, go, addEntity }: { db: Database; refresh: () => Promise<void>; go: (view: ViewKey) => void; addEntity: (collection: EditableCollection, entity: Partial<AnyEntity> & { id?: string }) => Promise<void> }) {
  const [profile, setProfile] = useState(() => ({ ...db.profile, university: db.profile.university || "西南财经大学", developmentDirections: db.profile.developmentDirections.length ? db.profile.developmentDirections.join("，") : "机器学习，运筹优化，统计" }));
  const [confirmGpa, setConfirmGpa] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [collection, setCollection] = useState<EditableCollection>("learning");
  const [title, setTitle] = useState(""); const [details, setDetails] = useState(""); const [savingEntity, setSavingEntity] = useState(false);
  const [situation, setSituation] = useState("");
  const directions = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  const submitProfile = async () => {
    setSavingProfile(true);
    try {
      const entryYear = String(profile.entryYear ?? "").trim() ? Number(profile.entryYear) : undefined;
      const value: PersonalProfile = { ...profile, entryYear, developmentDirections: directions(profile.developmentDirections), onboardingComplete: true };
      await api<PersonalProfile>("/api/profile", { method: "PUT", body: JSON.stringify({ profile: value, confirmGpaPreset: confirmGpa }) });
      await refresh(); toast.success("个人档案已保存"); go("dashboard");
    } catch (error) { toast.error(`保存失败：${(error as Error).message}`); }
    finally { setSavingProfile(false); }
  };
  const saveInitialEntity = async () => {
    if (!title.trim()) { toast.error("请填写记录名称"); return; }
    const entity = defaultEntity(collection); const nameKey = ["tasks", "papers", "goals"].includes(collection) ? "title" : collection === "grades" ? "course" : "name";
    entity[nameKey] = title.trim();
    if (collection === "tasks") entity.notes = details;
    if (collection === "learning") entity.notes = details;
    if (collection === "research") entity.recentProgress = details;
    if (collection === "papers") entity.abstract = details;
    if (collection === "projects") entity.description = details;
    if (collection === "competitions") entity.preparationStage = details;
    if (collection === "goals") entity.description = details;
    setSavingEntity(true);
    try { await addEntity(collection, entity as Partial<AnyEntity> & { id?: string }); setTitle(""); setDetails(""); }
    finally { setSavingEntity(false); }
  };
  const askAi = () => {
    if (!situation.trim()) { toast.error("请先描述当前真实情况"); return; }
    sessionStorage.setItem("research-os-assistant-prefill", `请帮我把以下真实情况整理成课程、科研项目、目标与任务的可审阅草稿。只录入我明确说出的事实，缺失信息请追问，不要猜。\n\n${situation.trim()}`);
    go("assistant");
  };
  return <div className="stack">
    <section className="panel"><div className="panel-head"><div><h2 className="panel-title">① 确认个人档案</h2><span className="panel-meta">页面预填的信息只是待核对内容，只有保存后才进入数据文件。</span></div></div><div className="panel-body stack">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="form-label">称呼（可留空）</label><input className="field-input" value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} placeholder="你希望系统怎样称呼你" /></div><div><label className="form-label">学校</label><input className="field-input" value={profile.university} onChange={(event) => setProfile({ ...profile, university: event.target.value })} /></div><div><label className="form-label">专业</label><input className="field-input" value={profile.major} onChange={(event) => setProfile({ ...profile, major: event.target.value })} placeholder="请按你的实际专业填写" /></div><div><label className="form-label">入学年份</label><input className="field-input" type="number" min={2000} max={2200} value={profile.entryYear ?? ""} onChange={(event) => setProfile({ ...profile, entryYear: event.target.value ? Number(event.target.value) : undefined })} placeholder="例如 2024" /></div><div><label className="form-label">当前学期</label><input className="field-input" value={profile.currentSemester} onChange={(event) => setProfile({ ...profile, currentSemester: event.target.value })} placeholder="例如 2026 秋季学期" /></div><div><label className="form-label">发展方向（按优先级排序）</label><input className="field-input" value={profile.developmentDirections} onChange={(event) => setProfile({ ...profile, developmentDirections: event.target.value })} /></div></div>
      <label className="choice"><input type="checkbox" checked={confirmGpa} onChange={(event) => setConfirmGpa(event.target.checked)} disabled={!profile.entryYear || profile.entryYear < 2024} /><span>我确认自己属于 2024 级及以后，并启用“西南财经大学本科 2024 版”GPA 规则</span></label>
      <div className="flex flex-wrap gap-2"><Button disabled={savingProfile} onClick={() => void submitProfile()}>{savingProfile ? "保存中…" : "确认档案并进入控制台"}</Button><Button variant="outline" onClick={() => go("dashboard")}>暂时跳过</Button></div>
    </div></section>
    <section className="panel"><div className="panel-head"><div><h2 className="panel-title">② 录入正在进行的事项</h2><span className="panel-meta">空白工作区不会自动补入示例。任务先进入收件箱，之后再关联和安排周计划。</span></div></div><div className="panel-body stack">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><select className="field-select" value={collection} onChange={(event) => setCollection(event.target.value as EditableCollection)}>{(["learning", "research", "papers", "projects", "competitions", "goals", "tasks"] as EditableCollection[]).map((item) => <option key={item} value={item}>{collectionLabel(item)}</option>)}</select><input className="field-input md:col-span-2" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="名称或标题" /></div>
      <textarea className="field-textarea" value={details} onChange={(event) => setDetails(event.target.value)} placeholder={collection === "tasks" ? "备注（可选）；具体下一步可稍后补充" : "当前进度或补充说明（可选）"} />
      <div className="flex flex-wrap gap-2"><Button disabled={savingEntity} onClick={() => void saveInitialEntity()}><Plus />{savingEntity ? "正在保存" : `新增${collectionLabel(collection)}`}</Button><span className="form-help self-center">目前已有 {(["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"] as EditableCollection[]).reduce((sum, key) => sum + db[key].filter((item) => !item.archived).length, 0)} 条活动记录。</span></div>
    </div></section>
    <section className="panel"><div className="panel-head"><div><h2 className="panel-title">③ 用 AI 整理（可选）</h2><span className="panel-meta">AI 只生成待审阅草稿；未连接模型也能手工完成初始化。</span></div><Button variant="outline" onClick={() => go("settings")}>配置模型</Button></div><div className="panel-body stack"><textarea className="field-textarea min-h-32" value={situation} onChange={(event) => setSituation(event.target.value)} placeholder="可以描述目前真实在学的课程、正在做的科研或项目、近期目标。不要担心格式；空缺信息会留空或由助手追问。" /><Button variant="outline" onClick={askAi}><Bot />前往 AI 助手整理</Button></div></section>
  </div>;
}

function relationLabel(db: Database, ref?: EntityRef) {
  if (!ref) return "—";
  const map: Record<EntityKind, EditableCollection> = { task: "tasks", learning: "learning", research: "research", paper: "papers", project: "projects", competition: "competitions", goal: "goals", grade: "grades" };
  const collection = map[ref.type]; const item = db[collection].find((entity) => entity.id === ref.id);
  return item ? entityTitle(collection, item) : ref.label ?? ref.id;
}

function Dashboard({ db, edit, updateTask, addTask, progressTask, go }: { db: Database; edit: (collection: EditableCollection, entity: AnyEntity) => void; updateTask: (task: Task, patch: Partial<Task>) => Promise<void>; addTask: () => void; progressTask: (task: Task) => void; go: (view: ViewKey) => void }) {
  const [weekTab, setWeekTab] = useState<"this_week" | "next_week" | "leftover" | "inbox" | "completed">("this_week");
  const [taskFilters, setTaskFilters] = useState<TaskFilters>({ deadline: "all" });
  const priorities = topPriorities(db.tasks);
  const todayDate = today(db.settings.timeZone);
  const categories = [...new Set(db.tasks.filter((task) => !task.archived).map((task) => task.category))].sort();
  const tags = [...new Set(db.tasks.filter((task) => !task.archived).flatMap((task) => task.tags))].sort();
  const weekTasks = filterTasks(db.tasks.filter((task) => taskPlanBucket(task, todayDate) === weekTab), taskFilters, todayDate);
  const deadlines = allDeadlines(db);
  const overdue = deadlines.filter((item) => item.date < todayDate);
  const nextSeven = deadlines.filter((item) => item.date >= todayDate && item.date <= addDays(todayDate, 7));
  const daysEightToThirty = deadlines.filter((item) => item.date > addDays(todayDate, 7) && item.date <= addDays(todayDate, 30));
  const candidates = priorityCandidates(db, todayDate).filter((item) => taskPlanBucket(item.task, todayDate) !== "inbox" && taskPlanBucket(item.task, todayDate) !== "later");
  const activeResearch = db.research.filter((item) => !item.archived && item.status !== "completed");
  const activeGoals = db.goals.filter((item) => !item.archived && item.status !== "completed").slice(0, 4);
  const reorder = async (index: number, direction: -1 | 1) => {
    const next = [...priorities]; const target = index + direction;
    if (!next[target]) return;
    [next[index], next[target]] = [next[target], next[index]];
    await api("/api/priorities", { method: "PUT", body: JSON.stringify({ taskIds: next.map((task) => task.id) }) });
    await updateTask(next[0], {});
  };
  const pinCandidate = async (task: Task) => {
    if (priorities.length >= 5) { toast.error("当前已有 5 项重点，请先移出一项"); return; }
    try { await api("/api/priorities", { method: "PUT", body: JSON.stringify({ taskIds: [...priorities.map((item) => item.id), task.id] }) }); await updateTask(task, {}); }
    catch (error) { toast.error((error as Error).message); }
  };
  const renderTask = (task: Task) => {
    const action = effectiveNextAction(db, task);
    const stalled = isStalled(db, task, todayDate);
    const lastProgress = progressFor(db, task.id)[0];
    return <div className="task-line" key={task.id}>
      {task.status !== "completed" && <button className="check" aria-label="完成任务" onClick={() => void updateTask(task, { status: "completed" })} />}
      <div className="task-copy" onClick={() => edit("tasks", task)} role="button" tabIndex={0}>
        <strong>{task.title}</strong>
        <div className="task-meta"><StatusBadge status={task.status} /><span>{task.category}</span>{task.dueDate && <span>截止 {task.dueDate}</span>}{task.primaryParent && <span>↗ {relationLabel(db, task.primaryParent)}</span>}{stalled && <span className="warning-text">停滞 {db.settings.stalledDays} 天</span>}</div>
        <div className={`row-subtitle ${action ? "" : "warning-text"}`}>{task.status === "blocked" ? `解阻下一步：${action || "请补充解除阻塞的行动"}` : `下一步：${action || "请补充具体行动"}`}</div>
        {lastProgress && <div className="row-subtitle">最近进展 · {lastProgress.date}：{lastProgress.note}</div>}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="记录进展" onClick={() => progressTask(task)}><ClipboardCheck /></Button>
    </div>;
  };
  return <div className="grid dashboard-grid">
    <div className="stack">
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">当前最重要的事</h2><span className="panel-meta">最多 5 项 · 手工确认与排序</span></div><Button variant="ghost" size="sm" onClick={addTask}><Plus />收件箱任务</Button></div><div className="panel-body">
        {priorities.length ? <ol className="priority-list">{priorities.map((task, index) => <li className="priority-row" key={task.id}><span className="rank">0{index + 1}</span><div className="priority-copy"><div className="row-title">{task.title}</div><div className="row-subtitle">{task.category}{task.dueDate ? ` · ${task.dueDate}` : ""}{task.primaryParent ? ` · ${relationLabel(db, task.primaryParent)}` : " · 待补主关联"}</div><div className={`row-subtitle ${effectiveNextAction(db, task) ? "" : "warning-text"}`}>{task.status === "blocked" ? "解阻下一步：" : "下一步："}{effectiveNextAction(db, task) || "请补充具体行动"}</div></div><div className="row-actions"><button className="icon-button" aria-label="上移" disabled={index === 0} onClick={() => void reorder(index, -1)}><ArrowUp /></button><button className="icon-button" aria-label="下移" disabled={index === priorities.length - 1} onClick={() => void reorder(index, 1)}><ArrowDown /></button><button className="icon-button" aria-label="记录进展" onClick={() => progressTask(task)}><ClipboardCheck /></button><button className="icon-button" aria-label="完成" onClick={() => void updateTask(task, { status: "completed" })}><Check /></button><button className="icon-button" aria-label="编辑" onClick={() => edit("tasks", task)}><Pencil /></button></div></li>)}</ol> : <PageEmpty>先在任务中关联一个学习、科研或目标对象，再安排到本周并置顶。</PageEmpty>}
      </div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">任务安排</h2><div className="week-tabs">{([["this_week", "本周"], ["next_week", "下周"], ["leftover", "遗留"], ["inbox", "收件箱"], ["completed", "已完成"]] as const).map(([key, label]) => <button className={`tab ${weekTab === key ? "active" : ""}`} onClick={() => setWeekTab(key)} key={key}>{label}</button>)}</div></div><div className="panel-body"><div className="task-filter-bar"><input className="field-input task-filter-search" aria-label="搜索当前任务" placeholder="搜索任务、备注或标签…" value={taskFilters.query ?? ""} onChange={(event) => setTaskFilters((current) => ({ ...current, query: event.target.value }))} /><details className="task-filters"><summary>筛选</summary><div className="task-filter-controls"><select className="field-select" aria-label="状态筛选" value={taskFilters.status ?? "all"} onChange={(event) => setTaskFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">全部状态</option>{statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select className="field-select" aria-label="优先级筛选" value={taskFilters.priority ?? "all"} onChange={(event) => setTaskFilters((current) => ({ ...current, priority: event.target.value }))}><option value="all">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select><select className="field-select" aria-label="分类筛选" value={taskFilters.category ?? "all"} onChange={(event) => setTaskFilters((current) => ({ ...current, category: event.target.value }))}><option value="all">全部分类</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select><select className="field-select" aria-label="标签筛选" value={taskFilters.tag ?? "all"} onChange={(event) => setTaskFilters((current) => ({ ...current, tag: event.target.value }))}><option value="all">全部标签</option>{tags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}</select><select className="field-select" aria-label="截止日期筛选" value={taskFilters.deadline ?? "all"} onChange={(event) => setTaskFilters((current) => ({ ...current, deadline: event.target.value as TaskFilters["deadline"] }))}><option value="all">全部截止日期</option><option value="overdue">已逾期</option><option value="week">未来 7 天</option><option value="month">未来 30 天</option><option value="has_date">有截止日期</option><option value="no_date">无截止日期</option></select><button className="text-button" onClick={() => setTaskFilters({ deadline: "all" })}>清除筛选</button></div></details></div>{weekTasks.length ? weekTasks.map(renderTask) : <PageEmpty>{taskFilters.query || taskFilters.status && taskFilters.status !== "all" || taskFilters.priority && taskFilters.priority !== "all" || taskFilters.category && taskFilters.category !== "all" || taskFilters.tag && taskFilters.tag !== "all" || taskFilters.deadline && taskFilters.deadline !== "all" ? "没有符合当前筛选条件的任务。" : weekTab === "leftover" ? "没有过周遗留任务。" : weekTab === "inbox" ? "收件箱为空。可以先捕捉任务，再在今晚更新中分流。" : "这个视图暂时没有任务。"}</PageEmpty>}</div></section>
      {candidates.length > 0 && <section className="panel"><div className="panel-head"><div><h2 className="panel-title">系统推荐重点</h2><span className="panel-meta">只提供候选，不会自动置顶</span></div></div><div className="panel-body">{candidates.map(({ task, reasons }) => <div className="recommend-row" key={task.id}><div><strong>{task.title}</strong><div className="row-subtitle">{reasons.join(" · ") || "本周待推进"} · 下一步：{effectiveNextAction(db, task) || "待补充"}</div></div><Button size="sm" variant="outline" disabled={priorities.length >= 5} onClick={() => void pinCandidate(task)}>加入重点</Button></div>)}</div></section>}
      <section className="panel"><div className="panel-head"><h2 className="panel-title">长期目标</h2><Button variant="ghost" size="sm" onClick={() => go("goals")}>查看全部</Button></div><div className="panel-body">{activeGoals.length ? activeGoals.map((goal) => {
        const done = goal.milestones.filter((milestone) => milestone.status === "completed").length;
        const events = progressFor(db, undefined, { type: "goal", id: goal.id });
        return <div className="goal-card" key={goal.id}><div className="goal-top"><strong>{goal.title}</strong><span className="panel-meta">{done}/{goal.milestones.length} 个里程碑 · {goal.timeframe}</span></div><div className="milestone-summary">{goal.milestones.slice(0, 3).map((milestone) => <div key={milestone.id}><StatusBadge status={milestone.status} /><span>{milestone.title}</span>{milestone.evidence && <small>{milestone.evidence}</small>}</div>)}</div><div className="row-subtitle">下一步：{goal.nextAction || "尚未设置"}{events[0] && ` · 最近进展：${events[0].note}`}</div></div>;
      }) : <PageEmpty>还没有活跃目标。</PageEmpty>}</div></section>
    </div>
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2 className="panel-title">科研状态</h2><Button variant="ghost" size="sm" onClick={() => go("research")}>科研工作区</Button></div><div className="panel-body">{activeResearch.length ? activeResearch.map((research) => {
        const events = progressFor(db, undefined, { type: "research", id: research.id });
        const lastEvent = events[0]; const baselineDate = lastEvent?.date ?? dateInZone(new Date(research.createdAt), db.settings.timeZone); const stalled = baselineDate <= addDays(todayDate, -db.settings.stalledDays);
        return <div className="research-card" key={research.id}><div className="card-top"><h4>{research.name}</h4><div className="flex gap-2"><StatusBadge status={research.status} />{stalled && <span className="warning-text">停滞</span>}</div></div><dl><dt>阶段</dt><dd>{research.stage}</dd><dt>最近进展</dt><dd>{lastEvent?.note || research.recentProgress || "—"}</dd><dt>下一步</dt><dd>{research.nextAction || "—"}</dd><dt>截止日期</dt><dd>{research.deadline || "—"}</dd><dt>阻塞</dt><dd>{research.blockers || "无"}</dd></dl></div>;
      }) : <PageEmpty>暂无进行中的科研项目。</PageEmpty>}</div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">截止日期</h2><span className="panel-meta">跨模块统一排序</span></div><div className="panel-body"><DeadlineGroup title="已逾期" items={overdue} warning /><DeadlineGroup title="未来 7 天" items={nextSeven} /><DeadlineGroup title="未来 8–30 天" items={daysEightToThirty} /></div></section>
    </div>
  </div>;
}

function DeadlineGroup({ title, items, warning = false }: { title: string; items: ReturnType<typeof allDeadlines>; warning?: boolean }) { return <div className="deadline-group"><h4 className={warning ? "warning-text" : ""}>{title}</h4>{items.length ? items.map((item) => <div className="deadline-row" key={`${item.type}-${item.id}`}><span className={`deadline-date ${warning ? "warning-text" : ""}`}>{item.date.slice(5)}</span><strong>{item.title}<span className="row-subtitle"> · {item.type}</span></strong></div>) : <div className="row-subtitle">没有截止日期</div>}</div>; }

function ProgressDialog({ task, onClose, onSaved }: { task: Task | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(""); const [nextAction, setNextAction] = useState(task?.nextAction ?? ""); const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!task || !note.trim()) { toast.error("请先写下推进了什么"); return; }
    setSaving(true);
    try { await api("/api/progress", { method: "POST", body: JSON.stringify({ taskId: task.id, note, nextAction }) }); await onSaved(); toast.success("进展和下一步已记录"); onClose(); }
    catch (error) { toast.error(`记录失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  return <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>记录任务进展</DialogTitle><DialogDescription>{task?.title}</DialogDescription></DialogHeader><div className="stack"><div><label className="form-label">这次推进了什么</label><textarea className="field-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="写下可观察到的变化或完成部分" /></div><div><label className="form-label">新的下一步行动</label><textarea className="field-textarea" value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="任务未完成时，写出接下来具体要做什么" /></div></div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={saving} onClick={() => void submit()}>{saving ? "保存中" : "保存进展"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EntityPage({ collection, db, edit, archive }: { collection: EditableCollection; db: Database; edit: (entity: AnyEntity) => void; archive: (id: string) => void }) {
  const [filter, setFilter] = useState(""); const [status, setStatus] = useState("all");
  const entities = (db[collection] as AnyEntity[]).filter((entity) => !entity.archived && (status === "all" || (entity as { status?: string }).status === status) && (!filter || JSON.stringify(entity).toLocaleLowerCase().includes(filter.toLocaleLowerCase())));
  return <><div className="entity-toolbar"><input className="field-input toolbar-input" placeholder="在当前模块搜索…" value={filter} onChange={(event) => setFilter(event.target.value)} />{collection !== "grades" && <select className="field-select toolbar-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{(collection === "papers" ? paperStatusOptions : statusOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<span className="panel-meta self-center">{entities.length} 条记录</span></div>{entities.length ? <div className="entity-grid">{entities.map((entity) => <EntityCard key={entity.id} collection={collection} entity={entity} edit={() => edit(entity)} archive={() => archive(entity.id)} />)}</div> : <PageEmpty>没有符合当前条件的记录。</PageEmpty>}</>;
}

function EntityCard({ collection, entity, edit, archive }: { collection: EditableCollection; entity: AnyEntity; edit: () => void; archive: () => void }) {
  const status = (entity as { status?: string }).status;
  const details = cardDetails(collection, entity);
  return <article className="entity-card"><div className="card-top"><h3>{entityTitle(collection, entity)}</h3>{status && <StatusBadge status={status} />}</div><p className="entity-summary">{details.summary || "还没有进展说明。"}</p><dl className="meta-grid">{details.meta.map(([label, value]) => <span key={label} className="contents"><dt>{label}</dt><dd>{value || "—"}</dd></span>)}</dl><div className="tag-row">{entity.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div><div className="card-actions"><Button variant="ghost" size="sm" onClick={edit}><Pencil />编辑</Button><Button variant="ghost" size="sm" onClick={archive}><Archive />归档</Button></div></article>;
}
function cardDetails(collection: EditableCollection, entity: AnyEntity): { summary: string; meta: [string, React.ReactNode][] } {
  switch (collection) {
    case "learning": { const item = entity as LearningCourse; return { summary: item.progressSummary, meta: [["领域", item.field], ["当前", item.currentContent], ["下一步", item.nextAction], ["结构", `${item.modules.length} 个模块`]] }; }
    case "research": { const item = entity as ResearchProject; return { summary: item.recentProgress, meta: [["阶段", item.stage], ["研究问题", item.researchQuestion], ["下一步", item.nextAction], ["截止", item.deadline]] }; }
    case "papers": { const item = entity as Paper; return { summary: item.myUnderstanding || item.abstract, meta: [["作者", item.authors.join(", ")], ["来源", `${item.venue}${item.year ? ` · ${item.year}` : ""}`], ["领域", item.researchArea], ["后续", item.nextAction]] }; }
    case "projects": { const item = entity as PersonalProject; return { summary: item.description, meta: [["类型", item.type === "my_project" ? "我的项目" : "参考项目"], ["技术栈", item.techStack.join(", ")], ["进度", item.progress], ["下一步", item.nextAction]] }; }
    case "competitions": { const item = entity as Competition; return { summary: item.currentTask, meta: [["级别", item.level], ["阶段", item.preparationStage], ["截止", item.deadline], ["CV 价值", item.cvImportance]] }; }
    case "goals": { const item = entity as Goal; const done = item.milestones.filter((m) => m.status === "completed").length; return { summary: item.description, meta: [["时间", item.timeframe], ["里程碑", `${done}/${item.milestones.length}`], ["下一步", item.nextAction], ["关联", `${item.linkedItems.length} 项`]] }; }
    case "tasks": { const item = entity as Task; return { summary: item.notes, meta: [["分类", item.category], ["截止", item.dueDate], ["优先级", item.priority], ["计划周", item.planningState === "week" || item.planningState === "needs_parent" ? item.plannedWeek : "收件箱 / 以后"]] }; }
    case "grades": { const item = entity as Grade; return { summary: item.courseType, meta: [["学期", item.semester], ["学分", item.credits], ["成绩", item.score], ["核心", item.isCore ? "是" : "否"]] }; }
  }
}

function EntityEditor({ open, collection, entity, db, onClose, onSave }: { open: boolean; collection: EditableCollection; entity?: AnyEntity; db: Database; onClose: () => void; onSave: (collection: EditableCollection, entity: Partial<AnyEntity> & { id?: string }) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => prepareDraft(collection, entity)); const [saving, setSaving] = useState(false);
  const update = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const titleKey = collection === "grades" ? "course" : collection === "tasks" || collection === "papers" || collection === "goals" ? "title" : "name";
    if (!String(draft[titleKey] ?? "").trim()) { toast.error("请填写名称或标题"); return; }
    setSaving(true);
    try { await onSave(collection, serializeDraft(collection, draft) as Partial<AnyEntity> & { id?: string }); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent className="sm:max-w-3xl max-w-[calc(100%-1rem)]"><DialogHeader><DialogTitle>{entity ? "编辑" : "新增"}{collectionLabel(collection)}</DialogTitle><DialogDescription>保存后会立即写入本地 JSON 数据文件。</DialogDescription></DialogHeader><div className="dialog-form">{fields[collection].map((field) => <EditorField key={field.key} field={field} value={draft[field.key]} update={(value) => update(field.key, value)} db={db} entityId={entity?.id} />)}</div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={saving} onClick={() => void submit()}>{saving && <RefreshCw className="animate-spin" />}{saving ? "保存中" : "保存"}</Button></DialogFooter></DialogContent></Dialog>;
}

function collectionLabel(collection: EditableCollection) { return ({ tasks: "任务", learning: "课程", research: "科研项目", papers: "论文", projects: "项目", competitions: "竞赛", goals: "目标", grades: "成绩" } as const)[collection]; }
function prepareDraft(collection: EditableCollection, entity?: AnyEntity): Record<string, unknown> {
  const source = structuredClone(entity ?? defaultEntity(collection)) as unknown as Record<string, unknown>;
  for (const field of fields[collection]) if (field.type === "list" && Array.isArray(source[field.key])) source[field.key] = (source[field.key] as unknown[]).join(", ");
  if (collection === "tasks") {
    source.planningState ??= "inbox";
    source.relatedRefs ??= [];
    source.milestoneRefs ??= [];
    source.nextAction ??= "";
    source.plannedWeek ??= "";
  }
  return source;
}
function serializeDraft(collection: EditableCollection, source: Record<string, unknown>) {
  const draft = structuredClone(source);
  for (const field of fields[collection]) {
    if (field.type === "list") draft[field.key] = String(draft[field.key] ?? "").split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);
    if (field.type === "number") draft[field.key] = collection === "grades" && field.key === "score" && String(draft[field.key] ?? "").trim() === "" ? null : Number(draft[field.key]) || 0;
  }
  if (collection === "grades") {
    if (draft.gradingType !== "pass_fail") delete draft.result;
    if (draft.gradingType === "pass_fail") draft.score = null;
    if (draft.gradingType === "exempt") { draft.score = null; delete draft.result; }
  }
  if (collection === "tasks") {
    const taskPlanning = String(draft.planningState ?? "inbox");
    if (taskPlanning === "week") {
      draft.plannedWeek = weekStart(String(draft.plannedWeek ?? today()));
    } else if (taskPlanning !== "needs_parent") {
      draft.plannedWeek = undefined;
    }
    draft.primaryParent = draft.primaryParent || undefined;
    draft.relatedRefs ??= [];
    draft.milestoneRefs ??= [];
  }
  if (collection === "papers") draft.source = (source.source as object | undefined) ?? { provider: "manual" };
  return draft;
}

function EditorField({ field, value, update, db, entityId }: { field: FieldDef; value: unknown; update: (value: unknown) => void; db: Database; entityId?: string }) {
  const id = `field-${field.key}`;
  let control: React.ReactNode;
  if (field.type === "textarea") control = <textarea id={id} className="field-textarea" value={String(value ?? "")} onChange={(event) => update(event.target.value)} />;
  else if (field.type === "select") control = <select id={id} className="field-select" value={String(value ?? "")} onChange={(event) => update(event.target.value)}>{field.options?.map(([option, label]) => <option value={option} key={option}>{label}</option>)}</select>;
  else if (field.type === "checkbox") control = <label className="toggle-line"><input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.target.checked)} /><span>{Boolean(value) ? "是" : "否"}</span></label>;
  else if (field.type === "relation") control = <RelationPicker value={value as EntityRef | undefined} update={update} db={db} primary={field.key === "primaryParent"} />;
  else if (field.type === "relationMulti") control = <RelationMulti value={(value as string[]) ?? []} update={update} db={db} type={field.relationType!} />;
  else if (field.type === "relationRefs") control = <RelationRefsEditor value={(value as EntityRef[]) ?? []} update={update} db={db} />;
  else if (field.type === "milestoneRefs") control = <MilestoneRefsEditor value={(value as MilestoneRef[]) ?? []} update={update} db={db} />;
  else if (field.type === "modules") control = <ModulesEditor value={(value as LearningModule[]) ?? []} update={update} />;
  else if (field.type === "milestones") control = <MilestonesEditor value={(value as Milestone[]) ?? []} update={update} db={db} goalId={entityId} />;
  else if (field.type === "resources") control = <textarea id={id} className="field-textarea" value={formatResources(value)} onChange={(event) => update(parseResources(event.target.value))} />;
  else if (field.type === "meetings") control = <textarea id={id} className="field-textarea" value={formatMeetings(value)} onChange={(event) => update(parseMeetings(event.target.value))} />;
  else control = <input id={id} className="field-input" type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(event) => update(event.target.value)} />;
  return <div className={`form-field ${field.wide ? "wide" : ""}`}><label className="form-label" htmlFor={id}>{field.label}</label>{control}{field.help && <div className="form-help">{field.help}</div>}</div>;
}

const entityMap: { type: EntityKind; collection: EditableCollection; label: string }[] = [
  { type: "learning", collection: "learning", label: "课程" }, { type: "research", collection: "research", label: "科研" },
  { type: "paper", collection: "papers", label: "论文" }, { type: "project", collection: "projects", label: "项目" },
  { type: "competition", collection: "competitions", label: "竞赛" }, { type: "goal", collection: "goals", label: "目标" }, { type: "task", collection: "tasks", label: "任务" },
];
function RelationPicker({ value, update, db, primary = false }: { value?: EntityRef; update: (value?: EntityRef) => void; db: Database; primary?: boolean }) {
  const selected = value ? `${value.type}:${value.id}` : "";
  const available = primary ? entityMap.filter((item) => ["learning", "research", "paper", "project", "competition", "goal"].includes(item.type)) : entityMap;
  return <select className="field-select" value={selected} onChange={(event) => { const [type, id] = event.target.value.split(":"); if (!id) update(undefined); else { const item = available.find((entry) => entry.type === type)!; const entity = (db[item.collection] as AnyEntity[]).find((candidate) => candidate.id === id)!; update({ type: type as EntityKind, id, label: entityTitle(item.collection, entity) }); } }}><option value="">不关联</option>{available.map((item) => <optgroup label={item.label} key={item.type}>{(db[item.collection] as AnyEntity[]).filter((entity) => !entity.archived).map((entity) => <option key={entity.id} value={`${item.type}:${entity.id}`}>{entityTitle(item.collection, entity)}</option>)}</optgroup>)}</select>;
}
function RelationMulti({ value, update, db, type }: { value: string[]; update: (value: string[]) => void; db: Database; type: EntityKind }) {
  const entry = entityMap.find((item) => item.type === type)!; const items = (db[entry.collection] as AnyEntity[]).filter((entity) => !entity.archived);
  return <div className="choice-list">{items.length ? items.map((entity) => <label className="choice" key={entity.id}><input type="checkbox" checked={value.includes(entity.id)} onChange={(event) => update(event.target.checked ? [...value, entity.id] : value.filter((id) => id !== entity.id))} />{entityTitle(entry.collection, entity)}</label>) : <div className="row-subtitle">当前没有可关联的{entry.label}。</div>}</div>;
}
function RelationRefsEditor({ value, update, db }: { value: EntityRef[]; update: (value: EntityRef[]) => void; db: Database }) {
  const selected = new Set(value.map((ref) => `${ref.type}:${ref.id}`));
  return <div className="relation-ref-groups">{entityMap.filter((item) => !["task", "grade"].includes(item.type)).map((item) => {
    const entities = (db[item.collection] as AnyEntity[]).filter((entity) => !entity.archived);
    if (!entities.length) return null;
    return <div key={item.type}><div className="form-help relation-group-label">{item.label}</div><div className="choice-list">{entities.map((entity) => {
      const key = `${item.type}:${entity.id}`;
      return <label className="choice" key={entity.id}><input type="checkbox" checked={selected.has(key)} onChange={(event) => update(event.target.checked ? [...value, { type: item.type, id: entity.id, label: entityTitle(item.collection, entity) }] : value.filter((ref) => `${ref.type}:${ref.id}` !== key))} /><span>{entityTitle(item.collection, entity)}</span></label>;
    })}</div></div>;
  })}</div>;
}
function MilestoneRefsEditor({ value, update, db }: { value: MilestoneRef[]; update: (value: MilestoneRef[]) => void; db: Database }) {
  const selected = new Set(value.map((ref) => `${ref.goalId}:${ref.milestoneId}`));
  const milestones = db.goals.filter((goal) => !goal.archived).flatMap((goal) => goal.milestones.map((milestone) => ({ goal, milestone })));
  return <div className="choice-list">{milestones.length ? milestones.map(({ goal, milestone }) => {
    const key = `${goal.id}:${milestone.id}`;
    return <label className="choice" key={key}><input type="checkbox" checked={selected.has(key)} onChange={(event) => update(event.target.checked ? [...value, { goalId: goal.id, milestoneId: milestone.id }] : value.filter((ref) => `${ref.goalId}:${ref.milestoneId}` !== key))} /><span><strong>{goal.title}</strong><div className="row-subtitle">{milestone.title}</div></span></label>;
  }) : <div className="row-subtitle">先创建目标和里程碑。</div>}</div>;
}
function ModulesEditor({ value, update }: { value: LearningModule[]; update: (value: LearningModule[]) => void }) {
  const patch = (index: number, next: Partial<LearningModule>) => update(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  return <div className="stack">{value.map((module, index) => <div className="panel-body rounded-lg border" key={module.id}><div className="flex gap-2"><input className="field-input" value={module.title} placeholder="模块名称" onChange={(event) => patch(index, { title: event.target.value })} /><select className="field-select max-w-36" value={module.status} onChange={(event) => patch(index, { status: event.target.value as Status })}>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button variant="ghost" size="icon-sm" onClick={() => update(value.filter((_, itemIndex) => itemIndex !== index))}><X /></Button></div><div className="mt-2"><label className="form-label">知识点（逗号分隔）</label><input className="field-input" value={module.topics.map((topic) => topic.title).join(", ")} onChange={(event) => patch(index, { topics: event.target.value.split(/[,，]/).map((title, topicIndex) => ({ id: module.topics[topicIndex]?.id ?? `topic_${Date.now()}_${topicIndex}`, title: title.trim(), status: module.topics[topicIndex]?.status ?? "not_started" as Status })).filter((topic) => topic.title) })} /></div></div>)}<Button variant="outline" size="sm" onClick={() => update([...value, { id: `module_${Date.now()}`, title: "", status: "not_started", topics: [] }])}><Plus />添加模块</Button></div>;
}
function MilestonesEditor({ value, update, db, goalId }: { value: Milestone[]; update: (value: Milestone[]) => void; db: Database; goalId?: string }) {
  const patch = (index: number, next: Partial<Milestone>) => update(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  return <div className="stack">{value.map((milestone, index) => { const recent = goalId ? progressFor(db, undefined, undefined, { goalId, milestoneId: milestone.id })[0] : undefined; return <div className="milestone-editor" key={milestone.id}><div className="flex flex-wrap gap-2"><input className="field-input flex-1 min-w-48" value={milestone.title} placeholder="里程碑" onChange={(event) => patch(index, { title: event.target.value })} /><select className="field-select w-32" value={milestone.status} onChange={(event) => patch(index, { status: event.target.value as Status })}>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input type="date" className="field-input w-38" value={milestone.targetDate ?? ""} onChange={(event) => patch(index, { targetDate: event.target.value })} /><Button variant="ghost" size="icon-sm" onClick={() => update(value.filter((_, itemIndex) => itemIndex !== index))}><X /></Button></div><textarea className="field-textarea" placeholder="完成证据（可选）" value={milestone.evidence ?? ""} onChange={(event) => patch(index, { evidence: event.target.value })} />{recent && <div className="row-subtitle">最近进展 · {recent.date}：{recent.note}</div>}</div>; })}<Button variant="outline" size="sm" onClick={() => update([...value, { id: `milestone_${Date.now()}`, title: "", status: "not_started", evidence: "" }])}><Plus />添加里程碑</Button></div>;
}
function formatResources(value: unknown) { return ((value as ResearchProject["resources"] | undefined) ?? []).map((item) => `${item.label} | ${item.url} | ${item.kind}`).join("\n"); }
function parseResources(value: string) { return value.split("\n").filter(Boolean).map((line) => { const [label = "", url = "", kind = "other"] = line.split("|").map((item) => item.trim()); return { label, url, kind }; }); }
function formatMeetings(value: unknown) { return ((value as ResearchProject["meetings"] | undefined) ?? []).map((item) => `${item.date} | ${item.title} | ${item.notes}`).join("\n"); }
function parseMeetings(value: string) { return value.split("\n").filter(Boolean).map((line, index) => { const [date = "", title = "", notes = ""] = line.split("|").map((item) => item.trim()); return { id: `meeting_${Date.now()}_${index}`, date, title, notes, nextActions: [] }; }); }

type ReviewDraftState = Pick<ReviewSubmission, "operationId" | "expectedRevision" | "completeTaskIds" | "undoTaskIds" | "progressUpdates" | "unfinishedNote" | "researchProjectId" | "researchProgress" | "priorityTaskIds" | "reflection"> & {
  dataEpoch: string;
  paperTitle: string; paperUrl: string; deadlineTitle: string; deadlineDate: string; deadlineParent?: ParentEntityRef;
  inboxPlans: ReviewSubmission["inboxPlans"];
};
function newReviewDraft(date: string, db: Database, review?: EveningReview): ReviewDraftState {
  const paper = review?.newPaperId ? db?.papers.find((item) => item.id === review.newPaperId) : undefined;
  const deadline = review?.newDeadlineTaskId ? db?.tasks.find((item) => item.id === review.newDeadlineTaskId) : undefined;
  return { dataEpoch: db.settings.dataEpoch, operationId: crypto.randomUUID(), expectedRevision: review?.revision ?? 0, completeTaskIds: [], undoTaskIds: [], progressUpdates: [], unfinishedNote: review?.unfinishedNote ?? "", researchProjectId: review?.researchProjectId ?? "", researchProgress: review?.researchProgress ?? "", paperTitle: paper?.title ?? "", paperUrl: paper?.doiUrl ?? "", deadlineTitle: deadline?.title ?? "", deadlineDate: deadline?.dueDate ?? "", deadlineParent: deadline?.primaryParent, inboxPlans: [], priorityTaskIds: review?.priorityTaskIds ?? [], reflection: review?.reflection ?? "" };
}

function TonightReview({ db, refresh, go }: { db: Database; refresh: () => Promise<void>; go: (view: ViewKey) => void }) {
  const reviewDate = today(db.settings.timeZone);
  const existing = db.reviews.find((item) => item.date === reviewDate);
  const [draft, setDraft] = useState<ReviewDraftState>(() => newReviewDraft(reviewDate, db, existing));
  const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false);
  const activeTasks = db.tasks.filter((task) => !task.archived && task.status !== "completed");
  const schedulableTasks = activeTasks.filter((task) => task.planningState === "inbox" || task.planningState === "needs_parent");
  const priorityOptions = db.tasks.filter((task) => !task.archived && task.status !== "completed" && task.planningState === "week" && Boolean(task.primaryParent));
  const revisionConflict = draft.expectedRevision !== (existing?.revision ?? 0);
  const patch = (changes: Partial<ReviewDraftState>) => setDraft((current) => ({ ...current, ...changes, operationId: crypto.randomUUID() }));
  useEffect(() => {
    let active = true;
    const key = `research-os-review-${reviewDate}-${db.settings.dataEpoch}`;
    queueMicrotask(() => {
      if (!active) return;
      let next = newReviewDraft(reviewDate, db, existing);
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved) as ReviewDraftState;
          if (parsed.dataEpoch === db.settings.dataEpoch && typeof parsed.operationId === "string" && Number.isInteger(parsed.expectedRevision)) next = parsed;
        }
      } catch { /* corrupted local draft is ignored; server data remains untouched */ }
      setDraft(next); setReady(true);
    });
    return () => { active = false; };
  }, [reviewDate, existing, db.settings.dataEpoch, db]);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(`research-os-review-${reviewDate}-${db.settings.dataEpoch}`, JSON.stringify(draft));
  }, [draft, ready, reviewDate, db.settings.dataEpoch]);
  const toggleId = (list: string[], id: string) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  const setProgress = (task: Task, enabled: boolean) => {
    const rest = draft.progressUpdates.filter((item) => item.taskId !== task.id);
    patch({ progressUpdates: enabled ? [...rest, { taskId: task.id, note: "", nextAction: task.nextAction }] : rest });
  };
  const toggleComplete = (taskId: string) => {
    const completeTaskIds = toggleId(draft.completeTaskIds, taskId);
    patch({ completeTaskIds, priorityTaskIds: completeTaskIds.includes(taskId) ? draft.priorityTaskIds.filter((id) => id !== taskId) : draft.priorityTaskIds, progressUpdates: completeTaskIds.includes(taskId) ? draft.progressUpdates.filter((item) => item.taskId !== taskId) : draft.progressUpdates });
  };
  const setInboxPlan = (taskId: string, changes: Partial<ReviewSubmission["inboxPlans"][number]>) => {
    const current = draft.inboxPlans.find((item) => item.taskId === taskId);
    const rest = draft.inboxPlans.filter((item) => item.taskId !== taskId);
    if (current || changes.planningState) patch({ inboxPlans: [...rest, { taskId, planningState: "week", plannedWeek: weekStart(reviewDate), ...current, ...changes }] });
  };
  const submit = async () => {
    if (revisionConflict) { toast.error("这份复盘已在其他窗口更新，请先重新加载或关闭该窗口"); return; }
    if (draft.priorityTaskIds.length > 5) { toast.error("重点任务最多选择 5 项"); return; }
    setSaving(true);
    const submission: ReviewSubmission = {
      date: reviewDate, operationId: draft.operationId, expectedRevision: draft.expectedRevision,
      completeTaskIds: draft.completeTaskIds, undoTaskIds: draft.undoTaskIds,
      progressUpdates: draft.progressUpdates.filter((item) => item.note.trim()),
      unfinishedNote: draft.unfinishedNote, researchProjectId: draft.researchProjectId || undefined,
      researchProgress: draft.researchProgress,
      newPaper: draft.paperTitle.trim() ? { title: draft.paperTitle, url: draft.paperUrl } : undefined,
      newDeadline: draft.deadlineTitle.trim() && draft.deadlineDate ? { title: draft.deadlineTitle, date: draft.deadlineDate, primaryParent: draft.deadlineParent } : undefined,
      inboxPlans: draft.inboxPlans.filter((item) => item.planningState), priorityTaskIds: draft.priorityTaskIds, reflection: draft.reflection,
    };
    try {
      await api<EveningReview>("/api/reviews", { method: "POST", body: JSON.stringify(submission) });
      localStorage.removeItem(`research-os-review-${reviewDate}-${db.settings.dataEpoch}`);
      await refresh(); toast.success("今晚更新已保存。跨设备使用前请运行同步脚本。"); go("dashboard");
    } catch (error) { toast.error(`保存复盘失败；草稿仍保存在本机：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const reorderPriority = (taskId: string, direction: -1 | 1) => {
    const next = [...draft.priorityTaskIds]; const index = next.indexOf(taskId); const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; patch({ priorityTaskIds: next });
  };
  return <div className="review-page">
    <div className="review-intro"><div><div className="eyebrow">{reviewDate}</div><h2>{existing ? `今晚更新 · 第 ${existing.revision + 1} 次修订` : "今晚更新"}</h2><p>集中记录实际推进、分流新任务，并确认下一阶段重点。草稿保存在当前浏览器，提交后才写入正式数据。</p>{draft.expectedRevision !== (existing?.revision ?? 0) && <div className="review-conflict"><span>这份复盘已在其他窗口更新。当前草稿仍保留；重新加载将丢弃旧草稿。</span><Button size="sm" variant="outline" onClick={() => { setDraft(newReviewDraft(reviewDate, db, existing)); setReady(true); }}>重新加载复盘</Button></div>}</div><Button variant="outline" onClick={() => go("dashboard")}>返回总览</Button></div>
    <section className="panel review-section"><div className="panel-head"><div><h3 className="panel-title">① 今天推进了什么</h3><span className="panel-meta">勾选完成，或记录部分进展和新的下一步</span></div></div><div className="panel-body">
      {activeTasks.length ? <div className="review-task-grid">{activeTasks.map((task) => {
        const update = draft.progressUpdates.find((item) => item.taskId === task.id);
        return <article className="review-task-card" key={task.id}><label className="choice"><input type="checkbox" checked={draft.completeTaskIds.includes(task.id)} onChange={() => toggleComplete(task.id)} /><span><strong>{task.title}</strong><div className="row-subtitle">{task.category}{task.primaryParent ? ` · ${relationLabel(db, task.primaryParent)}` : " · 待补主关联"}</div></span></label><label className="progress-toggle"><input type="checkbox" checked={Boolean(update)} onChange={(event) => setProgress(task, event.target.checked)} />记录部分进展</label>{update && <div className="stack"><textarea className="field-textarea" value={update.note} placeholder="实际推进了什么" onChange={(event) => patch({ progressUpdates: draft.progressUpdates.map((item) => item.taskId === task.id ? { ...item, note: event.target.value } : item) })} /><textarea className="field-textarea" value={update.nextAction} placeholder="新的下一步行动" onChange={(event) => patch({ progressUpdates: draft.progressUpdates.map((item) => item.taskId === task.id ? { ...item, nextAction: event.target.value } : item) })} /></div>}</article>;
      })}</div> : <PageEmpty>没有未完成任务。</PageEmpty>}
      {existing?.completedTaskIds.length ? <div className="review-history"><h4>本日已记录完成</h4>{existing.completedTaskIds.map((id) => { const task = db.tasks.find((item) => item.id === id); return task ? <label className="choice" key={id}><input type="checkbox" checked={!draft.undoTaskIds.includes(id)} onChange={() => patch({ undoTaskIds: toggleId(draft.undoTaskIds, id) })} /><span><strong>{task.title}</strong><div className="row-subtitle">取消勾选表示明确撤销这次完成</div></span></label> : null; })}</div> : null}
      <div className="mt-4"><label className="form-label">未完成事项或计划偏差</label><textarea className="field-textarea" value={draft.unfinishedNote} onChange={(event) => patch({ unfinishedNote: event.target.value })} placeholder="原因、需要调整的范围，或暂时没有完成的事项" /></div>
    </div></section>
    <div className="grid review-two-col"><section className="panel review-section"><div className="panel-head"><h3 className="panel-title">② 科研进展</h3></div><div className="panel-body stack"><select className="field-select" value={draft.researchProjectId ?? ""} onChange={(event) => patch({ researchProjectId: event.target.value })}><option value="">今天没有新的科研进展</option>{db.research.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><textarea className="field-textarea" value={draft.researchProgress} onChange={(event) => patch({ researchProgress: event.target.value })} placeholder="记录可观察到的变化" /></div></section>
      <section className="panel review-section"><div className="panel-head"><h3 className="panel-title">③ 新论文与截止日期</h3></div><div className="panel-body stack"><input className="field-input" value={draft.paperTitle} onChange={(event) => patch({ paperTitle: event.target.value })} placeholder="论文标题（可选）" /><input className="field-input" value={draft.paperUrl} onChange={(event) => patch({ paperUrl: event.target.value })} placeholder="DOI / URL" /><div className="review-divider" /><input className="field-input" value={draft.deadlineTitle} onChange={(event) => patch({ deadlineTitle: event.target.value })} placeholder="新的截止事项（可选）" /><input className="field-input" type="date" value={draft.deadlineDate} onChange={(event) => patch({ deadlineDate: event.target.value })} /><div><label className="form-label">主关联对象（稍后也可在收件箱补充）</label><RelationPicker value={draft.deadlineParent} update={(value) => patch({ deadlineParent: value as ParentEntityRef | undefined })} db={db} primary /></div></div></section></div>
    <section className="panel review-section"><div className="panel-head"><div><h3 className="panel-title">④ 收件箱分流</h3><span className="panel-meta">安排本周必须先补充主关联；暂不安排可留在收件箱</span></div></div><div className="panel-body">{schedulableTasks.length ? <div className="stack">{schedulableTasks.map((task) => {
      const plan = draft.inboxPlans.find((item) => item.taskId === task.id);
      return <div className="inbox-triage" key={task.id}><strong>{task.title}{task.planningState === "needs_parent" && <span className="warning-text"> · 待补归属</span>}</strong><div className="triage-controls"><select className="field-select" value={plan?.planningState === "week" ? plan.plannedWeek === weekStart(reviewDate) ? "this_week" : "next_week" : plan?.planningState === "later" ? "later" : "inbox"} onChange={(event) => { const value = event.target.value; if (value === "inbox") patch({ inboxPlans: draft.inboxPlans.filter((item) => item.taskId !== task.id) }); else setInboxPlan(task.id, { planningState: value === "later" ? "later" : "week", plannedWeek: value === "next_week" ? addDays(weekStart(reviewDate), 7) : weekStart(reviewDate) }); }}><option value="inbox">保留收件箱</option><option value="this_week">本周</option><option value="next_week">下周</option><option value="later">以后</option></select>{plan?.planningState === "week" && <RelationPicker value={plan.primaryParent ?? task.primaryParent} update={(primaryParent) => setInboxPlan(task.id, { primaryParent: primaryParent as ParentEntityRef | undefined })} db={db} primary />}</div></div>;
    })}</div> : <PageEmpty>收件箱为空。</PageEmpty>}</div></section>
    <div className="grid review-two-col"><section className="panel review-section"><div className="panel-head"><div><h3 className="panel-title">⑤ 当前重点</h3><span className="panel-meta">最多 5 项；顺序就是总览上的顺序</span></div></div><div className="panel-body"><div className="choice-list">{priorityOptions.map((task) => <label className="choice" key={task.id}><input type="checkbox" checked={draft.priorityTaskIds.includes(task.id)} disabled={!draft.priorityTaskIds.includes(task.id) && draft.priorityTaskIds.length >= 5} onChange={() => patch({ priorityTaskIds: toggleId(draft.priorityTaskIds, task.id) })} /><span><strong>{task.title}</strong><div className="row-subtitle">{task.category} · 下一步：{effectiveNextAction(db, task) || "待补充"}</div></span>{draft.priorityTaskIds.includes(task.id) && <span className="priority-order">#{draft.priorityTaskIds.indexOf(task.id) + 1}<button className="icon-button" aria-label="重点上移" onClick={(event) => { event.preventDefault(); reorderPriority(task.id, -1); }}><ArrowUp /></button><button className="icon-button" aria-label="重点下移" onClick={(event) => { event.preventDefault(); reorderPriority(task.id, 1); }}><ArrowDown /></button></span>}</label>)}</div></div></section>
      <section className="panel review-section"><div className="panel-head"><h3 className="panel-title">⑥ 一句话复盘</h3></div><div className="panel-body stack"><textarea className="field-textarea min-h-52" value={draft.reflection} onChange={(event) => patch({ reflection: event.target.value })} placeholder="今天最重要的认识，或明天需要记住的事" /><Button disabled={saving || !ready || revisionConflict} onClick={() => void submit()}>{saving ? <RefreshCw className="animate-spin" /> : <Check />}{saving ? "正在统一保存" : existing ? "保存本次修订" : "完成今晚更新"}</Button><p className="form-help">保存后数据写入本地 JSON；跨设备前请按 README 提交数据变更，再运行 sync-push。</p></div></section></div>
  </div>;
}

function GpaPage({ db, edit, archive }: { db: Database; edit: (entity: Grade) => void; archive: (id: string) => void }) {
  const grades = db.grades.filter((grade) => !grade.archived);
  const counted = grades.filter((grade) => grade.gradingType === "percentage" && grade.includeInAverage && typeof grade.score === "number");
  const total = calculateGpa(grades, db.settings.gpa.rules); const average = calculateWeightedAverage(grades);
  const recordedCredits = grades.reduce((sum, grade) => sum + Number(grade.credits || 0), 0);
  const semesters = [...new Set(grades.map((grade) => grade.semester || "未填写学期"))].sort((a, b) => b.localeCompare(a, "zh-CN"));
  return <>
    <div className="grid gpa-summary">
      <div className="stat-card"><span>累计百分制加权平均</span><strong>{average.average === null ? "—" : average.average.toFixed(2)}</strong><small>主指标 · {average.credits.toFixed(1)} 学分计入</small></div>
      <div className="stat-card"><span>GPA / {db.settings.gpa.scale.toFixed(1)}</span><strong>{total.gpa === null ? "—" : total.gpa.toFixed(2)}</strong><small>{db.settings.gpaConfigured ? "已确认西财 2024 基础预设（可调整）" : "按当前可编辑规则"}</small></div>
      <div className="stat-card"><span>已记录学分</span><strong>{recordedCredits.toFixed(1)}</strong><small>{counted.reduce((sum, grade) => sum + Number(grade.credits), 0).toFixed(1)} 学分计入均分</small></div>
    </div>
    <section className="panel mb-4"><div className="panel-body"><p className="text-sm leading-6">百分制加权平均 = Σ（成绩 × 学分）÷ Σ计入统计的学分。待出分、合格制、免修及手动排除记录不计入。重修课程不会自动合并，请手动选择计入统计的那一次。</p></div></section>
    {semesters.map((semester) => {
      const semesterGrades = grades.filter((grade) => (grade.semester || "未填写学期") === semester);
      const summary = calculateGpa(semesterGrades, db.settings.gpa.rules); const semesterAverage = calculateWeightedAverage(semesterGrades);
      const credits = semesterGrades.reduce((sum, grade) => sum + Number(grade.credits || 0), 0);
      return <section className="panel mb-4" key={semester}>
        <div className="panel-head"><h2 className="panel-title">{semester}</h2><span className="panel-meta">均分 {semesterAverage.average === null ? "—" : semesterAverage.average.toFixed(2)} · GPA {summary.gpa === null ? "—" : summary.gpa.toFixed(2)} · {credits.toFixed(1)} 已记录学分</span></div>
        <div className="table-wrap border-0 rounded-none"><table className="data-table"><thead><tr><th>课程</th><th>考核方式</th><th>类型</th><th>学分</th><th>成绩</th><th>计入均分</th><th>绩点</th><th>核心</th><th /></tr></thead><tbody>{semesterGrades.map((grade) => <tr key={grade.id}>
          <td><strong>{grade.course}</strong></td><td>{grade.gradingType === "percentage" ? "百分制" : grade.gradingType === "pass_fail" ? "合格制" : "免修"}</td><td>{grade.courseType}</td><td>{grade.credits}</td><td>{grade.gradingType === "pass_fail" ? grade.result === "pass" ? "合格" : grade.result === "fail" ? "不合格" : "—" : typeof grade.score === "number" ? grade.score : "待出分"}</td><td>{grade.includeInAverage && grade.gradingType === "percentage" ? "是" : "否"}</td><td>{grade.gradingType === "percentage" && typeof grade.score === "number" ? calculateGradePoint(grade.score, db.settings.gpa.rules).toFixed(1) : "—"}</td><td>{grade.isCore ? "是" : "—"}</td><td><div className="flex gap-1"><Button variant="ghost" size="icon-sm" onClick={() => edit(grade)}><Pencil /></Button><Button variant="ghost" size="icon-sm" onClick={() => archive(grade.id)}><Archive /></Button></div></td>
        </tr>)}</tbody></table></div>
      </section>;
    })}
    {!grades.length && <PageEmpty>还没有成绩记录。可以在设置中确认适用的 GPA 规则后再录入。</PageEmpty>}
  </>;
}

function ArchivePage({ db, restore, remove }: { db: Database; restore: (collection: EditableCollection, entity: AnyEntity) => Promise<void>; remove: (collection: EditableCollection, id: string, hard?: boolean) => Promise<void> | void }) {
  const collections = Object.keys(viewCollection).map((view) => viewCollection[view as ViewKey]).filter(Boolean) as EditableCollection[]; collections.push("tasks", "grades");
  const entries = [...new Set(collections)].flatMap((collection) => (db[collection] as AnyEntity[]).filter((entity) => entity.archived).map((entity) => ({ collection, entity })));
  return <section className="panel"><div className="panel-head"><h2 className="panel-title">已归档内容</h2><span className="panel-meta">{entries.length} 条 · 归档不会丢失数据</span></div><div className="panel-body">{entries.length ? entries.map(({ collection, entity }) => <div className="archive-row" key={`${collection}-${entity.id}`}><div><strong>{entityTitle(collection, entity)}</strong><div className="row-subtitle">{collectionLabel(collection)} · 更新于 {entity.updatedAt.slice(0, 10)}</div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void restore(collection, entity)}>恢复</Button><ConfirmButton title="永久删除这条记录？" description="此操作无法撤销，但不会影响其他记录。" action="永久删除" onConfirm={() => remove(collection, entity.id, true)} /></div></div>) : <PageEmpty>归档还是空的。</PageEmpty>}</div></section>;
}

function SettingsPage({ db, setDb }: { db: Database; setDb: (db: Database) => void }) {
  const [rules, setRules] = useState(JSON.stringify(db.settings.gpa, null, 2));
  const [stalledDays, setStalledDays] = useState(db.settings.stalledDays);
  const [timeZone, setTimeZone] = useState(db.settings.timeZone);
  const [saving, setSaving] = useState(false);
  const [archiveCollection, setArchiveCollection] = useState<EditableCollection>("tasks");
  const [archiveIds, setArchiveIds] = useState<string[]>([]);
  const { theme, setTheme } = useTheme();
  const refreshData = useCallback(async () => { setDb(await api<Database>("/api/data")); }, [setDb]);
  const collections: EditableCollection[] = ["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"];
  const candidates = (db[archiveCollection] as AnyEntity[]).filter((item) => !item.archived);
  const saveSettings = async (next: AppSettings) => {
    setSaving(true);
    try { const settings = await api<AppSettings>("/api/data", { method: "PUT", body: JSON.stringify({ settings: next }) }); setDb({ ...db, settings }); toast.success("设置已保存"); }
    catch (error) { toast.error(`保存失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const saveRules = async () => {
    try { const gpa = JSON.parse(rules) as AppSettings["gpa"]; await saveSettings({ ...db.settings, gpa }); }
    catch (error) { toast.error(`规则无效：${(error as Error).message}`); }
  };
  const archiveSelected = async () => {
    if (!archiveIds.length) return;
    try {
      await api("/api/archive-batch", { method: "POST", body: JSON.stringify({ collection: archiveCollection, ids: archiveIds }) });
      setArchiveIds([]); await api<Database>("/api/data").then(setDb); toast.success("所选记录已归档，可在归档页恢复");
    } catch (error) { toast.error(`归档失败：${(error as Error).message}`); }
  };
  return <div className="grid settings-grid">
    <div className="stack">
      <ModelSettings refreshData={refreshData} />
      <WorkspaceDataSettings db={db} refresh={refreshData} />
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">GPA 计算规则</h2><span className="panel-meta">从高分到低分匹配第一个规则</span></div><Button disabled={saving} onClick={() => void saveRules()}>保存规则</Button></div><div className="panel-body"><textarea className="field-textarea code-area" spellCheck={false} value={rules} onChange={(event) => setRules(event.target.value)} /><p className="form-help">修改 scale（满绩点）、minScore（最低分）、point（绩点）和 label（等级）。</p></div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">本地数据与恢复</h2></div><div className="panel-body"><p className="text-sm leading-6">正式数据保存在 <code>data/</code> 的 JSON 文件中。成功提交晚间复盘会创建本机快照；GitHub 私有仓库用于跨设备同步。未提交草稿仅保存在当前浏览器。</p><p className="form-help">不要直接删除 JSON 文件。误操作可从“归档”恢复，或从 Git 历史和 data/.backups 快照还原。</p></div></section>
    </div>
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2 className="panel-title">外观与推进提醒</h2></div><div className="panel-body stack"><div><label className="form-label">主题</label><select className="field-select" value={theme ?? "system"} onChange={(event) => setTheme(event.target.value)}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></div><div><label className="form-label">日期时区</label><input className="field-input" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></div><div><label className="form-label">停滞提醒天数</label><input className="field-input" type="number" min={1} max={365} value={stalledDays} onChange={(event) => setStalledDays(Number(event.target.value))} /></div><Button disabled={saving} variant="outline" onClick={() => void saveSettings({ ...db.settings, timeZone, stalledDays })}>保存提醒设置</Button></div></section>
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">选择记录并归档</h2><span className="panel-meta">可恢复，不会清空全库</span></div></div><div className="panel-body stack"><p className="form-help">旧数据可能已被你编辑，因此不会自动猜测哪些是示例。先选择模块，再勾选你确认要归档的记录。</p><select className="field-select" value={archiveCollection} onChange={(event) => { setArchiveCollection(event.target.value as EditableCollection); setArchiveIds([]); }}>{collections.map((item) => <option key={item} value={item}>{collectionLabel(item)}</option>)}</select><div className="choice-list">{candidates.map((item) => <label className="choice" key={item.id}><input type="checkbox" checked={archiveIds.includes(item.id)} onChange={() => setArchiveIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{entityTitle(archiveCollection, item)}</span></label>)}{!candidates.length && <div className="row-subtitle">这个模块没有活动记录。</div>}</div><ConfirmButton title={`归档选中的 ${archiveIds.length} 条记录？`} description="归档会保留记录并创建操作前快照；有关联未完成任务的对象需要先处理任务。你可以在归档页恢复。" action={`归档 ${archiveIds.length} 条`} onConfirm={() => void archiveSelected()} /></div></section>
    </div>
  </div>;
}

type PublicModelConnection = AppSettings["modelConnections"][number] & { connected: boolean; account?: string; isDefault: boolean };
function ModelSettings({ refreshData }: { refreshData: () => Promise<void> }) {
  const [connections, setConnections] = useState<PublicModelConnection[]>([]);
  const [models, setModels] = useState<Record<string, { id: string; name: string }[]>>({});
  const [loginSession, setLoginSession] = useState<{ id: string; url: string } | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [saving, setSaving] = useState(false); const [testing, setTesting] = useState("");
  const [form, setForm] = useState({ id: "", name: "备用 OpenAI 兼容 API", baseUrl: "", protocol: "chat_completions" as "chat_completions" | "responses", modelId: "", apiKey: "" });
  const refresh = useCallback(async () => { const value = await api<{ connections: PublicModelConnection[] }>("/api/models"); setConnections(value.connections); }, []);
  useEffect(() => {
    let active = true;
    void api<{ connections: PublicModelConnection[] }>("/api/models").then((value) => { if (active) setConnections(value.connections); }).catch((error) => { if (active) toast.error(`模型状态读取失败：${(error as Error).message}`); });
    return () => { active = false; };
  }, []);
  const loginSessionId = loginSession?.id;
  useEffect(() => {
    if (!loginSessionId) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await api<{ status: string; error?: string }>(`/api/models/chatgpt/login/${loginSessionId}`);
        if (cancelled) return;
        if (result.status === "pending" || result.status === "processing") { timer = setTimeout(() => void poll(), 1500); return; }
        setLoginStatus(result.status === "complete" ? "ChatGPT 订阅已连接" : result.error ?? "授权未完成");
        if (result.status === "complete") { await refresh(); await refreshData(); toast.success("ChatGPT 订阅模型已连接"); }
        else toast.error(result.error ?? "授权未完成");
        setLoginSession(null);
      } catch (error) { if (!cancelled) { setLoginStatus((error as Error).message); setLoginSession(null); } }
    };
    timer = setTimeout(() => void poll(), 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loginSessionId, refresh, refreshData]);
  const beginLogin = async () => {
    setSaving(true); setLoginStatus("请在弹出的官方页面完成授权；可点下方按钮重新打开");
    try { const result = await api<{ id: string; authorizationUrl: string }>("/api/models/chatgpt/login", { method: "POST", body: "{}" }); setLoginSession({ id: result.id, url: result.authorizationUrl }); await refreshData(); await refresh(); }
    catch (error) { setLoginStatus((error as Error).message); toast.error(`启动订阅登录失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const loadModels = async (id: string) => {
    try { const result = await api<{ models: { id: string; name: string }[] }>(`/api/models/catalog?connectionId=${encodeURIComponent(id)}`); setModels((current) => ({ ...current, [id]: result.models })); if (!result.models.length) toast.error("该连接没有返回可用模型"); }
    catch (error) { toast.error(`读取模型列表失败：${(error as Error).message}`); }
  };
  const chooseModel = async (id: string, modelId: string) => {
    try { await api("/api/models", { method: "POST", body: JSON.stringify({ action: "choose-model", id, modelId }) }); await refresh(); await refreshData(); toast.success("默认模型已更新"); }
    catch (error) { toast.error(`模型选择失败：${(error as Error).message}`); }
  };
  const setDefault = async (id: string) => {
    try { await api("/api/models", { method: "POST", body: JSON.stringify({ action: "set-default", id }) }); await refresh(); await refreshData(); toast.success("默认渠道已更新；后续请求只使用此渠道"); }
    catch (error) { toast.error((error as Error).message); }
  };
  const test = async (id: string) => {
    setTesting(id); try { const result = await api<{ response: string; channel: string }>("/api/models/test", { method: "POST", body: JSON.stringify({ connectionId: id }) }); toast.success(`${result.channel}完整响应成功：${result.response}`); }
    catch (error) { toast.error(`连接测试失败：${(error as Error).message}`); }
    finally { setTesting(""); }
  };
  const disconnect = async () => {
    try {
      const result = await api<{ remoteRevocationConfirmed: boolean }>("/api/models/chatgpt/disconnect", { method: "POST", body: "{}" });
      await refresh();
      toast.success(result.remoteRevocationConfirmed ? "本機憑據已清除，官方會話也已撤銷" : "本機憑據已清除；官方撤銷未確認。若要立即取消遠端授權，請在 ChatGPT 設置中斷開 Research OS");
    } catch (error) { toast.error(`断开失败：${(error as Error).message}`); }
  };
  const saveCustom = async () => {
    setSaving(true); try {
      const result = await api<{ connection: AppSettings["modelConnections"][number]; needsKey: boolean }>("/api/models/custom", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, id: result.connection.id, apiKey: "" }); await refresh(); await refreshData(); toast.success(result.needsKey ? "连接配置已保存；请在本机填写 API Key" : "备用 API 配置已保存");
    } catch (error) { toast.error(`备用 API 保存失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const customConnections = connections.filter((item) => item.kind === "openai_compatible");
  return <section className="panel"><div className="panel-head"><div><h2 className="panel-title">模型配置</h2><span className="panel-meta">ChatGPT 订阅优先；API 仅作备用，只有你手动设为默认才会调用。</span></div></div><div className="panel-body stack">
    <div className="ai-channel-card"><div><strong>ChatGPT 订阅</strong><div className="row-subtitle">按账号实际模型目录显示；连接失败不会自动调用 API。</div></div><Button disabled={saving || Boolean(loginSession)} onClick={() => void beginLogin()}>{loginSession ? "等待官方授权" : connections.some((item) => item.kind === "chatgpt_subscription" && item.connected) ? "重新登录" : "Continue with ChatGPT"}</Button></div>
    {loginStatus && <p className="form-help">{loginStatus}</p>}
    {loginSession && <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href={loginSession.url} target="_blank" rel="noreferrer">打开 OpenAI 官方授权页</a></Button><Button variant="outline" onClick={() => { void api(`/api/models/chatgpt/login/${loginSession.id}`, { method: "DELETE" }).then(() => setLoginSession(null)); }}>取消授权</Button></div>}
    {connections.filter((item) => item.kind === "chatgpt_subscription").map((connection) => <div className="ai-channel-card" key={connection.id}><div><strong>{connection.connected ? `已连接${connection.account ? ` · ${connection.account}` : ""}` : "需要在本机登录"}</strong><div className="row-subtitle">{connection.modelId ? `默认模型：${connection.modelId}` : "尚未选择模型"} · {connection.isDefault ? "当前默认渠道（订阅）" : "可用订阅渠道"}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void loadModels(connection.id)}>刷新账号模型列表</Button><Button variant="outline" size="sm" disabled={!connection.connected || testing === connection.id} onClick={() => void test(connection.id)}>{testing === connection.id ? "测试中…" : "测试完整响应"}</Button><Button variant="outline" size="sm" onClick={() => void setDefault(connection.id)}>设为默认</Button><Button variant="ghost" size="sm" disabled={!connection.connected} onClick={() => void disconnect()}>断开</Button></div>
      {models[connection.id] && <div className="mt-3"><label className="form-label">账号当前可用模型</label><select className="field-select" value={connection.modelId ?? ""} onChange={(event) => void chooseModel(connection.id, event.target.value)}><option value="">请选择账号目录中的模型</option>{models[connection.id].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
    </div>)}
    <div className="panel-body rounded-lg border stack"><div><h3 className="panel-title">备用 API（OpenAI 兼容）</h3><p className="form-help">密钥仅写入本机用户凭据目录；不会进入 JSON 业务数据、聊天或 Git。Responses / Chat Completions 二选一。</p></div>
      {customConnections.map((connection) => <div className="ai-channel-card" key={connection.id}><div><strong>{connection.name} · {connection.connected ? "此设备已填密钥" : "另一设备需重新填写密钥"}</strong><div className="row-subtitle">{connection.baseUrl} · {connection.modelId || "未设置模型 ID"} · {connection.isDefault ? "当前默认渠道（API）" : "备用"}</div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setForm({ id: connection.id, name: connection.name, baseUrl: connection.baseUrl ?? "", protocol: connection.protocol ?? "chat_completions", modelId: connection.modelId ?? "", apiKey: "" }); void loadModels(connection.id); }}>编辑 / 读模型列表</Button><Button variant="outline" size="sm" disabled={testing === connection.id} onClick={() => void test(connection.id)}>{testing === connection.id ? "测试中…" : "测试完整响应"}</Button><Button variant="outline" size="sm" onClick={() => void setDefault(connection.id)}>手动切换为默认</Button><Button variant="ghost" size="sm" onClick={() => void api("/api/models", { method: "POST", body: JSON.stringify({ action: "remove", id: connection.id }) }).then(() => refresh()).then(() => toast.success("备用连接已移除"))}>移除</Button></div></div>)}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3"><input className="field-input" placeholder="连接名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input className="field-input" placeholder="Base URL（例如 https://api.example.com/v1）" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /><select className="field-select" value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as typeof form.protocol })}><option value="chat_completions">OpenAI 兼容 · Chat Completions</option><option value="responses">OpenAI 兼容 · Responses</option></select><input className="field-input" placeholder="模型 ID（可手工填写）" value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /><input className="field-input md:col-span-2" type="password" autoComplete="new-password" placeholder={form.id ? "API Key（留空保留现有密钥）" : "API Key（仅保存在本机）"} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></div>
      <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void saveCustom()}>{saving ? "保存中…" : "保存备用 API"}</Button>{form.id && <Button variant="outline" onClick={() => { void api(`/api/models/catalog?connectionId=${encodeURIComponent(form.id)}`).then((value: unknown) => { const list = (value as { models: { id: string; name: string }[] }).models; setModels((current) => ({ ...current, [form.id]: list })); }).catch((error) => toast.error((error as Error).message)); }}>获取模型列表</Button>}</div>
    </div>
    <p className="form-help">切换为 API 后，模型调用可能产生该服务的 API 费用；ChatGPT 订阅调用不显示或计入 API 账单。</p>
  </div></section>;
}

function WorkspaceDataSettings({ db, refresh }: { db: Database; refresh: () => Promise<void> }) {
  const [backups, setBackups] = useState<{ id: string; createdAt: string; schemaVersion: number; counts: Record<string, number>; valid: boolean; error?: string }[]>([]);
  const [preview, setPreview] = useState<{ id: string; counts: Record<string, number>; schemaVersion: number } | null>(null);
  const [initialization, setInitialization] = useState<{ counts: Record<string, number>; total: number; dataEpoch: string; dataRevision: number } | null>(null);
  const [confirmation, setConfirmation] = useState(""); const [restoreConfirmation, setRestoreConfirmation] = useState(""); const [busy, setBusy] = useState(false);
  const refreshBackups = async () => { setBackups(await api("/api/workspace/backups")); };
  useEffect(() => {
    let active = true;
    void api<typeof backups>("/api/workspace/backups").then((value) => { if (active) setBackups(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const previewReset = async () => { try { const result = await api<typeof initialization>("/api/workspace/preview"); setInitialization(result); setConfirmation(""); } catch (error) { toast.error((error as Error).message); } };
  const reset = async () => {
    if (!initialization) return;
    setBusy(true); try { await api("/api/workspace/initialize", { method: "POST", body: JSON.stringify({ expectedRevision: initialization.dataRevision, confirmation }) }); await refresh(); await refreshBackups(); setInitialization(null); setConfirmation(""); toast.success("工作区已初始化；操作前快照已保存在本机"); }
    catch (error) { toast.error(`初始化未执行：${(error as Error).message}`); } finally { setBusy(false); }
  };
  const inspect = async (id: string) => { try { setPreview(await api(`/api/workspace/backups/${encodeURIComponent(id)}`)); setRestoreConfirmation(""); } catch (error) { toast.error((error as Error).message); } };
  const restore = async () => {
    if (!preview) return;
    setBusy(true); try { await api("/api/workspace/restore", { method: "POST", body: JSON.stringify({ id: preview.id, expectedRevision: db.settings.dataRevision, confirmation: restoreConfirmation }) }); await refresh(); await refreshBackups(); setPreview(null); setRestoreConfirmation(""); toast.success("备份已恢复；恢复前数据也已另行备份"); }
    catch (error) { toast.error(`恢复未完成：${(error as Error).message}`); } finally { setBusy(false); }
  };
  return <section className="panel"><div className="panel-head"><div><h2 className="panel-title">本地备份、初始化与恢复</h2><span className="panel-meta">数据保存在 data/*.json；快照位于 data/.backups，且不会进入 Git。</span></div><DatabaseBackup /></div><div className="panel-body stack">
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void refreshBackups()}>刷新备份列表</Button><Button variant="destructive" onClick={() => void previewReset()}>预览并初始化工作区</Button></div>
    {initialization && <div className="panel-body rounded-lg border stack"><strong>将清空以下活动与归档记录，模型连接设置保留：</strong><div className="row-subtitle">{Object.entries(initialization.counts).map(([key, value]) => `${collectionLabel(key as EditableCollection)} ${value}`).join(" · ")} · 合计 {initialization.total} 条</div><label className="form-label">先完整备份，再输入“清空并开始”</label><input className="field-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /><Button variant="destructive" disabled={busy || confirmation !== "清空并开始"} onClick={() => void reset()}>{busy ? "正在备份并初始化…" : "创建快照后初始化"}</Button><p className="form-help">服务端会先创建并校验包含业务 JSON 与聊天记录的快照；快照失败则不会清理。初始化会换发 dataEpoch，旧标签页与待确认草稿将失效。</p></div>}
    <div className="backup-list">{backups.map((backup) => <div className="archive-row" key={backup.id}><div><strong>{backup.id}</strong><div className="row-subtitle">{new Date(backup.createdAt).toLocaleString("zh-CN")} · v{backup.schemaVersion} · {backup.valid ? Object.values(backup.counts).reduce((sum, value) => sum + value, 0) : "不可恢复"} 条</div>{!backup.valid && <div className="warning-text">{backup.error}</div>}</div><Button variant="outline" size="sm" disabled={!backup.valid} onClick={() => void inspect(backup.id)}>恢复预览</Button></div>)}{!backups.length && <PageEmpty>还没有本机快照。</PageEmpty>}</div>
    {preview && <div className="panel-body rounded-lg border stack"><strong>恢复预览：{preview.id}</strong><div className="row-subtitle">{Object.entries(preview.counts).map(([key, value]) => `${collectionLabel(key as EditableCollection)} ${value}`).join(" · ")}</div><p className="form-help">恢复前当前数据会先备份；恢复事务完成后会生成新数据代次，草稿失效。</p><label className="form-label">输入“恢复此备份”</label><input className="field-input" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} /><div className="flex gap-2"><Button disabled={busy || restoreConfirmation !== "恢复此备份"} onClick={() => void restore()}>{busy ? "恢复中…" : "确认整组恢复"}</Button><Button variant="outline" onClick={() => setPreview(null)}>取消</Button></div></div>}
  </div></section>;
}

function AssistantPage({ db, refresh, go }: { db: Database; refresh: () => Promise<void>; go: (view: ViewKey) => void }) {
  const [conversations, setConversations] = useState<{ id: string; title: string; updatedAt: string; messageCount: number }[]>([]);
  const [conversation, setConversation] = useState<AIConversation | null>(null);
  const [models, setModels] = useState<{ connections: PublicModelConnection[]; defaultModelConnectionId: string } | null>(null);
  const [composer, setComposer] = useState(""); const [includeGrades, setIncludeGrades] = useState(false);
  const [contextHint, setContextHint] = useState(""); const [sending, setSending] = useState(false); const [streaming, setStreaming] = useState("");
  const [edits, setEdits] = useState<Record<string, { selected: boolean; raw: string }[]>>({});
  const [applying, setApplying] = useState("");
  const refreshList = async () => setConversations(await api("/api/assistant/conversations"));
  useEffect(() => {
    let active = true;
    void Promise.all([api<typeof conversations>("/api/assistant/conversations"), api<typeof models>("/api/models")]).then(([items, modelState]) => {
      if (active) { setConversations(items); setModels(modelState); }
    }).catch((error) => { if (active) toast.error((error as Error).message); });
    queueMicrotask(() => {
      if (!active) return;
      const initial = sessionStorage.getItem("research-os-assistant-prefill");
      if (initial) { setComposer(initial); setContextHint("初始化引导"); sessionStorage.removeItem("research-os-assistant-prefill"); }
    });
    return () => { active = false; };
  }, []);
  const openConversation = async (id: string) => { try { setConversation(await api(`/api/assistant/conversations/${encodeURIComponent(id)}`)); } catch (error) { toast.error((error as Error).message); } };
  const newConversation = async () => { try { const value = await api<AIConversation>("/api/assistant/conversations", { method: "POST", body: JSON.stringify({ title: "新对话" }) }); setConversation(value); await refreshList(); } catch (error) { toast.error((error as Error).message); } };
  const send = async () => {
    if (!composer.trim() || sending) return;
    setSending(true); setStreaming("");
    try {
      let active = conversation;
      if (!active) { active = await api<AIConversation>("/api/assistant/conversations", { method: "POST", body: JSON.stringify({ title: composer.trim().slice(0, 36) }) }); setConversation(active); }
      const userMessage: AIConversationMessage = { id: crypto.randomUUID().replaceAll("-", ""), role: "user", text: composer.trim(), createdAt: new Date().toISOString(), status: "complete", usesGradeContext: includeGrades };
      setConversation({ ...active, messages: [...active.messages, userMessage] });
      const response = await fetch("/api/assistant/send", { method: "POST", headers: { "Content-Type": "application/json", "x-research-os-epoch": db.settings.dataEpoch }, body: JSON.stringify({ conversationId: active.id, text: composer.trim(), includeGrades, contextHint }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `请求失败：${response.status}`);
      if (!response.body) throw new Error("浏览器未能读取助手响应流");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let resultConversationId = active.id; let completed = false;
      const handleBlock = (block: string) => {
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!event || !data) return;
        const payload = JSON.parse(data) as { delta?: string; error?: string; conversationId?: string; message?: AIConversationMessage };
        if (payload.conversationId) resultConversationId = payload.conversationId;
        if (event === "delta" && payload.delta) setStreaming((value) => (value + payload.delta).slice(-6000));
        if (event === "complete" && payload.message) { setConversation((value) => value ? { ...value, id: resultConversationId, messages: [...value.messages, payload.message!] } : value); completed = true; setComposer(""); setIncludeGrades(false); setContextHint(""); }
        if (event === "error") throw new Error(payload.error || "助手请求失败");
      };
      while (true) { const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }); let split: number; while ((split = buffer.indexOf("\n\n")) >= 0) { const block = buffer.slice(0, split); buffer = buffer.slice(split + 2); handleBlock(block); } if (done) break; }
      if (!completed) throw new Error("响应流中断；这次请求没有形成可应用草稿");
      await refreshList(); await refresh();
    } catch (error) {
      const message = (error as Error).message;
      toast.error(`AI 助手：${message}`);
      const id = conversation?.id;
      if (id) void api<AIConversation>(`/api/assistant/conversations/${encodeURIComponent(id)}`).then(setConversation).catch(() => undefined);
    } finally { setSending(false); setStreaming(""); }
  };
  const apply = async (message: AIConversationMessage) => {
    const proposal = message.proposal; if (!proposal || !conversation) return;
    const editList = edits[proposal.id] ?? proposal.changes.map((change) => ({ selected: true, raw: JSON.stringify(change, null, 2) }));
    let editedChanges: AIProposalChange[];
    try { editedChanges = editList.map((item) => JSON.parse(item.raw) as AIProposalChange); }
    catch { toast.error("请先修正草稿中的 JSON 格式，或取消这份草稿"); return; }
    const indexes = editList.map((item, index) => item.selected ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) { toast.error("至少勾选一项操作"); return; }
    setApplying(proposal.id);
    try {
      const common = { conversationId: conversation.id, proposalId: proposal.id, indexes, editedChanges, expectedRevision: proposal.dataRevision };
      await api("/api/assistant/apply", { method: "POST", body: JSON.stringify({ ...common, operationId: crypto.randomUUID().replaceAll("-", ""), validateOnly: true }) });
      await api("/api/assistant/apply", { method: "POST", body: JSON.stringify({ ...common, operationId: crypto.randomUUID().replaceAll("-", "") }) });
      toast.success("已按你勾选和编辑的内容保存；本批操作具备幂等保护");
      setConversation(await api(`/api/assistant/conversations/${encodeURIComponent(conversation.id)}`));
      await refresh();
    } catch (error) { toast.error(`草稿未应用：${(error as Error).message}`); }
    finally { setApplying(""); }
  };
  const cancelProposal = async (message: AIConversationMessage) => {
    if (!conversation || !message.proposal) return;
    const next = { ...conversation, messages: conversation.messages.map((item) => item.id === message.id ? { ...item, proposal: undefined } : item), updatedAt: new Date().toISOString() };
    try { setConversation(await api<AIConversation>(`/api/assistant/conversations/${encodeURIComponent(conversation.id)}`, { method: "PUT", body: JSON.stringify(next) })); }
    catch (error) { toast.error((error as Error).message); }
  };
  const collectionForView = (collection: string) => collection in ({ tasks: 1, learning: 1, research: 1, papers: 1, projects: 1, competitions: 1, goals: 1, grades: 1 }) ? collectionLabel(collection as EditableCollection) : collection;
  return <div className="assistant-layout">
    <aside className="assistant-history panel"><div className="panel-head"><h2 className="panel-title">对话</h2><Button size="sm" variant="outline" onClick={() => void newConversation()}><Plus />新对话</Button></div><div className="panel-body choice-list">{conversations.map((item) => <button className={`assistant-history-item ${conversation?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => void openConversation(item.id)}><strong>{item.title}</strong><small>{item.messageCount} 条消息 · {item.updatedAt.slice(0, 16).replace("T", " ")}</small></button>)}{!conversations.length && <p className="form-help">AI 对话会保存为可读 JSON，并随数据仓库同步；切换设备后需重新连接模型。</p>}</div></aside>
    <section className="panel assistant-chat"><div className="panel-head"><div><h2 className="panel-title">{conversation?.title ?? "Research OS 助手"}</h2><span className="panel-meta">{models?.connections.find((item) => item.isDefault)?.name ?? "默认渠道尚未设置"} · 只提出草稿，不会自动写入</span></div><Button variant="outline" size="sm" onClick={() => go("settings")}>模型配置</Button></div>
      <div className="assistant-messages">{conversation?.messages.map((message) => <article className={`assistant-message ${message.role}`} key={message.id}><div className="assistant-message-meta">{message.role === "user" ? "你" : message.channel === "openai_compatible" ? "AI · 备用 API" : "AI · ChatGPT 订阅"}{message.status === "interrupted" && <span className="warning-text"> · 未完成</span>}</div><p className="whitespace-pre-wrap">{message.text}</p>
        {message.citations?.length ? <div className="citation-list"><strong>本地引用</strong>{message.citations.map((item) => <span key={`${item.collection}-${item.id}`}>{collectionForView(item.collection)} · {item.title}</span>)}</div> : null}
        {message.proposal && <div className="proposal-panel"><div className="proposal-head"><div><strong>待审阅操作草稿</strong><div className="row-subtitle">生成时数据版本 {message.proposal.dataRevision}{message.proposal.dataRevision !== db.settings.dataRevision ? " · 数据已变化，必须重新生成" : ""}</div></div><Button variant="ghost" size="sm" onClick={() => void cancelProposal(message)}>取消草稿</Button></div>
          {message.proposal.changes.map((change, index) => { const edit = edits[message.proposal!.id]?.[index] ?? { selected: true, raw: JSON.stringify(change, null, 2) }; return <div className="proposal-change" key={`${message.proposal!.id}-${index}`}><label className="choice"><input type="checkbox" checked={edit.selected} onChange={(event) => setEdits((value) => ({ ...value, [message.proposal!.id]: message.proposal!.changes.map((item, itemIndex) => ({ selected: itemIndex === index ? event.target.checked : value[message.proposal!.id]?.[itemIndex]?.selected ?? true, raw: value[message.proposal!.id]?.[itemIndex]?.raw ?? JSON.stringify(item, null, 2) })) }))} /><span><strong>{change.action} · {collectionForView(change.collection)}{change.id ? ` · ${change.id}` : ""}</strong><div className="row-subtitle">{change.explanation}</div><div className="row-subtitle">建议字段：{Object.entries(change.entity).map(([key, value]) => `${key}=${typeof value === "string" ? value.slice(0, 100) : JSON.stringify(value).slice(0, 100)}`).join(" · ")}</div></span></label><details><summary>编辑此项 JSON</summary><textarea className="field-textarea code-area mt-2" spellCheck={false} value={edit.raw} onChange={(event) => setEdits((value) => ({ ...value, [message.proposal!.id]: message.proposal!.changes.map((item, itemIndex) => ({ selected: value[message.proposal!.id]?.[itemIndex]?.selected ?? true, raw: itemIndex === index ? event.target.value : value[message.proposal!.id]?.[itemIndex]?.raw ?? JSON.stringify(item, null, 2) })) }))} /></details></div>; })}
          <Button disabled={Boolean(applying) || message.proposal.dataEpoch !== db.settings.dataEpoch || message.proposal.dataRevision !== db.settings.dataRevision} onClick={() => void apply(message)}>{applying === message.proposal.id ? "校验并提交中…" : "确认所选操作并保存"}</Button><p className="form-help">确认前会重新执行日期、字段、ID 引用和跨模块关系校验。永久删除、初始化、凭据与 Git 不可由 AI 操作。</p>
        </div>}
      </article>)}
        {sending && <div className="assistant-message assistant"><div className="assistant-message-meta">正在生成 · {streaming.length ? "已接收响应片段" : "等待模型响应"}</div>{streaming.length > 0 && <pre className="assistant-stream-preview">{streaming.slice(-1600)}</pre>}</div>}
        {!conversation?.messages.length && !sending && <div className="assistant-welcome"><Bot /><h3>把要梳理的问题交给助手</h3><p>助手只会读取活动记录与相关进展；成绩需按每轮单独勾选。模型建议必须经你审阅、编辑并确认后才会保存。</p></div>}
      </div>
      <div className="assistant-composer"><textarea className="field-textarea" value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void send(); }} placeholder="描述真实情况，或请助手拆任务、整理周计划、生成复盘草稿…" /><div className="assistant-composer-row"><label className="choice"><input type="checkbox" checked={includeGrades} onChange={(event) => setIncludeGrades(event.target.checked)} /><span>本轮允许读取成绩</span></label><span className="form-help">{contextHint || "本地检索 · 不含归档与备份"}</span><Button disabled={sending || !composer.trim()} onClick={() => void send()}>{sending ? "正在生成…" : "发送"}</Button></div></div>
    </section>
  </div>;
}

function ConfirmButton({ title, description, action, onConfirm }: { title: string; description: string; action: string; onConfirm: () => void }) {
  return <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="sm"><Trash2 />{action}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onConfirm}>{action}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

type WebMcpTool = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown): Promise<unknown> | unknown;
};
type WebMcpContext = { registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void> };

function useWebMcp(db: Database) {
  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: WebMcpTool) => { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); };
    register({
      name: "search_research_os", title: "搜索 Research OS", description: "搜索进行中的任务、课程、科研、论文、项目、竞赛、目标和成绩。",
      inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) { const query = (input as { query?: unknown })?.query; if (typeof query !== "string" || !query.trim()) throw new Error("query must be a non-empty string"); return searchDatabase(db, query).slice(0, 20).map((result) => ({ collection: result.collection, id: result.entity.id, title: result.title })); },
    });
    return () => lifecycle.abort();
  }, [db]);
}
