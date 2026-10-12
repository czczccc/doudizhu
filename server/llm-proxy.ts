/**
 * 本地大模型代理：作为 Vite 插件挂在 dev / preview 服务器上，路径 POST /api/llm。
 *
 * 为什么需要它：大多数模型服务不允许浏览器跨域直连，而且 Key 放在服务端环境变量里更安全。
 * 浏览器只发“用哪家、哪个模型、提示词”，这里负责真正调用。
 */
import Anthropic from "@anthropic-ai/sdk";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { providerById, type LlmRequest, type LlmResponse } from "../src/ai/providers";

const TIMEOUT_MS = 90_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("请求体过大");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function resolveTarget(body: LlmRequest, env: Record<string, string>) {
  const provider = providerById(body.providerId);
  if (!provider) throw new Error(`未知的服务商：${body.providerId}`);
  if (!body.model?.trim()) throw new Error("没有填写模型名称");
  if (provider.id === "custom") {
    if (!body.baseUrl?.trim()) throw new Error("自定义服务商需要填写接口地址");
    // 自定义地址只能用浏览器里填的 Key，避免把服务端 Key 发到任意地址
    return { provider, baseUrl: body.baseUrl.trim().replace(/\/+$/, ""), apiKey: body.apiKey?.trim() ?? "" };
  }
  const apiKey = body.apiKey?.trim() || (provider.envKey ? env[provider.envKey] : "") || "";
  if (!apiKey && !provider.keyless) {
    throw new Error(`没有 API Key：在设置里填写，或在服务端设置环境变量 ${provider.envKey}`);
  }
  return { provider, baseUrl: provider.baseUrl, apiKey };
}

/** 支持服务端拒答兜底（fallbacks: "default"）的模型 */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

async function callAnthropic(body: LlmRequest, baseUrl: string, apiKey: string, signal: AbortSignal) {
  const client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 1 });
  const fallback = FALLBACK_MODELS.test(body.model);
  const response = await client.beta.messages.create(
    {
      model: body.model,
      max_tokens: 16000,
      system: body.system,
      messages: body.messages,
      output_config: {
        effort: body.effort ?? "low",
        ...(body.schema ? { format: { type: "json_schema" as const, schema: body.schema } } : {}),
      },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    },
    { signal },
  );
  if (response.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callOpenAiCompatible(body: LlmRequest, baseUrl: string, apiKey: string, signal: AbortSignal) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: body.model,
      messages: [{ role: "system", content: body.system }, ...body.messages],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("接口返回里没有文本内容");
  return content;
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "API Key 无效";
  if (error instanceof Anthropic.PermissionDeniedError) return "这个 Key 没有权限调用该模型";
  if (error instanceof Anthropic.NotFoundError) return "找不到这个模型，检查一下模型名称";
  if (error instanceof Anthropic.RateLimitError) return "请求太频繁，被限流了";
  if (error instanceof Anthropic.BadRequestError) return `请求参数有误：${error.message}`;
  if (error instanceof Anthropic.APIError) return `Claude 接口错误 ${error.status ?? ""}：${error.message}`;
  if (error instanceof Error) return error.name === "AbortError" ? "请求超时" : error.message;
  return String(error);
}

export async function handleLlm(body: LlmRequest, env: Record<string, string>): Promise<LlmResponse> {
  const started = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const { provider, baseUrl, apiKey } = resolveTarget(body, env);
    const text =
      provider.kind === "anthropic"
        ? await callAnthropic(body, baseUrl, apiKey, signal)
        : await callOpenAiCompatible(body, baseUrl, apiKey, signal);
    return { ok: true, text, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: describeError(error), ms: Date.now() - started };
  }
}

export function llmProxy(): Plugin {
  let env: Record<string, string> = {};
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== "/api/llm") return next();
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end();
    }
    let result: LlmResponse;
    try {
      result = await handleLlm((await readJson(req)) as LlmRequest, env);
    } catch (error) {
      result = { ok: false, error: describeError(error), ms: 0 };
    }
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
  };
  return {
    name: "doudizhu-llm-proxy",
    configResolved(config) {
      // 读取 .env 里所有变量（不只是 VITE_ 开头的），只在服务端使用，不会打包进前端
      env = { ...loadEnv(config.mode, config.root, ""), ...(process.env as Record<string, string>) };
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
