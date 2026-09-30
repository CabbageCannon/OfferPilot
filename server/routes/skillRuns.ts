import { Router } from "express";
import { z } from "zod";
import type { ModelGateway } from "../llm";
import { ProviderError } from "../providers/xunfei";
import { getSkill } from "../skills/store";
import { runResumeMatch, MatchError } from "../skill-runs/match";
import { runCompanyResearch, CompanyResearchError } from "../skills/companyResearch";
import { getSkillRun, listSkillRuns, saveSkillRun } from "../skill-runs/store";

const matchSchema = z.object({
  kind: z.literal("resume-match"),
  modelId: z.string().min(1).max(128),
  skillId: z.string().min(1).max(128),
  jdDocumentId: z.uuid(),
  resumeDocumentId: z.uuid(),
}).strict();

const companySchema = z.object({
  kind: z.literal("company-research"),
  modelId: z.string().min(1).max(128),
  skillId: z.string().min(1).max(128),
  companyName: z.string().trim().min(2).max(120),
  jdDocumentId: z.uuid().optional(),
}).strict();

const runSchema = z.discriminatedUnion("kind", [matchSchema, companySchema]);

export function createSkillRunsRouter(gateway: ModelGateway): Router {
  const router = Router();

  router.get("/skill-runs", (_request, response) => {
    response.json({ runs: listSkillRuns() });
  });

  router.get("/skill-runs/:id", (request, response) => {
    const run = getSkillRun(String(request.params.id));
    if (!run) {
      response.status(404).json({ code: "SKILL_RUN_NOT_FOUND", message: "Skill 运行记录不存在" });
      return;
    }
    response.json({ run });
  });

  router.post("/skill-runs", async (request, response) => {
    const parsed = runSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: "INVALID_REQUEST", message: "Skill 运行参数不正确", details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const skill = getSkill(input.skillId);
    if (!skill || skill.kind !== input.kind) {
      response.status(404).json({ code: "SKILL_NOT_FOUND", message: "对应的 Skill 不存在" });
      return;
    }

    try {
      const result = input.kind === "resume-match"
        ? await runResumeMatch(gateway, { ...input, skill })
        : await runCompanyResearch(gateway, { ...input, skill });
      const run = saveSkillRun({ kind: input.kind, modelId: input.modelId, skillId: skill.id, input, result });
      response.json({ id: run.id, kind: run.kind, result: run.result });
    } catch (error) {
      if (error instanceof MatchError || error instanceof CompanyResearchError) {
        response.status(error.status).json({ code: error.code, message: error.message });
      } else if (error instanceof ProviderError) {
        response.status(error.code === "MODEL_NOT_FOUND" ? 400 : 502)
          .json({ code: error.code, message: error.message, retryable: error.retryable });
      } else {
        console.error("Skill run failed", error instanceof Error ? error.name : "unknown");
        response.status(500).json({ code: "INTERNAL_ERROR", message: "Skill 运行失败" });
      }
    }
  });

  return router;
}
