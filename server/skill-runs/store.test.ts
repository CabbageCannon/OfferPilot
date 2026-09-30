import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("Skill 运行结果重开数据库后可读取且按 owner 隔离", async context => {
  const dataDir = await mkdtemp(join(tmpdir(), "skill-runs-"));
  process.env.SKILL_RUNS_DATA_DIR = dataDir;
  const { saveSkillRun, getSkillRun, listSkillRuns, closeSkillRunsStore } = await import("./store");
  context.after(async () => {
    closeSkillRunsStore();
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.SKILL_RUNS_DATA_DIR;
  });

  const saved = saveSkillRun({ kind: "company-research", modelId: "fake", skillId: "company-research", input: { companyName: "示例公司" }, result: { summary: "已核对" } });
  closeSkillRunsStore();
  assert.deepEqual(getSkillRun(saved.id)?.result, { summary: "已核对" });
  assert.equal(getSkillRun(saved.id, "other"), null);
  assert.equal(listSkillRuns()[0].title, "示例公司背调");
  assert.deepEqual(listSkillRuns("other"), []);
});
