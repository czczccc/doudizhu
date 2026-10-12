import { ToolCall, reduced, rise } from "@cz/design-system";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import type { DecisionLog } from "../ai/players";

/** 侧栏：大模型每一步看到了什么、回答了什么 */
export function AiLog({ logs }: { logs: DecisionLog[] }) {
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [logs.length]);

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-fg">
          <Sparkles className="size-5" />
        </span>
        <p className="text-body text-fg">还没有大模型的决策</p>
        <p className="text-footnote text-fg-muted">把对手设成大模型后，这里会显示它每一步看到的局面和原始回答。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {logs.map((log) => (
        <motion.div key={log.id} variants={reduce ? reduced(rise) : rise} initial="hidden" animate="visible">
          <ToolCall
            name={`${log.name} · ${log.phase === "bid" ? "叫分" : "出牌"}`}
            summary={log.status === "running" ? log.model : [log.summary, log.ms ? `${(log.ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ")}
            status={log.status}
            input={log.prompt}
            output={[...log.replies, log.note ? `⚠ ${log.note}` : ""].filter(Boolean).join("\n\n——\n\n") || undefined}
          />
        </motion.div>
      ))}
      <div ref={end} />
    </div>
  );
}
