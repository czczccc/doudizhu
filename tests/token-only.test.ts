// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 和 CZ Design System 同一条规则：界面代码只用设计 token，
 * 不写硬编码颜色、Tailwind 默认色板、方括号任意值。
 */
const dir = fileURLToPath(new URL("../src", import.meta.url));
const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ name: f, text: stripAllowed(readFileSync(join(dir, f), "utf8")) }));

function stripAllowed(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\b(?:group-|peer-)?(?:data|aria)-\[[^\]]+\]:/g, "");
}

const palette =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";

const rules: [string, RegExp][] = [
  ["十六进制颜色", /#[0-9a-fA-F]{3,8}\b/],
  ["rgb/hsl/oklch 颜色函数", /\b(rgba?|hsla?|oklch|oklab)\(/],
  ["Tailwind 默认色板", new RegExp(`\\b(bg|text|border|ring|fill|stroke|from|to|via|shadow|outline|divide)-(${palette})(-\\d+)?\\b`)],
  ["shadcn 默认语义色", /\b(bg|text|border|ring)-(background|foreground|primary|secondary|muted|card|popover|destructive|input)(-foreground)?\b/],
  ["任意值（方括号）", /\b(?:[a-z]+-)+\[(?!&)[^\]]+\]/],
  ["px 单位的内联尺寸", /\b\d+px\b/],
];

describe("界面只使用 design token", () => {
  it("找到了界面文件", () => expect(files.length).toBeGreaterThan(5));
  for (const { name, text } of files) {
    for (const [label, re] of rules) {
      it(`${name} 不含${label}`, () => {
        const hit = text.match(re);
        expect(hit?.[0], hit ? `${name}: ${hit[0]}` : undefined).toBeUndefined();
      });
    }
  }
});
