import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZodType } from "zod";
import { saveDocument } from "../documents";
import type { ModelGateway, ModelMessage } from "../llm";
import { createInterviewService } from "./service";

test("面试按阶段推进，重复请求不会重复记入回答", async () => {
  const jd = await saveDocument({
    ownerId: "local", kind: "jd", filename: "jd.txt", mimeType: "text/plain",
    buffer: Buffer.from("招聘客户经理，负责客户沟通和需求分析。"),
    parsed: { extractedText: "招聘客户经理，负责客户沟通和需求分析。", blocks: [], parseStatus: "ready" },
  });
  const resume = await saveDocument({
    ownerId: "local", kind: "resume", filename: "resume.txt", mimeType: "text/plain",
    buffer: Buffer.from("曾负责客户沟通与方案交付。"),
    parsed: { extractedText: "曾负责客户沟通与方案交付。", blocks: [], parseStatus: "ready" },
  });
  let questionNumber = 0;
  const gateway = {
    defaultModelId: "fake",
    listModels: () => [{ id: "fake", model: "fake", capabilities: { stream: true, structured: true, tools: false } }],
    async *streamText() { yield { type: "done" as const, finishReason: "stop" as const }; },
    async generateObject<T>(_id: string, messages: ModelMessage[], schema: ZodType<T>): Promise<T> {
      const task = JSON.parse(messages.at(-1)?.content ?? "{}") as { task: string };
      if (task.task.startsWith("提出下一道")) {
        questionNumber += 1;
        return schema.parse({ question: `第${questionNumber}题：请说明你亲自处理过的一次客户需求及结果？` });
      }
      if (task.task.startsWith("评价最后")) {
        return schema.parse({ score: 2, evidence: ["说明了客户需求"], gaps: ["缺少结果证据"], followUp: false });
      }
      return schema.parse({ summary: "回答展示了沟通经历，但结果证据不足。", strengths: ["能描述场景"], gaps: ["缺少结果"], nextSteps: ["补充量化结果"] });
    },
  } as ModelGateway;
  const service = createInterviewService(gateway);
  const session = await service.create({
    jdDocumentId: jd.id, resumeDocumentId: resume.id, skillId: "interview-deep-dive",
    modelId: "fake", durationMinutes: 10, difficulty: "medium",
  });
  assert.equal(session.turns.length, 1);
  const firstRequest = crypto.randomUUID();
  const first = await service.answer(session.id, "我负责和客户确认需求，并交付了方案。", firstRequest);
  assert.equal(first.turns.length, 2);
  assert.equal(first.turns[1].stageId, "competency");
  const replay = await service.answer(session.id, "我负责和客户确认需求，并交付了方案。", firstRequest);
  assert.equal(replay.turns.length, 2);
  const second = await service.answer(session.id, "我梳理了客户目标，提出了两种方案。", crypto.randomUUID());
  assert.equal(second.turns[2].stageId, "reflection");
  const finished = await service.answer(session.id, "我复盘后调整了沟通节奏。", crypto.randomUUID());
  assert.equal(finished.status, "completed");
  assert.match(finished.report ?? "", /面试复盘/);
});
