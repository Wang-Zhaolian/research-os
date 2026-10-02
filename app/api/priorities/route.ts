import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try { const epoch = assertLocalMutation(request); const body = await readJson<{ taskIds: string[] }>(request); await store.setPriorities(body.taskIds, epoch); return NextResponse.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
