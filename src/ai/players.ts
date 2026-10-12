/**
 * 对手：规则 AI 或大模型。大模型的回答会被严格校验，不合法时让它重答一次，再不行就由规则 AI 代打。
 */
import { botBid, botPlay } from "../game/bot";
import { parseRank, pickByRanks, type Card } from "../game/cards";
import { describeCombo, resolvePlay } from "../game/patterns";
import { SEATS, isTeammate, targetFor, type Action, type GameState, type Seat } from "../game/state";
import { BID_SCHEMA, PLAY_SCHEMA, SYSTEM_PROMPT, bidPrompt, playPrompt } from "./prompt";
import { providerById, type Effort, type LlmRequest, type LlmResponse } from "./providers";

export type SeatConfig = {
  kind: "bot" | "llm";
  /** 牌桌上显示的名字 */
  name: string;
  providerId: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  effort: Effort;
};

export const defaultSeats = (): [SeatConfig, SeatConfig] => [
  { kind: "llm", name: "Claude", providerId: "anthropic", model: "claude-opus-5-5", apiKey: "", baseUrl: "", effort: "low" },
  { kind: "bot", name: "老张", providerId: "deepseek", model: "deepseek-chat", apiKey: "", baseUrl: "", effort: "low" },
];

export const modelLabel = (c: SeatConfig) => (c.kind === "bot" ? "规则 AI" : c.model || (providerById(c.providerId)?.name ?? c.providerId));

/** 一次决策的记录，展示在侧栏 */
export type DecisionLog = {
  id: string;
  seat: Seat;
  name: string;
  model: string;
  phase: "bid" | "play";
  status: "running" | "done" | "error";
  /** 发给模型的局面描述 */
  prompt?: string;
  /** 模型原始回答（可能有多次） */
  replies: string[];
  /** 最终动作的文字描述 */
  summary?: string;
  /** 出错或被代打的原因 */
  note?: string;
  ms?: number;
};

export type Decision = { action: Action; say?: string; summary: string; note?: string };

/** 从模型回答里取出 JSON：兼容 ```json 代码块、前后多余文字 */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const cleanSay = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : undefined) || undefined;

/** 校验叫分回答 */
export function parseBid(s: GameState, seat: Seat, text: string): { ok: true; decision: Decision } | { ok: false; error: string } {
  const json = extractJson(text);
  if (!json) return { ok: false, error: "回答不是 JSON" };
  const bid = Number(json.bid);
  if (![0, 1, 2, 3].includes(bid)) return { ok: false, error: "bid 必须是 0、1、2、3 之一" };
  if (bid !== 0 && bid <= s.highestBid) return { ok: false, error: `只能叫比 ${s.highestBid} 更高的分，或者 0` };
  return {
    ok: true,
    decision: { action: { type: "bid", seat, value: bid }, say: cleanSay(json.say), summary: bid ? `叫 ${bid} 分` : "不叫" },
  };
}

/** 校验出牌回答：牌要在手里、牌型合法、能压过上家 */
export function parsePlay(s: GameState, seat: Seat, text: string): { ok: true; decision: Decision } | { ok: false; error: string } {
  const json = extractJson(text);
  if (!json) return { ok: false, error: "回答不是 JSON" };
  const target = targetFor(s, seat);
  const say = cleanSay(json.say);
  const labels = Array.isArray(json.cards) ? json.cards.map(String).flatMap((x) => x.trim().split(/\s+/)).filter(Boolean) : [];
  if (json.action === "pass" || labels.length === 0) {
    if (!target) return { ok: false, error: "这一轮你是第一手，必须出牌" };
    return { ok: true, decision: { action: { type: "pass", seat }, say, summary: "不出" } };
  }
  const ranks = labels.map(parseRank);
  const bad = labels.find((_, i) => ranks[i] === null);
  if (bad) return { ok: false, error: `看不懂的牌：${bad}` };
  const cards = pickByRanks(s.hands[seat], ranks as number[]);
  if (!cards) return { ok: false, error: `手里没有这些牌：${labels.join(" ")}` };
  const combo = resolvePlay(ranks as number[], target);
  if (!combo) {
    return { ok: false, error: target ? `${labels.join(" ")} 不是合法牌型，或者压不过 ${describeCombo(target)}` : `${labels.join(" ")} 不是合法牌型` };
  }
  return { ok: true, decision: { action: { type: "play", seat, cards }, say, summary: `出 ${describeCombo(combo)}` } };
}

