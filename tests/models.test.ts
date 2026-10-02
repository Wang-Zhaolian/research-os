import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeCustomBaseUrl, summarizeModelError } from "../lib/model-runtime.ts";
import { CredentialVault } from "../lib/credentials.ts";
import { assertLocalMutation } from "../lib/security.ts";

test("custom model URL accepts secure remote endpoints and explicit local services only", () => {
  assert.equal(normalizeCustomBaseUrl("https://models.example/v1/"), "https://models.example/v1");
  assert.equal(normalizeCustomBaseUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1");
  assert.throws(() => normalizeCustomBaseUrl("http://models.example/v1"), /必须使用 HTTPS/);
  assert.throws(() => normalizeCustomBaseUrl("https://user:pass@models.example/v1"), /不能含账号/);
  assert.throws(() => normalizeCustomBaseUrl("https://models.example/v1?token=secret"), /查询参数/);
});

test("subscription failures are explicit and never describe automatic API fallback", () => {
  assert.match(summarizeModelError("subscription_sharing_usage_limit_exceeded"), /不会自动切换到 API/);
  assert.match(summarizeModelError("429 rate limit"), /不会自动切换到其他渠道/);
});

test("browser write APIs require the fixed same-origin host and a data epoch", () => {
  const valid = new Request("http://127.0.0.1:3000/api/entities", { method: "POST", headers: { Origin: "http://127.0.0.1:3000", Host: "127.0.0.1:3000", "x-research-os-epoch": "epoch_1" } });
  assert.equal(assertLocalMutation(valid), "epoch_1");
  const wrongOrigin = new Request("http://127.0.0.1:3000/api/entities", { method: "POST", headers: { Origin: "http://localhost:3000", Host: "127.0.0.1:3000", "x-research-os-epoch": "epoch_1" } });
  assert.throws(() => assertLocalMutation(wrongOrigin), /同源请求/);
  const missingEpoch = new Request("http://127.0.0.1:3000/api/entities", { method: "POST", headers: { Origin: "http://127.0.0.1:3000", Host: "127.0.0.1:3000" } });
  assert.throws(() => assertLocalMutation(missingEpoch), /工作区版本缺失/);
});

test("credential vault stores secrets outside the project and with owner-only file mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-os-credential-test-"));
  try {
    const vaultPath = path.join(root, "private", "credentials");
    const vault = new CredentialVault(vaultPath);
    const secret = "api-key-never-in-json";
    await vault.setCustomKey("connection_1", secret);
    assert.equal(await vault.getCustomKey("connection_1"), secret);
    const file = path.join(vaultPath, "credentials.json");
    if (process.platform === "win32") {
      const { stdout } = await promisify(execFile)("icacls.exe", [file], { windowsHide: true });
      assert.doesNotMatch(stdout, /Everyone|BUILTIN\\Users|Authenticated Users/i, "credential ACL should not grant broad group access");
    } else {
      const mode = (await stat(file)).mode & 0o777;
      assert.equal(mode & 0o077, 0, "credential file should not grant group/other permissions");
    }
    const saved = await readFile(file, "utf8");
    assert.match(saved, /api-key-never-in-json/);
    await vault.setCustomKey("connection_1", undefined);
    assert.equal(await vault.getCustomKey("connection_1"), undefined);
    assert.doesNotMatch(await readFile(file, "utf8"), /api-key-never-in-json/);
    await vault.modify("test-provider", async () => ({ type: "oauth", access: "a", refresh: "r", expires: 1 }));
    assert.equal((await vault.read("test-provider"))?.type, "oauth");
    await vault.modify("test-provider", async () => undefined);
    assert.equal(await vault.read("test-provider"), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
