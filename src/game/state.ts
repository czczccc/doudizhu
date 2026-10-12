/**
 * 对局状态机：发牌 → 叫分 → 出牌 → 结算。纯函数，界面和 AI 都只通过 applyAction 改变状态。
 *
 * 座位：0 = 你（下方），1 = 下家（右侧），2 = 上家（左侧）。出牌顺序 0 → 1 → 2。
 */
import { createDeck, removeCards, shuffle, sortCards, type Card } from "./cards";
import { isBomb, resolvePlay, type Combo } from "./patterns";

export type Seat = 0 | 1 | 2;
export const SEATS: Seat[] = [0, 1, 2];
export const nextSeat = (s: Seat): Seat => ((s + 1) % 3) as Seat;

export type Play = { seat: Seat; combo: Combo; cards: Card[] };
export type Turn = { seat: Seat; play: Play | null };

export type Phase = "bidding" | "playing" | "over";

export type GameResult = {
  winner: Seat;
  landlordWins: boolean;
  bid: number;
  bombs: number;
  spring: boolean;
  multiple: number;
  /** 每个座位本局得分 */
  delta: [number, number, number];
};

export type GameState = {
  phase: Phase;
  hands: [Card[], Card[], Card[]];
  bottom: Card[];
  landlord: Seat | null;
  turn: Seat;
  /** 叫分阶段每个座位的叫分：undefined 未叫，0 不叫 */
  bids: [number | undefined, number | undefined, number | undefined];
  highestBid: number;
  /** 当前要压的牌；null 表示轮到的人自由出牌 */
  lastPlay: Play | null;
  /** 当前这一轮桌面上每个座位的动作，用于展示 */
  table: [Turn | null, Turn | null, Turn | null];
  /** 整局的出牌记录 */
  history: Turn[];
  bombs: number;
  /** 每个座位出过几手牌（判断春天） */
  playCount: [number, number, number];
  result: GameResult | null;
  /** 因为无人叫分而重新发牌的次数 */
  redeals: number;
};

export type Action = { type: "bid"; seat: Seat; value: number } | { type: "play"; seat: Seat; cards: Card[] } | { type: "pass"; seat: Seat };

export function deal(random: () => number = Math.random, redeals = 0): GameState {
  const deck = shuffle(createDeck(), random);
  return {
    phase: "bidding",
    hands: [sortCards(deck.slice(0, 17)), sortCards(deck.slice(17, 34)), sortCards(deck.slice(34, 51))],
    bottom: deck.slice(51),
    landlord: null,
    turn: Math.floor(random() * 3) as Seat,
    bids: [undefined, undefined, undefined],
    highestBid: 0,
    lastPlay: null,
    table: [null, null, null],
    history: [],
    bombs: 0,
    playCount: [0, 0, 0],
    result: null,
    redeals,
  };
}

export class IllegalAction extends Error {}

const replaceAt = <T extends unknown[]>(arr: T, i: number, v: T[number]) => arr.map((x, j) => (j === i ? v : x)) as T;

/** 轮到这个座位时要压的牌（自己出的牌没人要时，可以自由出） */
export const targetFor = (s: GameState, seat: Seat): Combo | null =>
  s.lastPlay && s.lastPlay.seat !== seat ? s.lastPlay.combo : null;

export const isTeammate = (s: GameState, a: Seat, b: Seat) => a === b || (s.landlord !== null && a !== s.landlord && b !== s.landlord);

export function applyAction(s: GameState, action: Action, random: () => number = Math.random): GameState {
  if (action.seat !== s.turn) throw new IllegalAction("还没轮到你");

  if (action.type === "bid") {
    if (s.phase !== "bidding") throw new IllegalAction("现在不是叫分阶段");
    const v = action.value;
    if (![0, 1, 2, 3].includes(v)) throw new IllegalAction("叫分只能是 0–3");
    if (v !== 0 && v <= s.highestBid) throw new IllegalAction(`要叫比 ${s.highestBid} 分更高的分`);
    const bids = replaceAt(s.bids, action.seat, v);
    const highestBid = Math.max(s.highestBid, v);
    const done = v === 3 || bids.every((b) => b !== undefined);
    if (!done) return { ...s, bids, highestBid, turn: nextSeat(action.seat) };
    if (highestBid === 0) {
      // 都不叫：重新发牌
      return deal(random, s.redeals + 1);
    }
    const landlord = SEATS.find((seat) => bids[seat] === highestBid)!;
    return {
      ...s,
      bids,
      highestBid,
      phase: "playing",
      landlord,
      turn: landlord,
      hands: replaceAt(s.hands, landlord, sortCards([...s.hands[landlord], ...s.bottom])),
    };
  }

  if (s.phase !== "playing") throw new IllegalAction("现在不能出牌");
  const target = targetFor(s, action.seat);
  // 新一轮开始时清空桌面
  const table = s.lastPlay === null || s.lastPlay.seat === action.seat ? ([null, null, null] as GameState["table"]) : s.table;

  if (action.type === "pass") {
    if (!target) throw new IllegalAction("你是这一轮的第一手，必须出牌");
    const turn: Turn = { seat: action.seat, play: null };
    const next = nextSeat(action.seat);
    return {
      ...s,
      table: replaceAt(table, action.seat, turn),
      history: [...s.history, turn],
      turn: next,
    };
  }

  const hand = s.hands[action.seat];
  const ids = new Set(hand.map((c) => c.id));
  if (action.cards.length === 0 || !action.cards.every((c) => ids.has(c.id))) throw new IllegalAction("出的牌不在手里");
  if (new Set(action.cards.map((c) => c.id)).size !== action.cards.length) throw new IllegalAction("出的牌有重复");
  const combo = resolvePlay(
    action.cards.map((c) => c.rank),
    target,
  );
  if (!combo) throw new IllegalAction(target ? "这手牌管不上" : "不是合法的牌型");

  const play: Play = { seat: action.seat, combo, cards: sortCards(action.cards) };
  const turn: Turn = { seat: action.seat, play };
  const hands = replaceAt(s.hands, action.seat, removeCards(hand, action.cards));
  const playCount = replaceAt(s.playCount, action.seat, s.playCount[action.seat] + 1);
  const bombs = s.bombs + (isBomb(combo) ? 1 : 0);
  const next: GameState = {
    ...s,
    hands,
    playCount,
    bombs,
    lastPlay: play,
    table: replaceAt(table, action.seat, turn),
    history: [...s.history, turn],
    turn: nextSeat(action.seat),
  };
  if (hands[action.seat].length === 0) return finish(next, action.seat);
  return next;
}

function finish(s: GameState, winner: Seat): GameState {
  const landlord = s.landlord!;
  const landlordWins = winner === landlord;
  const farmers = SEATS.filter((x) => x !== landlord);
  // 春天：地主赢且农民一张没出；反春：农民赢且地主只出了一手
  const spring = landlordWins ? farmers.every((f) => s.playCount[f] === 0) : s.playCount[landlord] === 1;
  const multiple = 2 ** s.bombs * (spring ? 2 : 1);
  const unit = s.highestBid * multiple;
  const sign = landlordWins ? 1 : -1;
  const delta = SEATS.map((x) => (x === landlord ? 2 * unit * sign : -unit * sign)) as [number, number, number];
  return {
    ...s,
    phase: "over",
    result: { winner, landlordWins, bid: s.highestBid, bombs: s.bombs, spring, multiple, delta },
  };
}

/** 已经出过的牌（记牌器用） */
export const playedCards = (s: GameState) => s.history.flatMap((t) => t.play?.cards ?? []);
