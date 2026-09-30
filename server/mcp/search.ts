import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type SearchSource = { title: string; url: string; accessedAt: string; snippet: string };

export class McpSearchError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function config(env: NodeJS.ProcessEnv) {
  const endpoint = env.MCP_SEARCH_URL?.trim();
  const tool = env.MCP_SEARCH_TOOL?.trim();
  if (!endpoint || !tool) {
    throw new McpSearchError("MCP_NOT_CONFIGURED", "公司背调搜索尚未配置，请设置服务端 MCP_SEARCH_URL 和 MCP_SEARCH_TOOL", 503);
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new McpSearchError("MCP_CONFIG_ERROR", "MCP_SEARCH_URL 配置无效", 503);
  }
  if (!(["https:", "http:"].includes(url.protocol)) || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new McpSearchError("MCP_CONFIG_ERROR", "MCP 搜索地址须使用 HTTPS，本机开发可使用 HTTP", 503);
  }
  const queryArg = env.MCP_SEARCH_QUERY_ARG?.trim() || "query";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(queryArg)) {
    throw new McpSearchError("MCP_CONFIG_ERROR", "MCP_SEARCH_QUERY_ARG 配置无效", 503);
  }
  return { url, tool, queryArg, token: env.MCP_SEARCH_TOKEN?.trim() };
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.replace(/[.,;，。；]+$/, ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function sourcesFromToolResult(result: unknown, accessedAt: string): SearchSource[] {
  const sources = new Map<string, SearchSource>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6 || sources.size >= 20 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value === "string") {
      try {
        visit(JSON.parse(value) as unknown, depth + 1);
      } catch {
        for (const match of value.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
          const url = webUrl(match[0]);
          if (url && !sources.has(url)) {
            sources.set(url, { title: new URL(url).hostname, url, accessedAt, snippet: value.slice(Math.max(0, match.index - 160), match.index + match[0].length + 300).slice(0, 500) });
          }
        }
      }
      return;
    }
    if (typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const url = webUrl(item.url ?? item.link ?? item.href ?? item.sourceUrl);
    if (url && !sources.has(url)) {
      const title = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : new URL(url).hostname;
      const snippet = [item.snippet, item.description, item.summary, item.text].find(part => typeof part === "string") as string | undefined;
      sources.set(url, { title: title.slice(0, 160), url, accessedAt, snippet: (snippet ?? "").slice(0, 800) });
    }
    for (const nested of Object.values(item)) visit(nested, depth + 1);
  };
  visit(result);
  return [...sources.values()];
}

export async function searchCompanySources(companyName: string, env: NodeJS.ProcessEnv = process.env): Promise<SearchSource[]> {
  const { url, tool, queryArg, token } = config(env);
  const client = new Client({ name: "interview-agent-company-research", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const signal = AbortSignal.timeout(30_000);
  try {
    await client.connect(transport, { signal, timeout: 10_000 });
    const sources = new Map<string, SearchSource>();
    for (const subject of ["官网 招聘 主体", "企业文化 近期新闻 公开评价"]) {
      const result = await client.callTool({ name: tool, arguments: { [queryArg]: `${companyName} ${subject}` } }, undefined, { signal, timeout: 15_000 });
      if (result.isError) throw new Error("MCP tool returned an error");
      const accessedAt = new Date().toISOString();
      for (const source of sourcesFromToolResult([result.structuredContent, result.content], accessedAt)) {
        if (!sources.has(source.url)) sources.set(source.url, source);
      }
    }
    return [...sources.values()].slice(0, 12);
  } catch {
    throw new McpSearchError("MCP_SEARCH_FAILED", "公司资料搜索失败，请检查 MCP 服务后重试", 502);
  } finally {
    await client.close().catch(() => undefined);
  }
}
