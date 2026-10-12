/**
 * 给大模型的提示词：系统提示讲规则和回答格式，每一步的用户消息描述当前局面。
 */
import { hints } from "../game/bot";
import { RANK_LABEL, cardsToText, countRanks, createDeck, type Card } from "../game/cards";
import { COMBO_LABEL, describeCombo } from "../game/patterns";
import { SEATS, isTeammate, playedCards, targetFor, type GameState, type Seat } from "../game/state";

export const SYSTEM_PROMPT = `你是一名斗地主高手，正在和另外两名玩家对局。

## 规则
- 一副 54 张牌，三人各 17 张，3 张底牌归地主。地主一人对抗两名农民，农民是队友。
- 单张大小：3 < 4 < … < 10 < J < Q < K < A < 2 < 小王 < 大王。
- 牌型：单张；对子；三张；三带一（三张 + 1 张）；三带一对；顺子（5 张及以上连续单牌，最大到 A，不含 2 和王）；连对（3 对及以上连续对子）；飞机（2 组及以上连续三张，可带同样组数的单牌或对子）；四带二（四张 + 2 张单牌）；四带两对；炸弹（四张相同）；王炸（大王 + 小王）。
- 跟牌必须是同牌型、同张数、更大的牌；炸弹可以压任何非炸弹牌型，大炸弹压小炸弹；王炸最大。
- 每一轮由上一轮最后出牌的人先出，可以出任意牌型；其他人可以选择“不出”。
- 先出完手牌的一方获胜。炸弹和春天会让分数翻倍。

## 策略提示
- 农民要配合队友：队友出的牌够大时一般不必去压；地主快出完时要不惜代价拦截。
- 尽量少拆牌，先出小牌和难出手的牌，把 2、王和炸弹留到关键时刻。
- 注意记牌：外面还剩哪些大牌，别人还剩几张。

## 回答格式
只输出一个 JSON 对象，不要输出别的内容。
- 叫分阶段：{"bid": 0 到 3 的整数（0 表示不叫）, "say": "一句台词"}
- 出牌阶段：{"action": "play" 或 "pass", "cards": ["K","K","K","5"], "say": "一句台词"}
  - cards 用点数表示：3 4 5 6 7 8 9 10 J Q K A 2 小王 大王，不写花色；不出时 cards 为空数组。
- say 是你在牌桌上说的一句话，符合你的身份和局势，可以调侃对手、鼓励队友，不超过 20 个字。`;

export const BID_SCHEMA = {
  type: "object",
  properties: {
    bid: { type: "integer", description: "0 表示不叫，1–3 表示叫分" },
    say: { type: "string" },
  },
  required: ["bid", "say"],
  additionalProperties: false,
};

export const PLAY_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["play", "pass"] },
    cards: { type: "array", items: { type: "string" } },
    say: { type: "string" },
  },
  required: ["action", "cards", "say"],
  additionalProperties: false,
};

/** 候选出法最多列出多少个，避免提示词过长 */
const MAX_OPTIONS = 40;

type Names = [string, string, string];

const role = (s: GameState, seat: Seat) => (s.landlord === null ? "" : s.landlord === seat ? "地主" : "农民");

function seatLine(s: GameState, me: Seat, seat: Seat, names: Names) {
  const who = seat === me ? "你" : names[seat];
  const r = role(s, seat);
  const relation = seat === me || s.landlord === null ? "" : isTeammate(s, me, seat) ? "，队友" : "，对手";
  return `${who}${r ? `（${r}${relation}）` : ""}`;
}

/** 外面还没出现的牌：整副牌去掉自己手牌和已出的牌 */
function unseen(s: GameState, me: Seat): Card[] {
  const known = new Set([...s.hands[me], ...playedCards(s)].map((c) => c.id));
  // 底牌虽然公开，但仍在地主手里的部分也算“外面的牌”
  return createDeck().filter((c) => !known.has(c.id));
}

function countsText(cards: Card[]) {
  const m = countRanks(cards);
  return [...m.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([r, n]) => `${RANK_LABEL[r]}×${n}`)
    .join(" ");
}

export function bidPrompt(s: GameState, me: Seat, names: Names): string {
  const others = SEATS.filter((x) => x !== me)
    .map((x) => {
      const b = s.bids[x];
      return `${names[x]}：${b === undefined ? "还没叫" : b === 0 ? "不叫" : `${b} 分`}`;
    })
    .join("；");
  return [
    `现在是叫分阶段。叫分最高的人当地主，拿 3 张底牌，以一敌二；叫的分数是本局的底分。`,
    `你的手牌（17 张）：${cardsToText(s.hands[me])}`,
    `目前最高叫分：${s.highestBid === 0 ? "还没人叫" : `${s.highestBid} 分`}。其他玩家：${others}。`,
    `你只能叫比 ${s.highestBid} 更高的分，或者 0（不叫）。请决定。`,
  ].join("\n");
}

export function playPrompt(s: GameState, me: Seat, names: Names): string {
  const target = targetFor(s, me);
  const lines: string[] = [];
  lines.push(`你是${seatLine(s, me, me, names)}。底分 ${s.highestBid}，已出炸弹 ${s.bombs} 个。`);
  lines.push(`底牌：${cardsToText(s.bottom)}（已归地主）`);
  lines.push(`你的手牌（${s.hands[me].length} 张）：${cardsToText(s.hands[me])}`);
  lines.push(
    `其他玩家剩余：${SEATS.filter((x) => x !== me)
      .map((x) => `${seatLine(s, me, x, names)} ${s.hands[x].length} 张`)
      .join("；")}`,
  );
  lines.push(`外面还没出现的牌：${countsText(unseen(s, me)) || "无"}`);

  const recent = s.history.slice(-24);
  if (recent.length) {
    lines.push("", "最近的出牌记录（从早到晚）：");
    for (const t of recent) {
      lines.push(`- ${seatLine(s, me, t.seat, names)}：${t.play ? describeCombo(t.play.combo) : "不出"}`);
    }
  }

  lines.push("");
  if (target && s.lastPlay) {
    const from = s.lastPlay.seat;
    lines.push(
      `现在要压的是 ${seatLine(s, me, from, names)} 出的 ${describeCombo(target)}。` +
        (isTeammate(s, me, from) ? "这是你队友出的牌。" : "这是对手出的牌。"),
    );
  } else {
    lines.push("这一轮由你先出，可以出任意牌型，不能不出。");
  }

  const options = hints(s.hands[me], target);
  if (options.length === 0) {
    lines.push("你没有能管上的牌，只能不出。");
  } else {
    lines.push(`可以出的牌（共 ${options.length} 种，按推荐程度排序${options.length > MAX_OPTIONS ? `，只列出前 ${MAX_OPTIONS} 种` : ""}）：`);
    options.slice(0, MAX_OPTIONS).forEach((c) => {
      lines.push(`- ${COMBO_LABEL[c.type]}：${c.ranks.map((r) => RANK_LABEL[r]).join(" ")}`);
    });
    if (target) lines.push("- 不出");
  }
  lines.push("", "请给出你的决定。");
  return lines.join("\n");
}
