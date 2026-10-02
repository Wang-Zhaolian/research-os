"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Archive, ArrowDown, ArrowUp, BookOpen, Check,
  CircleGauge, ClipboardCheck, FlaskConical, FolderGit2, GraduationCap, LibraryBig, Menu,
  Moon, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings, Sun, Target, Trash2,
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
import { addDays, allDeadlines, calculateGpa, calculateGradePoint, dateInZone, effectiveNextAction, filterTasks, isStalled, priorityCandidates, progressFor, searchDatabase, statusLabels, taskPlanBucket, topPriorities, weekStart, type TaskFilters } from "@/lib/domain";
import type {
  AnyEntity, CollectionKey, Competition, Database, EntityKind, EntityRef, EveningReview,
  Goal, Grade, LearningCourse, LearningModule, Milestone, MilestoneRef, Paper, PersonalProject,
  ParentEntityRef, ResearchProject, ReviewSubmission, Settings as AppSettings, Status, Task,
} from "@/lib/types";

type ViewKey = "dashboard" | "tonight" | "learning" | "research" | "papers" | "projects" | "competitions" | "goals" | "gpa" | "archive" | "settings";
type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;
type FieldType = "text" | "textarea" | "date" | "number" | "select" | "list" | "checkbox" | "relation" | "relationMulti" | "relationRefs" | "milestoneRefs" | "modules" | "milestones" | "resources" | "meetings";
type FieldDef = { key: string; label: string; type?: FieldType; wide?: boolean; options?: [string, string][]; help?: string; relationType?: EntityKind };

const nav: { key: ViewKey; label: string; icon: typeof CircleGauge; section?: string }[] = [
  { key: "dashboard", label: "总览", icon: CircleGauge, section: "现在" },
  { key: "tonight", label: "今晚更新", icon: ClipboardCheck },
  { key: "learning", label: "自主学习", icon: BookOpen, section: "工作区" },
  { key: "research", label: "科研", icon: FlaskConical },
  { key: "papers", label: "论文", icon: LibraryBig },
  { key: "projects", label: "项目", icon: FolderGit2 },
  { key: "competitions", label: "竞赛", icon: Trophy },
  { key: "goals", label: "长期目标", icon: Target },
  { key: "gpa", label: "成绩 / GPA", icon: GraduationCap },
  { key: "archive", label: "归档", icon: Archive, section: "系统" },
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
    { key: "credits", label: "学分", type: "number" }, { key: "score", label: "成绩", type: "number" },
    { key: "courseType", label: "课程类型" }, { key: "isCore", label: "核心课程", type: "checkbox" },
    { key: "tags", label: "标签", type: "list", wide: true },
  ],
};

const pageMeta: Record<ViewKey, [string, string, string]> = {
  dashboard: ["总览", "今天最值得推进什么", "把注意力放在少数真正重要的下一步。"],
  tonight: ["晚间复盘", "今晚更新", "用 3–5 分钟让计划重新贴合现实。"],
  learning: ["学习", "自主学习", "按课程、模块与知识点管理知识进展。"],
  research: ["研究", "科研", "从研究问题到投稿，保留每一步上下文。"],
  papers: ["论文库", "论文阅读", "记录理解、贡献、局限，以及它对研究的实际作用。"],
  projects: ["项目", "非科研项目", "只管理个人开发与参考项目；科研代码留在科研模块。"],
  competitions: ["竞赛", "竞赛", "只参加值得投入的竞赛，并跟踪准备与结果。"],
  goals: ["发展方向", "长期目标", "用里程碑和下一步行动连接多年目标与本周工作。"],
  gpa: ["学业记录", "成绩 / GPA", "按可配置规则计算学期与累计 GPA。"],
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
const emptyDatabase: Database = { tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], progressEvents: [], settings: { schemaVersion: 2, demoData: false, timeZone: "Asia/Shanghai", stalledDays: 7, gpa: { scale: 4, rules: [] } } };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function entityTitle(collection: EditableCollection, entity: AnyEntity) {
  if (collection === "tasks" || collection === "papers" || collection === "goals") return (entity as Task | Paper | Goal).title;
  if (collection === "grades") return (entity as Grade).course;
  return (entity as LearningCourse | ResearchProject | PersonalProject | Competition).name;
}

