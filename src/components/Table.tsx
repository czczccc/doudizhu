import { Badge, Card as Panel, StatusDot, ThinkingText, cn, pop, reduced, rise, stagger, transition } from "@cz/design-system";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bot, Crown, Sparkles } from "lucide-react";
import type { Card } from "../game/cards";
import { COMBO_LABEL } from "../game/patterns";
import type { Turn } from "../game/state";
import { CardBack, PlayingCard, type CardSize } from "./PlayingCard";

export type Speech = { text: string; key: number };

/** 对手座位：头像、名字、模型、身份、剩余张数、思考状态和台词气泡 */
export function OpponentSeat({
  name,
  model,
  isLlm,
  role,
  cardCount,
  thinking,
  speech,
  bid,
  align,
  reveal,
}: {
  name: string;
  model: string;
  isLlm: boolean;
  role: "landlord" | "farmer" | null;
  cardCount: number;
  thinking: boolean;
  speech?: Speech;
  /** 叫分阶段显示的叫分 */
  bid?: number;
  align: "left" | "right";
  /** 对局结束后亮出剩下的牌 */
  reveal?: Card[];
}) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("relative flex flex-col gap-2", align === "right" ? "items-end" : "items-start")}>
      <Panel className="w-36 gap-2 p-3 sm:w-48">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full border text-footnote font-semibold",
              role === "landlord" ? "border-warning-line bg-warning-soft text-warning-fg" : "border-line bg-sunken text-fg-muted",
            )}
          >
            {role === "landlord" ? <Crown className="size-4" /> : name.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 truncate text-body font-medium">
              {name}
              <StatusDot state={thinking ? "running" : "idle"} />
            </span>
            <span className="truncate text-caption font-normal text-fg-subtle">{model}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {role && <Badge tone={role === "landlord" ? "warning" : "neutral"}>{role === "landlord" ? "地主" : "农民"}</Badge>}
          <Badge tone={isLlm ? "accent" : "neutral"}>
            {isLlm ? <Sparkles /> : <Bot />}
            {isLlm ? "大模型" : "规则"}
          </Badge>
          {bid !== undefined && <Badge tone="info">{bid === 0 ? "不叫" : `${bid} 分`}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {reveal && reveal.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-y-1">
              {reveal.map((c, i) => (
                <PlayingCard key={c.id} card={c} size="xs" className={i > 0 ? "-ml-3" : undefined} />
              ))}
            </div>
          ) : (
            <div className="flex">
              {Array.from({ length: Math.min(cardCount, 6) }, (_, i) => (
                <CardBack key={i} size="xs" className={i > 0 ? "-ml-4" : undefined} />
              ))}
            </div>
          )}
          <span
            className={cn(
              "font-mono text-footnote tabular-nums",
              cardCount <= 2 && cardCount > 0 ? "font-medium text-danger-fg" : "text-fg-muted",
            )}
          >
            {cardCount} 张
          </span>
          {thinking && <ThinkingText className="ml-auto text-caption">思考中</ThinkingText>}
        </div>
      </Panel>
      <AnimatePresence mode="wait">
        {speech && (
          <motion.div
            key={speech.key}
            variants={reduce ? reduced(pop) : pop}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="max-w-36 rounded-card sm:max-w-48 border border-line-subtle bg-raised px-3 py-2 text-footnote text-fg shadow-md"
          >
            {speech.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 一个座位在本轮桌面上的动作：一组牌，或者“不出” */
export function PlayedCards({ turn, size = "sm", label }: { turn: Turn | null; size?: CardSize; label?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-20 flex-col items-center justify-center gap-1">
      <AnimatePresence mode="wait">
        {turn && (
          <motion.div
            key={turn.play ? turn.play.cards.map((c) => c.id).join("-") : "pass"}
            className="flex flex-col items-center gap-1"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={stagger(0.03)}
          >
            {turn.play ? (
              <>
                <div className="flex">
                  {turn.play.cards.map((c, i) => (
                    <motion.div key={c.id} variants={reduce ? reduced(rise) : rise} className={i > 0 ? "-ml-6" : undefined}>
                      <PlayingCard card={c} size={size} />
                    </motion.div>
                  ))}
                </div>
                <span className="text-caption text-fg-subtle">{COMBO_LABEL[turn.play.combo.type]}</span>
              </>
            ) : (
              <motion.span variants={reduce ? reduced(rise) : rise} className="text-body text-fg-subtle">
                不出
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {!turn && label && <span className="text-caption text-fg-disabled">{label}</span>}
    </div>
  );
}

/** 三张底牌：定地主前背面朝上 */
export function BottomCards({ cards, revealed }: { cards: Card[]; revealed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex gap-1">
        {cards.map((c) =>
          revealed ? (
            <motion.div key={c.id} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={transition.smooth}>
              <PlayingCard card={c} size="sm" />
            </motion.div>
          ) : (
            <CardBack key={c.id} size="sm" />
          ),
        )}
      </div>
      <span className="text-caption text-fg-subtle">底牌</span>
    </div>
  );
}
