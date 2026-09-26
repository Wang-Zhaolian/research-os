export type EntityKind = "task" | "learning" | "research" | "paper" | "project" | "competition" | "goal" | "grade";
export type CollectionKey = "tasks" | "learning" | "research" | "papers" | "projects" | "competitions" | "goals" | "grades" | "reviews";
export type Status = "not_started" | "in_progress" | "blocked" | "completed" | "paused" | "delayed";
export type Priority = "high" | "medium" | "low";

export interface EntityRef { type: EntityKind; id: string; label?: string }
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  archived?: boolean;
}

export interface Task extends BaseEntity {
  title: string;
  category: string;
  priority: Priority;
  status: Status;
  dueDate?: string;
  relation?: EntityRef;
  notes: string;
  weekBucket: "this_week" | "next_week" | "later";
  pinned: boolean;
  pinOrder: number;
  completedAt?: string;
}

export interface Topic { id: string; title: string; status: Status }
export interface LearningModule { id: string; title: string; status: Status; topics: Topic[] }
export interface LearningCourse extends BaseEntity {
  name: string; field: string; status: Status; materials: string[];
  progressSummary: string; completedContent: string; currentContent: string;
  nextAction: string; notes: string; modules: LearningModule[];
}

export interface MeetingNote { id: string; date: string; title: string; notes: string; nextActions: string[] }
export interface ResearchProject extends BaseEntity {
  name: string; advisor: string; collaborators: string[]; startDate: string;
  status: Status; expectedCompletion?: string; stage: string;
  researchQuestion: string; background: string; literatureReview: string;
  researchGap: string; hypothesis: string; method: string; dataset: string;
  experiment: string; results: string; writing: string; submission: string;
  currentTask: string; nextAction: string; deadline?: string; blockers: string;
  recentProgress: string; meetings: MeetingNote[]; paperIds: string[];
  resources: { label: string; url: string; kind: string }[];
}

export interface Paper extends BaseEntity {
  title: string; authors: string[]; year?: number; venue: string; doiUrl: string;
  researchArea: string; status: "to_read" | "skimmed" | "reading" | "read" | "deep_read" | "core";
  importance: number; relatedResearchIds: string[]; abstract: string;
  researchQuestion: string; coreMethod: string; dataset: string; mainResults: string;
  contribution: string; limitation: string; myUnderstanding: string;
  researchUse: string; worthDeepReading: boolean; nextAction: string;
  source: { provider: "manual" | "zotero"; externalId?: string; libraryId?: string };
}

export interface PersonalProject extends BaseEntity {
  name: string; type: "my_project" | "reference_project"; techStack: string[];
  description: string; github: string; demo: string; status: Status;
  progress: string; nextAction: string; learnings: string;
}

export interface Competition extends BaseEntity {
  name: string; level: string; date?: string; teammates: string[]; advisor: string;
  status: Status; deadline?: string; preparationStage: string; currentTask: string;
  finalResult: string; award: string; cvImportance: "high" | "medium" | "low";
  materials: string[]; projectIds: string[];
}

export interface Milestone { id: string; title: string; status: Status; targetDate?: string }
export interface Goal extends BaseEntity {
  title: string; type: "year" | "semester" | "long_term"; timeframe: string;
  status: Status; description: string; milestones: Milestone[];
  linkedItems: EntityRef[]; nextAction: string;
}

export interface Grade extends BaseEntity {
  semester: string; course: string; credits: number; score: number;
  courseType: string; isCore: boolean;
}

export interface EveningReview extends BaseEntity {
  date: string; completedTaskIds: string[]; unfinishedNote: string;
  researchProjectId?: string; researchProgress: string;
  newPaperId?: string; newDeadlineTaskId?: string; priorityTaskIds: string[];
  reflection: string;
}

export interface GpaRule { minScore: number; point: number; label: string }
export interface Settings {
  gpa: { scale: number; rules: GpaRule[] };
  demoData: boolean;
  schemaVersion: number;
}

export interface Database {
  tasks: Task[]; learning: LearningCourse[]; research: ResearchProject[];
  papers: Paper[]; projects: PersonalProject[]; competitions: Competition[];
  goals: Goal[]; grades: Grade[]; reviews: EveningReview[]; settings: Settings;
}

export type AnyEntity = Task | LearningCourse | ResearchProject | Paper | PersonalProject | Competition | Goal | Grade | EveningReview;
