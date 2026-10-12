// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractJson, parseBid, parsePlay } from "../src/ai/players";
import { bidPrompt, playPrompt } from "../src/ai/prompt";
import type { Card } from "../src/game/cards";
import { analyze } from "../src/game/patterns";
import { deal, type GameState } from "../src/game/state";

const cards = (ranks: number[]): Card[] => ranks.map((rank, id) => ({ id, rank, suit: "spade" }));

/** 构造一个出牌阶段的局面：座位 1 是农民，要压地主（座位 0）的 target */
function playing(hand: number[], target: number[] | null): GameState {
  const s = deal(() => 0.5);
  const lastPlay = target ? { seat: 0 as const, combo: analyze(target)!, cards: cards(target) } : null;
  return {
    ...s,
    phase: "playing",
    landlord: 0,
    highestBid: 2,
    turn: 1,
    hands: [s.hands[0], cards(hand), s.hands[2]],
    lastPlay,
  };
}

describe("解析大模型的回答", () => {
  it("能从代码块和多余文字里取出 JSON", () => {
    expect(extractJson('好的：\n```json\n{"bid": 2}\n```')).toEqual({ bid: 2 });
    expect(extractJson("我不知道")).toBeNull();
  });

  it("叫分必须比当前更高", () => {
    const s = { ...deal(() => 0.3), highestBid: 2, turn: 1 as const };
    expect(parseBid(s, 1, '{"bid":1}').ok).toBe(false);
    const ok = parseBid(s, 1, '{"bid":3,"say":"我来"}');
    expect(ok.ok && ok.decision.action).toEqual({ type: "bid", seat: 1, value: 3 });
  });

  it("出牌：认得 10、J、小王等写法，并选出手里对应的牌", () => {
    const s = playing([10, 10, 11, 16, 17], null);
    const r = parsePlay(s, 1, '{"action":"play","cards":["小王","大王"],"say":"王炸！"}');
    expect(r.ok).toBe(true);
    if (r.ok && r.decision.action.type === "play") {
      expect(r.decision.action.cards.map((c) => c.rank).sort()).toEqual([16, 17]);
      expect(r.decision.say).toBe("王炸！");
    }
  });

  it("拒绝手里没有的牌、管不上的牌、第一手不出", () => {
    const s = playing([5, 9, 9, 13], [8, 8]);
    expect(parsePlay(s, 1, '{"action":"play","cards":["A","A"]}')).toMatchObject({ ok: false });
    expect(parsePlay(s, 1, '{"action":"play","cards":["5"]}')).toMatchObject({ ok: false });
    expect(parsePlay(s, 1, '{"action":"play","cards":["9","9"]}')).toMatchObject({ ok: true });
    expect(parsePlay(s, 1, '{"action":"pass","cards":[]}')).toMatchObject({ ok: true });
    const lead = playing([5, 9], null);
    expect(parsePlay(lead, 1, '{"action":"pass","cards":[]}')).toMatchObject({ ok: false });
  });
});

describe("提示词", () => {
  const names: [string, string, string] = ["玩家", "Claude", "老张"];

  it("叫分提示包含手牌和当前最高分", () => {
    const s = deal(() => 0.1);
    const text = bidPrompt(s, 1, names);
    expect(text).toContain("你的手牌（17 张）");
    expect(text).toContain("还没人叫");
  });

  it("出牌提示说明要压谁的牌、列出候选，并区分队友和对手", () => {
    const text = playPrompt(playing([5, 9, 9, 13], [8, 8]), 1, names);
    expect(text).toContain("玩家（地主，对手）");
    expect(text).toContain("老张（农民，队友）");
    expect(text).toContain("对子：9 9");
    expect(text).toContain("- 不出");
  });
});
