# Launch kit（发射材料 — 内部用，不随包发布）

## 0. 发射前检查清单

- [ ] `npm view agent-verdict` 确认包名可用（被占则备选：`verdict-agent`, `agent-verdict-dev`, `@<scope>/verdict`）
- [ ] GitHub 仓库建好（public, MIT），README 首屏放仪表盘截图/GIF
- [ ] 录制 2 分钟"恐惧演示"：`npx verdict demo` 的提示词注入剧本，左右对比
- [ ] docs/proposal.md 同步发成 GitHub Discussion / 博文
- [ ] `npm publish` + `pip` 打包（python/ 已是单文件，setup 后发 PyPI）

## 1. Hacker News（Show HN）

**标题候选（按推荐排序）：**

1. `Show HN: Verdict – see why your AI agent's tool call was denied`
2. `Show HN: DevTools for agent authorization (MCP, budgets, delegation)`
3. `Show HN: My agent silently failed. This shows which layer said no`

**帖子正文草稿：**

> Agents in production sit behind five layers that can each say no: OAuth
> scopes (MCP auth), gateway policies, budgets, payment mandates, delegation
> chains. Each speaks its own dialect, so when a tool call fails you grep
> five log formats and guess.
>
> Verdict is a local-first timeline for authorization decisions. Wrap your
> MCP client in one line; every allow/deny shows up with the *why*: which
> layer, which rule, budget state at decision time, the delegation chain.
> There's a time-travel replay for stepping through a failed run, and
> `verdict tail` adapts existing gateway JSONL logs.
>
> Zero runtime deps, data never leaves 127.0.0.1. The interesting part is
> probably the unified DecisionEvent format (link to proposal) — I'd love
> feedback from anyone running gateways or agent frameworks on whether
> they'd emit it natively.
>
> Try without wiring anything: `npx verdict demo`

**发射时间：**美东周二–周四早 8–10 点。发完后 4 小时内守评论区——HN 的转化全在评论质量。

## 2. 目标社区（按优先级）

| 渠道 | 动作 |
|---|---|
| MCP 官方 GitHub Discussions | 发 proposal.md 精简版，问"愿不愿原生发这个格式" |
| MCP 官方 Discord | demo GIF + 一句话，别刷屏 |
| r/LocalLLaMA, r/mcp | "I built X because my agent kept silently failing" 叙事 |
| awesome-mcp 系列列表 | 提 PR 加入 observability 分类 |
| Lobsters / dev.to | 转发 proposal 文章 |
| Twitter/X agent-dev 圈 | 30 秒 demo 视频 + 线程拆解五层"方言" |

## 3. 集成 PR 攻势（前 5 个真实用户的来源）

给以下类型的开源项目直接提"add verdict integration"PR（各 ~20 行）：

1. 流行的 MCP agent 框架的 examples 目录（加一个 observability 示例）
2. MCP gateway（Intercept/AGT 类）：提供 `--map` 配置文件，README 里给 `verdict tail` 一行命令
3. agent 模板仓库（create-xxx-agent 类脚手架）：作为可选依赖

**PR 文案模板：**

> This adds an optional one-line integration with agent-verdict, a
> local-first authorization timeline. When users of <project> hit a denied
> tool call, they currently see <现状的烂错误>. With this, they get the
> layer + rule + budget state that produced the denial. No runtime deps,
> nothing leaves localhost, fully optional.

## 4. 发射后第 1–4 周节奏

- 每周一发 changelog（哪怕很小）——持续可见本身就是壁垒
- 守住一个指标：**生产环境真实依赖的项目数**（目标：4 周内 5 个）
- 每个 issue 24h 内回复；每个用过的人都问一句："上一次你查不出 agent 为什么失败，是什么场景？"——这是下一个适配器的需求清单
- 收集"deny 案例"做成 docs/zoo.md（拒绝动物园）：每种真实拒绝的原始错误 vs Verdict 解读，这是最好的内容营销

## 5. 风险预案

- **被指责"又一个 observability 工具"**：回应口径——不做通用 tracing，只做授权决策这一种语义，OTel 是互补（proposal 里已写）
- **HN 冷场**：两周后换叙事角度（"我给 agent 的每次被拒装上了 why"）再发一次 dev.to/Reddit；HN 允许隔段时间重投
- **有人发现分类器误判**：这是最好的 issue——每个误判样本都让启发式更准，公开感谢 + 24h 内修
