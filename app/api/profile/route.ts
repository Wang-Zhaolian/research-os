import { NextResponse } from "next/server";
import { assertLocalMutation, errorResponse, readJson } from "@/lib/api";
import { store } from "@/lib/store";
import type { PersonalProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request) {
  try {
    const epoch = assertLocalMutation(request);
    const body = await readJson<{ profile: PersonalProfile; confirmGpaPreset?: boolean }>(request);
    return NextResponse.json(await store.saveProfile(body.profile, body.confirmGpaPreset === true, epoch));
  } catch (error) { return errorResponse(error); }
}
