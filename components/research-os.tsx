"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Archive, ArrowDown, ArrowUp, BookOpen, Check, ChevronLeft, ChevronRight,
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
import { calculateGpa, calculateGradePoint, searchDatabase, sortDeadlines, statusLabels, topPriorities } from "@/lib/domain";
import type {
  AnyEntity, CollectionKey, Competition, Database, EntityKind, EntityRef, EveningReview,
  Goal, Grade, LearningCourse, LearningModule, Milestone, Paper, PersonalProject,
  ResearchProject, Settings as AppSettings, Status, Task,
} from "@/lib/types";

type ViewKey = "dashboard" | "tonight" | "learning" | "research" | "papers" | "projects" | "competitions" | "goals" | "gpa" | "archive" | "settings";
type EditableCollection = Exclude<CollectionKey, "reviews">;
type FieldType = "text" | "textarea" | "date" | "number" | "select" | "list" | "checkbox" | "relation" | "relationMulti" | "modules" | "milestones" | "resources" | "meetings";
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
    { key: "weekBucket", label: "周计划", type: "select", options: [["this_week", "本周"], ["next_week", "下周"], ["later", "以后"]] },
    { key: "dueDate", label: "截止日期", type: "date" },
    { key: "relation", label: "关联对象", type: "relation", wide: true },
    { key: "notes", label: "简短备注", type: "textarea", wide: true },
    { key: "tags", label: "标签", type: "list", wide: true, help: "用逗号分隔" },
    { key: "pinned", label: "显示在 Top Priorities", type: "checkbox" },
    { key: "pinOrder", label: "置顶顺序", type: "number" },
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
    { key: "linkedItems", label: "关联对象", type: "relation", wide: true, help: "目标目前支持一个主关联；更多关系可在后续编辑中扩展" },
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

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const emptyDatabase: Database = { tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [], settings: { schemaVersion: 1, demoData: false, gpa: { scale: 4, rules: [] } } };

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
    tasks: { ...base, title: "", category: "学习", priority: "medium", status: "not_started", dueDate: "", notes: "", weekBucket: "this_week", pinned: false, pinOrder: 5 },
    learning: { ...base, name: "", field: "", status: "not_started", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "", notes: "", modules: [] },
    research: { ...base, name: "", advisor: "", collaborators: [], startDate: today(), status: "not_started", expectedCompletion: "", stage: "Idea", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] },
    papers: { ...base, title: "", authors: [], year: new Date().getFullYear(), venue: "", doiUrl: "", researchArea: "", status: "to_read", importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" } },
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
    await api("/api/entities", { method: "PUT", body: JSON.stringify({ collection: "tasks", entity: { id: task.id, ...patch } }) });
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
          {view === "dashboard" && <Dashboard db={db} edit={(collection, entity) => setEditor({ collection, entity })} updateTask={updateTask} addTask={() => setEditor({ collection: "tasks" })} go={go} />}
          {view === "tonight" && <TonightReview db={db} refresh={refresh} go={go} />}
          {viewCollection[view] && <EntityPage collection={viewCollection[view]!} db={db} edit={(entity) => setEditor({ collection: viewCollection[view]!, entity })} archive={(id) => archiveEntity(viewCollection[view]!, id)} />}
          {view === "gpa" && <GpaPage db={db} edit={(entity) => setEditor({ collection: "grades", entity })} archive={(id) => archiveEntity("grades", id)} />}
          {view === "archive" && <ArchivePage db={db} restore={async (collection, entity) => save(collection, { id: entity.id, archived: false })} remove={archiveEntity} />}
          {view === "settings" && <SettingsPage db={db} setDb={setDb} />}
        </main>
      </div>
      <EntityEditor key={`${editor?.collection ?? "closed"}-${editor?.entity?.id ?? "new"}`} open={Boolean(editor)} collection={editor?.collection ?? "tasks"} entity={editor?.entity} db={db} onClose={() => setEditor(null)} onSave={save} />
    </div>
  );
}

function PageEmpty({ children }: { children: React.ReactNode }) { return <div className="empty"><MoreHorizontal />{children}</div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`badge ${status}`}>{statusLabels[status] ?? status}</span>; }
function relationLabel(db: Database, ref?: EntityRef) {
  if (!ref) return "—";
  if (ref.label) return ref.label;
  const map: Record<EntityKind, EditableCollection> = { task: "tasks", learning: "learning", research: "research", paper: "papers", project: "projects", competition: "competitions", goal: "goals", grade: "grades" };
  const collection = map[ref.type]; const item = db[collection].find((entity) => entity.id === ref.id);
  return item ? entityTitle(collection, item) : ref.id;
}

