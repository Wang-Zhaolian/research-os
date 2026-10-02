import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const host = "127.0.0.1";
const port = 3000;
const origin = `http://${host}:${port}`;
const dataRoot = path.resolve(process.env.RESEARCH_OS_DATA_DIR || path.join(root, "data"));
const instance = createHash("sha256").update(dataRoot).digest("hex").slice(0, 12);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openBrowser(url) {
  if (process.env.RESEARCH_OS_NO_BROWSER === "1") { console.log(`浏览器自动打开已按测试设置跳过：${url}`); return; }
  const commands = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(commands[0], commands[1], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.log(`请手动打开：${url}`));
  child.unref();
}
async function serverAtPort() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(700, () => { socket.destroy(); resolve(false); });
  });
}
async function matchingHealth() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return { status: "other" };
    const value = await response.json();
    if (value.app === "research-os" && value.instance === instance) return { status: "same" };
    return { status: "other" };
  } catch { return { status: "offline" }; }
}
async function run(command, args) {
  const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : command;
  const executableArgs = process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, executableArgs, { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} 退出代码 ${code ?? "未知"}`)));
  });
}
async function sourceHash() {
  const hash = createHash("sha256");
  const includeFile = async (relative) => hash.update(relative).update(await readFile(path.join(root, relative)));
  const walk = async (relative) => {
    const full = path.join(root, relative);
    for (const entry of (await readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(tsx?|css|mjs|json)$/.test(entry.name)) await includeFile(child.replaceAll(path.sep, "/"));
    }
  };
  for (const directory of ["app", "components", "lib"]) await walk(directory);
  for (const file of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]) await includeFile(file);
  return hash.digest("hex");
}
async function prepareBuild() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("需要 Node.js 22 或更高版本。请先安装 Node.js，再重新启动。");
  const lockHash = createHash("sha256").update(await readFile(path.join(root, "package-lock.json"))).digest("hex");
  const lockMarker = path.join(root, "node_modules", ".research-os-lock-hash");
  let installedHash = "";
  try { installedHash = await readFile(lockMarker, "utf8"); } catch { /* first run or old dependencies */ }
  if (!existsSync(path.join(root, "node_modules")) || installedHash !== lockHash) {
    console.log("正在安装 Research OS 依赖…");
    await run("npm", ["ci"]);
    await writeFile(lockMarker, lockHash, "utf8");
  }
  const inputHash = await sourceHash();
  const buildMarker = path.join(root, ".next", ".research-os-source-hash");
  let builtHash = "";
  try { builtHash = await readFile(buildMarker, "utf8"); } catch { /* first build */ }
  if (builtHash !== inputHash || !existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("首次运行或代码已更新，正在构建本地应用…");
    await run("npm", ["run", "build"]);
    await writeFile(buildMarker, inputHash, "utf8");
  }
}

let server;
async function stopServer() {
  if (server && server.exitCode === null) server.kill("SIGINT");
}
process.on("SIGINT", () => { void stopServer(); });
process.on("SIGTERM", () => { void stopServer(); });

try {
  const before = await matchingHealth();
  if (before.status === "same") {
    console.log("Research OS 已在运行，正在打开浏览器…");
    await openBrowser(origin);
    process.exit(0);
  }
  if (before.status === "other" || await serverAtPort()) throw new Error("本机 3000 端口已被其他程序占用。请关闭占用程序后再启动；Research OS 不会自动更换网址。");
  await prepareBuild();
  const afterBuild = await matchingHealth();
  if (afterBuild.status === "same") { await openBrowser(origin); process.exit(0); }
  if (afterBuild.status === "other" || await serverAtPort()) throw new Error("构建期间 3000 端口被其他程序占用，请关闭后重试。");
  const npm = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const serverArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run start"] : ["run", "start"];
  server = spawn(npm, serverArgs, { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  server.once("error", (error) => console.error("无法启动本地服务：", error.message));
  for (let attempt = 0; attempt < 60; attempt++) {
    const health = await matchingHealth();
    if (health.status === "same") {
      console.log(`Research OS 已启动：${origin}`);
      console.log("使用期间请保持此窗口打开；关闭窗口会停止服务。按 Ctrl+C 可正常退出。");
      await openBrowser(origin);
      await new Promise((resolve) => server.once("exit", resolve));
      process.exit(server.exitCode ?? 0);
    }
    if (health.status === "other") throw new Error("3000 端口响应的不是当前 Research OS 实例，已停止启动。");
    if (server.exitCode !== null) throw new Error("Research OS 本地服务未能启动。请查看上方错误信息。");
    await delay(500);
  }
  throw new Error("等待本地服务就绪超时。请检查上方错误信息或端口 3000 状态。");
} catch (error) {
  await stopServer();
  console.error(`\nResearch OS：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
