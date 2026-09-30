// 自动读取环境变量env并放入process.env中
import "dotenv/config";

import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { createChatRouter } from "./routes/chat";
import { createDocumentsRouter } from "./routes/documents";
import { createSkillsRouter } from "./routes/skills";
import { createInterviewsRouter } from "./routes/interviews";
import { createSkillRunsRouter } from "./routes/skillRuns";
import { createModelGateway } from "./llm";

const envSchema = z.object({
  AI_ROUTER_MODEL_ID: z.string().min(1).optional(),
  // 服务器端口
  // z.coerce.number()尝试把字符串转换成数字,因为读env时默认是读字符串
  SERVER_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3001)
})

const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
  console.error(
    "环境变量配置错误",
    envResult.error.flatten().fieldErrors,
  )

  process.exit(1);
}

const env = envResult.data;
const gateway = createModelGateway();
const app = express();

// express默认响应头里会带x-powered-by用来表示express这个框架,这里把他去掉避免多余的信息暴露
app.disable("x-powered-by");

// 注册json解析中间件,把前端请求中body中的json字符串转换成js对象
app.use(
  express.json({
    limit: "256kb"
  })
)

// 健康检查接口
app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
  })
})

// 挂载聊天路由
app.use(
  "/api",
  createChatRouter({
    gateway,

    timeoutMs: 120_000,

    systemPrompt: "你是一名准确、友好、专业的中文求职顾问。",
    routerModelId: env.AI_ROUTER_MODEL_ID,
  })
)

app.get("/api/models", (_request, response) => {
  response.json({ models: gateway.listModels().map(model => ({
    id: model.id,
    label: model.name ?? model.model,
    capabilities: model.capabilities,
  })) });
});
app.use("/api", createDocumentsRouter());
app.use("/api", createSkillsRouter());
app.use("/api", createInterviewsRouter(gateway));
app.use("/api", createSkillRunsRouter(gateway));

// 处理错误中间件
// 一般中间件  _request,response,_next 三个参数,用于处理请求
// 处理错误中间件 error,_request,response,_next 四个参数,用于处理错误
// express根据参数数量来判断中间件作用
const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next
) => {
  // 如果给前端的响应头已经发送了,是不能更改status的,不然会出问题
  if (response.headersSent) {
    _next(error);
    return;
  }

  console.error(
    "Unhandled server error",
  );

  response.status(500).json({
    code: "INTERNAL_ERROR",
    message: "服务器内部错误",
  });
}

app.use(errorHandler);

app.listen(
  env.SERVER_PORT,
  "127.0.0.1",
  () => {
    console.log(
      `Server running at http://127.0.0.1:${env.SERVER_PORT}`,
    )
  }
)
