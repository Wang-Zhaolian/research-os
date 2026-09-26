import { NextResponse } from "next/server";
import { defaultSettings, store } from "@/lib/store";
import type { Database, Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await store.read(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const body = await request.json() as { settings?: Settings; reset?: boolean };
  if (body.reset) {
    const empty: Database = {
      tasks: [], learning: [], research: [], papers: [], projects: [], competitions: [], goals: [], grades: [], reviews: [],
      settings: { ...defaultSettings, demoData: false },
    };
    await store.replace(empty);
    return NextResponse.json(empty);
  }
  if (!body.settings) return NextResponse.json({ error: "Missing settings" }, { status: 400 });
  return NextResponse.json(await store.saveSettings(body.settings));
}
