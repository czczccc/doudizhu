/**
 * 合法出牌枚举：给定手牌和要压的牌，列出所有能出的牌（按点数表示）。
 */
import { BIG_JOKER, RANK_2, RANK_A, SMALL_JOKER, countRanks, type Card } from "./cards";
import { beats, type Combo, type ComboType } from "./patterns";

const repeat = (rank: number, n: number) => Array<number>(n).fill(rank);

/** 从候选里选 k 个（组合） */
function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

const combo = (type: ComboType, main: number, length: number, ranks: number[]): Combo => ({
  type,
  main,
  length,
  ranks: ranks.slice().sort((a, b) => b - a),
});

/** 列出手牌能组成的全部牌型（不考虑要压的牌） */
export function allCombos(hand: Card[]): Combo[] {
  const m = countRanks(hand);
  const kinds = [...m.keys()].sort((a, b) => a - b);
  const has = (r: number, n: number) => (m.get(r) ?? 0) >= n;
  const out: Combo[] = [];

  for (const r of kinds) {
    out.push(combo("single", r, 1, [r]));
    if (has(r, 2)) out.push(combo("pair", r, 1, repeat(r, 2)));
    if (has(r, 3)) out.push(combo("triple", r, 1, repeat(r, 3)));
    if (has(r, 4)) out.push(combo("bomb", r, 1, repeat(r, 4)));
  }
  if (has(SMALL_JOKER, 1) && has(BIG_JOKER, 1)) out.push(combo("rocket", BIG_JOKER, 1, [BIG_JOKER, SMALL_JOKER]));

  // 顺子、连对、飞机
  const seq = (n: number, minLen: number, type: ComboType) => {
    for (let start = 3; start <= RANK_A; start++) {
      for (let end = start; end <= RANK_A && has(end, n); end++) {
        const len = end - start + 1;
        if (len >= minLen) {
          const ranks = Array.from({ length: len }, (_, i) => repeat(start + i, n)).flat();
          out.push(combo(type, end, len, ranks));
        }
      }
    }
  };
  seq(1, 5, "straight");
  seq(2, 3, "pairStraight");
  seq(3, 2, "plane");

  // 带牌：主体之外的点数做翅膀（不拆主体）
  const singlesExcept = (exclude: number[]) => kinds.filter((r) => !exclude.includes(r));
  const pairsExcept = (exclude: number[]) => kinds.filter((r) => !exclude.includes(r) && r < SMALL_JOKER && has(r, 2));
  const noRocket = (ks: number[]) => !(ks.includes(SMALL_JOKER) && ks.includes(BIG_JOKER));

  for (const r of kinds) {
    if (has(r, 3)) {
      for (const k of singlesExcept([r])) out.push(combo("triple1", r, 1, [...repeat(r, 3), k]));
      for (const p of pairsExcept([r])) out.push(combo("triple2", r, 1, [...repeat(r, 3), p, p]));
    }
    if (has(r, 4)) {
      for (const ks of combinations(singlesExcept([r]), 2).filter(noRocket)) out.push(combo("four2", r, 1, [...repeat(r, 4), ...ks]));
      // 同点数的一对也可以当两张单牌带
      for (const p of pairsExcept([r])) out.push(combo("four2", r, 1, [...repeat(r, 4), p, p]));
      for (const ps of combinations(pairsExcept([r]), 2)) out.push(combo("four22", r, 1, [...repeat(r, 4), ...ps.flatMap((p) => [p, p])]));
    }
  }
  for (const plane of out.filter((c) => c.type === "plane")) {
    const body = [...new Set(plane.ranks)];
    const k = plane.length;
    for (const ks of combinations(singlesExcept(body), k).filter(noRocket)) {
      out.push(combo("plane1", plane.main, k, [...plane.ranks, ...ks]));
    }
    for (const ps of combinations(pairsExcept(body), k)) {
      out.push(combo("plane2", plane.main, k, [...plane.ranks, ...ps.flatMap((p) => [p, p])]));
    }
  }
  return out;
}

/** 能出的牌：target 为空表示自己领出，任何牌型都行 */
export function legalMoves(hand: Card[], target: Combo | null): Combo[] {
  const all = allCombos(hand);
  return target ? all.filter((c) => beats(c, target)) : all;
}

export const comboKey = (c: Combo) => `${c.type}:${c.ranks.join(",")}`;

/** 判断一张点数是不是“大牌”（2 和王） */
export const isHighRank = (r: number) => r >= RANK_2;
