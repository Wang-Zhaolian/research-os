import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import { DataError } from "@/lib/validation";
import type { AnyEntity, CollectionKey } from "@/lib/types";
type EditableCollection = Exclude<CollectionKey, "reviews" | "progressEvents">;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collections = new Set<CollectionKey>(["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades"]);
const valid = (value: string | null): value is EditableCollection => Boolean(value && collections.has(value as CollectionKey));

export async function POST(request: Request) {
  try {
    const body = await readJson<{ collection?: string; entity?: Partial<AnyEntity> & { id?: string } }>(request);
    const collection = body.collection ?? null;
    if (!valid(collection) || !body.entity || body.entity.id) throw new DataError("新建记录请求无效；新记录不能指定 ID");
    return NextResponse.json(await store.upsert(collection, body.entity), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<{ collection?: string; entity?: Partial<AnyEntity> & { id?: string } }>(request);
    const collection = body.collection ?? null;
    if (!valid(collection) || !body.entity?.id) throw new DataError("更新请求无效");
    return NextResponse.json(await store.upsert(collection, body.entity));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const collection = url.searchParams.get("collection");
    const id = url.searchParams.get("id");
    if (!valid(collection) || !id) throw new DataError("删除请求无效");
    await store.archive(collection, id, url.searchParams.get("hard") === "1");
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
