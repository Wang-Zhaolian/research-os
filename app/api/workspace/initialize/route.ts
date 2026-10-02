import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ expectedRevision: number; confirmation: string }>(request);
    return NextResponse.json(await store.initializeWorkspace({ expectedEpoch: epoch, ...body }));
  } catch (error) { return errorResponse(error); }
}
