import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const expectedEpoch = assertLocalMutation(request);
    const body = await readJson<{ id: string; expectedRevision: number; horizonId: string; startDate?: string; targetDate?: string; nextAction?: string }>(request);
    return NextResponse.json(await store.promotePending({ ...body, expectedEpoch }));
  } catch (error) { return errorResponse(error); }
}
