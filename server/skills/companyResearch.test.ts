import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelGateway } from "../llm";
import { McpSearchError, searchCompanySources, sourcesFromToolResult, type SearchSource } from "../mcp/search";
import { builtInSkills } from "./catalog";
import { CompanyResearchError, runCompanyResearch } from "./companyResearch";

test("MCP 未配置、无来源与引用约束", async () => {
  await assert.rejects(searchCompanySources("示例公司", {}), (error: unknown) =>
    error instanceof McpSearchError && error.status === 503 && error.code === "MCP_NOT_CONFIGURED");

  const extracted = sourcesFromToolResult({ content: [{ type: "text", text: JSON.stringify({ results: [
    { title: "官网", url: "https://example.com/about", snippet: "公司介绍" },
  ] }) }] }, "2026-09-30T00:00:00.000Z");
  assert.equal(extracted[0].url, "https://example.com/about");

  let calls = 0;
  let generated = { findings: [{ claim: "官网有公司介绍", category: "官网", sourceUrls: ["https://example.com/about"] }], questions: ["招聘主体是否为该公司？"] };
  const gateway = {
    listModels: () => [{ id: "test", capabilities: { structured: true } }],
    generateObject: async () => { calls += 1; return generated; },
  } as unknown as ModelGateway;
  const skill = builtInSkills.find(item => item.id === "company-research");
  assert.ok(skill);
  const input = { modelId: "test", companyName: "示例公司", skill };

  const noSources = await runCompanyResearch(gateway, input, async () => []);
  assert.equal(noSources.findings.length, 0);
  assert.match(noSources.summary, /未查到/);
  assert.equal(calls, 0);

  const source: SearchSource = { title: "官网", url: "https://example.com/about", accessedAt: "2026-09-30T00:00:00.000Z", snippet: "公司介绍" };
  const report = await runCompanyResearch(gateway, input, async () => [source]);
  assert.deepEqual(report.findings[0].sourceUrls, [source.url]);
  assert.equal(report.sources[0].accessedAt, source.accessedAt);

  generated = { findings: [{ claim: "凭空信息", category: "官网", sourceUrls: ["https://not-found.example/"] }], questions: [] };
  await assert.rejects(runCompanyResearch(gateway, input, async () => [source]), (error: unknown) =>
    error instanceof CompanyResearchError && error.code === "UNGROUNDED_REPORT");
});
