/**
 * 大模型出牌接口：作为 Vite 插件挂在 dev / preview 服务器上，路径 POST /api/move。
 *
 * 浏览器只发对局状态；提示词、输出格式由这里按固定模板生成，模型的回答在这里校验，
 * 只把“出什么牌”返回给浏览器。因此这个接口不能被拿去当通用的大模型代理。
 *
 * 另外的防护（都可以用环境变量调整）：
 * - 使用服务端 Key 时，模型必须在白名单里（LLM_ALLOWED_MODELS，默认是各服务商的预设模型）
 * - 自定义接口地址、本地 Ollama 会让服务器去请求任意地址，部署时默认关闭（LLM_ALLOW_CUSTOM_ENDPOINTS）
 * - 每个 IP 每分钟最多 LLM_RATE_LIMIT 次（默认 40）
 * - 设置了 ACCESS_PASSWORD 时，请求必须带正确的访问密码
 */
import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import { BadRequest, parseMoveRequest, runDecision, toMove, type AskModel, type MoveResponse, type PlayerWire } from "../src/ai/decide";
import { providerById, type Provider } from "../src/ai/providers";

const TIMEOUT_MS = 90_000;
const MAX_BODY = 64_000;

export type ProxyOptions = {
  env: Record<string, string | undefined>;
  /** 是否允许自定义接口地址和本地模型（开发服务器默认允许，部署默认不允许） */
  allowCustomEndpoints: boolean;
};

class Forbidden extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BadRequest("请求体过大");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("请求不是 JSON");
  }
}

/** 使用服务端 Key 时允许的模型 */
export function allowedModels(provider: Provider, env: ProxyOptions["env"]): string[] {
  const list = env.LLM_ALLOWED_MODELS?.split(",").map((m) => m.trim()).filter(Boolean);
  return list?.length ? list : provider.models;
}

/** 决定这次请求发往哪里、用哪个 Key；不符合策略时抛出 Forbidden */
export function resolveTarget(player: PlayerWire, opts: ProxyOptions) {
  const provider = providerById(player.providerId);
  if (!provider) throw new BadRequest("未知的服务商");
  if (!player.model) throw new BadRequest("没有填写模型名称");

  if (provider.id === "custom" || provider.keyless) {
    if (!opts.allowCustomEndpoints) throw new Forbidden("服务器没有开放自定义接口和本地模型（LLM_ALLOW_CUSTOM_ENDPOINTS）");
    if (provider.id === "custom") {
      const url = player.baseUrl ?? "";
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new BadRequest("自定义服务商需要填写 http(s) 接口地址");
      // 自定义地址只能用浏览器里填的 Key，避免把服务端 Key 发到任意地址
      return { provider, baseUrl: url.replace(/\/+$/, ""), apiKey: player.apiKey ?? "" };
    }
    return { provider, baseUrl: provider.baseUrl, apiKey: "" };
  }

  // 自带 Key：花的是玩家自己的额度，模型随意
  if (player.apiKey) return { provider, baseUrl: provider.baseUrl, apiKey: player.apiKey };

  const serverKey = provider.envKey ? opts.env[provider.envKey] : undefined;
  if (!serverKey) throw new Forbidden(`没有 API Key：在设置里填写，或在服务端设置环境变量 ${provider.envKey}`);
  const allowed = allowedModels(provider, opts.env);
  if (!allowed.includes(player.model)) {
    throw new Forbidden(`服务端 Key 只能用这些模型：${allowed.join("、")}。其他模型请在设置里填自己的 Key`);
  }
  return { provider, baseUrl: provider.baseUrl, apiKey: serverKey };
}

/** 支持服务端拒答兜底（fallbacks: "default"）的模型 */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

function askAnthropic(player: PlayerWire, baseUrl: string, apiKey: string, signal: AbortSignal): AskModel {
  const client = new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 1 });
  const fallback = FALLBACK_MODELS.test(player.model);
  return async ({ system, messages, schema }) => {
    const response = await client.beta.messages.create(
      {
        model: player.model,
        max_tokens: 16000,
        system,
        messages,
        output_config: { effort: player.effort ?? "low", format: { type: "json_schema", schema } },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal },
    );
    if (response.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  };
}

