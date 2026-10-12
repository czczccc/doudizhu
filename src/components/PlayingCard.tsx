import { cn } from "@cz/design-system";
import type { ComponentProps } from "react";
import { BIG_JOKER, RANK_LABEL, SMALL_JOKER, SUIT_SYMBOL, isRed, type Card } from "../game/cards";

export type CardSize = "xs" | "sm" | "md";

const sizes: Record<CardSize, { box: string; rank: string; suit: string; pip: string; joker: string }> = {
  xs: { box: "h-9 w-6 rounded-xs", rank: "text-caption", suit: "hidden", pip: "hidden", joker: "text-caption" },
  sm: { box: "h-14 w-10 rounded-sm", rank: "text-footnote", suit: "text-caption", pip: "hidden", joker: "text-caption" },
  md: {
    box: "h-20 w-14 rounded-md sm:h-24 sm:w-17",
    rank: "text-body-lg sm:text-title-sm",
    suit: "text-footnote",
    pip: "text-title sm:text-heading",
    joker: "text-footnote",
  },
};

/** 牌面：左上角点数和花色，右下角大花色；王牌竖排 “JOKER”。红色用 danger 语义色。 */
export function PlayingCard({ card, size = "md", className, ...props }: ComponentProps<"div"> & { card: Card; size?: CardSize }) {
  const s = sizes[size];
  const joker = card.rank === SMALL_JOKER || card.rank === BIG_JOKER;
  return (
    <div
      className={cn(
        "card-face relative shrink-0 select-none overflow-hidden border border-line shadow-sm",
        isRed(card) ? "text-danger-fg" : "text-fg",
        s.box,
        className,
      )}
      aria-label={`${SUIT_SYMBOL[card.suit]}${RANK_LABEL[card.rank]}`}
      {...props}
    >
      {joker ? (
        <span className={cn("vertical-text absolute top-1 left-0.5 font-semibold leading-none", s.joker)}>
          {size === "md" ? "JOKER" : card.rank === BIG_JOKER ? "大王" : "小王"}
        </span>
      ) : (
        <>
          <span className="absolute top-1 left-1 flex flex-col items-center leading-none">
            <span className={cn("font-semibold tracking-tight", s.rank)}>{RANK_LABEL[card.rank]}</span>
            <span className={cn("leading-none", s.suit)}>{SUIT_SYMBOL[card.suit]}</span>
          </span>
          <span className={cn("absolute right-1.5 bottom-1 leading-none", s.pip)}>{SUIT_SYMBOL[card.suit]}</span>
        </>
      )}
      {joker && size === "md" && (
        <span className={cn("absolute right-1.5 bottom-1 leading-none", s.pip)} aria-hidden>
          {card.rank === BIG_JOKER ? "★" : "☆"}
        </span>
      )}
    </div>
  );
}

export function CardBack({ size = "sm", className }: { size?: CardSize; className?: string }) {
  return <div aria-hidden className={cn("card-back shrink-0 border border-accent shadow-xs", sizes[size].box, className)} />;
}
