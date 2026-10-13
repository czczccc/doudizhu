/**
 * 对手：规则 AI 或大模型。大模型的提示词和回答校验都在服务端（见 decide.ts 和 server/llm-proxy.ts）。
 */
import { botBid, botPlay } from "../game/bot";
import { pickByRanks, type Card } from "../game/cards";
import { describeCombo } from "../game/patterns";
import { SEATS, applyAction, isTeammate, targetFor, type Action, type GameState, type Seat } from "../game/state";
import { encodeGame, type Decision, type MoveRequest, type MoveResponse } from "./decide";
import { providerById, type Effort } from "./providers";

export type { Decision } from "./decide";

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

/**
 * 让大模型做一次决定：把对局状态交给服务端，服务端拼提示词、调用模型、校验回答后返回要出的牌。
 * 请求失败或回答两次都不合法时，由规则 AI 代打。
 */
export async function llmDecision(
  s: GameState,
  seat: Seat,
  config: SeatConfig,
  names: [string, string, string],
  accessPassword: string,
  signal: AbortSignal,
): Promise<{ decision: Decision; prompt?: string; replies: string[]; ms?: number }> {
  const request: MoveRequest = {
    seat,
    names,
    player: {
      providerId: config.providerId,
      model: config.model,
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl || undefined,
      effort: config.effort,
    },
    game: encodeGame(s),
  };
  let res: MoveResponse;
  try {
    const http = await fetch("/api/move", {
      method: "POST",
      headers: { "content-type": "application/json", ...(accessPassword ? { "x-access-password": accessPassword } : {}) },
      body: JSON.stringify(request),
      signal,
    });
    const text = await http.text();
    try {
      res = JSON.parse(text) as MoveResponse;
    } catch {
      res = { ok: false, error: `出牌接口返回 HTTP ${http.status}（需要用 npm run dev 或 npm start 启动）`, ms: 0 };
    }
  } catch (error) {
    if (signal.aborted) throw error;
    res = { ok: false, error: `连不上出牌接口：${(error as Error).message}`, ms: 0 };
  }

  const fallback = (why: string) => ({ ...botDecision(s, seat), note: `${why}。本步由规则 AI 代打。` });
  const meta = { prompt: res.prompt, replies: res.replies ?? [], ms: res.ms || undefined };
  if (!res.ok) return { decision: fallback(res.error), ...meta };

  const move = res.move;
  let action: Action | null = null;
  if (move.type === "bid") action = { type: "bid", seat, value: move.value };
  else if (move.type === "pass") action = { type: "pass", seat };
  else {
    const hand = new Map(s.hands[seat].map((c) => [c.id, c]));
    const cards = move.cards.map((id) => hand.get(id));
    if (cards.every((c): c is Card => !!c)) action = { type: "play", seat, cards };
  }
  // 服务端已经校验过；这里再用本地状态确认一遍，防止状态不同步
  try {
    if (!action) throw new Error();
    applyAction(s, action);
  } catch {
    return { decision: fallback("服务端返回的出牌和本地局面对不上"), ...meta };
  }
  return { decision: { action, say: res.say, summary: res.summary }, ...meta };
}
