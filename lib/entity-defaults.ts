import type { AnyEntity, CollectionKey } from "./types.ts";

export type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;
const base = (prefix: string) => ({ id: `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tags: [] as string[] });

export function createEntityDefaults(collection: EditableCollection): AnyEntity {
  switch (collection) {
    case "tasks": return { ...base("task"), title: "", category: "学习", priority: "medium", status: "not_started", dueDate: "", nextAction: "", relatedRefs: [], milestoneRefs: [], planningState: "inbox", notes: "", pinned: false, pinOrder: 5 };
    case "learning": return { ...base("lear"), name: "", field: "", status: "not_started", materials: [], progressSummary: "", completedContent: "", currentContent: "", nextAction: "", notes: "", modules: [] };
    case "research": return { ...base("rese"), name: "", advisor: "", collaborators: [], startDate: "", status: "not_started", expectedCompletion: "", stage: "", researchQuestion: "", background: "", literatureReview: "", researchGap: "", hypothesis: "", method: "", dataset: "", experiment: "", results: "", writing: "", submission: "", currentTask: "", nextAction: "", deadline: "", blockers: "", recentProgress: "", meetings: [], paperIds: [], resources: [] };
    case "papers": return { ...base("pape"), title: "", authors: [], venue: "", doiUrl: "", researchArea: "", keywords: [], status: "to_read", importance: 3, relatedResearchIds: [], abstract: "", researchQuestion: "", coreMethod: "", dataset: "", mainResults: "", contribution: "", limitation: "", myUnderstanding: "", researchUse: "", worthDeepReading: false, nextAction: "", source: { provider: "manual" } };
    case "projects": return { ...base("proj"), name: "", type: "my_project", techStack: [], description: "", github: "", demo: "", status: "not_started", progress: "", nextAction: "", learnings: "" };
    case "competitions": return { ...base("comp"), name: "", level: "", teammates: [], advisor: "", status: "not_started", preparationStage: "", currentTask: "", finalResult: "", award: "", cvImportance: "medium", materials: [], projectIds: [] };
    case "goals": return { ...base("goal"), title: "", type: "semester", timeframe: "", status: "not_started", description: "", milestones: [], linkedItems: [], nextAction: "" };
    case "grades": return { ...base("grad"), semester: "", course: "", credits: 3, score: null, courseType: "", isCore: false, gradingType: "percentage", includeInAverage: true };
  }
}
