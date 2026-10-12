/**
 * 大模型服务商。浏览器和本地代理（server/llm-proxy.ts）共用这份配置。
 *
 * - anthropic：Claude，走官方 SDK
 * - openai：任何 OpenAI 兼容的 /chat/completions 接口（DeepSeek、通义千问、Kimi、智谱、Ollama……）
 *
 * 服务端环境变量里的 Key 只会发往这里登记的官方地址；“自定义”服务商必须在浏览器里填 Key。
 */

export type ProviderKind = "anthropic" | "openai";

export type Provider = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** 服务端读取的环境变量名 */
  envKey?: string;
  models: string[];
  /** 不需要 Key（本地模型） */
  keyless?: boolean;
};

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-5", "gpt-5-mini"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "qwen",
    name: "通义千问",
    kind: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: "DASHSCOPE_API_KEY",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
  },
  {
    id: "moonshot",
    name: "Kimi",
    kind: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    envKey: "MOONSHOT_API_KEY",
    models: ["kimi-k2-turbo-preview", "moonshot-v1-8k"],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    kind: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKey: "ZHIPU_API_KEY",
    models: ["glm-4.6", "glm-4-flash"],
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["qwen3", "llama3.1"],
    keyless: true,
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    kind: "openai",
    baseUrl: "",
    models: [],
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

/** Claude 的思考力度；对局里每一步都要等，默认用 low 保证节奏 */
export type Effort = "low" | "medium" | "high";

/** 浏览器发给本地代理的请求 */
export type LlmRequest = {
  providerId: string;
  model: string;
  /** 浏览器里填的 Key；留空则用服务端环境变量 */
  apiKey?: string;
  /** 仅“自定义”服务商使用 */
  baseUrl?: string;
  effort?: Effort;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** 希望模型返回的 JSON 结构（Claude 用结构化输出强制，其他模型写在提示词里） */
  schema?: Record<string, unknown>;
};

export type LlmResponse = { ok: true; text: string; ms: number } | { ok: false; error: string; ms: number };