function askOpenAiCompatible(player: PlayerWire, baseUrl: string, apiKey: string, signal: AbortSignal): AskModel {
  return async ({ system, messages }) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: player.model, messages: [{ role: "system", content: system }, ...messages] }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 200)}`);
    const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("接口返回里没有文本内容");
    return content;
  };
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "API Key 无效";
  if (error instanceof Anthropic.PermissionDeniedError) return "这个 Key 没有权限调用该模型";
  if (error instanceof Anthropic.NotFoundError) return "找不到这个模型，检查一下模型名称";
  if (error instanceof Anthropic.RateLimitError) return "请求太频繁，被限流了";
  if (error instanceof Anthropic.BadRequestError) return `请求参数有误：${error.message}`;
  if (error instanceof Anthropic.APIError) return `Claude 接口错误 ${error.status ?? ""}：${error.message}`;
  if (error instanceof Error) return error.name === "AbortError" || error.name === "TimeoutError" ? "请求超时" : error.message;
  return String(error);
}

/** 处理一次出牌请求（不含限流和访问密码，便于测试） */
export async function handleMove(raw: unknown, opts: ProxyOptions): Promise<{ status: number; body: MoveResponse }> {
  const started = Date.now();
  try {
    const { seat, names, player, state } = parseMoveRequest(raw);
    const { provider, baseUrl, apiKey } = resolveTarget(player, opts);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const ask = provider.kind === "anthropic" ? askAnthropic(player, baseUrl, apiKey, signal) : askOpenAiCompatible(player, baseUrl, apiKey, signal);
    const wrapped: AskModel = async (req) => {
      try {
        return await ask(req);
      } catch (error) {
        throw new Error(describeError(error));
      }
    };
    const result = await runDecision(state, seat, names, wrapped);
    const ms = Date.now() - started;
    if (!result.ok) return { status: 200, body: { ok: false, error: result.error, prompt: result.prompt, replies: result.replies, ms } };
    const { decision } = result;
    return {
      status: 200,
      body: { ok: true, move: toMove(decision.action), say: decision.say, summary: decision.summary, prompt: result.prompt, replies: result.replies, ms },
    };
  } catch (error) {
    const ms = Date.now() - started;
    if (error instanceof BadRequest) return { status: 400, body: { ok: false, error: error.message, ms } };
    if (error instanceof Forbidden) return { status: 403, body: { ok: false, error: error.message, ms } };
    return { status: 500, body: { ok: false, error: describeError(error), ms } };
  }
}

/** 简单的按 IP 固定窗口限流 */
export function rateLimiter(limitPerMinute: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || now - h.start >= 60_000) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= 60_000) hits.delete(k);
      return true;
    }
    h.count++;
    return h.count <= limitPerMinute;
  };
}

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function llmProxy(): Plugin {
  let env: Record<string, string | undefined> = {};
  const truthy = (v?: string) => v === "1" || v?.toLowerCase() === "true";

  const middleware = (allowCustomDefault: boolean) => {
    const opts = (): ProxyOptions => ({
      env,
      allowCustomEndpoints: env.LLM_ALLOW_CUSTOM_ENDPOINTS === undefined ? allowCustomDefault : truthy(env.LLM_ALLOW_CUSTOM_ENDPOINTS),
    });
    let limit: ReturnType<typeof rateLimiter> | null = null;
    return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (req.url !== "/api/move") return next();
      const send = (status: number, body: MoveResponse) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      };
      if (req.method !== "POST") return send(405, { ok: false, error: "只支持 POST", ms: 0 });

      const password = env.ACCESS_PASSWORD;
      const given = req.headers["x-access-password"];
      if (password && !(typeof given === "string" && sameSecret(given, password))) {
        return send(401, { ok: false, error: "需要访问密码：在对手设置里填写", ms: 0 });
      }

      limit ??= rateLimiter(Number(env.LLM_RATE_LIMIT) || 40);
      const forwarded = truthy(env.TRUST_PROXY) ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
      const ip = forwarded || req.socket.remoteAddress || "unknown";
      if (!limit(ip)) return send(429, { ok: false, error: "请求太频繁，稍后再试", ms: 0 });

      let raw: unknown;
      try {
        raw = await readJson(req);
      } catch (error) {
        return send(400, { ok: false, error: (error as Error).message, ms: 0 });
      }
      const { status, body } = await handleMove(raw, opts());
      send(status, body);
    };
  };

  return {
    name: "doudizhu-llm-proxy",
    configResolved(config) {
      // 读取 .env 里所有变量（不只是 VITE_ 开头的），只在服务端使用，不会打包进前端
      env = { ...loadEnv(config.mode, config.root, ""), ...process.env };
    },
    configureServer(server) {
      server.middlewares.use(middleware(true));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(false));
    },
  };
}
