/**
 * 牌的基本定义。
 * 点数用数字表示大小：3…10，J=11，Q=12，K=13，A=14，2=15，小王=16，大王=17。
 */

export type Suit = "spade" | "heart" | "club" | "diamond" | "joker";

export type Card = {
  /** 0–53，整副牌里唯一 */
  id: number;
  rank: number;
  suit: Suit;
};

export const RANK_A = 14;
export const RANK_2 = 15;
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;

const SUITS: Suit[] = ["spade", "heart", "club", "diamond"];

export const RANK_LABEL: Record<number, string> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
  16: "小王",
  17: "大王",
};

export const SUIT_SYMBOL: Record<Suit, string> = {
  spade: "♠",
  heart: "♥",
  club: "♣",
  diamond: "♦",
  joker: "",
};

export const isRed = (card: Card) => card.suit === "heart" || card.suit === "diamond" || card.rank === BIG_JOKER;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let rank = 3; rank <= RANK_2; rank++) {
    for (const suit of SUITS) deck.push({ id: id++, rank, suit });
  }
  deck.push({ id: id++, rank: SMALL_JOKER, suit: "joker" });
  deck.push({ id: id++, rank: BIG_JOKER, suit: "joker" });
  return deck;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 从大到小排：手牌展示和提示词都用这个顺序 */
export const sortCards = (cards: Card[]) =>
  cards.slice().sort((a, b) => b.rank - a.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));

/** 每个点数有几张 */
export function countRanks(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  return counts;
}

/** 文字形式，例如 “大王 2 2 K 9 9 9 3”，给大模型和日志用 */
export const cardsToText = (cards: Card[]) =>
  sortCards(cards)
    .map((c) => RANK_LABEL[c.rank])
    .join(" ");

const LABEL_TO_RANK: Record<string, number> = {
  ...Object.fromEntries(Object.entries(RANK_LABEL).map(([rank, label]) => [label.toUpperCase(), Number(rank)])),
  T: 10,
  "1": 14,
  X: SMALL_JOKER,
  D: BIG_JOKER,
  SJ: SMALL_JOKER,
  BJ: BIG_JOKER,
  JOKER: BIG_JOKER,
  小鬼: SMALL_JOKER,
  大鬼: BIG_JOKER,
};

/** 把 “10”“小王” 这类文字解析成点数；认不出返回 null */
export const parseRank = (label: string): number | null => LABEL_TO_RANK[label.trim().toUpperCase()] ?? null;

/**
 * 按点数从手牌里挑出具体的牌。手牌不够时返回 null。
 * 出牌只关心点数，花色由这里决定。
 */
export function pickByRanks(hand: Card[], ranks: number[]): Card[] | null {
  const pool = sortCards(hand).reverse();
  const used = new Set<number>();
  const out: Card[] = [];
  for (const rank of ranks) {
    const card = pool.find((c) => c.rank === rank && !used.has(c.id));
    if (!card) return null;
    used.add(card.id);
    out.push(card);
  }
  return out;
}

export const removeCards = (hand: Card[], cards: Card[]) => {
  const ids = new Set(cards.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
};
