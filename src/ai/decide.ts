/**
 * 大模型决策：浏览器和服务端共用。
 *
 * 浏览器只把“对局状态”（牌用 id 表示）发给服务端；服务端用整副标准牌重建状态、校验合法性，
 * 再用固定模板拼提示词并调用模型。这样接口无法被拿去当通用的大模型代理：
 * 能进入提示词的只有固定文字、牌面和清洗过的短名字。
 */
import { createDeck, parseRank, pickByRanks, type Card } from "../game/cards";
import { analyze, describeCombo, resolvePlay } from "../game/patterns";
import { targetFor, type Action, type GameState, type Play, type Seat, type Turn } from "../game/state";
import { BID_SCHEMA, PLAY_SCHEMA, SYSTEM_PROMPT, bidPrompt, playPrompt } from "./prompt";
import type { Effort } from "./providers";

export type Decision = { action: Action; say?: string; summary: string; note?: string };

// ———————————————————————— 回答解析 ————————————————————————

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

type Parsed = { ok: true; decision: Decision } | { ok: false; error: string };

/** 校验叫分回答 */
export function parseBid(s: GameState, seat: Seat, text: string): Parsed {
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
export function parsePlay(s: GameState, seat: Seat, text: string): Parsed {
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
  if (bad) return { ok: false, error: `看不懂的牌：${bad.slice(0, 10)}` };
  const cards = pickByRanks(s.hands[seat], ranks as number[]);
  if (!cards) return { ok: false, error: `手里没有这些牌：${labels.join(" ")}` };
  const combo = resolvePlay(ranks as number[], target);
  if (!combo) {
    return { ok: false, error: target ? `${labels.join(" ")} 不是合法牌型，或者压不过 ${describeCombo(target)}` : `${labels.join(" ")} 不是合法牌型` };
  }
  return { ok: true, decision: { action: { type: "play", seat, cards }, say, summary: `出 ${describeCombo(combo)}` } };
}

// ———————————————————————— 请求与校验 ————————————————————————

/** 发给服务端的对局状态：牌一律用 id（0–53） */
export type GameWire = {
  phase: "bidding" | "playing";
  hands: [number[], number[], number[]];
  bottom: number[];
  landlord: Seat | null;
  turn: Seat;
  bids: (number | null)[];
  highestBid: number;
  bombs: number;
  lastPlay: { seat: Seat; cards: number[] } | null;
  history: { seat: Seat; cards: number[] | null }[];
};

export type PlayerWire = {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  effort?: Effort;
};

export type MoveRequest = { seat: Seat; names: [string, string, string]; player: PlayerWire; game: GameWire };

export type Move = { type: "bid"; value: number } | { type: "play"; cards: number[] } | { type: "pass" };

export type MoveResponse =
  | { ok: true; move: Move; say?: string; summary: string; note?: string; prompt: string; replies: string[]; ms: number }
  | { ok: false; error: string; prompt?: string; replies?: string[]; ms: number };

const ids = (cards: Card[]) => cards.map((c) => c.id);

export function encodeGame(s: GameState): GameWire {
  if (s.phase === "over") throw new Error("对局已结束");
  return {
    phase: s.phase,
    hands: [ids(s.hands[0]), ids(s.hands[1]), ids(s.hands[2])],
    bottom: ids(s.bottom),
    landlord: s.landlord,
    turn: s.turn,
    bids: s.bids.map((b) => b ?? null),
    highestBid: s.highestBid,
    bombs: s.bombs,
    lastPlay: s.lastPlay ? { seat: s.lastPlay.seat, cards: ids(s.lastPlay.cards) } : null,
    history: s.history.map((t) => ({ seat: t.seat, cards: t.play ? ids(t.play.cards) : null })),
  };
}

export class BadRequest extends Error {}

const DECK = createDeck();
const isSeat = (v: unknown): v is Seat => v === 0 || v === 1 || v === 2;
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function cardList(v: unknown, max: number, what: string): Card[] {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => isInt(x, 0, 53))) throw new BadRequest(`${what}格式不对`);
  if (new Set(v).size !== v.length) throw new BadRequest(`${what}有重复的牌`);
  return v.map((id: number) => DECK[id]);
}

/** 名字只保留文字、数字和少量符号，最多 8 个字 */
export const cleanName = (v: unknown, fallback: string) =>
  (typeof v === "string" ? v.replace(/[^\p{L}\p{N} ·_-]/gu, "").trim().slice(0, 8) : "") || fallback;

/**
 * 把浏览器发来的请求还原成可信的对局状态。任何不符合斗地主规则的结构都会被拒绝。
 * 牌只取 id，点数和花色以服务端的标准牌为准；所有牌型由服务端重新识别。
 */
