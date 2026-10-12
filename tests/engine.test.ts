// @vitest-environment node
import { describe, expect, it } from "vitest";
import { botBid, botPlay, hints } from "../src/game/bot";
import { pickByRanks, type Card } from "../src/game/cards";
import { legalMoves } from "../src/game/moves";
import { analyze, analyzeAll, beats } from "../src/game/patterns";
import { applyAction, deal, isTeammate, targetFor, type GameState } from "../src/game/state";

const r = (s: string) =>
  s
    .split(" ")
    .map((x) => ({ J: 11, Q: 12, K: 13, A: 14, "2": 15, X: 16, D: 17 })[x] ?? Number(x));
const type = (s: string) => analyze(r(s))?.type ?? null;

/** 可复现的随机数 */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("牌型识别", () => {
  it.each([
    ["5", "single"],
    ["5 5", "pair"],
    ["X D", "rocket"],
    ["9 9 9", "triple"],
    ["9 9 9 9", "bomb"],
    ["9 9 9 3", "triple1"],
    ["9 9 9 3 3", "triple2"],
    ["3 4 5 6 7", "straight"],
    ["10 J Q K A", "straight"],
    ["3 3 4 4 5 5", "pairStraight"],
    ["3 3 3 4 4 4", "plane"],
    ["3 3 3 4 4 4 7 9", "plane1"],
    ["3 3 3 4 4 4 7 7 9 9", "plane2"],
    ["8 8 8 8 3 5", "four2"],
    ["8 8 8 8 3 3 5 5", "four22"],
  ])("%s 是 %s", (cards, expected) => expect(type(cards)).toBe(expected));

  it.each(["J Q K A 2", "3 4 5 6", "3 3 4 4", "2 2 2 A A A", "5 6", "9 9 9 X D", "3 3 3 4 4 4 X D"])("%s 不是合法牌型", (cards) =>
    expect(type(cards)).toBeNull(),
  );

  it("连续四组三张可以看成飞机，也可以看成三组带单", () => {
    const types = analyzeAll(r("3 3 3 4 4 4 5 5 5 6 6 6")).map((c) => c.type);
    expect(types).toContain("plane");
    expect(types).toContain("plane1");
  });

  it("比较大小", () => {
    const c = (s: string) => analyze(r(s))!;
    expect(beats(c("6"), c("5"))).toBe(true);
    expect(beats(c("5"), c("6"))).toBe(false);
    expect(beats(c("3 3 3 3"), c("2 2"))).toBe(true);
    expect(beats(c("X D"), c("2 2 2 2"))).toBe(true);
    expect(beats(c("4 5 6 7 8 9"), c("3 4 5 6 7"))).toBe(false);
    expect(beats(c("4 5 6 7 8"), c("3 4 5 6 7"))).toBe(true);
    expect(beats(c("D"), c("X"))).toBe(true);
  });
});

describe("出牌枚举", () => {
  const hand = (s: string): Card[] => r(s).map((rank, id) => ({ id, rank, suit: "spade" }));

  it("能列出压过对子的所有牌，包括炸弹", () => {
    const moves = legalMoves(hand("3 3 7 7 9 9 9 9 X D"), analyze(r("5 5"))!);
    const keys = moves.map((m) => m.ranks.join(" "));
    expect(keys).toContain("7 7");
    expect(keys).toContain("9 9");
    expect(keys).toContain("9 9 9 9");
    expect(keys).toContain("17 16");
    expect(keys).not.toContain("3 3");
  });

  it("提示优先不拆牌", () => {
    const [first] = hints(hand("3 4 5 6 7 9 9 K"), analyze(r("8"))!);
    expect(first.ranks).toEqual([13]);
  });

  it("叫分随牌力变化", () => {
    expect(botBid(hand("X D 2 2 2 A 3 4 5 6 7 8 9 10 J Q K"), 0)).toBe(3);
    expect(botBid(hand("3 3 4 5 6 7 8 8 9 10 J J Q K K A 5"), 0)).toBe(0);
  });
});

describe("对局流程", () => {
  it("叫分后地主拿到底牌并先出", () => {
    let s = deal(seeded(1));
    const first = s.turn;
    s = applyAction(s, { type: "bid", seat: first, value: 3 });
    expect(s.phase).toBe("playing");
    expect(s.landlord).toBe(first);
    expect(s.hands[first]).toHaveLength(20);
    expect(s.turn).toBe(first);
  });

  it("都不叫时重新发牌", () => {
    let s = deal(seeded(2));
    for (let i = 0; i < 3; i++) s = applyAction(s, { type: "bid", seat: s.turn, value: 0 });
    expect(s.phase).toBe("bidding");
    expect(s.redeals).toBe(1);
  });

  it("第一手不能不出，管不上的牌会被拒绝", () => {
    let s = deal(seeded(3));
    s = applyAction(s, { type: "bid", seat: s.turn, value: 3 });
    expect(() => applyAction(s, { type: "pass", seat: s.turn })).toThrow();
    const lowest = s.hands[s.turn].at(-1)!;
    s = applyAction(s, { type: "play", seat: s.turn, cards: [lowest] });
    const next = s.hands[s.turn];
    const weaker = next.find((c) => c.rank < lowest.rank);
    if (weaker) expect(() => applyAction(s, { type: "play", seat: s.turn, cards: [weaker] })).toThrow();
  });

  it("三个规则 AI 能把 200 局完整打完，分数守恒", () => {
    for (let game = 0; game < 200; game++) {
      const random = seeded(game + 100);
      let s: GameState = deal(random);
      let steps = 0;
      while (s.phase !== "over") {
        if (++steps > 500) throw new Error(`第 ${game} 局卡住了`);
        const seat = s.turn;
        if (s.phase === "bidding") {
          s = applyAction(s, { type: "bid", seat, value: botBid(s.hands[seat], s.highestBid) || (s.redeals > 2 && seat === 0 && s.highestBid === 0 ? 1 : 0) }, random);
          continue;
        }
        const target = targetFor(s, seat);
        const enemies = [0, 1, 2].filter((x) => !isTeammate(s, seat, x as 0 | 1 | 2)) as (0 | 1 | 2)[];
        const move = botPlay({
          hand: s.hands[seat],
          target,
          targetIsTeammate: !!s.lastPlay && s.lastPlay.seat !== seat && isTeammate(s, seat, s.lastPlay.seat),
          isLandlord: s.landlord === seat,
          enemyMinCards: Math.min(...enemies.map((e) => s.hands[e].length)),
        });
        s = move
          ? applyAction(s, { type: "play", seat, cards: pickByRanks(s.hands[seat], move.ranks)! })
          : applyAction(s, { type: "pass", seat });
      }
      expect(s.result!.delta.reduce((a, b) => a + b, 0)).toBe(0);
      expect(s.hands[s.result!.winner]).toHaveLength(0);
    }
  });
});
