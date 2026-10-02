import { NextResponse } from "next/server";
import { DataError } from "./validation";

export { assertLocalMutation } from "./security";

export async function readJson<T>(request: Request): Promise<T> {
  try { return await request.json() as T; }
  catch { throw new DataError("请求内容不是有效的 JSON"); }
}

export function errorResponse(error: unknown) {
  const status = error instanceof DataError ? error.status : 500;
  const message = error instanceof Error ? error.message : "发生未知错误";
  if (status >= 500) console.error("Research OS API error status:", status);
  return NextResponse.json({ error: message }, { status });
}
