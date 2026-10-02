import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function systemGit(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

export async function syncResearchOs(mode, cwd = projectRoot, runGit = systemGit) {
  if (mode !== "pull" && mode !== "push") throw new Error("用法：node scripts/sync.mjs pull|push");
  const root = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (root.status !== 0) throw new Error("当前目录不是 Git 仓库。");
  const status = await runGit(["status", "--porcelain"], cwd);
  if (status.status !== 0) throw new Error("无法读取 Git 状态。");
  if (status.stdout.trim()) throw new Error(mode === "pull"
    ? "工作区有未提交改动。为避免覆盖数据，已停止；请先检查、提交或手动处理冲突。"
    : "工作区有未提交改动。此脚本不会自动暂存或提交；请按 README 手动检查并提交，再重试。");

  const pull = await runGit(["pull", "--ff-only"], cwd);
  if (pull.stdout) process.stdout.write(pull.stdout);
  if (pull.stderr) process.stderr.write(pull.stderr);
  if (pull.status !== 0) throw new Error(mode === "pull"
    ? "安全拉取失败。未执行 stash、rebase 或冲突覆盖；请查看 Git 提示并手动处理。"
    : "安全拉取失败，已停止推送。请先手动处理 Git 提示。");
  if (mode === "pull") { console.log("Research OS 已安全拉取最新提交。"); return; }

  const push = await runGit(["push"], cwd);
  if (push.stdout) process.stdout.write(push.stdout);
  if (push.stderr) process.stderr.write(push.stderr);
  if (push.status !== 0) throw new Error("推送失败。请检查登录状态、远端和分支；本脚本不会强推。");
  console.log("Research OS 已安全推送。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncResearchOs(process.argv[2]).catch((error) => {
    console.error(`Research OS 同步已停止：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
