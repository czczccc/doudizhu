import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd,
  Tabs,
  TabsList,
  TabsTrigger,
  ThinkingText,
  Tooltip,
  TooltipProvider,
  cn,
} from "@cz/design-system";
import { Crown, Lightbulb, ListTree, Monitor, Moon, RotateCcw, Settings2, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { defaultSeats, modelLabel, type SeatConfig } from "./ai/players";
import { AiLog } from "./components/AiLog";
import { Hand } from "./components/Hand";
import { SettingsDialog } from "./components/SettingsDialog";
import { BottomCards, OpponentSeat, PlayedCards } from "./components/Table";
import { hints } from "./game/bot";
import { pickByRanks } from "./game/cards";
import { targetFor, type Seat } from "./game/state";
import { useGame } from "./useGame";

type ThemeChoice = "system" | "light" | "dark";

function useStoredState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial();
    } catch {
      return initial();
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

function useTheme() {
  const [choice, setChoice] = useStoredState<ThemeChoice>("ddz-theme", () => "system");
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  }, [choice]);
  return [choice, setChoice] as const;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function App() {
  const [theme, setTheme] = useTheme();
  const [seats, setSeats] = useStoredState<[SeatConfig, SeatConfig]>("ddz-seats-v2", defaultSeats);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [accessPassword, setAccessPassword] = useStoredState("ddz-access-password", () => "");
  const game = useGame(seats, accessPassword);
  const { state, names, thinking, speech, board } = game;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [hintIndex, setHintIndex] = useState(0);

  const myTurn = state.turn === 0 && state.phase !== "over";
  const target = targetFor(state, 0);
  const hand = state.hands[0];

  // 状态变化后清掉选择、错误和提示进度
  useEffect(() => {
    setError(null);
    setHintIndex(0);
    setSelected((sel) => {
      const ids = new Set(hand.map((c) => c.id));
      const kept = [...sel].filter((id) => ids.has(id));
      return kept.length === sel.size ? sel : new Set(kept);
    });
  }, [state, hand]);

  const myHints = useMemo(() => (myTurn && state.phase === "playing" ? hints(hand, target) : []), [myTurn, state.phase, hand, target]);
  const mustPlay = myTurn && state.phase === "playing" && !target;

  const doPlay = () => {
    const cards = hand.filter((c) => selected.has(c.id));
    if (!cards.length) return setError("先选要出的牌");
    const err = game.play(cards);
    if (err) setError(err);
    else setSelected(new Set());
  };
  const doPass = () => {
    const err = game.pass();
    if (err) setError(err);
    else setSelected(new Set());
  };
  const doHint = () => {
    if (!myHints.length) return doPass();
    const h = myHints[hintIndex % myHints.length];
    setSelected(new Set(pickByRanks(hand, h.ranks)!.map((c) => c.id)));
    setHintIndex((i) => i + 1);
    setError(null);
  };

  // 快捷键：Enter 出牌，P 不出，H 提示
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!myTurn || state.phase !== "playing" || settingsOpen) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "Enter") doPlay();
      else if (e.key === "p" || e.key === "P") doPass();
      else if (e.key === "h" || e.key === "H") doHint();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const roleOf = (seat: Seat) => (state.landlord === null ? null : state.landlord === seat ? "landlord" : "farmer");
  const llmCount = seats.filter((s) => s.kind === "llm").length;

  const status = (() => {
    if (state.phase === "over") return null;
    const who = state.turn === 0 ? "你" : names[state.turn];
    if (state.phase === "bidding") {
      return state.turn === 0 ? "轮到你叫分" : `${who}正在叫分`;
    }
    if (state.turn === 0) return target ? "轮到你出牌" : "你先出，可以出任意牌型";
    return `${who}正在出牌`;
  })();

  const opponent = (seat: 1 | 2, align: "left" | "right") => {
    const cfg = seats[seat - 1];
    return (
      <OpponentSeat
        name={names[seat]}
        model={modelLabel(cfg)}
        isLlm={cfg.kind === "llm"}
        role={roleOf(seat)}
        cardCount={state.hands[seat].length}
        thinking={thinking === seat}
        speech={speech[seat]}
        bid={state.phase === "bidding" ? state.bids[seat] : undefined}
        align={align}
        reveal={state.phase === "over" ? state.hands[seat] : undefined}
      />
    );
  };

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-line-subtle bg-canvas/85 backdrop-blur-md">
          <div className="flex h-14 items-center gap-3 px-4">
            <span className="grid size-7 place-items-center rounded-sm bg-accent text-footnote font-semibold text-on-accent">斗</span>
            <span className="text-body font-semibold tracking-tight">斗地主</span>
            <span className="hidden font-mono text-caption font-normal text-fg-subtle sm:inline">第 {board.round} 局</span>
            <div className="ml-2 hidden items-center gap-3 md:flex">
              {([0, 2, 1] as Seat[]).map((seat) => (
                <span key={seat} className="flex items-center gap-1.5 text-footnote text-fg-muted">
                  {names[seat]}
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      board.scores[seat] > 0 ? "text-success-fg" : board.scores[seat] < 0 ? "text-danger-fg" : "text-fg-subtle",
                    )}
                  >
                    {signed(board.scores[seat])}
                  </span>
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip content="大模型思考记录">
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="大模型思考记录" onClick={() => setLogOpen(true)}>
                  <ListTree />
                </Button>
              </Tooltip>
              <Tooltip content="对手设置">
                <Button variant="ghost" size="icon" aria-label="对手设置" onClick={() => setSettingsOpen(true)}>
                  <Settings2 />
                </Button>
              </Tooltip>
              <Tooltip content="重新发牌">
                <Button variant="ghost" size="icon" aria-label="重新发牌" onClick={game.newGame}>
                  <RotateCcw />
                </Button>
              </Tooltip>
              <Tabs value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)} className="ml-1 hidden sm:flex">
                <TabsList aria-label="主题">
                  <TabsTrigger value="system" aria-label="跟随系统" className="px-2">
                    <Monitor />
                  </TabsTrigger>
                  <TabsTrigger value="light" aria-label="浅色" className="px-2">
                    <Sun />
                  </TabsTrigger>
                  <TabsTrigger value="dark" aria-label="深色" className="px-2">
                    <Moon />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-4 pb-6">
            {/* 对手与底牌 */}
            <div className="flex items-start justify-between gap-3">
              {opponent(2, "left")}
              <div className="hidden sm:block">
                <BottomCards cards={state.bottom} revealed={state.landlord !== null} />
              </div>
              {opponent(1, "right")}
            </div>

            {/* 桌面：本轮每个人出的牌 */}
            <div className="grid flex-1 grid-cols-3 items-center gap-2">
              <PlayedCards turn={state.table[2]} />
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="sm:hidden">
                  <BottomCards cards={state.bottom} revealed={state.landlord !== null} />
                </div>
                {status &&
                  (thinking !== null ? (
                    <ThinkingText className="text-body">{status}</ThinkingText>
                  ) : (
                    <span className={cn("text-body", myTurn ? "font-medium text-fg" : "text-fg-muted")}>{status}</span>
                  ))}
                {state.redeals > 0 && state.phase === "bidding" && <Badge tone="info">没人叫地主，已重新发牌</Badge>}
                {state.phase === "playing" && (
                  <span className="font-mono text-caption font-normal text-fg-subtle">
                    底分 {state.highestBid} · 炸弹 {state.bombs}
                  </span>
                )}
              </div>
              <PlayedCards turn={state.table[1]} />
            </div>
            <PlayedCards turn={state.table[0]} />

            {/* 操作区 */}
            <div className="flex min-h-control-lg flex-col items-center gap-1.5">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {roleOf(0) && (
                  <Badge tone={roleOf(0) === "landlord" ? "warning" : "neutral"}>
                    {roleOf(0) === "landlord" && <Crown />}
                    {roleOf(0) === "landlord" ? "你是地主" : "你是农民"}
                  </Badge>
                )}
                {myTurn && state.phase === "bidding" && (
                  <>
                    <Button variant="secondary" onClick={() => game.bid(0)}>
                      不叫
                    </Button>
                    {[1, 2, 3].map((v) => (
                      <Button key={v} variant={v === 3 ? "primary" : "soft"} disabled={v <= state.highestBid} onClick={() => game.bid(v)}>
                        {v} 分
                      </Button>
                    ))}
                  </>
                )}
                {myTurn && state.phase === "playing" && (
                  <>
                    <Tooltip content="不出" shortcut="P">
                      <Button variant="secondary" disabled={mustPlay} onClick={doPass}>
                        不出
                      </Button>
                    </Tooltip>
                    <Tooltip content={myHints.length ? "按规则 AI 的建议选牌，多按几次换一种" : "没有能管上的牌"} shortcut="H">
                      <Button variant="soft" onClick={doHint}>
                        <Lightbulb />
                        {myHints.length ? "提示" : "要不起"}
                      </Button>
                    </Tooltip>
                    <Tooltip content="出牌" shortcut="Enter">
                      <Button disabled={selected.size === 0} onClick={doPlay}>
                        出牌
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>
              {error && <p className="text-footnote text-danger-fg">{error}</p>}
            </div>

            <Hand cards={hand} selected={selected} onChange={setSelected} />
          </section>

          <aside className="hidden w-80 shrink-0 flex-col border-l border-line-subtle bg-surface lg:flex xl:w-96">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
              <ListTree className="size-4 text-fg-subtle" />
              <span className="text-body font-medium">大模型思考记录</span>
              <Badge className="ml-auto" tone={llmCount ? "accent" : "neutral"}>
                {llmCount} 位大模型对手
              </Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AiLog logs={game.logs} />
            </div>
            <p className="border-t border-line-subtle px-4 py-2 text-caption font-normal text-fg-subtle">
              快捷键 <Kbd>Enter</Kbd> 出牌 · <Kbd>P</Kbd> 不出 · <Kbd>H</Kbd> 提示
            </p>
          </aside>
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        seats={seats}
        accessPassword={accessPassword}
        onSave={(next, password) => {
          setSeats(next);
          setAccessPassword(password);
        }}
      />

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-h-full max-w-lg overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>大模型思考记录</DialogTitle>
          </DialogHeader>
          <AiLog logs={game.logs} />
        </DialogContent>
      </Dialog>

      <ResultDialog game={game} />
    </TooltipProvider>
  );
}

