import { createHash } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const instance = createHash("sha256").update(path.resolve(store.root)).digest("hex").slice(0, 12);
  return NextResponse.json({ app: "research-os", instance }, { headers: { "Cache-Control": "no-store" } });
}
