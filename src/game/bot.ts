/**
 * 规则 AI：不依赖大模型的本地对手，也是大模型出错时的兜底，以及“提示”按钮的来源。
 * 思路是先把手牌拆成若干“手”（能一次出完的组合），出牌时尽量少增加手数、先出小牌。
 */
import { BIG_JOKER, RANK_2, RANK_A, SMALL_JOKER, countRanks, pickByRanks, removeCards, type Card } from "./cards";
import { legalMoves } from "./moves";
import { isBomb, resolvePlay, type Combo, type ComboType } from "./patterns";

const repeat = (rank: number, n: number) => Array<number>(n).fill(rank);
const mk = (type: ComboType, main: number, length: number, ranks: number[]): Combo => ({
  type,
  main,
  length,
  ranks: ranks.slice().sort((a, b) => b - a),
});

/** 把手牌拆成若干手。贪心，不求最优，但足够稳定。 */
export function decompose(hand: Card[]): Combo[] {
  const m = countRanks(hand);
  const left = (r: number) => m.get(r) ?? 0;
  const take = (r: number, n: number) => m.set(r, left(r) - n);
  const groups: Combo[] = [];

  if (left(SMALL_JOKER) && left(BIG_JOKER)) {
    groups.push(mk("rocket", BIG_JOKER, 1, [BIG_JOKER, SMALL_JOKER]));
    take(SMALL_JOKER, 1);
    take(BIG_JOKER, 1);
  }
  for (let r = 3; r <= RANK_2; r++) {
    if (left(r) === 4) {
      groups.push(mk("bomb", r, 1, repeat(r, 4)));
      take(r, 4);
    }
  }

  // 飞机：连续的三张
  for (let start = 3; start < RANK_A; start++) {
    let end = start;
    while (end <= RANK_A && left(end) === 3) end++;
    if (end - start >= 2) {
      const ranks = [];
      for (let r = start; r < end; r++) {
        ranks.push(...repeat(r, 3));
        take(r, 3);
      }
      groups.push(mk("plane", end - 1, end - start, ranks));
    }
  }

  // 顺子：只在能吃掉至少 3 张孤立单牌时才拆
  for (let found = true; found; ) {
    found = false;
    for (let start = 3; start + 4 <= RANK_A && !found; start++) {
      let end = start;
      while (end <= RANK_A && left(end) >= 1) end++;
      if (end - start < 5) continue;
      const singles = Array.from({ length: end - start }, (_, i) => start + i).filter((r) => left(r) === 1).length;
      if (singles < 3) continue;
      const ranks = [];
      for (let r = start; r < end; r++) {
        ranks.push(r);
        take(r, 1);
      }
      groups.push(mk("straight", end - 1, end - start, ranks));
      found = true;
    }
  }

  // 连对
  for (let start = 3; start <= RANK_A - 2; start++) {
    let end = start;
    while (end <= RANK_A && left(end) === 2) end++;
    if (end - start >= 3) {
      const ranks = [];
      for (let r = start; r < end; r++) {
        ranks.push(r, r);
        take(r, 2);
      }
      groups.push(mk("pairStraight", end - 1, end - start, ranks));
    }
  }

  const triples: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 3; r <= BIG_JOKER; r++) {
    const c = left(r);
    if (c === 3) triples.push(r);
    else if (c === 2) pairs.push(r);
    else if (c === 1) singles.push(r);
  }

  // 三张带最小的单牌或对子（不带 2 和王，除非没得选）
  const smallSingles = singles.filter((r) => r < RANK_2);
  const smallPairs = pairs.filter((r) => r < RANK_2);
  for (const t of triples) {
    if (smallSingles.length) {
      const k = smallSingles.shift()!;
      singles.splice(singles.indexOf(k), 1);
      groups.push(mk("triple1", t, 1, [...repeat(t, 3), k]));
    } else if (smallPairs.length) {
      const p = smallPairs.shift()!;
      pairs.splice(pairs.indexOf(p), 1);
      groups.push(mk("triple2", t, 1, [...repeat(t, 3), p, p]));
    } else groups.push(mk("triple", t, 1, repeat(t, 3)));
  }
  for (const g of groups.filter((g) => g.type === "plane")) {
    const k = g.length;
    const wings = singles.filter((r) => r < RANK_2).slice(0, k);
    if (wings.length === k) {
      wings.forEach((w) => singles.splice(singles.indexOf(w), 1));
      Object.assign(g, mk("plane1", g.main, k, [...g.ranks, ...wings]));
    }
  }
  for (const p of pairs) groups.push(mk("pair", p, 1, [p, p]));
  for (const s of singles) groups.push(mk("single", s, 1, [s]));
  return groups;
}