function Dashboard({ db, edit, updateTask, addTask, go }: { db: Database; edit: (collection: EditableCollection, entity: AnyEntity) => void; updateTask: (task: Task, patch: Partial<Task>) => Promise<void>; addTask: () => void; go: (view: ViewKey) => void }) {
  const [weekTab, setWeekTab] = useState<"this_week" | "next_week" | "completed">("this_week");
  const priorities = topPriorities(db.tasks);
  const weekTasks = db.tasks.filter((task) => !task.archived && (weekTab === "completed" ? task.status === "completed" : task.weekBucket === weekTab && task.status !== "completed"));
  const deadlines = buildDeadlines(db);
  const now = new Date(today()); const seven = new Date(now); seven.setDate(now.getDate() + 7); const thirty = new Date(now); thirty.setDate(now.getDate() + 30);
  const inRange = (end: Date, after = now) => deadlines.filter((item) => new Date(item.date) >= after && new Date(item.date) <= end);
  const reorder = async (index: number, direction: -1 | 1) => {
    const other = priorities[index + direction]; if (!other) return;
    await Promise.all([api("/api/entities", { method: "PUT", body: JSON.stringify({ collection: "tasks", entity: { id: priorities[index].id, pinOrder: other.pinOrder } }) }), api("/api/entities", { method: "PUT", body: JSON.stringify({ collection: "tasks", entity: { id: other.id, pinOrder: priorities[index].pinOrder } }) })]);
    await updateTask(priorities[index], {});
  };
  const activeResearch = db.research.filter((item) => !item.archived && item.status !== "completed");
  const activeGoals = db.goals.filter((item) => !item.archived && item.status !== "completed").slice(0, 4);
  return <div className="grid dashboard-grid">
    <div className="stack">
      <section className="panel"><div className="panel-head"><div><h2 className="panel-title">当前最重要的事</h2><span className="panel-meta">最多 5 项 · 可手工排序</span></div><Button variant="ghost" size="sm" onClick={addTask}><Plus />添加</Button></div><div className="panel-body">{priorities.length ? <ol className="priority-list">{priorities.map((task, index) => <li className="priority-row" key={task.id}><span className="rank">0{index + 1}</span><div><div className="row-title">{task.title}</div><div className="row-subtitle">{task.category}{task.dueDate ? ` · ${task.dueDate}` : ""}</div></div><div className="row-actions"><button className="icon-button" aria-label="上移" disabled={index === 0} onClick={() => void reorder(index, -1)}><ArrowUp /></button><button className="icon-button" aria-label="下移" disabled={index === priorities.length - 1} onClick={() => void reorder(index, 1)}><ArrowDown /></button><button className="icon-button" aria-label="完成" onClick={() => void updateTask(task, { status: "completed", completedAt: nowIso(), pinned: false })}><Check /></button><button className="icon-button" aria-label="编辑" onClick={() => edit("tasks", task)}><Pencil /></button></div></li>)}</ol> : <PageEmpty>还没有置顶任务。把本周真正重要的 3–5 件事放在这里。</PageEmpty>}</div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">本周任务</h2><div className="week-tabs">{([["this_week", "本周"], ["next_week", "下周"], ["completed", "已完成"]] as const).map(([key, label]) => <button className={`tab ${weekTab === key ? "active" : ""}`} onClick={() => setWeekTab(key)} key={key}>{label}</button>)}</div></div><div className="panel-body">{weekTasks.length ? weekTasks.map((task) => <div className="task-line" key={task.id}><button className="check" aria-label="完成任务" onClick={() => void updateTask(task, { status: "completed", completedAt: nowIso(), pinned: false })} /> <div className="task-copy" onClick={() => edit("tasks", task)} role="button"><strong>{task.title}</strong><div className="task-meta"><StatusBadge status={task.status} /><span>{task.category}</span>{task.dueDate && <span>截止 {task.dueDate}</span>}{task.relation && <span>↗ {relationLabel(db, task.relation)}</span>}</div></div></div>) : <PageEmpty>这个视图暂时没有任务。</PageEmpty>}</div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">长期目标进度</h2><Button variant="ghost" size="sm" onClick={() => go("goals")}>查看全部</Button></div><div className="panel-body">{activeGoals.length ? activeGoals.map((goal) => { const done = goal.milestones.filter((m) => m.status === "completed").length; const percent = goal.milestones.length ? Math.round(done / goal.milestones.length * 100) : 0; return <div className="goal-card" key={goal.id}><div className="goal-top"><strong>{goal.title}</strong><span className="panel-meta">{percent}% · {goal.timeframe}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div><div className="row-subtitle">下一步：{goal.nextAction || "尚未设置"}</div></div>; }) : <PageEmpty>还没有活跃目标。</PageEmpty>}</div></section>
    </div>
    <div className="stack">
      <section className="panel"><div className="panel-head"><h2 className="panel-title">科研状态</h2><Button variant="ghost" size="sm" onClick={() => go("research")}>科研工作区</Button></div><div className="panel-body">{activeResearch.length ? activeResearch.map((research) => <div className="research-card" key={research.id}><div className="card-top"><h4>{research.name}</h4><StatusBadge status={research.status} /></div><dl><dt>阶段</dt><dd>{research.stage}</dd><dt>最近进展</dt><dd>{research.recentProgress || "—"}</dd><dt>下一步</dt><dd>{research.nextAction || "—"}</dd><dt>截止日期</dt><dd>{research.deadline || "—"}</dd><dt>阻塞</dt><dd>{research.blockers || "无"}</dd></dl></div>) : <PageEmpty>暂无进行中的科研项目。</PageEmpty>}</div></section>
      <section className="panel"><div className="panel-head"><h2 className="panel-title">即将到来的截止日期</h2><span className="panel-meta">跨模块统一排序</span></div><div className="panel-body"><DeadlineGroup title="未来 7 天" items={inRange(seven)} /> <DeadlineGroup title="未来 30 天" items={inRange(thirty, new Date(seven.getTime() + 86400000))} /></div></section>
    </div>
  </div>;
}

