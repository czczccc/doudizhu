/**
 * 牌型识别与比较。全部基于点数（rank），不关心花色。
 */
import { BIG_JOKER, RANK_A, RANK_LABEL, SMALL_JOKER } from "./cards";

export type ComboType =
  | "single"
  | "pair"
  | "triple"
  | "triple1"
  | "triple2"
  | "straight"
  | "pairStraight"
  | "plane"
  | "plane1"
  | "plane2"
  | "four2"
  | "four22"
  | "bomb"
  | "rocket";

export type Combo = {
  type: ComboType;
  /** 比较大小用的点数：单张/对子/三张/炸弹取本身，顺子/飞机取最大一组 */
  main: number;
  /** 顺子、连对、飞机的组数；其他牌型为 1 */
  length: number;
  /** 出的牌（点数），从大到小 */
  ranks: number[];
};

export const COMBO_LABEL: Record<ComboType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  triple1: "三带一",
  triple2: "三带一对",
  straight: "顺子",
  pairStraight: "连对",
  plane: "飞机",
  plane1: "飞机带单",
  plane2: "飞机带对",
  four2: "四带二",
  four22: "四带两对",
  bomb: "炸弹",
  rocket: "王炸",
};

const counts = (ranks: number[]) => {
  const m = new Map<number, number>();
  for (const r of ranks) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
};

/** 连续且不含 2 和王 */
const isRun = (sorted: number[]) =>
  sorted.length > 0 && sorted[sorted.length - 1] <= RANK_A && sorted.every((r, i) => i === 0 || r === sorted[i - 1] + 1);

/** 找出所有长度为 k、每个点数至少 n 张的连续段（返回各段的点数，升序） */
function runsOf(m: Map<number, number>, n: number, k: number): number[][] {
  const out: number[][] = [];
  for (let start = 3; start + k - 1 <= RANK_A; start++) {
    const run = Array.from({ length: k }, (_, i) => start + i);
    if (run.every((r) => (m.get(r) ?? 0) >= n)) out.push(run);
  }
  return out;
}

const make = (type: ComboType, main: number, length: number, ranks: number[]): Combo => ({
  type,
  main,
  length,
  ranks: ranks.slice().sort((a, b) => b - a),
});

/**
 * 识别一手牌所有可能的牌型解释（极少数牌会有多种，例如 333444 + 55 66 也能看成别的组合）。
 * 返回空数组表示不是合法牌型。顺序即优先级。
 */
export function analyzeAll(ranks: number[]): Combo[] {
  const n = ranks.length;
  if (n === 0) return [];
  const m = counts(ranks);
  const kinds = [...m.keys()].sort((a, b) => a - b);
  const out: Combo[] = [];

  if (n === 2 && m.get(SMALL_JOKER) === 1 && m.get(BIG_JOKER) === 1) return [make("rocket", BIG_JOKER, 1, ranks)];
  if (kinds.length === 1) {
    const r = kinds[0];
    if (n === 1) return [make("single", r, 1, ranks)];
    if (n === 2) return [make("pair", r, 1, ranks)];
    if (n === 3) return [make("triple", r, 1, ranks)];
    if (n === 4) return [make("bomb", r, 1, ranks)];
    return [];
  }

  const values = [...m.values()];
  // 顺子：5 张以上单张连续
  if (n >= 5 && values.every((v) => v === 1) && isRun(kinds)) out.push(make("straight", kinds[kinds.length - 1], n, ranks));
  // 连对：3 对以上
  if (n >= 6 && values.every((v) => v === 2) && isRun(kinds)) out.push(make("pairStraight", kinds[kinds.length - 1], n / 2, ranks));
  // 飞机（不带）
  if (n >= 6 && values.every((v) => v === 3) && isRun(kinds)) out.push(make("plane", kinds[kinds.length - 1], n / 3, ranks));

  // 三带一 / 三带一对
  if (n === 4) {
    const t = kinds.find((r) => m.get(r) === 3);
    if (t !== undefined) out.push(make("triple1", t, 1, ranks));
  }
  if (n === 5) {
    const t = kinds.find((r) => m.get(r) === 3);
    const p = kinds.find((r) => m.get(r) === 2);
    if (t !== undefined && p !== undefined && p < SMALL_JOKER) out.push(make("triple2", t, 1, ranks));
  }

  // 四带二 / 四带两对
  for (const r of kinds) {
    if (m.get(r) !== 4) continue;
    const rest = ranks.filter((x) => x !== r);
    if (n === 6 && !(rest.includes(SMALL_JOKER) && rest.includes(BIG_JOKER))) out.push(make("four2", r, 1, ranks));
    if (n === 8) {
      const rm = counts(rest);
      if ([...rm.values()].every((v) => v === 2) && rm.size === 2) out.push(make("four22", r, 1, ranks));
    }
  }

  // 飞机带翅膀：k 组连续三张 + k 张单牌 或 k 对
  for (let k = Math.floor(n / 4); k >= 2; k--) {
    if (n === 4 * k) {
      for (const run of runsOf(m, 3, k)) {
        const rest = counts(ranks);
        for (const r of run) rest.set(r, rest.get(r)! - 3);
        const restRanks = [...rest.entries()].filter(([, c]) => c > 0);
        // 翅膀不能是王炸
        const hasRocket = (rest.get(SMALL_JOKER) ?? 0) > 0 && (rest.get(BIG_JOKER) ?? 0) > 0;
        if (!hasRocket && restRanks.reduce((s, [, c]) => s + c, 0) === k) out.push(make("plane1", run[k - 1], k, ranks));
      }
    }
    if (n === 5 * k) {
      for (const run of runsOf(m, 3, k)) {
        const rest = counts(ranks);
        for (const r of run) rest.set(r, rest.get(r)! - 3);
        const restRanks = [...rest.entries()].filter(([, c]) => c > 0);
        const pairs = restRanks.reduce((s, [r, c]) => (r >= SMALL_JOKER || c % 2 ? NaN : s + c / 2), 0);
        if (pairs === k) out.push(make("plane2", run[k - 1], k, ranks));
      }
    }
  }

  // 同一牌型可能因不同的段被识别多次，保留最大的那个
  const best = new Map<string, Combo>();
  for (const c of out) {
    const key = `${c.type}:${c.length}`;
    if (!best.has(key) || best.get(key)!.main < c.main) best.set(key, c);
  }
  return [...best.values()];
}

export const analyze = (ranks: number[]): Combo | null => analyzeAll(ranks)[0] ?? null;

/** a 能否压过 b */
export function beats(a: Combo, b: Combo): boolean {
  if (a.type === "rocket") return true;
  if (b.type === "rocket") return false;
  if (a.type === "bomb" && b.type !== "bomb") return true;
  if (a.type !== b.type) return false;
  if (a.length !== b.length || a.ranks.length !== b.ranks.length) return false;
  return a.main > b.main;
}

/** 在这手牌的所有解释里找一个能压过 target 的；target 为空（自己领出）时返回首选解释 */
export function resolvePlay(ranks: number[], target: Combo | null): Combo | null {
  const all = analyzeAll(ranks);
  if (!target) return all[0] ?? null;
  return all.find((c) => beats(c, target)) ?? null;
}

export const isBomb = (c: Combo) => c.type === "bomb" || c.type === "rocket";

/** “三带一 K K K 5” 这样的描述 */
export const describeCombo = (c: Combo) => `${COMBO_LABEL[c.type]} ${c.ranks.map((r) => RANK_LABEL[r]).join(" ")}`;
