import { errorResponse } from "@/lib/api";
import { DataError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    void request;
    throw new DataError("破坏性初始化已停用。当前工作区采用保留现有资料的非破坏性导入。", 410);
  } catch (error) { return errorResponse(error); }
}
