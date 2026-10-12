import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { llmProxy } from "./server/llm-proxy";

/**
 * 设计系统以源码形式引用：和本仓库并排克隆 cz-design-system（../cz-design-system）。
 * 它的依赖（React、Radix、Framer Motion……）统一从本项目的 node_modules 解析，避免出现两份 React。
 */
const designSystem = fileURLToPath(new URL("../cz-design-system", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), llmProxy()],
  resolve: {
    alias: [{ find: /^@cz\/design-system$/, replacement: `${designSystem}/src/index.ts` }],
    dedupe: ["react", "react-dom", "framer-motion", "radix-ui", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority"],
  },
  server: { fs: { allow: [".", designSystem] } },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