type DeadlineItem = { date: string; title: string; type: string };
function buildDeadlines(db: Database): DeadlineItem[] {
  const items: DeadlineItem[] = sortDeadlines(db.tasks).map((task) => ({ date: task.dueDate!, title: task.title, type: task.category }));
  db.research.filter((item) => !item.archived && item.deadline && item.status !== "completed").forEach((item) => items.push({ date: item.deadline!, title: item.name, type: "科研" }));
  db.competitions.filter((item) => !item.archived && item.deadline && item.status !== "completed").forEach((item) => items.push({ date: item.deadline!, title: item.name, type: "竞赛" }));
  db.goals.filter((item) => !item.archived).forEach((goal) => goal.milestones.filter((m) => m.targetDate && m.status !== "completed").forEach((m) => items.push({ date: m.targetDate!, title: `${goal.title} · ${m.title}`, type: "目标" })));
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
function DeadlineGroup({ title, items }: { title: string; items: DeadlineItem[] }) { return <div className="deadline-group"><h4>{title}</h4>{items.length ? items.map((item, index) => <div className="deadline-row" key={`${item.date}-${item.title}-${index}`}><span className="deadline-date">{item.date.slice(5)}</span><strong>{item.title}<span className="row-subtitle"> · {item.type}</span></strong></div>) : <div className="row-subtitle">没有截止日期</div>}</div>; }

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
    case "tasks": { const item = entity as Task; return { summary: item.notes, meta: [["分类", item.category], ["截止", item.dueDate], ["优先级", item.priority], ["本周", item.weekBucket]] }; }
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
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}><DialogContent className="sm:max-w-3xl max-w-[calc(100%-1rem)]"><DialogHeader><DialogTitle>{entity ? "编辑" : "新增"}{collectionLabel(collection)}</DialogTitle><DialogDescription>保存后会立即写入本地 JSON 数据文件。</DialogDescription></DialogHeader><div className="dialog-form">{fields[collection].map((field) => <EditorField key={field.key} field={field} value={draft[field.key]} update={(value) => update(field.key, value)} db={db} />)}</div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={saving} onClick={() => void submit()}>{saving && <RefreshCw className="animate-spin" />}{saving ? "保存中" : "保存"}</Button></DialogFooter></DialogContent></Dialog>;
}

