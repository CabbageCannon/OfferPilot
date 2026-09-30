# OfferPilot 求职面试 Agent

React + Express 的中文求职对话 Agent，支持任意岗位。聊天页是主入口：发送问题、上传或粘贴 JD/简历，在同一段对话里进行普通求职咨询、模拟面试、JD 匹配和公司背调。系统对每条消息做 LLM 意图识别并选择 Skill；结果留在会话消息中，可继续追问或修改。自定义 Skill 在设置中管理。产品范围与改造顺序见 [PRD](./docs/PRD.md) 和 [实施计划](./docs/IMPLEMENTATION_PLAN.md)。

## 本地运行

需要 Node.js 24。复制 `.env.example` 为 `.env`，填写至少一个模型密钥，然后运行：

```bash
npm install
npm run dev
```

打开 Vite 输出的地址；前端默认把 `/api` 代理到 `http://127.0.0.1:3001`。检查命令：`npm run build`、`npm run lint`、`node --import tsx --test server/**/*.test.ts`。

## 模型与路由

单模型配置使用 `AI_API_KEY`、`AI_API_BASE_URL`、`AI_MODEL`，可选 `AI_MODEL_NAME` 设置页面展示名。多模型可改用 `AI_MODELS` JSON 数组：

```env
AI_MODELS=[{"id":"model-a","name":"模型 A","baseUrl":"https://example.com/v1","model":"model-name","apiKey":"replace-me"},{"id":"model-b","name":"模型 B","baseUrl":"https://example.org/v1","model":"other-model","apiKey":"replace-me"}]
# AI_ROUTER_MODEL_ID=model-a
```

`AI_ROUTER_MODEL_ID` 可选，用于固定每条消息意图识别的服务端模型；留空时使用本轮选中的模型，未选则使用默认模型。聊天中切换的模型从下一条生成请求起生效，不清除已关联资料或进行中的面试。当前模型网关支持 OpenAI 兼容接口的流式文本与结构化 JSON；模型自身的工具调用尚未开放。密钥只放服务端，不要提交到仓库。

## 资料与公司搜索

输入区支持 PDF、DOCX、TXT、MD 的 JD/简历上传。粘贴的 JD 或简历文本按用户选定类型包装为 UTF-8 `.txt`，复用 `POST /api/documents`；原件和解析结果保存在忽略版本控制的 `data/`。扫描 PDF 暂无 OCR，会显示 `needs_ocr`，不会把空文本交给模型。

公司背调需配置受信任的 Streamable HTTP MCP 搜索服务：

```env
MCP_SEARCH_URL=https://mcp.example.com/mcp
MCP_SEARCH_TOOL=search
# MCP_SEARCH_TOKEN=replace-me
# MCP_SEARCH_QUERY_ARG=query
```

工具需返回公开网页 URL。未配置时返回 `MCP_NOT_CONFIGURED`；没有有效来源时只显示“未查到”，不会凭模型记忆生成公司事实。搜索服务地址、令牌和工具名都由服务端控制。

## 当前边界与下一步

本地版沿用 `POST /api/chat` SSE；面试、匹配和背调的服务端能力由聊天入口编排，完成结果展示在原会话中。原“定向简历草稿”是针对 JD 生成新简历的能力，目标是在聊天中返回可继续修改、需用户核验的文稿。内部任务记录可保留用于恢复，不提供独立的历史结果页面。

当前使用固定 `ownerId=local`，部分聊天历史仍在浏览器；**没有登录和真实用户隔离，不可作为公开产品部署**。公开 Web 版要先完成服务端完整会话、认证、双账号隔离、额度、删除与备份。未来微信小程序作为另一个客户端复用同一 Express 后端和 Skill/模型/MCP 运行器，客户端不保存服务端密钥。
