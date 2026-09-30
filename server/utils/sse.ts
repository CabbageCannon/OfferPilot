import type { Response } from "express";

// 定义三种SSE事件类型
type SSEEventMap = {
  delta: {
    requestId: string,
    content: string
  },

  done: {
    requestId: string,
    finishReason: "stop" | "length"
  },

  error: {
    requestId: string,
    code: string,
    message: string,
    retryable: boolean
  }
}

// 与前端请求建立连接
export const startSSE = (response: Response): void => {
  response.status(200);

  response.set({
    "Content-Type": "text/event-stream;charset=utf-8",

    "Cache-control": "no-cache,no-transform",

    Connection: "keep-alive",

    "X-Accel-Buffering": "no"
  });

  // 写好reponse响应头后直接发送，先于前端建立连接
  response.flushHeaders();
}

// 在与前端的连接中持续发送数据
export const writeSSE = <EventName extends keyof SSEEventMap>(
  response: Response,
  eventName: EventName,
  data: SSEEventMap[EventName]
): void => {
  response.write(`event:${eventName}\n`);
  response.write(`data:${JSON.stringify(data)}\n\n`);
}