function collectionLabel(collection: EditableCollection) { return ({ tasks: "任务", learning: "课程", research: "科研项目", papers: "论文", projects: "项目", competitions: "竞赛", goals: "目标", grades: "成绩" } as const)[collection]; }
function prepareDraft(collection: EditableCollection, entity?: AnyEntity): Record<string, unknown> {
  const source = structuredClone(entity ?? defaultEntity(collection)) as unknown as Record<string, unknown>;
  for (const field of fields[collection]) if (field.type === "list" && Array.isArray(source[field.key])) source[field.key] = (source[field.key] as unknown[]).join(", ");
  if (collection === "goals") source.linkedItems = (source.linkedItems as EntityRef[] | undefined)?.[0];
  return source;
}
function serializeDraft(collection: EditableCollection, source: Record<string, unknown>) {
  const draft = structuredClone(source);
  for (const field of fields[collection]) {
    if (field.type === "list") draft[field.key] = String(draft[field.key] ?? "").split(/[,，\n]/).map((value) => value.trim()).filter(Boolean);
    if (field.type === "number") draft[field.key] = Number(draft[field.key]) || 0;
  }
  if (collection === "goals") draft.linkedItems = draft.linkedItems ? [draft.linkedItems] : [];
  if (collection === "papers") draft.source = (source.source as object | undefined) ?? { provider: "manual" };
  return draft;
}

