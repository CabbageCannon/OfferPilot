import { z, type ZodType } from "zod";
import {
  ProviderError,
  streamXunfei,
  type providerEvent,
  type providerMessage,
} from "../providers/xunfei";

export type ModelMessage = providerMessage;
export type ModelEvent = providerEvent;

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  baseUrl: z.url().refine(value => /^https?:\/\//.test(value)),
  model: z.string().min(1),
  apiKey: z.string().min(1),
  capabilities: z.object({
    stream: z.boolean().default(true),
    structured: z.boolean().default(true),
    tools: z.literal(false).default(false),
  }).default({ stream: true, structured: true, tools: false }),
});

type ModelConfig = z.infer<typeof modelSchema>;
export type ModelInfo = Omit<ModelConfig, "apiKey" | "baseUrl">;

function loadModels(env: NodeJS.ProcessEnv): ModelConfig[] {
  let configured: unknown;
  if (env.AI_MODELS) {
    try {
      configured = JSON.parse(env.AI_MODELS);
    } catch {
      throw new ProviderError("MODEL_CONFIG_ERROR", "AI_MODELS 必须是 JSON 数组");
    }
  } else if (env.AI_API_KEY) {
    configured = [{
      id: "xunfei",
      name: env.AI_MODEL_NAME?.trim() || env.AI_MODEL?.trim() || "4.0Ultra",
      apiKey: env.AI_API_KEY,
      baseUrl: env.AI_API_BASE_URL ?? "https://spark-api-open.xf-yun.com/v1",
      model: env.AI_MODEL ?? "4.0Ultra",
    }];
  } else {
    throw new ProviderError("MODEL_CONFIG_ERROR", "请配置 AI_MODELS 或 AI_API_KEY");
  }

  const parsed = z.array(modelSchema).min(1).safeParse(configured);
  if (!parsed.success || new Set(parsed.data.map(item => item.id)).size !== parsed.data.length) {
    throw new ProviderError("MODEL_CONFIG_ERROR", "模型配置无效或 ID 重复");
  }
  return parsed.data;
}

function normalizeError(error: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
    return new ProviderError("REQUEST_ABORTED", "模型请求已中断");
  }
  if (error instanceof ProviderError) return error;
  return new ProviderError("UPSTREAM_NETWORK_ERROR", "无法连接上游模型", { retryable: true });
}

function responseContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new ProviderError("UPSTREAM_FORMAT_ERROR", "上游模型响应格式错误");
  }
  const result = payload as { error?: { message?: string }, choices?: Array<{ message?: { content?: unknown } }> };
  if (result.error) {
    throw new ProviderError("UPSTREAM_ERROR", result.error.message ?? "上游模型生成失败");
  }
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ProviderError("UPSTREAM_FORMAT_ERROR", "上游模型没有返回文本");
  }
  return content;
}

export function createModelGateway(env: NodeJS.ProcessEnv = process.env) {
  const models = loadModels(env);
  const byId = new Map(models.map(model => [model.id, model]));

  function getModel(modelId: string): ModelConfig {
    const model = byId.get(modelId);
    if (!model) throw new ProviderError("MODEL_NOT_FOUND", "模型不存在");
    return model;
  }

  return {
    defaultModelId: models[0].id,
    listModels(): ModelInfo[] {
      return models.map(({ id, name, model, capabilities }) => ({ id, name, model, capabilities }));
    },
    async *streamText(modelId: string, messages: ModelMessage[], signal: AbortSignal): AsyncGenerator<ModelEvent> {
      const model = getModel(modelId);
      if (!model.capabilities.stream) throw new ProviderError("MODEL_UNSUPPORTED", "模型不支持流式输出");
      try {
        yield* streamXunfei(model, messages, signal);
      } catch (error) {
        throw normalizeError(error, signal);
      }
    },
    async generateObject<T>(modelId: string, messages: ModelMessage[], schema: ZodType<T>, signal: AbortSignal): Promise<T> {
      const model = getModel(modelId);
      if (!model.capabilities.structured) throw new ProviderError("MODEL_UNSUPPORTED", "模型不支持结构化输出");
      const jsonMessages: ModelMessage[] = [
        ...messages,
        { role: "system", content: `仅输出符合以下 JSON Schema 的 JSON 对象，不要 Markdown 或额外说明：${JSON.stringify(z.toJSONSchema(schema))}` },
      ];
      let response: Response;
      try {
        response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${model.apiKey}` },
          body: JSON.stringify({ model: model.model, messages: jsonMessages, stream: false, temperature: 0.2, max_tokens: 4000 }),
          signal,
        });
      } catch (error) {
        throw normalizeError(error, signal);
      }
      if (!response.ok) {
        throw new ProviderError("UPSTREAM_HTTP_ERROR", `上游模型请求失败，状态码：${response.status}`, {
          status: response.status,
          retryable: response.status >= 500,
        });
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (signal.aborted) throw normalizeError(error, signal);
        throw new ProviderError("UPSTREAM_PARSE_ERROR", "无法解析上游模型响应");
      }
      const content = responseContent(payload);
      let value: unknown;
      try {
        value = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        throw new ProviderError("UPSTREAM_PARSE_ERROR", "模型没有返回有效 JSON");
      }
      const result = schema.safeParse(value);
      if (!result.success) throw new ProviderError("UPSTREAM_FORMAT_ERROR", "模型返回的 JSON 不符合要求");
      return result.data;
    },
  };
}

export type ModelGateway = ReturnType<typeof createModelGateway>;
