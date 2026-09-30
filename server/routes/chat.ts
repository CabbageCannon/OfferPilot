import { createHash } from "node:crypto";
import { Router } from "express";
import { chatRequestSchema } from "../schemas/chat";
import { createChatAgent, ChatFlowError } from "../chat/agent";
import { getChatResponse, getChatSession, saveChatResponse, saveChatSession, type ChatSession } from "../chat/store";
import { DocumentError } from "../documents";
import { InterviewError } from "../interviews/service";
import type { ModelGateway } from "../llm";
import { ProviderError } from "../providers/xunfei";
import { MatchError } from "../skill-runs/match";
import { CompanyResearchError } from "../skills/companyResearch";
import { startSSE, writeSSE } from "../utils/sse";

type ChatRouteConfig = {
  gateway: ModelGateway;
  timeoutMs: number;
  systemPrompt: string;
  routerModelId?: string;
};

function errorEvent(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof ProviderError) return { code: error.code, message: error.message, retryable: error.retryable };
  if (error instanceof ChatFlowError || error instanceof DocumentError || error instanceof InterviewError || error instanceof MatchError || error instanceof CompanyResearchError) {
    return { code: error.code, message: error.message, retryable: error.status >= 500 };
  }
  console.error("Chat processing failed", error instanceof Error ? error.name : "unknown");
  return { code: "INTERNAL_ERROR", message: "聊天处理失败，请稍后重试", retryable: true };
}

export function createChatRouter(config: ChatRouteConfig): Router {
  const router = Router();
  const agent = createChatAgent(config.gateway, config.systemPrompt);
  const busy = new Set<string>();

  router.get("/chat/sessions/:id", (request, response) => {
    const id = String(request.params.id);
    if (!id || id.length > 128) {
      response.status(400).json({ code: "INVALID_SESSION", message: "会话 ID 无效" });
      return;
    }
    const session = getChatSession(id);
    if (!session) {
      response.status(404).json({ code: "SESSION_NOT_FOUND", message: "会话尚无服务端状态" });
      return;
    }
    response.json({ session: {
      id: session.id,
      jdDocumentId: session.jdDocumentId,
      resumeDocumentId: session.resumeDocumentId,
      interviewId: session.interviewId,
      pending: session.pending,
      summary: session.summary,
      updatedAt: session.updatedAt,
    } });
  });

  router.post("/chat", async (request, response) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ code: "INVALID_REQUEST", message: "聊天请求格式不正确", details: parsed.error.flatten() });
      return;
    }
    const input = parsed.data;
    const { requestId, sessionId } = input;
    const inputHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = getChatResponse(sessionId, requestId);
    if (previous && previous.inputHash !== inputHash) {
      response.status(409).json({ code: "REQUEST_CONFLICT", message: "同一请求 ID 的内容不同" });
      return;
    }
    startSSE(response);
    if (previous) {
      writeSSE(response, "delta", { requestId, content: previous.content });
      writeSSE(response, "done", { requestId, finishReason: previous.finishReason });
      response.end();
      return;
    }
    if (busy.has(sessionId)) {
      writeSSE(response, "error", { requestId, code: "SESSION_BUSY", message: "上一条消息仍在处理，请稍后重试", retryable: true });
      response.end();
      return;
    }
    busy.add(sessionId);
    const session: ChatSession = getChatSession(sessionId) ?? {
      id: sessionId, ownerId: "local", summary: "", updatedAt: new Date().toISOString(),
    };
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    try {
      const reply = await agent.handle(input, session, controller.signal, config.routerModelId);
      let content = "";
      let finishReason: "stop" | "length" = "stop";
      if (reply.kind === "text") {
        content = reply.content;
        if (!response.destroyed) writeSSE(response, "delta", { requestId, content });
      } else {
        for await (const event of config.gateway.streamText(reply.modelId, reply.messages, controller.signal)) {
          if (event.type === "delta") {
            content += event.content;
            if (!response.destroyed) writeSSE(response, "delta", { requestId, content: event.content });
          } else {
            finishReason = event.finishReason;
          }
        }
      }
      if (timedOut) throw new ProviderError("REQUEST_TIMEOUT", "模型响应超时", { retryable: true });
      saveChatSession(session);
      saveChatResponse(sessionId, requestId, { inputHash, content, finishReason });
      if (!response.destroyed) writeSSE(response, "done", { requestId, finishReason });
    } catch (error) {
      if (!response.destroyed) {
        writeSSE(response, "error", { requestId, ...(timedOut ? { code: "REQUEST_TIMEOUT", message: "模型响应超时", retryable: true } : errorEvent(error)) });
      }
    } finally {
      clearTimeout(timeout);
      busy.delete(sessionId);
      if (!response.writableEnded && !response.destroyed) response.end();
    }
  });

  return router;
}
