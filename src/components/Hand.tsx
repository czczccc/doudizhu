import { cn, transition } from "@cz/design-system";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Card } from "../game/cards";
import { PlayingCard } from "./PlayingCard";

/**
 * 自己的手牌：横向叠放，点击或按住滑动选牌，选中的牌上移。
 * 每张牌占一列较窄的网格，最后一张完整显示；屏幕变窄时列宽自动收缩。
 */
export function Hand({
  cards,
  selected,
  onChange,
  disabled,
}: {
  cards: Card[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  // 拖动选牌：按下时决定这次是“选中”还是“取消”，划过的牌都设成同一状态
  const drag = useRef<{ select: boolean; seen: Set<number> } | null>(null);
  const latest = useRef(selected);
  latest.current = selected;

  useEffect(() => {
    const end = () => (drag.current = null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  const apply = (id: number) => {
    const d = drag.current;
    if (!d || d.seen.has(id)) return;
    d.seen.add(id);
    const next = new Set(latest.current);
    if (d.select) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  const cardAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-card-id]");
    return el ? Number(el.dataset.cardId) : null;
  };

  return (
    <div
      role="group"
      aria-label="我的手牌"
      className={cn("grid w-full touch-none justify-center pt-4", disabled && "pointer-events-none opacity-60")}
      style={{ gridTemplateColumns: `repeat(${Math.max(cards.length - 1, 0)}, minmax(0, 2rem)) max-content` }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const id = cardAt(e.clientX, e.clientY);
        if (id !== null) apply(id);
      }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {cards.map((card) => {
          const on = selected.has(card.id);
          return (
            <motion.button
              key={card.id}
              type="button"
              data-card-id={card.id}
              aria-pressed={on}
              layout={!reduce}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: on && !reduce ? -14 : 0 }}
              exit={{ opacity: 0, y: -24, transition: transition.exit }}
              transition={transition.snappy}
              className="relative w-max cursor-pointer rounded-md outline-none focus-visible:shadow-ring"
              onPointerDown={(e) => {
                // 触屏会把指针捕获在按下的元素上，释放后才能收到其他牌的移动事件
                (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
                drag.current = { select: !on, seen: new Set() };
                apply(card.id);
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  const next = new Set(selected);
                  if (on) next.delete(card.id);
                  else next.add(card.id);
                  onChange(next);
                }
              }}
            >
              <PlayingCard card={card} className={cn("transition-colors duration-fast", on && "border-accent shadow-md")} />
              {on && <span aria-hidden className="absolute inset-0 rounded-md bg-accent-soft opacity-30" />}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
