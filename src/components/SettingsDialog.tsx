import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  fieldClasses,
} from "@cz/design-system";
import { Bot, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { SeatConfig } from "../ai/players";
import { PROVIDERS, providerById, type Effort } from "../ai/providers";

const SEAT_LABEL = ["右侧 · 下家", "左侧 · 上家"] as const;

function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldClasses, "h-control-md px-2.5 text-body")}>
      {children}
    </select>
  );
}

function SeatForm({ index, value, onChange }: { index: number; value: SeatConfig; onChange: (v: SeatConfig) => void }) {
  const set = <K extends keyof SeatConfig>(key: K, v: SeatConfig[K]) => onChange({ ...value, [key]: v });
  const provider = providerById(value.providerId);
  const id = (name: string) => `seat${index}-${name}`;
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={value.kind} onValueChange={(v) => set("kind", v as SeatConfig["kind"])}>
        <TabsList aria-label="对手类型">
          <TabsTrigger value="llm">
            <Sparkles />
            大模型
          </TabsTrigger>
          <TabsTrigger value="bot">
            <Bot />
            规则 AI
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Field label="名字" htmlFor={id("name")}>
        <Input id={id("name")} value={value.name} maxLength={8} onChange={(e) => set("name", e.target.value)} />
      </Field>

      {value.kind === "llm" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="服务商" htmlFor={id("provider")}>
              <Select
                id={id("provider")}
                value={value.providerId}
                onChange={(v) => onChange({ ...value, providerId: v, model: providerById(v)?.models[0] ?? "" })}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="模型" htmlFor={id("model")} hint="可以直接输入其他模型名">
              <Input id={id("model")} list={id("models")} value={value.model} onChange={(e) => set("model", e.target.value)} />
              <datalist id={id("models")}>
                {provider?.models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Field>
          </div>
          {value.providerId === "custom" && (
            <Field label="接口地址" htmlFor={id("base")} hint="OpenAI 兼容接口，例如 https://example.com/v1">
              <Input id={id("base")} value={value.baseUrl} placeholder="https://…/v1" onChange={(e) => set("baseUrl", e.target.value)} />
            </Field>
          )}
          {!provider?.keyless && (
            <Field
              label="API Key"
              htmlFor={id("key")}
              hint={
                provider?.envKey
                  ? `留空则使用服务端环境变量 ${provider.envKey}。Key 只保存在本机浏览器。`
                  : "Key 只保存在本机浏览器，经服务端转发。"
              }
            >
              <Input id={id("key")} type="password" autoComplete="off" value={value.apiKey} onChange={(e) => set("apiKey", e.target.value)} />
            </Field>
          )}
          {provider?.kind === "anthropic" && (
            <Field label="思考力度" htmlFor={id("effort")} hint="越高越会算牌，但每步等待更久">
              <Select id={id("effort")} value={value.effort} onChange={(v) => set("effort", v as Effort)}>
                <option value="low">低（推荐，节奏快）</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </Select>
            </Field>
          )}
        </>
      )}
      {value.kind === "bot" && (
        <p className="text-footnote text-fg-muted">规则 AI 在本地运行，不需要网络。它会尽量少拆牌、先出小牌，并在对手快出完时用炸弹拦截。</p>
      )}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  seats,
  accessPassword,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seats: [SeatConfig, SeatConfig];
  accessPassword: string;
  onSave: (seats: [SeatConfig, SeatConfig], accessPassword: string) => void;
}) {
  const [draft, setDraft] = useState(seats);
  const [password, setPassword] = useState(accessPassword);
  const [tab, setTab] = useState("1");
  useEffect(() => {
    if (open) {
      setDraft(seats);
      setPassword(accessPassword);
    }
  }, [open, seats, accessPassword]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-full max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>对手设置</DialogTitle>
          <DialogDescription>每个对手都可以是大模型或规则 AI。改动从下一步开始生效。</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="座位">
            {SEAT_LABEL.map((label, i) => (
              <TabsTrigger key={label} value={String(i + 1)}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {draft.map((seat, i) => (
            <TabsContent key={i} value={String(i + 1)}>
              <SeatForm
                index={i}
                value={seat}
                onChange={(v) => setDraft((d) => (i === 0 ? [v, d[1]] : [d[0], v]))}
              />
            </TabsContent>
          ))}
        </Tabs>
        <Field label="访问密码" htmlFor="access-password" hint="服务器设置了 ACCESS_PASSWORD 时才需要填">
          <Input id="access-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => {
              onSave(
                draft.map((s) => ({ ...s, name: s.name.trim() || (s.kind === "llm" ? "AI" : "电脑") })) as [SeatConfig, SeatConfig],
                password.trim(),
              );
              onOpenChange(false);
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