/** 拆完之后要几手才能出完；炸弹和王炸算作可以随时打出的“免费”手 */
export const handCount = (hand: Card[]) => decompose(hand).filter((g) => !isBomb(g)).length;

export type BotContext = {
  hand: Card[];
  /** 要压的牌，自己领出时为 null */
  target: Combo | null;
  /** 要压的牌是不是队友出的 */
  targetIsTeammate: boolean;
  isLandlord: boolean;
  /** 两个对手（对地主来说是两个农民）里手牌最少的张数 */
  enemyMinCards: number;
};

const toCards = (hand: Card[], c: Combo) => pickByRanks(hand, c.ranks)!;

/** 规则 AI 的出牌决定；返回 null 表示不出 */
export function botPlay(ctx: BotContext): Combo | null {
  const { hand, target, enemyMinCards } = ctx;
  // 能一把出完就出完
  const finish = resolvePlay(hand.map((c) => c.rank), target);
  if (finish) return finish;
  const moves = legalMoves(hand, target);

  if (!target) return lead(ctx);
  if (ctx.targetIsTeammate) return null;
  if (moves.length === 0) return null;

  const before = handCount(hand);
  const scored = moves
    .filter((m) => !isBomb(m))
    .map((m) => {
      const after = handCount(removeCards(hand, toCards(hand, m)));
      // 用 2 和王去管小牌是浪费，对手牌还多时额外扣分
      const spendsHigh = m.ranks.some((r) => r >= RANK_2) && enemyMinCards > 6 ? 4 : 0;
      return { m, after, score: after * 10 + m.main + spendsHigh };
    })
    .sort((a, b) => a.score - b.score);

  const best = scored[0];
  if (best) {
    const breaksHand = best.after > before;
    const urgent = enemyMinCards <= 5 || (!ctx.isLandlord && enemyMinCards <= 8);
    if (!breaksHand || urgent) return best.m;
    return null;
  }

  // 只剩炸弹能管：对手快走完了，或者炸完自己也快出完了才炸
  const bombs = moves.filter(isBomb).sort((a, b) => a.main - b.main);
  if (bombs.length && (enemyMinCards <= 5 || handCount(removeCards(hand, toCards(hand, bombs[0]))) <= 1)) return bombs[0];
  return null;
}

function lead(ctx: BotContext): Combo {
  const { hand, enemyMinCards } = ctx;
  const groups = decompose(hand);
  const normal = groups.filter((g) => !isBomb(g));
  if (normal.length === 0) return groups.sort((a, b) => a.main - b.main)[0];

  // 剩两手且其中一手是炸弹：先把另一手出掉
  let pool = normal;
  // 对手只剩一张时别出单张；只剩两张时别出对子
  if (enemyMinCards === 1) {
    const nonSingle = pool.filter((g) => g.type !== "single");
    if (nonSingle.length) pool = nonSingle;
    else return pool.sort((a, b) => b.main - a.main)[0];
  } else if (enemyMinCards === 2) {
    const nonPair = pool.filter((g) => g.type !== "pair");
    if (nonPair.length) pool = nonPair;
  }
  // 先出最小的；同样大小时多出几张
  return pool.slice().sort((a, b) => a.main - b.main || b.ranks.length - a.ranks.length)[0];
}

/** 叫分：按大牌数量估算牌力 */
export function botBid(hand: Card[], highest: number): number {
  const m = countRanks(hand);
  let power = 0;
  if (m.get(BIG_JOKER)) power += 4;
  if (m.get(SMALL_JOKER)) power += 3;
  power += (m.get(RANK_2) ?? 0) * 2;
  power += (m.get(RANK_A) ?? 0) * 0.5;
  for (const c of m.values()) if (c === 4) power += 4;
  const want = power >= 10 ? 3 : power >= 7 ? 2 : power >= 5 ? 1 : 0;
  return want > highest ? want : 0;
}

/** “提示”按钮：按规则 AI 的偏好给出若干可出的牌，第一个最推荐 */
export function hints(hand: Card[], target: Combo | null): Combo[] {
  const moves = legalMoves(hand, target);
  const scored = moves.map((m) => {
    const after = handCount(removeCards(hand, toCards(hand, m)));
    return { m, score: (isBomb(m) ? 1000 : 0) + after * 10 + m.main - m.ranks.length * 0.1 };
  });
  scored.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  return scored
    .map((s) => s.m)
    .filter((m) => {
      const key = m.ranks.join(",");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
