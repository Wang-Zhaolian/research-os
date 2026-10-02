export type EntityKind = "task" | "learning" | "research" | "paper" | "project" | "competition" | "goal" | "grade";
export type ParentEntityKind = Exclude<EntityKind, "task" | "grade">;
export type CollectionKey = "tasks" | "learning" | "research" | "papers" | "projects" | "competitions" | "goals" | "grades" | "reviews" | "progressEvents";
export type Status = "not_started" | "in_progress" | "blocked" | "completed" | "paused" | "delayed";
export type Priority = "high" | "medium" | "low";

export interface EntityRef { type: EntityKind; id: string; label?: string }
export type ParentEntityRef = Omit<EntityRef, "type"> & { type: ParentEntityKind };
export interface MilestoneRef { goalId: string; milestoneId: string }
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
  nextAction: string;
  primaryParent?: ParentEntityRef;
  relatedRefs: EntityRef[];
  milestoneRefs: MilestoneRef[];
  planningState: "inbox" | "needs_parent" | "week" | "later";
  plannedWeek?: string;
  notes: string;
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
  researchArea: string; keywords: string[]; status: "to_read" | "skimmed" | "reading" | "read" | "deep_read" | "core";
  importance: number; relatedResearchIds: string[]; abstract: string;
  researchQuestion: string; coreMethod: string; dataset: string; mainResults: string;
  contribution: string; limitation: string; myUnderstanding: string;
  researchUse: string; worthDeepReading: boolean; nextAction: string;
  source: { provider: "manual" | "zotero"; externalId?: string; libraryId?: string; zoteroLibraryId?: string; zoteroItemId?: string; lastSyncedAt?: string };
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

export interface Milestone { id: string; title: string; status: Status; targetDate?: string; evidence?: string }
export interface Goal extends BaseEntity {
  title: string; type: "year" | "semester" | "long_term"; timeframe: string;
  status: Status; description: string; milestones: Milestone[];
  linkedItems: EntityRef[]; nextAction: string;
}

export interface Grade extends BaseEntity {
  semester: string; course: string; credits: number; score?: number | null;
  courseType: string; isCore: boolean;
  gradingType: "percentage" | "pass_fail" | "exempt";
  includeInAverage: boolean;
  result?: "pass" | "fail";
}

export interface PersonalProfile {
  displayName: string;
  university: string;
  major: string;
  entryYear?: number;
  currentSemester: string;
  developmentDirections: string[];
  onboardingComplete: boolean;
}

export interface ModelConnection {
  id: string;
  kind: "chatgpt_subscription" | "openai_compatible";
  name: string;
  baseUrl?: string;
  protocol?: "chat_completions" | "responses";
  modelId?: string;
  createdAt: string;
}

export interface AIConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status: "complete" | "interrupted";
  channel?: "chatgpt_subscription" | "openai_compatible";
  usesGradeContext?: boolean;
  citations?: { collection: string; id: string; title: string }[];
  proposal?: AIProposal;
}

export interface AIProposalChange {
  action: "create" | "update" | "progress" | "priorities";
  collection: Exclude<CollectionKey, "reviews" | "progressEvents">;
  id?: string;
  entity: Record<string, unknown>;
  explanation: string;
}

export interface AIProposal {
  id: string;
  dataEpoch: string;
  dataRevision: number;
  changes: AIProposalChange[];
  appliedAt?: string;
  operationId?: string;
}

export interface AIConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AIConversationMessage[];
  allowGrades: boolean;
  dataEpoch: string;
}

export interface EveningReview extends BaseEntity {
  date: string; completedTaskIds: string[]; unfinishedNote: string;
  researchProjectId?: string; researchProgress: string;
  newPaperId?: string; newDeadlineTaskId?: string; priorityTaskIds: string[];
  reflection: string;
  revision: number;
  operationIds: string[];
}

export interface ReviewSubmission {
  date: string;
  operationId: string;
  expectedRevision: number;
  completeTaskIds: string[];
  undoTaskIds: string[];
  progressUpdates: { taskId: string; note: string; nextAction: string }[];
  unfinishedNote: string;
  researchProjectId?: string;
  researchProgress: string;
  newPaper?: { title: string; url: string };
  newDeadline?: { title: string; date: string; primaryParent?: ParentEntityRef };
  inboxPlans: { taskId: string; planningState: "week" | "later"; plannedWeek?: string; primaryParent?: Task["primaryParent"] }[];
  priorityTaskIds: string[];
  reflection: string;
}

export interface ProgressEvent extends BaseEntity {
  date: string;
  taskId?: string;
  parentRef?: EntityRef;
  milestoneRefs: MilestoneRef[];
  note: string;
  nextAction?: string;
  kind: "progress" | "completed" | "unblocked" | "replan";
  previousStatus?: Status;
  reviewDate?: string;
}

export interface GpaRule { minScore: number; point: number; label: string }
export interface Settings {
  gpa: { scale: number; rules: GpaRule[] };
  demoData: boolean;
  schemaVersion: number;
  timeZone: string;
  stalledDays: number;
  dataEpoch: string;
  dataRevision: number;
  gpaPresetId: string;
  gpaConfigured: boolean;
  modelConnections: ModelConnection[];
  defaultModelConnectionId: string;
}

export interface Database {
  tasks: Task[]; learning: LearningCourse[]; research: ResearchProject[];
  papers: Paper[]; projects: PersonalProject[]; competitions: Competition[];
  goals: Goal[]; grades: Grade[]; reviews: EveningReview[]; settings: Settings;
  progressEvents: ProgressEvent[];
  profile: PersonalProfile;
}

export type AnyEntity = Task | LearningCourse | ResearchProject | Paper | PersonalProject | Competition | Goal | Grade | EveningReview | ProgressEvent;