/** 规则 AI 的决定 */
export function botDecision(s: GameState, seat: Seat): Decision {
  if (s.phase === "bidding") {
    const value = botBid(s.hands[seat], s.highestBid);
    return { action: { type: "bid", seat, value }, summary: value ? `叫 ${value} 分` : "不叫" };
  }
  const target = targetFor(s, seat);
  const enemies = SEATS.filter((x) => !isTeammate(s, seat, x));
  const move = botPlay({
    hand: s.hands[seat],
    target,
    targetIsTeammate: !!target && !!s.lastPlay && isTeammate(s, seat, s.lastPlay.seat),
    isLandlord: s.landlord === seat,
    enemyMinCards: Math.min(...enemies.map((e) => s.hands[e].length)),
  });
  if (!move) return { action: { type: "pass", seat }, summary: "不出" };
  const cards: Card[] = pickByRanks(s.hands[seat], move.ranks)!;
  return { action: { type: "play", seat, cards }, summary: `出 ${describeCombo(move)}` };
}

async function callLlm(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
  try {
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) return { ok: false, error: `本地代理返回 HTTP ${res.status}（需要用 npm run dev 或 npm start 启动）`, ms: 0 };
    return (await res.json()) as LlmResponse;
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: `连不上本地代理：${(error as Error).message}`, ms: 0 };
  }
}

/**
 * 让大模型做一次决定。onUpdate 用来实时更新侧栏的日志。
 * 回答不合法时把错误告诉模型重答一次；仍不合法或请求失败，就由规则 AI 代打。
 */
export async function llmDecision(
  s: GameState,
  seat: Seat,
  config: SeatConfig,
  names: [string, string, string],
  signal: AbortSignal,
  onUpdate: (patch: Partial<DecisionLog>) => void,
): Promise<Decision> {
  const bidding = s.phase === "bidding";
  const prompt = bidding ? bidPrompt(s, seat, names) : playPrompt(s, seat, names);
  const parse = bidding ? parseBid : parsePlay;
  const messages: LlmRequest["messages"] = [{ role: "user", content: prompt }];
  const replies: string[] = [];
  let ms = 0;
  onUpdate({ prompt, replies });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callLlm(
      {
        providerId: config.providerId,
        model: config.model,
        apiKey: config.apiKey || undefined,
        baseUrl: config.baseUrl || undefined,
        effort: config.effort,
        system: SYSTEM_PROMPT,
        messages,
        schema: bidding ? BID_SCHEMA : PLAY_SCHEMA,
      },
      signal,
    );
    ms += res.ms;
    if (!res.ok) {
      const fallback = botDecision(s, seat);
      return { ...fallback, note: `${res.error}。本步由规则 AI 代打。` };
    }
    replies.push(res.text);
    onUpdate({ replies: [...replies], ms });
    const parsed = parse(s, seat, res.text);
    if (parsed.ok) return parsed.decision;
    messages.push({ role: "assistant", content: res.text }, { role: "user", content: `这个回答不合法：${parsed.error}。请重新决定，只输出 JSON。` });
    if (attempt === 1) {
      const fallback = botDecision(s, seat);
      return { ...fallback, note: `两次回答都不合法（${parsed.error}），本步由规则 AI 代打。` };
    }
  }
  throw new Error("unreachable");
}
