import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createModelGateway } from "./index";
import { ProviderError } from "../providers/xunfei";

const env = {
  AI_MODELS: JSON.stringify([
    { id: "first", apiKey: "secret-1", baseUrl: "https://first.example/v1", model: "chat-a" },
    { id: "second", apiKey: "secret-2", baseUrl: "https://second.example/v1", model: "chat-b" },
  ]),
};

test("lists two selectable models without exposing keys", async () => {
  const gateway = createModelGateway(env);
  assert.equal(gateway.defaultModelId, "first");
  assert.deepEqual(gateway.listModels().map(model => model.id), ["first", "second"]);
  assert.equal(JSON.stringify(gateway.listModels()).includes("secret"), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://second.example/v1/chat/completions");
    assert.equal(JSON.parse(String(init?.body)).model, "chat-b");
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"question":"你好"}' } }] }));
  };
  try {
    const answer = await gateway.generateObject("second", [{ role: "user", content: "提问" }], z.object({ question: z.string() }), new AbortController().signal);
    assert.deepEqual(answer, { question: "你好" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid structured output and streams compatible SSE", async () => {
  const gateway = createModelGateway(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (JSON.parse(String(init?.body)).stream) {
      return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"wrong":true}' } }] }));
  };
  try {
    await assert.rejects(
      gateway.generateObject("first", [], z.object({ question: z.string() }), new AbortController().signal),
      (error: unknown) => error instanceof ProviderError && error.code === "UPSTREAM_FORMAT_ERROR",
    );
    const events = [];
    for await (const event of gateway.streamText("first", [{ role: "user", content: "你好" }], new AbortController().signal)) events.push(event);
    assert.deepEqual(events, [{ type: "delta", content: "你好" }, { type: "done", finishReason: "stop" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses the configured single-model name and normalizes aborted requests", async () => {
  const gateway = createModelGateway({ AI_API_KEY: "legacy-key", AI_MODEL: "deepseek-flash" });
  assert.equal(gateway.defaultModelId, "xunfei");
  assert.equal(gateway.listModels()[0].name, "deepseek-flash");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException("Aborted", "AbortError"); };
  try {
    await assert.rejects(
      gateway.generateObject("xunfei", [], z.object({ value: z.string() }), new AbortController().signal),
      (error: unknown) => error instanceof ProviderError && error.code === "REQUEST_ABORTED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects tool capability until tool calls are implemented", () => {
  assert.throws(
    () => createModelGateway({ AI_MODELS: JSON.stringify([{ id: "tools", apiKey: "key", baseUrl: "https://example.com/v1", model: "chat", capabilities: { tools: true } }]) }),
    (error: unknown) => error instanceof ProviderError && error.code === "MODEL_CONFIG_ERROR",
  );
});
