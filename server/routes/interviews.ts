import { Router } from "express";
import { z } from "zod";
import type { ModelGateway } from "../llm";
import { ProviderError } from "../providers/xunfei";
import { createInterviewService, InterviewError } from "../interviews/service";
import { getInterview, listInterviews, type InterviewRecord } from "../interviews/store";

const createSchema = z.object({
  jdDocumentId: z.uuid(),
  resumeDocumentId: z.uuid(),
  skillId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(128).optional(),
  durationMinutes: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  feedbackPreference: z.enum(["direct", "guided"]).optional(),
}).strict();

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(20_000),
  requestId: z.uuid(),
  modelId: z.string().min(1).max(128).optional(),
}).strict();

const finishSchema = z.object({ modelId: z.string().min(1).max(128).optional() }).strict();

function sendError(response: import("express").Response, error: unknown): void {
  if (error instanceof InterviewError) {
    response.status(error.status).json({ code: error.code, message: error.message });
  } else if (error instanceof ProviderError) {
    response.status(error.code === "MODEL_NOT_FOUND" ? 400 : 502)
      .json({ code: error.code, message: error.message, retryable: error.retryable });
  } else {
    console.error("Interview request failed", error instanceof Error ? error.name : "unknown");
    response.status(500).json({ code: "INTERNAL_ERROR", message: "面试处理失败" });
  }
}

function currentResult(interview: InterviewRecord) {
  return {
    interview,
    ...(interview.status === "active" ? { question: interview.turns.at(-1)?.question } : {}),
    ...(interview.report ? { report: interview.report } : {}),
  };
}

export function createInterviewsRouter(gateway: ModelGateway): Router {
  const router = Router();
  const service = createInterviewService(gateway);

  router.get("/interviews", (_request, response) => {
    response.json({ interviews: listInterviews().map(interview => ({
      id: interview.id,
      status: interview.status,
      skillId: interview.skillId,
      startedAt: interview.startedAt,
      question: interview.turns[0]?.question,
    })) });
  });

  router.post("/interviews", async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: "INVALID_REQUEST", message: "面试设置不正确", details: parsed.error.flatten() });
      return;
    }
    try {
      const interview = await service.create({ ...parsed.data, modelId: parsed.data.modelId ?? gateway.defaultModelId });
      response.status(201).json(currentResult(interview));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.get("/interviews/:id", (request, response) => {
    const interview = getInterview(String(request.params.id));
    if (!interview) {
      response.status(404).json({ code: "INTERVIEW_NOT_FOUND", message: "面试不存在" });
      return;
    }
    response.json({ interview, turns: interview.turns });
  });

  router.post("/interviews/:id/answers", async (request, response) => {
    const parsed = answerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: "INVALID_REQUEST", message: "回答格式不正确", details: parsed.error.flatten() });
      return;
    }
    try {
      response.json(currentResult(await service.answer(String(request.params.id), parsed.data.answer, parsed.data.requestId, parsed.data.modelId)));
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post("/interviews/:id/finish", async (request, response) => {
    const parsed = finishSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ code: "INVALID_REQUEST", message: "面试结束参数不正确" });
      return;
    }
    try {
      response.json(currentResult(await service.finish(String(request.params.id), parsed.data.modelId)));
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
}
