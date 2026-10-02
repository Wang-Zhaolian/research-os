import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { const epoch = assertLocalMutation(request); return NextResponse.json(await store.recordProgress(await readJson<{ taskId?: string; note: string; nextAction?: string; complete?: boolean }>(request), epoch), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