function EditorField({ field, value, update, db }: { field: FieldDef; value: unknown; update: (value: unknown) => void; db: Database }) {
  const id = `field-${field.key}`;
  let control: React.ReactNode;
  if (field.type === "textarea") control = <textarea id={id} className="field-textarea" value={String(value ?? "")} onChange={(event) => update(event.target.value)} />;
  else if (field.type === "select") control = <select id={id} className="field-select" value={String(value ?? "")} onChange={(event) => update(event.target.value)}>{field.options?.map(([option, label]) => <option value={option} key={option}>{label}</option>)}</select>;
  else if (field.type === "checkbox") control = <label className="toggle-line"><input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => update(event.target.checked)} /><span>{Boolean(value) ? "是" : "否"}</span></label>;
  else if (field.type === "relation") control = <RelationPicker value={value as EntityRef | undefined} update={update} db={db} />;
  else if (field.type === "relationMulti") control = <RelationMulti value={(value as string[]) ?? []} update={update} db={db} type={field.relationType!} />;
  else if (field.type === "modules") control = <ModulesEditor value={(value as LearningModule[]) ?? []} update={update} />;
  else if (field.type === "milestones") control = <MilestonesEditor value={(value as Milestone[]) ?? []} update={update} />;
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
function RelationPicker({ value, update, db }: { value?: EntityRef; update: (value?: EntityRef) => void; db: Database }) {
  const selected = value ? `${value.type}:${value.id}` : "";
  return <select className="field-select" value={selected} onChange={(event) => { const [type, id] = event.target.value.split(":"); if (!id) update(undefined); else { const item = entityMap.find((entry) => entry.type === type)!; const entity = (db[item.collection] as AnyEntity[]).find((candidate) => candidate.id === id)!; update({ type: type as EntityKind, id, label: entityTitle(item.collection, entity) }); } }}><option value="">不关联</option>{entityMap.map((item) => <optgroup label={item.label} key={item.type}>{(db[item.collection] as AnyEntity[]).filter((entity) => !entity.archived).map((entity) => <option key={entity.id} value={`${item.type}:${entity.id}`}>{entityTitle(item.collection, entity)}</option>)}</optgroup>)}</select>;
}
function RelationMulti({ value, update, db, type }: { value: string[]; update: (value: string[]) => void; db: Database; type: EntityKind }) {
  const entry = entityMap.find((item) => item.type === type)!; const items = (db[entry.collection] as AnyEntity[]).filter((entity) => !entity.archived);
  return <div className="choice-list">{items.length ? items.map((entity) => <label className="choice" key={entity.id}><input type="checkbox" checked={value.includes(entity.id)} onChange={(event) => update(event.target.checked ? [...value, entity.id] : value.filter((id) => id !== entity.id))} />{entityTitle(entry.collection, entity)}</label>) : <div className="row-subtitle">当前没有可关联的{entry.label}。</div>}</div>;
}
function ModulesEditor({ value, update }: { value: LearningModule[]; update: (value: LearningModule[]) => void }) {
  const patch = (index: number, next: Partial<LearningModule>) => update(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  return <div className="stack">{value.map((module, index) => <div className="panel-body rounded-lg border" key={module.id}><div className="flex gap-2"><input className="field-input" value={module.title} placeholder="模块名称" onChange={(event) => patch(index, { title: event.target.value })} /><select className="field-select max-w-36" value={module.status} onChange={(event) => patch(index, { status: event.target.value as Status })}>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><Button variant="ghost" size="icon-sm" onClick={() => update(value.filter((_, itemIndex) => itemIndex !== index))}><X /></Button></div><div className="mt-2"><label className="form-label">知识点（逗号分隔）</label><input className="field-input" value={module.topics.map((topic) => topic.title).join(", ")} onChange={(event) => patch(index, { topics: event.target.value.split(/[,，]/).map((title, topicIndex) => ({ id: module.topics[topicIndex]?.id ?? `topic_${Date.now()}_${topicIndex}`, title: title.trim(), status: module.topics[topicIndex]?.status ?? "not_started" as Status })).filter((topic) => topic.title) })} /></div></div>)}<Button variant="outline" size="sm" onClick={() => update([...value, { id: `module_${Date.now()}`, title: "", status: "not_started", topics: [] }])}><Plus />添加模块</Button></div>;
}
function MilestonesEditor({ value, update }: { value: Milestone[]; update: (value: Milestone[]) => void }) {
  const patch = (index: number, next: Partial<Milestone>) => update(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item));
  return <div className="stack">{value.map((milestone, index) => <div className="flex flex-wrap gap-2" key={milestone.id}><input className="field-input flex-1 min-w-48" value={milestone.title} placeholder="里程碑" onChange={(event) => patch(index, { title: event.target.value })} /><select className="field-select w-32" value={milestone.status} onChange={(event) => patch(index, { status: event.target.value as Status })}>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><input type="date" className="field-input w-38" value={milestone.targetDate ?? ""} onChange={(event) => patch(index, { targetDate: event.target.value })} /><Button variant="ghost" size="icon-sm" onClick={() => update(value.filter((_, itemIndex) => itemIndex !== index))}><X /></Button></div>)}<Button variant="outline" size="sm" onClick={() => update([...value, { id: `milestone_${Date.now()}`, title: "", status: "not_started" }])}><Plus />添加里程碑</Button></div>;
}
function formatResources(value: unknown) { return ((value as ResearchProject["resources"] | undefined) ?? []).map((item) => `${item.label} | ${item.url} | ${item.kind}`).join("\n"); }
function parseResources(value: string) { return value.split("\n").filter(Boolean).map((line) => { const [label = "", url = "", kind = "other"] = line.split("|").map((item) => item.trim()); return { label, url, kind }; }); }
function formatMeetings(value: unknown) { return ((value as ResearchProject["meetings"] | undefined) ?? []).map((item) => `${item.date} | ${item.title} | ${item.notes}`).join("\n"); }
function parseMeetings(value: string) { return value.split("\n").filter(Boolean).map((line, index) => { const [date = "", title = "", notes = ""] = line.split("|").map((item) => item.trim()); return { id: `meeting_${Date.now()}_${index}`, date, title, notes, nextActions: [] }; }); }