function ResultDialog({ game }: { game: ReturnType<typeof useGame> }) {
  const { state, names, board } = game;
  const result = state.result;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(!!result), [result]);
  if (!result) return null;
  const won = result.delta[0] > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{won ? "你赢了" : "你输了"}</DialogTitle>
          <DialogDescription>
            {result.landlordWins ? `地主 ${names[result.winner]} 先出完了牌。` : `农民 ${names[result.winner]} 先出完了牌，农民获胜。`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          <Badge>底分 {result.bid}</Badge>
          <Badge tone={result.bombs ? "warning" : "neutral"}>炸弹 {result.bombs}</Badge>
          {result.spring && <Badge tone="danger">{result.landlordWins ? "春天" : "反春"}</Badge>}
          <Badge tone="accent">×{result.multiple}</Badge>
        </div>
        <div className="flex flex-col divide-y divide-line-subtle rounded-card border border-line-subtle">
          {([0, 1, 2] as Seat[]).map((seat) => (
            <div key={seat} className="flex items-center gap-2 px-3 py-2">
              <span className="text-body">{names[seat]}</span>
              {state.landlord === seat && <Badge tone="warning">地主</Badge>}
              <span
                className={cn("ml-auto font-mono tabular-nums", result.delta[seat] > 0 ? "text-success-fg" : "text-danger-fg")}
              >
                {signed(result.delta[seat])}
              </span>
              <span className="w-12 text-right font-mono text-footnote text-fg-subtle tabular-nums">{signed(board.scores[seat])}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            看看牌面
          </Button>
          <Button onClick={game.newGame}>再来一局</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