export function parseMoveRequest(raw: unknown): { seat: Seat; names: [string, string, string]; player: PlayerWire; state: GameState } {
  if (!raw || typeof raw !== "object") throw new BadRequest("请求格式不对");
  const r = raw as Record<string, unknown>;
  const g = r.game as Record<string, unknown> | undefined;
  const p = r.player as Record<string, unknown> | undefined;
  if (!g || typeof g !== "object" || !p || typeof p !== "object") throw new BadRequest("请求格式不对");
  if (!isSeat(r.seat) || r.seat === 0) throw new BadRequest("座位不对");
  const seat = r.seat;
  if (g.phase !== "bidding" && g.phase !== "playing") throw new BadRequest("阶段不对");
  if (g.turn !== seat) throw new BadRequest("还没轮到这个座位");

  const handsRaw = g.hands;
  if (!Array.isArray(handsRaw) || handsRaw.length !== 3) throw new BadRequest("手牌格式不对");
  const hands = handsRaw.map((h, i) => cardList(h, 20, `座位 ${i} 的手牌`)) as [Card[], Card[], Card[]];
  const bottom = cardList(g.bottom, 3, "底牌");
  if (bottom.length !== 3) throw new BadRequest("底牌要有 3 张");

  const landlord = g.landlord === null ? null : isSeat(g.landlord) ? g.landlord : undefined;
  if (landlord === undefined) throw new BadRequest("地主格式不对");
  if ((g.phase === "playing") !== (landlord !== null)) throw new BadRequest("地主和阶段不一致");
  if (!isInt(g.highestBid, 0, 3) || !isInt(g.bombs, 0, 20)) throw new BadRequest("分数格式不对");
  const bidsRaw = g.bids;
  if (!Array.isArray(bidsRaw) || bidsRaw.length !== 3 || !bidsRaw.every((b) => b === null || isInt(b, 0, 3))) throw new BadRequest("叫分格式不对");
  const bids = bidsRaw.map((b) => (b === null ? undefined : b)) as GameState["bids"];

  const historyRaw = g.history;
  if (!Array.isArray(historyRaw) || historyRaw.length > 200) throw new BadRequest("出牌记录格式不对");
  const history: Turn[] = historyRaw.map((t: unknown) => {
    const turn = t as { seat?: unknown; cards?: unknown };
    if (!turn || !isSeat(turn.seat)) throw new BadRequest("出牌记录格式不对");
    if (turn.cards === null) return { seat: turn.seat, play: null };
    const cards = cardList(turn.cards, 20, "出牌记录");
    const combo = analyze(cards.map((c) => c.rank));
    if (!combo) throw new BadRequest("出牌记录里有不合法的牌型");
    return { seat: turn.seat, play: { seat: turn.seat, combo, cards } };
  });

  // 手牌和打出过的牌不能重叠，也不能超过一副牌
  const all = [...hands.flat(), ...history.flatMap((t) => t.play?.cards ?? [])].map((c) => c.id);
  if (new Set(all).size !== all.length) throw new BadRequest("同一张牌出现了两次");
  if (hands[seat].length === 0) throw new BadRequest("这个座位已经没牌了");

  let lastPlay: Play | null = null;
  if (g.lastPlay !== null) {
    const lp = g.lastPlay as { seat?: unknown; cards?: unknown } | undefined;
    if (!lp || !isSeat(lp.seat)) throw new BadRequest("上一手牌格式不对");
    const cards = cardList(lp.cards, 20, "上一手牌");
    const combo = analyze(cards.map((c) => c.rank));
    if (!combo) throw new BadRequest("上一手牌不是合法牌型");
    lastPlay = { seat: lp.seat, combo, cards };
  }

  const namesRaw = Array.isArray(r.names) ? r.names : [];
  const names: [string, string, string] = [cleanName(namesRaw[0], "玩家"), cleanName(namesRaw[1], "下家"), cleanName(namesRaw[2], "上家")];
  names[0] = "玩家";

  const effort = p.effort === "medium" || p.effort === "high" ? p.effort : "low";
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const player: PlayerWire = {
    providerId: str(p.providerId, 40),
    model: str(p.model, 100),
    apiKey: str(p.apiKey, 400) || undefined,
    baseUrl: str(p.baseUrl, 300) || undefined,
    effort,
  };

  const state: GameState = {
    phase: g.phase,
    hands,
    bottom,
    landlord,
    turn: seat,
    bids,
    highestBid: g.highestBid,
    lastPlay,
    table: [null, null, null],
    history,
    bombs: g.bombs,
    playCount: [0, 0, 0],
    result: null,
    redeals: 0,
  };
  return { seat, names, player, state };
}

// ———————————————————————— 决策循环 ————————————————————————

export type ChatMessage = { role: "user" | "assistant"; content: string };
/** 调用一次模型：固定的系统提示和输出格式由调用方补上 */
export type AskModel = (req: { system: string; messages: ChatMessage[]; schema: Record<string, unknown> }) => Promise<string>;

/**
 * 让模型做一次决定：回答不合法时把错误告诉它重答一次。
 * 两次都不合法或请求出错时返回 ok: false，由浏览器端的规则 AI 代打。
 */
export async function runDecision(
  s: GameState,
  seat: Seat,
  names: [string, string, string],
  ask: AskModel,
): Promise<{ ok: true; decision: Decision; prompt: string; replies: string[] } | { ok: false; error: string; prompt: string; replies: string[] }> {
  const bidding = s.phase === "bidding";
  const prompt = bidding ? bidPrompt(s, seat, names) : playPrompt(s, seat, names);
  const parse = bidding ? parseBid : parsePlay;
  const schema = bidding ? BID_SCHEMA : PLAY_SCHEMA;
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];
  const replies: string[] = [];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await ask({ system: SYSTEM_PROMPT, messages, schema });
    } catch (error) {
      return { ok: false, error: (error as Error).message, prompt, replies };
    }
    replies.push(text);
    const parsed = parse(s, seat, text);
    if (parsed.ok) return { ok: true, decision: parsed.decision, prompt, replies };
    lastError = parsed.error;
    messages.push({ role: "assistant", content: text }, { role: "user", content: `这个回答不合法：${parsed.error}。请重新决定，只输出 JSON。` });
  }
  return { ok: false, error: `两次回答都不合法（${lastError}）`, prompt, replies };
}

export const toMove = (a: Action): Move =>
  a.type === "bid" ? { type: "bid", value: a.value } : a.type === "pass" ? { type: "pass" } : { type: "play", cards: ids(a.cards) };
