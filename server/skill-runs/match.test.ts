import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ModelGateway, ModelMessage } from "../llm";
import { builtInSkills } from "../skills/catalog";

test("匹配结果只保留简历原文证据并定位来源", async context => {
  const dataDir = await mkdtemp(join(tmpdir(), "resume-match-"));
  process.env.DOCUMENTS_DATA_DIR = dataDir;
  const { saveDocument, closeDocumentsStore } = await import("../documents/store");
  const { runResumeMatch, MatchError } = await import("./match");
  context.after(async () => {
    closeDocumentsStore();
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.DOCUMENTS_DATA_DIR;
  });

  const jd = await saveDocument({ ownerId: "local", kind: "jd", filename: "岗位.txt", mimeType: "text/plain", buffer: Buffer.from("客户经理"), parsed: { extractedText: "招聘客户经理，需要客户拓展和成交经验", blocks: [{ text: "招聘客户经理，需要客户拓展和成交经验", section: 1 }], parseStatus: "ready" } });
  const resume = await saveDocument({ ownerId: "local", kind: "resume", filename: "简历.txt", mimeType: "text/plain", buffer: Buffer.from("简历"), parsed: { extractedText: "负责华东客户拓展，签订 12 份合同", blocks: [{ text: "负责华东客户拓展，签订 12 份合同", section: 2 }], parseStatus: "ready" } });
  let messagesSeen: ModelMessage[] = [];
  const gateway = {
    listModels: () => [{ id: "fake", capabilities: { structured: true } }],
    generateObject: async (_modelId: string, messages: ModelMessage[]) => {
      messagesSeen = messages;
      return ({
      summary: "有客户拓展经历。",
      requirements: [
        { requirement: "成交经验", status: "matched", evidence: "签订 12 份合同", source: { documentId: jd.id, page: 99 }, advice: "突出成交成果。" },
        { requirement: "团队管理", status: "matched", evidence: "管理百人团队", source: { documentId: resume.id, section: 2 }, advice: "突出管理经验。" },
      ],
      revisedResume: "负责华东客户拓展，签订 12 份合同。",
      knowledgeGaps: [], warnings: [],
      });
    },
  } as unknown as ModelGateway;

  const skill = builtInSkills.find(item => item.kind === "resume-match");
  assert.ok(skill);
  const result = await runResumeMatch(gateway, { jdDocumentId: jd.id, resumeDocumentId: resume.id, modelId: "fake", skill });
  assert.match(JSON.stringify(messagesSeen), /证据匹配/);
  assert.deepEqual(result.requirements[0].source, { documentId: resume.id, section: 2 });
  assert.equal(result.requirements[1].status, "evidence_gap");
  assert.equal(result.requirements[1].evidence, undefined);
  assert.equal(result.requirements[1].source, undefined);
  assert.match(result.revisedResume, /^【待审核草稿】/);
  assert.match(result.warnings.join(" "), /引文无法/);
  await assert.rejects(
    runResumeMatch(gateway, { jdDocumentId: "missing", resumeDocumentId: resume.id, modelId: "fake" }),
    (error: unknown) => error instanceof MatchError && error.code === "DOCUMENT_NOT_FOUND",
  );
  await assert.rejects(
    runResumeMatch(gateway, { jdDocumentId: jd.id, resumeDocumentId: resume.id, modelId: "fake", skill: { ...skill, kind: "interview" } }),
    (error: unknown) => error instanceof MatchError && error.code === "INVALID_SKILL",
  );
});
