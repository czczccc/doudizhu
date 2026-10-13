# 斗地主 · 与大模型同桌

经典三人斗地主。你坐下方，左右两家对手各自可以是**大模型**或**本地规则 AI**——一个大模型、两个大模型，或者让 Claude 和 DeepSeek 联手当农民打你，都行。

界面基于 [CZ Design System](https://github.com/czczccc/cz-design-system)：颜色、字号、圆角、阴影、动效全部取自它的 token，组件直接复用它的 Button、Badge、Card、Dialog、Tabs、Tooltip，以及 AI 组件 StatusDot、ThinkingText、ToolCall。明暗主题跟随系统，也可以手动切换。

## 快速开始

```bash
git clone https://github.com/czczccc/doudizhu.git
cd doudizhu
npm ci
cp .env.example .env   # 可选：填入要用的模型 Key
npm run dev            # http://localhost:5173
```

不填任何 Key 也能玩：大模型请求失败时，这一步会由规则 AI 代打，并在侧栏注明原因。

## 部署

```bash
npm ci
npm run build
npm start -- --host 0.0.0.0 --port 8080
```

`npm start`（`vite preview`）同时提供页面和出牌接口 `/api/move`，所以要以 Node 进程运行，不能只把 `dist/` 放到静态托管上。模型 Key 用环境变量或 `.env` 提供。

### 防止被当成大模型代理滥用

`/api/move` 只接受**对局状态**，不接受任何提示词：

- 浏览器只发牌的 id；服务端用标准牌重建对局，检查牌不重复、出过的牌都是合法牌型，任何多余字段都会被丢弃
- 系统提示、局面描述、输出格式都由服务端按固定模板生成；玩家名字只保留文字和数字，最多 8 个字
- 模型的回答在服务端校验，返回给浏览器的只是“出哪几张牌”和一句不超过 40 字的台词

另外几道限制，都可以用环境变量调整：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `LLM_ALLOWED_MODELS` | 使用服务端 Key 时允许的模型（逗号分隔）。玩家自带 Key 时不受限 | 各服务商的预设模型 |
| `LLM_ALLOW_CUSTOM_ENDPOINTS` | 是否允许“自定义地址”和 Ollama（会让服务器去请求任意地址） | `npm run dev` 允许，`npm start` 不允许 |
| `LLM_RATE_LIMIT` | 每个 IP 每分钟最多请求次数 | 40 |
| `TRUST_PROXY` | 部署在 Nginx 等反向代理后面时设为 `true`，按 `X-Forwarded-For` 识别 IP | 关闭 |
| `ACCESS_PASSWORD` | 设置后，玩家要在「对手设置」里填对密码才能用大模型 | 不设置 |

公开部署并在服务端放了 Key 时，建议同时设置 `ACCESS_PASSWORD`：上面的措施能防止别人拿接口去干别的，但不能阻止别人用你的 Key 打斗地主。

## 设计系统依赖

CZ Design System 以 npm 依赖的形式引入，指向 GitHub 上某个固定提交的源码包（见 `package.json` 里的 `@cz/design-system`），`npm ci` 会自动下载，不需要单独克隆，构建机也不需要装 git。

升级设计系统：把 URL 末尾的提交号换成新的，再执行 `npm install` 更新锁文件。

## 接入大模型

点右上角的「对手设置」，分别为左、右两家选择：

| 服务商 | 接口 | 环境变量 |
| --- | --- | --- |
| Claude | Anthropic 官方 SDK | `ANTHROPIC_API_KEY` |
| OpenAI | OpenAI 兼容 | `OPENAI_API_KEY` |
| DeepSeek | OpenAI 兼容 | `DEEPSEEK_API_KEY` |
| 通义千问 | OpenAI 兼容（DashScope） | `DASHSCOPE_API_KEY` |
| Kimi | OpenAI 兼容 | `MOONSHOT_API_KEY` |
| 智谱 GLM | OpenAI 兼容 | `ZHIPU_API_KEY` |
| Ollama（本地） | OpenAI 兼容，无需 Key | — |
| 自定义 | 任意 OpenAI 兼容地址 | 只能在浏览器里填 Key |

模型名称可以自由输入。Key 可以写在 `.env`，也可以在设置里填（只存在本机浏览器的 localStorage）。

**出牌接口**：浏览器不直接请求模型服务（大多不允许跨域，Key 也不该暴露），而是把对局状态发给 Vite 开发/预览服务器上的 `POST /api/move`（`server/llm-proxy.ts`），由服务端拼提示词、调用模型、校验回答。所以要用 `npm run dev` 或 `npm run build && npm start` 启动；直接打开静态文件时大模型不可用。服务端环境变量里的 Key 只会发往表里登记的官方地址。

### 大模型怎么打牌

每轮到大模型，服务端会发给它一段局面描述（`src/ai/prompt.ts`）：

- 身份、底分、炸弹数、底牌，自己的手牌
- 其他人剩几张、谁是队友谁是对手
- 外面还没出现的牌（相当于记牌器）
- 最近的出牌记录、要压的牌
- 所有能出的牌，按规则 AI 的推荐程度排序（最多 40 种）

模型回答 JSON：`{"action": "play", "cards": ["K","K","K","5"], "say": "一句台词"}`。Claude 通过结构化输出强制这个格式，其他模型靠提示词约束。回答会被严格校验（牌在不在手里、牌型是否合法、压不压得过）；不合法时把错误告诉它重答一次，还不行就由规则 AI 代打。`say` 会作为台词气泡显示在牌桌上。

右侧「大模型思考记录」能展开看每一步发出的局面和模型的原始回答。

Claude 默认用 `claude-opus-5-5`，思考力度默认「低」以保证出牌节奏，可在设置里调高。Claude Opus 5.5 / Sonnet 5.5 请求开启了服务端拒答兜底（`fallbacks: "default"`），被拒时自动换模型重试。

## 规则

- 叫分制：随机一家先叫，可叫 1–3 分或不叫，叫 3 分直接成为地主；都不叫重新发牌。
- 牌型：单张、对子、三张、三带一、三带一对、顺子、连对、飞机（可带单或带对）、四带二、四带两对、炸弹、王炸。
- 计分：底分 × 2^(炸弹数) × 春天/反春 2 倍；地主得失双倍。累计积分保存在浏览器里。

操作：点击或按住滑动选牌；`Enter` 出牌，`P` 不出，`H` 提示（多按几次换一种）。

## 结构

```
src/game/      纯逻辑：牌、牌型识别、出牌枚举、规则 AI、对局状态机
src/ai/        服务商配置、提示词、请求校验与决策循环（decide.ts，服务端使用）
src/components 牌、手牌、座位、设置、思考记录
server/        Vite 插件形式的出牌接口：模型白名单、限流、访问密码
tests/         牌型/状态机/200 局自对局、回答解析、接口防滥用、只用 token 的样式检查
```

```bash
npm run check   # 类型检查 + 测试 + 构建
```
