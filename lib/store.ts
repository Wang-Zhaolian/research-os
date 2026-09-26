import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnyEntity, CollectionKey, Database, Settings } from "./types";

const collectionKeys: CollectionKey[] = ["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades", "reviews"];
export const defaultSettings: Settings = {
  schemaVersion: 1,
  demoData: true,
  gpa: { scale: 4, rules: [
    { minScore: 90, point: 4, label: "A" }, { minScore: 85, point: 3.7, label: "A-" },
    { minScore: 82, point: 3.3, label: "B+" }, { minScore: 78, point: 3, label: "B" },
    { minScore: 75, point: 2.7, label: "B-" }, { minScore: 72, point: 2.3, label: "C+" },
    { minScore: 68, point: 2, label: "C" }, { minScore: 64, point: 1.5, label: "D" },
    { minScore: 60, point: 1, label: "D-" }, { minScore: 0, point: 0, label: "F" },
  ] },
};

const iso = () => new Date().toISOString();
export const createId = (prefix: string) => `${prefix}_${randomUUID().split("-")[0]}`;

export function createStore(root = process.env.RESEARCH_OS_DATA_DIR || path.join(process.cwd(), "data")) {
  let writeQueue: Promise<void> = Promise.resolve();
  const file = (key: CollectionKey | "settings") => path.join(root, `${key}.json`);
  const atomicWrite = async (target: string, value: unknown) => {
    await mkdir(root, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  };
  const readJson = async <T>(target: string, fallback: T): Promise<T> => {
    try { return JSON.parse(await readFile(target, "utf8")) as T; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw error;
    }
  };
  const queued = <T>(operation: () => Promise<T>) => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    root,
    async read(): Promise<Database> {
      await mkdir(root, { recursive: true });
      const values = await Promise.all(collectionKeys.map((key) => readJson<AnyEntity[]>(file(key), [])));
      const settings = await readJson(file("settings"), defaultSettings);
      return Object.fromEntries([...collectionKeys.map((key, index) => [key, values[index]]), ["settings", settings]]) as unknown as Database;
    },
    async replace(db: Database) {
      await queued(async () => {
        await Promise.all(collectionKeys.map((key) => atomicWrite(file(key), db[key])));
        await atomicWrite(file("settings"), db.settings);
      });
    },
    async upsert(collection: CollectionKey, input: Partial<AnyEntity> & { id?: string }) {
      return queued(async () => {
        const entities = await readJson<AnyEntity[]>(file(collection), []);
        const now = iso();
        const index = input.id ? entities.findIndex((entity) => entity.id === input.id) : -1;
        const entity = index >= 0
          ? { ...entities[index], ...input, updatedAt: now }
          : { ...input, id: input.id || createId(collection.slice(0, 4)), createdAt: now, updatedAt: now, tags: input.tags ?? [] };
        if (index >= 0) entities[index] = entity as AnyEntity; else entities.push(entity as AnyEntity);
        await atomicWrite(file(collection), entities);
        return entity as AnyEntity;
      });
    },
    async archive(collection: CollectionKey, id: string, hard = false) {
      return queued(async () => {
        const entities = await readJson<AnyEntity[]>(file(collection), []);
        const next = hard ? entities.filter((entity) => entity.id !== id) : entities.map((entity) => entity.id === id ? { ...entity, archived: true, updatedAt: iso() } : entity);
        await atomicWrite(file(collection), next);
      });
    },
    async saveSettings(settings: Settings) { await queued(() => atomicWrite(file("settings"), settings)); return settings; },
  };
}

export const store = createStore();