function defaultEntity(collection: EditableCollection): Record<string, unknown> {
  const base = { tags: [], archived: false };
  const map: Record<EditableCollection, Record<string, unknown>> = {
    tasks: { ...base, title: "", category: "学习", priority: "medium", status: "not_started", dueDate: "", nextAction: "", primaryParent: undefined, relatedRefs: [], milestoneRefs: [], planningState: "inbox", plannedWeek: "", notes: "", pinned: false, pinOrder: 5 },
    learning: { ...base, name: "", field: "", status: "not_started", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "", notes: "", modules: [] },
    research: { ...base, name: "", advisor: "", collaborators: [], startDate: today(), status: "not_started", expectedCompletion: "", stage: "Idea", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] },
    papers: { ...base, title: "", authors: [], year: new Date().getFullYear(), venue: "", doiUrl: "", researchArea: "", keywords: [], status: "to_read", importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" } },
    projects: { ...base, name: "", type: "my_project", techStack: [], description: "", github: "", demo: "", status: "not_started", progress: "", nextAction: "", learnings: "" },
    competitions: { ...base, name: "", level: "", date: "", teammates: [], advisor: "", status: "not_started", deadline: "", preparationStage: "", currentTask: "", finalResult: "", award: "", cvImportance: "medium", materials: [], projectIds: [] },
    goals: { ...base, title: "", type: "semester", timeframe: "", status: "not_started", description: "", milestones: [], linkedItems: [], nextAction: "" },
    grades: { ...base, semester: "", course: "", credits: 3, score: 0, courseType: "", isCore: false },
  };
  return map[collection];
}

