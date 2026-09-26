import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import type { AnyEntity, CollectionKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const collections = new Set<CollectionKey>(["tasks", "learning", "research", "papers", "projects", "competitions", "goals", "grades", "reviews"]);
const valid = (value: string | null): value is CollectionKey => Boolean(value && collections.has(value as CollectionKey));

export async function POST(request: Request) {
  const body = await request.json() as { collection?: string; entity?: Partial<AnyEntity> };
  const collection = body.collection ?? null;
  if (!valid(collection) || !body.entity) return NextResponse.json({ error: "Invalid entity request" }, { status: 400 });
  return NextResponse.json(await store.upsert(collection, body.entity), { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json() as { collection?: string; entity?: Partial<AnyEntity> & { id?: string } };
  const collection = body.collection ?? null;
  if (!valid(collection) || !body.entity?.id) return NextResponse.json({ error: "Invalid update request" }, { status: 400 });
  return NextResponse.json(await store.upsert(collection, body.entity));
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const collection = url.searchParams.get("collection");
  const id = url.searchParams.get("id");
  if (!valid(collection) || !id) return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  await store.archive(collection, id, url.searchParams.get("hard") === "1");
  return NextResponse.json({ ok: true });
}
