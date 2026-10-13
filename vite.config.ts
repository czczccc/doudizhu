import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { llmProxy } from "./server/llm-proxy";

export default defineConfig({
  plugins: [react(), tailwindcss(), llmProxy()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
