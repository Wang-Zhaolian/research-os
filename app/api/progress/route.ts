import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return NextResponse.json(await store.recordProgress(await readJson<{ taskId?: string; note: string; nextAction?: string; complete?: boolean }>(request)), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
