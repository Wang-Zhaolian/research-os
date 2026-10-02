import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import type { ReviewSubmission } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { const epoch = assertLocalMutation(request); const body = await readJson<ReviewSubmission>(request); return NextResponse.json(await store.submitReview({ ...body, dataEpoch: epoch })); }
  catch (error) { return errorResponse(error); }
}
