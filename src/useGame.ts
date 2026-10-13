/**
 * 对局控制：持有游戏状态，轮到对手时调用规则 AI 或大模型，并记录它们的决策过程。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { botDecision, llmDecision, modelLabel, type Decision, type DecisionLog, type SeatConfig } from "./ai/players";
import type { Card } from "./game/cards";
import { IllegalAction, applyAction, deal, type Action, type GameState, type Seat } from "./game/state";
import type { Speech } from "./components/Table";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 无痕模式等场景下忽略 */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export type Scoreboard = { round: number; scores: [number, number, number] };

export function useGame(configs: [SeatConfig, SeatConfig], accessPassword = "") {
  const [state, setState] = useState<GameState>(() => deal());
  const [logs, setLogs] = useState<DecisionLog[]>([]);
  const [speech, setSpeech] = useState<Partial<Record<Seat, Speech>>>({});
  const [thinking, setThinking] = useState<Seat | null>(null);
  const [board, setBoard] = useStored<Scoreboard>("ddz-scoreboard", { round: 1, scores: [0, 0, 0] });
  const configsRef = useRef(configs);
  configsRef.current = configs;
  const passwordRef = useRef(accessPassword);
  passwordRef.current = accessPassword;
  const names: [string, string, string] = ["你", configs[0].name, configs[1].name];
  // 给大模型看的名字：从它的视角，“你”是它自己，真人玩家叫“玩家”
  const namesRef = useRef<[string, string, string]>(["玩家", configs[0].name, configs[1].name]);
  namesRef.current = ["玩家", configs[0].name, configs[1].name];

  const configFor = (seat: Seat) => configsRef.current[seat - 1];

  const say = useCallback((seat: Seat, text: string | undefined) => {
    if (!text) return;
    setSpeech((s) => ({ ...s, [seat]: { text, key: Date.now() } }));
  }, []);

  // 台词显示一会儿就收起
  useEffect(() => {
    const timers = Object.entries(speech).map(([seat, sp]) =>
      setTimeout(() => setSpeech((s) => (s[Number(seat) as Seat] === sp ? { ...s, [seat]: undefined } : s)), 7000),
    );
    return () => timers.forEach(clearTimeout);
  }, [speech]);

  // 轮到对手：让 AI 决定
  useEffect(() => {
    if (state.phase === "over" || state.turn === 0) return;
    const seat = state.turn;
    const config = configFor(seat);
    const controller = new AbortController();
    let cancelled = false;
    const logId = `${Date.now()}-${seat}`;
    const patchLog = (patch: Partial<DecisionLog>) => setLogs((ls) => ls.map((l) => (l.id === logId ? { ...l, ...patch } : l)));

    (async () => {
      setThinking(seat);
      let decision: Decision;
      if (config.kind === "llm") {
        setLogs((ls) => [
          ...ls,
          {
            id: logId,
            seat,
            name: config.name,
            model: modelLabel(config),
            phase: state.phase === "bidding" ? "bid" : "play",
            status: "running",
            replies: [],
          },
        ]);
        const result = await llmDecision(state, seat, config, namesRef.current, passwordRef.current, controller.signal);
        decision = result.decision;
        patchLog({
          status: decision.note ? "error" : "done",
          summary: decision.summary,
          note: decision.note,
          prompt: result.prompt,
          replies: result.replies,
          ms: result.ms,
        });
      } else {
        await sleep(600 + Math.random() * 600);
        decision = botDecision(state, seat);
      }
      if (cancelled) return;
      say(seat, decision.say);
      setThinking(null);
      setState((s) => (s === state ? applyAction(s, decision.action) : s));
    })().catch((error) => {
      if (cancelled) return;
      // 不应该发生：兜底让规则 AI 出牌，保证对局不会卡住
      console.error(error);
      setThinking(null);
      setState((s) => (s === state ? applyAction(s, botDecision(s, seat).action) : s));
    });

    return () => {
      cancelled = true;
      controller.abort();
      setLogs((ls) => ls.filter((l) => !(l.id === logId && l.status === "running")));
    };
  }, [state, say]);

  // 结算
  const settled = useRef<GameState["result"]>(null);
  useEffect(() => {
    const result = state.result;
    if (!result || settled.current === result) return;
    settled.current = result;
    setBoard((b) => ({ ...b, scores: b.scores.map((v, i) => v + result.delta[i]) as Scoreboard["scores"] }));
  }, [state.result, setBoard]);

  /** 你的动作；不合法时返回错误文字 */
  const act = (action: Action): string | null => {
    try {
      setState(applyAction(state, action));
      return null;
    } catch (error) {
      if (error instanceof IllegalAction) return error.message;
      throw error;
    }
  };
  const play = (cards: Card[]) => act({ type: "play", seat: 0, cards });
  const pass = () => act({ type: "pass", seat: 0 });
  const bid = (value: number) => act({ type: "bid", seat: 0, value });

  const newGame = () => {
    if (state.phase === "over") setBoard((b) => ({ ...b, round: b.round + 1 }));
    setState(deal());
    setLogs([]);
    setSpeech({});
    setThinking(null);
  };

  const resetScores = () => setBoard({ round: 1, scores: [0, 0, 0] });

  return { state, names, logs, speech, thinking, board, play, pass, bid, newGame, resetScores };
}
