import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";
import type { ZodType } from "zod";
import type { ModelGateway, ModelMessage } from "../llm";

test("统一聊天按意图切 Skill、补齐面试参数并允许中途换模型", async context => {
  const dataDir = await mkdtemp(join(tmpdir(), "chat-agent-"));
  process.env.DOCUMENTS_DATA_DIR = join(dataDir, "documents");
  process.env.CHAT_DATA_DIR = join(dataDir, "chat");
  process.env.INTERVIEWS_DATA_DIR = join(dataDir, "interviews");
  process.env.SKILLS_DATA_DIR = join(dataDir, "skills");
  process.env.SKILL_RUNS_DATA_DIR = join(dataDir, "runs");
  const { createChatRouter } = await import("../routes/chat");
  const { getChatSession, closeChatStore } = await import("./store");
  const { getInterview, closeInterviewsStore } = await import("../interviews/store");
  const { closeSkillsStore } = await import("../skills/store");
  const { closeDocumentsStore } = await import("../documents/store");
  const { closeSkillRunsStore } = await import("../skill-runs/store");

  let classifierCalls = 0;
  const gateway = {
    defaultModelId: "first",
    listModels: () => ["first", "second"].map(id => ({ id, model: id, capabilities: { stream: true, structured: true, tools: false } })),
    async *streamText(_modelId: string, messages: ModelMessage[]) {
      assert.match(messages[0].content, /求职会话 Skill/);
      yield { type: "delta" as const, content: "先明确目标岗位，再梳理经历。" };
      yield { type: "done" as const, finishReason: "stop" as const };
    },
    async generateObject<T>(_modelId: string, messages: ModelMessage[], schema: ZodType<T>): Promise<T> {
      if (messages[0].content.includes("意图路由器")) {
        classifierCalls++;
        const latest = (JSON.parse(messages[1].content) as { latest: string }).latest;
        const decision = latest === "开始模拟面试" ? { intent: "start_interview" }
          : latest.startsWith("岗位要求") ? { intent: "provide_material", materialKind: "jd" }
          : latest.startsWith("个人简历") ? { intent: "provide_material", materialKind: "resume" }
          : latest === "20分钟" ? { intent: "provide_parameters", durationMinutes: 20 }
          : latest === "中等难度" ? { intent: "provide_parameters", difficulty: "medium" }
          : latest === "帮我查这家公司" ? { intent: "company_research" }
          : latest === "我负责了需求分析" ? { intent: "answer_interview" }
          : { intent: "conversation" };
        return schema.parse(decision);
      }
      const task = JSON.parse(messages.at(-1)?.content ?? "{}") as { task: string };
      if (task.task.startsWith("提出下一道")) return schema.parse({ question: "请说明你如何分析客户需求并推动方案落地？" });
      if (task.task.startsWith("评价最后")) return schema.parse({ score: 2, evidence: ["负责需求分析"], gaps: ["缺少成果"], followUp: false });
      return schema.parse({ summary: "回答有经验，但缺少成果。", strengths: [], gaps: [], nextSteps: [] });
    },
  } as ModelGateway;

  const app = express().use(express.json()).use("/api", createChatRouter({ gateway, timeoutMs: 30_000, systemPrompt: "求职顾问", routerModelId: "first" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  context.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeChatStore(); closeInterviewsStore(); closeSkillsStore(); closeDocumentsStore(); closeSkillRunsStore();
    await rm(dataDir, { recursive: true, force: true });
    for (const key of ["DOCUMENTS_DATA_DIR", "CHAT_DATA_DIR", "INTERVIEWS_DATA_DIR", "SKILLS_DATA_DIR", "SKILL_RUNS_DATA_DIR"]) delete process.env[key];
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const sessionId = crypto.randomUUID();
  async function send(content: string, modelId = "first", requestId = crypto.randomUUID()) {
    const response = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, sessionId, modelId, messages: [{ role: "user", content }] }) });
    return { response, text: await response.text(), requestId };
  }

  assert.match((await send("开始模拟面试")).text, /请上传目标岗位的 JD/);
  assert.match((await send("岗位要求：客户经理负责客户沟通、需求分析和业务成交，需要完整项目经验。")).text, /请上传你的简历/);
  assert.match((await send("个人简历：我曾负责客户沟通、需求分析与方案交付，协调多方完成项目。")).text, /多少分钟/);
  assert.match((await send("20分钟")).text, /难度选/);
  assert.match((await send("中等难度")).text, /模拟面试开始/);
  const started = getChatSession(sessionId);
  assert.ok(started?.interviewId);
  assert.equal(getInterview(started.interviewId)?.turns.length, 1);

  assert.match((await send("帮我查这家公司")).text, /公司全称/);
  assert.equal(getInterview(started.interviewId)?.turns.length, 1);
  assert.match((await send("我负责了需求分析", "second")).text, /下一题/);
  const switched = getInterview(started.interviewId);
  assert.equal(switched?.modelId, "second");
  assert.equal(switched?.turns[1].questionModelId, "second");
  assert.equal(switched?.turns[0].assessmentModelId, "second");

  assert.match((await send("如何回答这个问题")).text, /先明确目标岗位/);
  assert.equal(getInterview(started.interviewId)?.turns.length, 2);
  const normal = await send("职业规划怎么做");
  assert.match(normal.text, /event:delta/);
  assert.match(normal.text, /先明确目标岗位/);
  const callsBeforeReplay = classifierCalls;
  const replay = await send("职业规划怎么做", "first", normal.requestId);
  assert.match(replay.text, /先明确目标岗位/);
  assert.equal(classifierCalls, callsBeforeReplay);
});
