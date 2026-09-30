// 提供给大模型的消息类型
export type providerMessage = {
  role: "system" | "user" | "assistant",
  content: string
};

export type providerEvent = {
  type: "delta",
  content: string
} | {
  type: "done",
  finishReason: "stop" | "length"
}

// 讯飞大模型基本配置
export type xunfeiConfig = {
  apiKey: string,
  baseUrl: string,
  model: string
};

type jsonObject = Record<string, unknown>;

export class ProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: {
      status?: number,
      retryable?: boolean
    } = {}
  ) {
    super(message);
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

// 检查是否是json格式js对象
const isJsonObject = (
  value: unknown
): value is jsonObject => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

// 将SSE数据块中的data中的数据解析出来
const extractSSEData = (
  block: string
): string | null => {
  const dataLines = block
    .split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trimStart());

  // block中没有解析出数据
  if (dataLines.length === 0) return null;

  return dataLines.join("\n");
}

async function* readUpstreamSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  // 读取 SSE 字节流
  const reader = stream.getReader();
  // 用于将二进制转换成字符串
  const decoder = new TextDecoder("utf-8");

  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode(value);
        break;
      }

      buffer += decoder.decode(value, {
        stream: true
      });

      const blocks = buffer.split(/\r?\n\r?\n/);

      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const data = extractSSEData(block);

        if (data !== null) {
          yield data;
        }
      }
    }

    if (buffer.trim()) {
      const data = extractSSEData(buffer);
      if (data !== null) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamXunfei(
  config: xunfeiConfig,
  messages: providerMessage[],
  signal: AbortSignal
): AsyncGenerator<providerEvent> {
  // 去掉末尾的/
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  const response = await fetch(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",

        Authorization: `Bearer ${config.apiKey}`
      },

      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4000
      }),

      signal
    }
  );

  if (!response.ok) {
    throw new ProviderError(
      "UPSTREAM_HTTP_ERROR",
      `上游模型请求失败,状态码:${response.status}`,
      {
        status: response.status,
        retryable: response.status >= 500
      }
    )
  }

  if (!response.body) {
    throw new ProviderError(
      "UPSTREAM_EMPTY_BODY",
      "上游模型没有返回响应流",
      {
        retryable: true,
      },
    );
  }

  let receivedDone = false;
  let receivedFinishReason = false;
  let finishReason:
    "stop" | "length" = "stop";

  for await (const dataText of readUpstreamSSE(response.body)) {
    if (dataText === "[DONE]") {
      receivedDone = true;
      break;
    }

    let payload: unknown;
    try {
      // dataText如果不是[done],理论上应该是json格式的字符串
      payload = JSON.parse(dataText)
    } catch {
      throw new ProviderError(
        "UPSTREAM_PARSE_ERROR",
        "无法解析上游模型响应",
      )
    }

    if (!isJsonObject(payload)) {
      throw new ProviderError(
        "UPSTREAM_FORMAT_ERROR",
        "上游模型响应格式错误",
      );
    }

    if (isJsonObject(payload.error)) {
      const upstreamMessage =
        payload.error.message;

      throw new ProviderError(
        "UPSTREAM_ERROR",
        typeof upstreamMessage === "string"
          ? upstreamMessage
          : "上游模型生成失败",
      );
    }

    const choices = payload.choices;
    if (
      !Array.isArray(choices) ||
      choices.length === 0 ||
      !isJsonObject(choices[0])
    ) {
      continue;
    }

    const choice = choices[0];
    const delta = choice.delta;

    if (
      isJsonObject(delta) &&
      typeof delta.content === "string" &&
      delta.content
    ) {
      yield {
        type: "delta",
        content: delta.content,
      };
    }


    if (
      typeof choice.finish_reason ===
      "string"
    ) {
      receivedFinishReason = true;

      finishReason =
        choice.finish_reason === "length"
          ? "length"
          : "stop";
    }
  }
  // 既没有拿到delta,也没有被告知done,则说明传输出错了,被迫中断了
  if (
    !receivedDone &&
    !receivedFinishReason
  ) {
    throw new ProviderError(
      "UPSTREAM_INCOMPLETE_STREAM",
      "上游模型响应未完整结束",
      {
        retryable: true,
      },
    );
  }

  yield {
    type: "done",
    finishReason: finishReason,
  };
}