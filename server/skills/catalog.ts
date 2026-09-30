import { z } from "zod";

const stageSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(1000),
  maxQuestions: z.number().int().min(1).max(20).default(3),
}).strict();

const promptsSchema = z.object({
  system: z.string().trim().max(4000).default(""),
  question: z.string().trim().max(4000).default(""),
  assessment: z.string().trim().max(4000).default(""),
  report: z.string().trim().max(4000).default(""),
}).strict();

export const skillInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  kind: z.enum(["conversation", "interview", "resume-match", "company-research"]),
  stages: z.array(stageSchema).min(1).max(8),
  prompts: promptsSchema.default({ system: "", question: "", assessment: "", report: "" }),
  allowedTools: z.array(z.string()).max(0).default([]),
}).strict().superRefine((value, context) => {
  const ids = value.stages.map(stage => stage.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["stages"], message: "阶段 ID 不能重复" });
  }
});

export type SkillInput = z.infer<typeof skillInputSchema>;
export type Skill = SkillInput & {
  id: string;
  ownerId: string | null;
  version: number;
  enabled: boolean;
};

export const builtInSkills: Skill[] = [
  {
    id: "career-conversation",
    ownerId: null,
    version: 1,
    enabled: true,
    name: "求职会话",
    description: "讨论岗位、简历、面试准备与求职疑问，并在需要时引导使用专用 Skill。",
    kind: "conversation",
    stages: [{ id: "conversation", name: "求职讨论", goal: "理解问题并给出有依据、可执行的建议。", maxQuestions: 1 }],
    prompts: { system: "你是中文求职顾问。区分用户事实和推断；资料不足时说明并提出一个关键追问。正在进行的面试可作为参考，不强制把每条消息当成答案。", question: "", assessment: "", report: "" },
    allowedTools: [],
  },
  {
    id: "interview-deep-dive",
    ownerId: null,
    version: 1,
    enabled: true,
    name: "面试深挖",
    description: "按 JD、简历、时长和难度逐题追问，最后给出证据化复盘。",
    kind: "interview",
    stages: [
      { id: "experience", name: "经历核验", goal: "核验与目标岗位最相关的真实经历、个人贡献和成果。", maxQuestions: 3 },
      { id: "competency", name: "岗位能力", goal: "围绕 JD 的核心职责和能力要求提出实际场景题。", maxQuestions: 3 },
      { id: "reflection", name: "复盘与取舍", goal: "考察失败经验、取舍和学习能力。", maxQuestions: 2 },
    ],
    prompts: {
      system: "你是严谨的中文面试官。一次只问一个问题，不编造候选人经历；每题应能回指 JD 或简历。",
      question: "优先追问回答中缺失的个人动作、依据、结果或反事实，不重复原题。",
      assessment: "仅评价用户已给出的证据，区分说清楚、未说清楚和未提供。",
      report: "按考察点列出具体回答证据、欠缺和下次练习建议。",
    },
    allowedTools: [],
  },
  {
    id: "jd-resume-match",
    ownerId: null,
    version: 1,
    enabled: true,
    name: "JD 与简历匹配",
    description: "逐项对照岗位要求和真实经历，生成有修改依据的定向简历草稿。",
    kind: "resume-match",
    stages: [
      { id: "requirements", name: "拆解要求", goal: "提取硬性条件、职责、能力和加分项。", maxQuestions: 1 },
      { id: "evidence", name: "证据匹配", goal: "给每项要求找到原始经历证据或标明缺口。", maxQuestions: 1 },
      { id: "rewrite", name: "定向改写", goal: "只基于可核验事实改写，并列出可补学的知识点。", maxQuestions: 1 },
    ],
    prompts: { system: "不虚构经历、头衔、数据或技能。", question: "", assessment: "", report: "" },
    allowedTools: [],
  },
  {
    id: "company-research",
    ownerId: null,
    version: 1,
    enabled: true,
    name: "公司背调",
    description: "核对公司主体，检索公开来源，区分事实、评价与推断。",
    kind: "company-research",
    stages: [
      { id: "identity", name: "确认主体", goal: "确认公司全称及招聘主体。", maxQuestions: 1 },
      { id: "sources", name: "搜索资料", goal: "检索官网、新闻和公开评价并记录日期。", maxQuestions: 1 },
      { id: "report", name: "整理报告", goal: "标明来源、争议和面试待核实问题。", maxQuestions: 1 },
    ],
    prompts: { system: "来源不充分时明确写未查到，不把评价当事实。", question: "", assessment: "", report: "" },
    allowedTools: [],
  },
];
