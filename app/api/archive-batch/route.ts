import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { CollectionKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;
const allowed = new Set<EditableCollection>(["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"]);
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ collection: EditableCollection; ids: string[] }>(request);
    if (!allowed.has(body.collection)) throw new DataError("归档模块无效");
    await store.archiveDemo(body.collection, body.ids, epoch);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