function TonightReview({ db, refresh, go }: { db: Database; refresh: () => Promise<void>; go: (view: ViewKey) => void }) {
  const [step, setStep] = useState(0); const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]); const [unfinishedNote, setUnfinishedNote] = useState("");
  const [researchId, setResearchId] = useState(""); const [researchProgress, setResearchProgress] = useState("");
  const [paperTitle, setPaperTitle] = useState(""); const [paperUrl, setPaperUrl] = useState("");
  const [deadlineTitle, setDeadlineTitle] = useState(""); const [deadlineDate, setDeadlineDate] = useState("");
  const [priorities, setPriorities] = useState<string[]>(topPriorities(db.tasks).map((task) => task.id)); const [reflection, setReflection] = useState("");
  const activeTasks = db.tasks.filter((task) => !task.archived && task.status !== "completed");
  const rawUpsert = (collection: CollectionKey, entity: Record<string, unknown>, method: "POST" | "PUT" = "POST") => api<AnyEntity>("/api/entities", { method, body: JSON.stringify({ collection, entity }) });
  const finish = async () => {
    setSaving(true);
    try {
      await Promise.all(completed.map((id) => rawUpsert("tasks", { id, status: "completed", completedAt: nowIso(), pinned: false }, "PUT")));
      if (researchId && researchProgress.trim()) await rawUpsert("research", { id: researchId, recentProgress: researchProgress.trim(), updatedAt: nowIso() }, "PUT");
      let newPaperId: string | undefined; if (paperTitle.trim()) { const created = await rawUpsert("papers", { ...defaultEntity("papers"), title: paperTitle.trim(), doiUrl: paperUrl.trim() }); newPaperId = created.id; }
      let newDeadlineTaskId: string | undefined; if (deadlineTitle.trim() && deadlineDate) { const created = await rawUpsert("tasks", { ...defaultEntity("tasks"), title: deadlineTitle.trim(), dueDate: deadlineDate, priority: "high" }); newDeadlineTaskId = created.id; }
      await Promise.all(db.tasks.filter((task) => !task.archived).map((task) => rawUpsert("tasks", { id: task.id, pinned: priorities.includes(task.id), pinOrder: Math.max(1, priorities.indexOf(task.id) + 1) }, "PUT")));
      const review: Partial<EveningReview> = { ...defaultEntity("tasks"), date: today(), completedTaskIds: completed, unfinishedNote, researchProjectId: researchId || undefined, researchProgress, newPaperId, newDeadlineTaskId, priorityTaskIds: priorities, reflection };
      await rawUpsert("reviews", review as Record<string, unknown>); await refresh(); toast.success("今晚更新已完成，总览已同步"); go("dashboard");
    } catch (error) { toast.error(`保存复盘失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };
  const toggle = (list: string[], setList: (value: string[]) => void, id: string, limit?: number) => setList(list.includes(id) ? list.filter((item) => item !== id) : limit && list.length >= limit ? list : [...list, id]);
  return <div className="review-shell"><div className="review-steps">{[0,1,2,3,4,5].map((item) => <div className={`review-step ${item <= step ? "done" : ""}`} key={item} />)}</div><section className="review-card">
    {step === 0 && <><h2>① 今天完成了什么？</h2><p>勾选完成项。它们会从当前任务中移出，并保留完成记录。</p><div className="choice-list">{activeTasks.length ? activeTasks.map((task) => <label className="choice" key={task.id}><input type="checkbox" checked={completed.includes(task.id)} onChange={() => toggle(completed, setCompleted, task.id)} /><span><strong>{task.title}</strong><div className="row-subtitle">{task.category}{task.dueDate ? ` · ${task.dueDate}` : ""}</div></span></label>) : <PageEmpty>没有未完成任务。</PageEmpty>}</div></>}
    {step === 1 && <><h2>② 哪些事情没有完成？</h2><p>不必重排所有计划，只记录偏差原因或需要调整的地方。</p><textarea className="field-textarea min-h-52" value={unfinishedNote} onChange={(event) => setUnfinishedNote(event.target.value)} placeholder="例如：低估了第三章习题难度；研究问题仍需更多对比文献…" /></>}
    {step === 2 && <><h2>③ 科研有新进展吗？</h2><p>选择一个项目，写下今天之后真实发生的变化。</p><select className="field-select mb-3" value={researchId} onChange={(event) => { setResearchId(event.target.value); const item = db.research.find((r) => r.id === event.target.value); setResearchProgress(item?.recentProgress ?? ""); }}><option value="">今天没有科研更新</option>{db.research.filter((item) => !item.archived).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><textarea className="field-textarea min-h-44" disabled={!researchId} value={researchProgress} onChange={(event) => setResearchProgress(event.target.value)} placeholder="最近进展" /></>}
    {step === 3 && <><h2>④ 有没有新论文？</h2><p>这里快速收件；完整阅读笔记可以之后在论文模块补充。</p><div className="stack"><input className="field-input" value={paperTitle} onChange={(event) => setPaperTitle(event.target.value)} placeholder="论文标题（可留空）" /><input className="field-input" value={paperUrl} onChange={(event) => setPaperUrl(event.target.value)} placeholder="DOI / URL" /></div></>}
    {step === 4 && <><h2>⑤ 有没有新的截止日期？</h2><p>新截止日期会创建为高优先级本周任务。</p><div className="grid grid-cols-[1fr_180px] max-sm:grid-cols-1 gap-3"><input className="field-input" value={deadlineTitle} onChange={(event) => setDeadlineTitle(event.target.value)} placeholder="事项（可留空）" /><input className="field-input" type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} /></div></>}
    {step === 5 && <><h2>⑥ 最重要的事情变了吗？</h2><p>选择最多 5 项。选择顺序就是总览上的顺序。</p><div className="choice-list">{activeTasks.map((task) => <label className="choice" key={task.id}><input type="checkbox" checked={priorities.includes(task.id)} onChange={() => toggle(priorities, setPriorities, task.id, 5)} /><span><strong>{task.title}</strong><div className="row-subtitle">{priorities.includes(task.id) ? `优先级 #${priorities.indexOf(task.id) + 1}` : task.category}</div></span></label>)}</div><textarea className="field-textarea mt-4" value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="一句话总结（可选）" /></>}
    <div className="review-actions"><Button variant="outline" disabled={step === 0 || saving} onClick={() => setStep((current) => current - 1)}><ChevronLeft />上一步</Button>{step < 5 ? <Button onClick={() => setStep((current) => current + 1)}>下一步<ChevronRight /></Button> : <Button disabled={saving} onClick={() => void finish()}>{saving ? <RefreshCw className="animate-spin" /> : <Check />}{saving ? "正在更新" : "完成今晚更新"}</Button>}</div>
  </section></div>;
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
  const [rules, setRules] = useState(JSON.stringify(db.settings.gpa, null, 2)); const [saving, setSaving] = useState(false); const { theme, setTheme } = useTheme();
  const saveRules = async () => { try { setSaving(true); const gpa = JSON.parse(rules) as AppSettings["gpa"]; if (!Array.isArray(gpa.rules) || !gpa.rules.length) throw new Error("rules 必须是非空数组"); const settings = { ...db.settings, gpa }; await api("/api/data", { method: "PUT", body: JSON.stringify({ settings }) }); setDb({ ...db, settings }); toast.success("GPA 规则已保存"); } catch (error) { toast.error(`规则无效：${(error as Error).message}`); } finally { setSaving(false); } };
  const reset = async () => { const next = await api<Database>("/api/data", { method: "PUT", body: JSON.stringify({ reset: true }) }); setDb(next); toast.success("示例数据已清除"); };
  return <div className="grid settings-grid"><section className="panel"><div className="panel-head"><div><h2 className="panel-title">GPA 计算规则</h2><span className="panel-meta">从高分到低分匹配第一个规则</span></div><Button disabled={saving} onClick={() => void saveRules()}>保存规则</Button></div><div className="panel-body"><textarea className="field-textarea code-area" spellCheck={false} value={rules} onChange={(event) => setRules(event.target.value)} /><p className="form-help">修改 scale（满绩点）、minScore（最低分）、point（绩点）和 label（等级）。此设置保存在 data/settings.json。</p></div></section><div className="stack"><section className="panel"><div className="panel-head"><h2 className="panel-title">外观</h2></div><div className="panel-body"><label className="form-label">主题</label><select className="field-select" value={theme ?? "system"} onChange={(event) => setTheme(event.target.value)}><option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option></select></div></section><section className="panel"><div className="panel-head"><h2 className="panel-title">本地数据</h2></div><div className="panel-body"><p className="text-sm text-muted-foreground leading-6">主要数据位于项目的 <code>data/</code> 目录。每个模块一个 JSON 文件，便于 Git 对比、备份与迁移。</p></div></section><section className="panel danger-panel"><div className="panel-head"><h2 className="panel-title">清理示例数据</h2></div><div className="panel-body"><p className="text-sm text-muted-foreground mb-4">清空所有模块的示例数据，保留默认 GPA 规则。建议首次熟悉系统后执行。</p><ConfirmButton title="清空全部示例数据？" description="所有当前数据都会被清空。此操作无法撤销，建议先提交 Git 备份。" action="确认清空" onConfirm={() => void reset()} /></div></section></div></div>;
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
      async execute(input) { const taskId = (input as { taskId?: unknown })?.taskId; if (typeof taskId !== "string") throw new Error("taskId must be a string"); const task = db.tasks.find((item) => item.id === taskId && !item.archived); if (!task) throw new Error("task not found"); await api("/api/entities", { method: "PUT", body: JSON.stringify({ collection: "tasks", entity: { id: task.id, status: "completed", completedAt: nowIso(), pinned: false } }) }); await refresh(); return { id: task.id, status: "completed" }; },
    });
    return () => lifecycle.abort();
  }, [db, refresh]);
}
