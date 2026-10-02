import { DataError } from "./validation.ts";

export function assertLocalMutation(request: Request): string {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const expectedHost = "127.0.0.1:3000";
  if (origin !== `http://${expectedHost}` || host !== expectedHost) throw new DataError("本地写入接口仅接受来自 Research OS 固定地址的同源请求", 403);
  const epoch = request.headers.get("x-research-os-epoch");
  if (!epoch || epoch.length > 100) throw new DataError("工作区版本缺失；请刷新页面后重试", 409);
  return epoch;
}
