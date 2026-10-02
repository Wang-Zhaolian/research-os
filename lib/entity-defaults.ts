import type { AnyEntity, CollectionKey } from "./types.ts";

export type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents" | "attachments">;
const base = (prefix: string) => ({ id: `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [] as string[] });

export function createEntityDefaults(collection: EditableCollection): AnyEntity {
  switch (collection) {
    case "tasks": return { ...base("task"), title: "", category: "学习", priority: "medium", status: "not_started", dueDate: "", nextAction: "", relatedRefs: [], milestoneRefs: [], planningState: "inbox", notes: "", pinned: false, pinOrder: 5 };
    case "learning": return { ...base("lear"), name: "", field: "", status: "not_started", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "", notes: "", modules: [], syllabusComplete: false };
    case "research": return { ...base("rese"), name: "", advisor: "", collaborators: [], startDate: "", status: "not_started", expectedCompletion: "", stage: "", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] };
    case "papers": return { ...base("pape"), title: "", authors: [], venue: "", doiUrl: "", researchArea: "", keywords: [], status: "to_read", importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" } };
    case "projects": return { ...base("proj"), name: "", type: "my_project", techStack: [], description: "", github: "", demo: "", status: "not_started", progress: "", nextAction: "", learnings: "" };
    case "competitions": return { ...base("comp"), name: "", level: "", teammates: [], advisor: "", status: "not_started", preparationStage: "", currentTask: "", finalResult: "", award: "", cvImportance: "medium", materials: [], projectIds: [] };
    case "goals": return { ...base("goal"), title: "", type: "semester", timeframe: "", status: "not_started", description: "", milestones: [], linkedItems: [], nextAction: "" };
    case "grades": return { ...base("grad"), semester: "", course: "", credits: 3, score: null, courseType: "", isCore: false, gradingType: "percentage", includeInAverage: true, evidenceRefs: [] };
    case "pendingItems": return { ...base("pend"), title: "", categoryId: "general", description: "", desiredOutcome: "", status: "open", linkedRefs: [], evidenceRefs: [] };
    case "activePlans": return { ...base("plan"), title: "", categoryId: "general", horizonId: "short", status: "not_started", description: "", nextAction: "", linkedRefs: [], taskIds: [] };
    case "achievements": return { ...base("achi"), title: "", categoryId: "general", summary: "", linkedRefs: [], evidenceRefs: [], verification: "user_recorded" };
    case "internships": return { ...base("inte"), organization: "", role: "", location: "", status: "not_started", description: "", responsibilities: "", outcomes: "", mentor: "", evidenceRefs: [] };
  }
}
