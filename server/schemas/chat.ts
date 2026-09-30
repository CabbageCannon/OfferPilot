import { z } from "zod";

const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z
      .string()
      .min(1, "消息不能为空")
      .max(20_000, "单条消息不能超过 20000 字符")
      .refine(content => content.trim().length > 0, "消息不能只包含空白字符"),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    requestId: z.uuid(),

    sessionId: z
      .string()
      .min(1)
      .max(128),

    messages: z
      .array(messageSchema)
      .min(1, "至少需要一条信息")
      .max(50, "最多发送 50 条历史信息"),
    modelId: z.string().min(1).max(128).optional(),
    skillId: z.string().min(1).max(128).optional(),
    jdDocumentId: z.uuid().optional(),
    resumeDocumentId: z.uuid().optional(),
    durationMinutes: z.number().int().min(5).max(120).optional(),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    companyName: z.string().trim().min(2).max(120).optional(),
  }).strict()
  .superRefine((request, context) => {
    if (request.messages.at(-1)?.role !== "user") {
      context.addIssue({ code: "custom", path: ["messages"], message: "最后一条消息必须来自用户" });
    }
    // 计算信息内容的总长度
    const totalLength = request.messages.reduce((sum, message) => {
      return sum + message.content.length;
    }, 0)

    if (totalLength > 100_000) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "消息长度不能超过 100000 字符",
      })
    }
  })

export type ChatRequestBody =
  z.infer<typeof chatRequestSchema>
