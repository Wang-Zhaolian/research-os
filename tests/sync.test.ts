import assert from "node:assert/strict";
import test from "node:test";
import { syncResearchOs } from "../scripts/sync.mjs";

test("Git sync refuses dirty worktrees before pull or push", async () => {
  const calls: string[][] = [];
  const fakeGit = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { status: 0, stdout: "C:/research-os", stderr: "" };
    if (args[0] === "status") return { status: 0, stdout: " M data/tasks.json\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(syncResearchOs("push", "C:/research-os", fakeGit), /不会自动暂存或提交/);
  assert.deepEqual(calls.map((args) => args[0]), ["rev-parse", "status"]);
});

test("Git sync stops after a failed fast-forward pull", async () => {
  const calls: string[][] = [];
  const fakeGit = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pull") return { status: 1, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  await assert.rejects(syncResearchOs("push", "C:/research-os", fakeGit), /停止推送/);
  assert.deepEqual(calls.map((args) => args[0]), ["rev-parse", "status", "pull"]);
});

test("pull mode never pushes", async () => {
  const calls: string[][] = [];
  const fakeGit = async (args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  };
  await syncResearchOs("pull", "C:/research-os", fakeGit);
  assert.deepEqual(calls.map((args) => args[0]), ["rev-parse", "status", "pull"]);
  assert.deepEqual(calls.at(-1), ["pull", "--ff-only"]);
});