export function ResearchOS() {
  const [db, setDb] = useState<Database>(emptyDatabase);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ collection: EditableCollection; entity?: AnyEntity } | null>(null);
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const { theme, setTheme } = useTheme();

  const refresh = useCallback(async () => {
    try { setDb(await api<Database>("/api/data")); }
    catch (error) { toast.error(`读取数据失败：${(error as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void api<Database>("/api/data").then((data) => { if (active) { setDb(data); setLoading(false); } }).catch((error) => { if (active) { toast.error(`读取数据失败：${(error as Error).message}`); setLoading(false); } });
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
  useWebMcp(db, refresh);

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
        <div className="sidebar-footer">本地优先 · 数据保存在 Git 可追踪的 JSON 文件中</div>
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
          {view === "dashboard" && <Dashboard db={db} edit={(collection, entity) => setEditor({ collection, entity })} updateTask={updateTask} addTask={() => setEditor({ collection: "tasks" })} progressTask={setProgressTask} go={go} />}
          {view === "tonight" && <TonightReview db={db} refresh={refresh} go={go} />}
          {viewCollection[view] && <EntityPage collection={viewCollection[view]!} db={db} edit={(entity) => setEditor({ collection: viewCollection[view]!, entity })} archive={(id) => archiveEntity(viewCollection[view]!, id)} />}
          {view === "gpa" && <GpaPage db={db} edit={(entity) => setEditor({ collection: "grades", entity })} archive={(id) => archiveEntity("grades", id)} />}
          {view === "archive" && <ArchivePage db={db} restore={async (collection, entity) => save(collection, { id: entity.id, archived: false })} remove={archiveEntity} />}
          {view === "settings" && <SettingsPage db={db} setDb={setDb} />}
        </main>
      </div>
      <EntityEditor key={`${editor?.collection ?? "closed"}-${editor?.entity?.id ?? "new"}`} open={Boolean(editor)} collection={editor?.collection ?? "tasks"} entity={editor?.entity} db={db} onClose={() => setEditor(null)} onSave={save} />
      <ProgressDialog key={progressTask?.id ?? "progress-closed"} task={progressTask} onClose={() => setProgressTask(null)} onSaved={refresh} />
    </div>
  );
}

function PageEmpty({ children }: { children: React.ReactNode }) { return <div className="empty"><MoreHorizontal />{children}</div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`badge ${status}`}>{statusLabels[status] ?? status}</span>; }
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
    if (field.type === "number") draft[field.key] = Number(draft[field.key]) || 0;
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
  paperTitle: string; paperUrl: string; deadlineTitle: string; deadlineDate: string; deadlineParent?: ParentEntityRef;
  inboxPlans: ReviewSubmission["inboxPlans"];
};
function newReviewDraft(date: string, review?: EveningReview, db?: Database): ReviewDraftState {
  const paper = review?.newPaperId ? db?.papers.find((item) => item.id === review.newPaperId) : undefined;
  const deadline = review?.newDeadlineTaskId ? db?.tasks.find((item) => item.id === review.newDeadlineTaskId) : undefined;
  return { operationId: crypto.randomUUID(), expectedRevision: review?.revision ?? 0, completeTaskIds: [], undoTaskIds: [], progressUpdates: [], unfinishedNote: review?.unfinishedNote ?? "", researchProjectId: review?.researchProjectId ?? "", researchProgress: review?.researchProgress ?? "", paperTitle: paper?.title ?? "", paperUrl: paper?.doiUrl ?? "", deadlineTitle: deadline?.title ?? "", deadlineDate: deadline?.dueDate ?? "", deadlineParent: deadline?.primaryParent, inboxPlans: [], priorityTaskIds: review?.priorityTaskIds ?? [], reflection: review?.reflection ?? "" };
}

function TonightReview({ db, refresh, go }: { db: Database; refresh: () => Promise<void>; go: (view: ViewKey) => void }) {
  const reviewDate = today(db.settings.timeZone);
  const existing = db.reviews.find((item) => item.date === reviewDate);
  const [draft, setDraft] = useState<ReviewDraftState>(() => newReviewDraft(reviewDate, existing, db));
  const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false);
  const activeTasks = db.tasks.filter((task) => !task.archived && task.status !== "completed");
  const schedulableTasks = activeTasks.filter((task) => task.planningState === "inbox" || task.planningState === "needs_parent");
  const priorityOptions = db.tasks.filter((task) => !task.archived && task.status !== "completed" && task.planningState === "week" && Boolean(task.primaryParent));
  const revisionConflict = draft.expectedRevision !== (existing?.revision ?? 0);
  const patch = (changes: Partial<ReviewDraftState>) => setDraft((current) => ({ ...current, ...changes, operationId: crypto.randomUUID() }));
  useEffect(() => {
    let active = true;
    const key = `research-os-review-${reviewDate}`;
    queueMicrotask(() => {
      if (!active) return;
      let next = newReviewDraft(reviewDate, existing, db);
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const parsed = JSON.parse(saved) as ReviewDraftState;
          if (typeof parsed.operationId === "string" && Number.isInteger(parsed.expectedRevision)) next = parsed;
        }
      } catch { /* corrupted local draft is ignored; server data remains untouched */ }
      setDraft(next); setReady(true);
    });
    return () => { active = false; };
  }, [reviewDate, existing, db]);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(`research-os-review-${reviewDate}`, JSON.stringify(draft));
  }, [draft, ready, reviewDate]);
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
      localStorage.removeItem(`research-os-review-${reviewDate}`);
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
    <div className="review-intro"><div><div className="eyebrow">{reviewDate}</div><h2>{existing ? `今晚更新 · 第 ${existing.revision + 1} 次修订` : "今晚更新"}</h2><p>集中记录实际推进、分流新任务，并确认下一阶段重点。草稿保存在当前浏览器，提交后才写入正式数据。</p>{draft.expectedRevision !== (existing?.revision ?? 0) && <div className="review-conflict"><span>这份复盘已在其他窗口更新。当前草稿仍保留；重新加载将丢弃旧草稿。</span><Button size="sm" variant="outline" onClick={() => { setDraft(newReviewDraft(reviewDate, existing, db)); setReady(true); }}>重新加载复盘</Button></div>}</div><Button variant="outline" onClick={() => go("dashboard")}>返回总览</Button></div>
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
  const grades = db.grades.filter((grade) => !grade.archived); const total = calculateGpa(grades, db.settings.gpa.rules); const semesters = [...new Set(grades.map((grade) => grade.semester))];
  return <><div className="grid gpa-summary"><div className="stat-card"><span>累计 GPA / {db.settings.gpa.scale.toFixed(1)}</span><strong>{total.gpa.toFixed(2)}</strong></div><div className="stat-card"><span>累计学分</span><strong>{total.credits.toFixed(1)}</strong></div><div className="stat-card"><span>已记录课程</span><strong>{grades.length}</strong></div></div>{semesters.map((semester) => { const semesterGrades = grades.filter((grade) => grade.semester === semester); const summary = calculateGpa(semesterGrades, db.settings.gpa.rules); return <section className="panel mb-4" key={semester}><div className="panel-head"><h2 className="panel-title">{semester}</h2><span className="panel-meta">GPA {summary.gpa.toFixed(2)} · {summary.credits} 学分</span></div><div className="table-wrap border-0 rounded-none"><table className="data-table"><thead><tr><th>课程</th><th>类型</th><th>学分</th><th>成绩</th><th>绩点</th><th>核心</th><th /></tr></thead><tbody>{semesterGrades.map((grade) => <tr key={grade.id}><td><strong>{grade.course}</strong></td><td>{grade.courseType}</td><td>{grade.credits}</td><td>{grade.score}</td><td>{calculateGradePoint(grade.score, db.settings.gpa.rules).toFixed(1)}</td><td>{grade.isCore ? "是" : "—"}</td><td><div className="flex gap-1"><Button variant="ghost" size="icon-sm" onClick={() => edit(grade)}><Pencil /></Button><Button variant="ghost" size="icon-sm" onClick={() => archive(grade.id)}><Archive /></Button></div></td></tr>)}</tbody></table></div></section>; })}{!grades.length && <PageEmpty>还没有成绩记录。</PageEmpty>}</>;
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
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">GPA 计算规则</h2><span className="panel-meta">从高分到低分匹配第一个规则</span></div><Button disabled={saving} onClick={() => void saveRules()}>保存规则</Button></div><div className="panel-body"><textarea className="field-textarea code-area" spellCheck={false} value={rules} onChange={(event) => setRules(event.target.value)} /><p className="form-help">修改 scale（满绩点）、minScore（最低分）、point（绩点）和 label（等级）。</p></div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">本地数据与恢复</h2></div><div className="panel-body"><p className="text-sm leading-6">正式数据保存在 <code>data/</code> 的 JSON 文件中。成功提交晚间复盘会创建本机快照；GitHub 私有仓库用于跨设备同步。未提交草稿仅保存在当前浏览器。</p><p className="form-help">不要直接删除 JSON 文件。误操作可从“归档”恢复，或从 Git 历史和 data/.backups 快照还原。</p></div></section>
    </div>
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2 className="panel-title">外观与推进提醒</h2></div><div className="panel-body stack"><div><label className="form-label">主题</label><select className="field-select" value={theme ?? "system"} onChange={(event) => setTheme(event.target.value)}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></div><div><label className="form-label">日期时区</label><input className="field-input" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></div><div><label className="form-label">停滞提醒天数</label><input className="field-input" type="number" min={1} max={365} value={stalledDays} onChange={(event) => setStalledDays(Number(event.target.value))} /></div><Button disabled={saving} variant="outline" onClick={() => void saveSettings({ ...db.settings, timeZone, stalledDays })}>保存提醒设置</Button></div></section>
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">选择记录并归档</h2><span className="panel-meta">可恢复，不会清空全库</span></div></div><div className="panel-body stack"><p className="form-help">旧数据可能已被你编辑，因此不会自动猜测哪些是示例。先选择模块，再勾选你确认要归档的记录。</p><select className="field-select" value={archiveCollection} onChange={(event) => { setArchiveCollection(event.target.value as EditableCollection); setArchiveIds([]); }}>{collections.map((item) => <option key={item} value={item}>{collectionLabel(item)}</option>)}</select><div className="choice-list">{candidates.map((item) => <label className="choice" key={item.id}><input type="checkbox" checked={archiveIds.includes(item.id)} onChange={() => setArchiveIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span>{entityTitle(archiveCollection, item)}</span></label>)}{!candidates.length && <div className="row-subtitle">这个模块没有活动记录。</div>}</div><ConfirmButton title={`归档选中的 ${archiveIds.length} 条记录？`} description="归档会保留记录并创建操作前快照；有关联未完成任务的对象需要先处理任务。你可以在归档页恢复。" action={`归档 ${archiveIds.length} 条`} onConfirm={() => void archiveSelected()} /></div></section>
    </div>
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

function useWebMcp(db: Database, refresh: () => Promise<void>) {
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
    register({
      name: "create_research_os_task", title: "创建 Research OS 任务", description: "创建一条本周任务，并保存到 Research OS 本地数据。",
      inputSchema: { type: "object", properties: { title: { type: "string", minLength: 1 }, dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, priority: { type: "string", enum: ["high", "medium", "low"] }, notes: { type: "string" } }, required: ["title"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) { const value = input as { title?: unknown; dueDate?: unknown; priority?: unknown; notes?: unknown }; if (typeof value.title !== "string" || !value.title.trim()) throw new Error("title must be a non-empty string"); const entity = await api<Task>("/api/entities", { method: "POST", body: JSON.stringify({ collection: "tasks", entity: { ...defaultEntity("tasks"), title: value.title.trim(), dueDate: typeof value.dueDate === "string" ? value.dueDate : "", priority: ["high", "medium", "low"].includes(String(value.priority)) ? value.priority : "medium", notes: typeof value.notes === "string" ? value.notes : "" } }) }); await refresh(); return { id: entity.id, title: entity.title, status: entity.status }; },
    });
    register({
      name: "complete_research_os_task", title: "完成 Research OS 任务", description: "将已有任务标记为已完成，并更新总览。",
      inputSchema: { type: "object", properties: { taskId: { type: "string", minLength: 1 } }, required: ["taskId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) { const taskId = (input as { taskId?: unknown })?.taskId; if (typeof taskId !== "string") throw new Error("taskId must be a string"); const task = db.tasks.find((item) => item.id === taskId && !item.archived); if (!task) throw new Error("task not found"); await api("/api/progress", { method: "POST", body: JSON.stringify({ taskId: task.id, note: "通过本地助手标记为完成", complete: true }) }); await refresh(); return { id: task.id, status: "completed" }; },
    });
    return () => lifecycle.abort();
  }, [db, refresh]);
}
