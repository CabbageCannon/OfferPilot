import { Router } from "express";
import { skillInputSchema } from "../skills/catalog";
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "../skills/store";

export function createSkillsRouter(): Router {
  const router = Router();

  router.get("/skills", (_request, response) => {
    response.json({ skills: listSkills() });
  });

  router.get("/skills/:id", (request, response) => {
    const skill = getSkill(String(request.params.id));
    if (!skill) {
      response.status(404).json({ code: "NOT_FOUND", message: "Skill 不存在" });
      return;
    }
    response.json({ skill });
  });

  router.post("/skills", (request, response) => {
    const result = skillInputSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({ code: "INVALID_SKILL", message: "Skill 配置不正确", details: result.error.flatten() });
      return;
    }
    response.status(201).json({ skill: createSkill(result.data) });
  });

  router.put("/skills/:id", (request, response) => {
    const result = skillInputSchema.safeParse(request.body);
    if (!result.success) {
      response.status(400).json({ code: "INVALID_SKILL", message: "Skill 配置不正确", details: result.error.flatten() });
      return;
    }
    const skill = updateSkill(String(request.params.id), result.data);
    if (!skill) {
      response.status(404).json({ code: "NOT_FOUND", message: "只能修改自己的自定义 Skill" });
      return;
    }
    response.json({ skill });
  });

  router.delete("/skills/:id", (request, response) => {
    if (!deleteSkill(String(request.params.id))) {
      response.status(404).json({ code: "NOT_FOUND", message: "只能删除自己的自定义 Skill" });
      return;
    }
    response.status(204).end();
  });

  return router;
}
