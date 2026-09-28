# Agent Router

<div align="right"><b>English</b> · <a href="README.zh-CN.md">中文</a></div>


**主代理担任主线程（默认 Claude Code，可用 `--main` 指定为 zcode / devin / codex / opencode / antigravity）**：它常驻一个长期会话，把总目标拆解成任务派给本地子代理（ZCode / Devin / Codex / OpenCode / Antigravity / 其他 Claude Code 实例），派完活不等待、继续干自己的事；子代理的动向（完成/失败/留言）由 Router 实时推送回主会话。所有 agent 通过**本地任务板**协作、经**任务板信箱**互发消息，Router 负责自动派发、收割合并、汇总产出。

所有 agent 运行时、会话、任务数据、通信全部在本机（模型推理走各自厂商 API，这是唯一的边界）。

## 通信方式：共享任务板（方式一）+ 事件驱动

agent 之间不直连，全部通过一个**本地 MCP server**（stdio + JSON 文件）中转；Router 是主代理的"手脚"（调度器 + 事件层）：

```
你 ──目标──▶ Claude 主会话（主线程，常驻，stream-json 双向流）
              ├─ create_task 派活 → 立即返回，继续干自己的事
              ├─ followup_task 指定某个子代理带着原任务上下文继续
              ├─ 收到 [事件]/[信箱] 推送 → 答复 / 建后续任务 / 亲自写代码
              └─ 目标达成 → 调用 finish_run 结束运行
                    ▲ 事件实时注入             │ 派发/收割（Node 调度器）
              ┌─────┴──────────────────────────┴─────┐
              │        board-server.mjs（MCP/stdio）  │
              │   任务 + 信箱 → data/<run>/board.json │
              └─────┬───────────┬───────────┬─────────┘
              claude -p   agy(stream-json)  zcode -p   opencode run   devin acp
             （子代理执行任务：默认直通主仓库工作区，可选 worktree 隔离）
```

- **非阻塞派发**：主代理 `create_task` 后，调度器在一秒内把就绪任务派给对应子代理（每个子代理并发 1，FIFO 排队），并把"已排入队列"事件推回主会话。
- **续派（followup_task，类似 Codex）**：主代理可指定某个已结束任务的原执行子代理**继续**——Router 把原任务 spec、上轮结果与新指令注入为全新会话（不用会话 resume：claude/zcode 的 shell 快照锚定原会话目录，resume 到新目录会导致 Bash 工具失效），沿用原任务的执行模式（直通，或 worktree `task/T<id>-c<N>`），完成后照常收割。
- **实时事件**：任务完成合并、失败、子代理留言（`send_message` 给 manager）都会立即注入主会话，不再等批次结束。
- **主代理也能写代码**：assignee 填 `manager` 的任务由主代理亲自完成（在主仓库工作区，自己 commit）。
- **派发模式（默认直通）**：子代理默认直接在主仓库工作区执行（Codex 式共享工作区），多个任务**同时进行**——并发约束只有"每个子代理同时只跑一个自己的任务"；任务完成时 Router 只兜底提交未入库改动，没有代码改动的任务也是合法的。某任务要做有风险的实验性改动、需要隔离时：`create_task` 传 `isolated: true`（单任务隔离），或运行加 `--worktree`（全部隔离）。注意：并行直通的任务共享同一工作区，改同一批文件可能互相干扰，安排任务时尽量让改动范围不重叠。
- **git 可选**：默认直通模式不要求目标目录是 git 仓库——没有 git 就没有提交记录、合并与回滚，Router 跳过所有 git 动作，子代理直接改文件；`--worktree` 隔离模式需要 git。
- **隔离与收割（worktree 模式）**：每个任务一个 `git worktree`（`task/T<id>` 分支）；会话结束后 Router 强制提交未入库改动、校验提交数、`--no-ff` 合并回主分支，失败则保留现场并推送事件。
- **续命**：主会话进程意外退出时以 `--resume` 重启同一会话，上下文不丢；持续无输出超 10 分钟也会强制续命。
- **观察**：主会话完整事件流在 `data/<run>/logs/manager-stream.log`，每个成员输出在 `logs/`；也可用 Web 控制台实时看。

## 前置条件

| 成员 | 依赖 | 状态获取 |
|---|---|---|
| manager / claude | Claude Code CLI（本机 `Claude-3p` 安装，claude.ai 登录）+ 本地代理 | `router.config.json` 的 `claude.proxy` 指向 v2rayN 混合端口 |
| zcode | `npm i -g zcode-app-cli`，复用桌面端 GLM 计划凭证 | 已配置（`provider_config.json` 的 `defaultModelSelection` + credentials 的 identity 键） |
| devin | Devin CLI + 一次性 `devin auth login`（浏览器授权） | 未登录时 Router 会提示跳过 |
| codex | Codex CLI（`npm i -g @openai/codex`，`codex exec --json`，需 ChatGPT 登录） | 使用本机 Codex 登录与模型配置 |
| opencode | OpenCode CLI（`npm i -g opencode-ai`） | 使用本机 `opencode auth` 的凭证；模型默认 `opencode/space-bunny-free` |
| antigravity | Antigravity CLI（官方安装脚本装到 `%LOCALAPPDATA%\agy\bin`，命令 `agy`） | 密钥环静默登录（复用 IDE 凭据）；生成接口有地区限制，`antigravity.proxy` 指向本地代理 |

`router.config.json` 可覆盖各 agent 的可执行路径、代理与模型（模型字段省略则用各客户端默认/继承桌面端选择）：

```json
{
  "claude": { "exe": "...claude.exe", "proxy": "http://127.0.0.1:10808", "model": "claude-opus-5-5", "effort": "high" },
  "zcode":  { "entry": "...zcode.js" },
  "devin":  { "exe": "...devin.exe", "model": "swe-2-high" },
  "codex":  { "exe": "...codex.exe", "proxy": "http://127.0.0.1:10808", "model": "gpt-5.4" },
  "opencode": { "exe": "...opencode.exe", "model": "opencode/space-bunny-free" },
  "antigravity": { "exe": "...agy.exe", "proxy": "http://127.0.0.1:10808", "model": "gemini-3.8-flash-high", "effort": "high" }
}
```

- claude：`model` 接 `--model`（如 `claude-opus-5-5`），`effort` 接 `--effort`（low/medium/high）；也可用 `AGENT_ROUTER_CLAUDE_MODEL` / `AGENT_ROUTER_CLAUDE_EFFORT` 环境变量覆盖。
- devin：`model` 以 `DEVIN_MODEL` 环境变量注入（`devin models list` 查看可用模型）。
- zcode：模型跟随 `~/.zcode/v2/provider_config.json` 的 `defaultModelSelection`（与桌面端共用同一份选择）。
- codex：`exe` 指向 npm 包内的原生二进制（PATH 上的 `codex` 是 .cmd 垫片，Node spawn 不能直接执行）；`proxy` 建议设为本地代理——直连时 Codex 的 WebSocket 会反复超时再回退 HTTPS（约 90 秒），走代理秒连。
- opencode：`exe` 同样指向 npm 包内的原生二进制；`model` 填 `provider/model`（`opencode models` 可列出）。注意 zen 免费档多数模型（`-free` 后缀）被服务端限制为仅交互客户端可用，实测无头可用的免费模型是 `opencode/space-bunny-free`。任务板 MCP 与权限放行经 `OPENCODE_CONFIG_CONTENT` 内联注入，不改动用户全局配置。
- antigravity：`model` 填 `agy models` 列出的模型名（如 `gemini-3.8-flash-high`、`claude-sonnet-4-6`），`-high/-medium/-low/-max` 档位后缀会转为 `--effort`；`proxy` 必填——生成接口对未代理地区返回 "User location is not supported"。任务板 MCP 经工作区级 `.agents/mcp_config.json` 注入（写-还原，且已加入 `.git/info/exclude` 不会被误提交）。

## 用法

### Web 控制台(dsh 原生界面 + 经典控制台,同端口)

```bash
node web/server.mjs        # dsh 界面: http://127.0.0.1:2288/  经典控制台: /console/
```

> `dsh-web/`（deepseek-harness 的本地构建）随仓库分发，开箱即用完整 dsh 界面；也可替换为你自己的构建（需含 `index.html` 与 `dist/`）。

- **`/`(默认)**:deepseek-harness 原生 Web UI(构建产物已迁移至 `dsh-web/`),左侧工作区"Agent Router"下列出每次运行的各 agent 会话线程(每个 thread 独立展示),点开即见该 agent 的完整对话流——任务提示词、事件通知、可展开的工具调用卡片、AI 回复;线程文件变动实时推送。右下角"⧉ 任务板"按钮可展开任务板抽屉(非插件,iframe 集成);
- **dsh 里新建会话 / 发消息**(按本项目运行模型桥接):「新建会话」只是登记一个空会话;该会话里的**第一条消息 = 总目标,直接启动一次运行**(默认 repo `demo/todo-cli`、成员 claude+zcode、直通模式;消息里带的 cwd 路径若存在且不在 data 目录下则作为目标目录)。运行进行中再发消息 = **给主代理插话**;「停止生成」= 停止当前运行。该会话在 dsh 里的对话流即新运行的 manager 线程;
- **dsh 界面裁剪**(board-embed.js 注入):隐藏与本项目无对应能力的按钮——好的/有问题的回答、在新对话中分支、添加工作区、添加文件或调用指令、反馈、模型选择器;「搜索会话」可用(搜线程名与会话内容);已结束的运行不再误标"进行中";
- **`/board`**:重新设计的任务板页(可独立打开):运行选择、状态统计、任务卡(状态/指派/用时/结果/现场路径)与信箱,2.5s 自动刷新;
- **`/console/`**:经典轻量控制台(任务板/信箱/插话/取消重试/日志弹窗)。
- 两个界面共用同一份数据(`data/<run>/threads/*.jsonl`);dsh 的数据经 `web/dsh-bridge.mjs` 桥接为 dsh 的 SessionEvent 协议。

### 经典控制台

零依赖（node:http），只监听 127.0.0.1。页面上可以：

- **新建运行**：填总目标、选仓库、勾选执行成员（旁边显示各自模型，未就绪自动禁用）、设超时；
- **实时监控**：SSE 推送控制台输出与任务板/信箱快照，任务卡状态实时变色；控制台可按 主代理/事件/信箱 过滤，主代理状态条显示 在线状态/回合数/累计花费/当前工具；
- **人在环中**：运行中可在控制台下方输入框直接给主代理插话（`[用户]` 消息，最高优先级）；任务卡上可 取消执行中 / 重试已失败 的任务；
- **运行总结**：manager 调用 finish_run 后，页面顶部常驻展示结束总结；
- **任务板/信箱**：任务的状态、执行者、依赖、用时、结果摘要与产出，失败保留现场的 worktree 路径，成员间消息流；
- **会话日志**：点任务卡上的"日志"按钮查看该 agent 会话的完整输出；
- **运行记录**：`data/` 下所有历史运行（含 CLI 启动的），点击回看；运行中的可一键停止。

### 多运行与成员协作

Web 控制台支持同时启动多个运行。每次运行必须使用互不重叠的工作目录（或独立 Git worktree），运行列表、SSE 事件、任务板和会话线程都按 `runId` 隔离；历史会话不会把消息或停止操作转发到另一个运行。

运行设置面板可以为当前运行选择六个成员（Claude、ZCode、Devin、Codex、OpenCode、Antigravity）各自的模型。配置写入该运行的 `runtime-config.json`，不会修改全局配置；主代理在当前回合结束后重新载入配置，子代理在下一次会话启动时读取对应模型。

任务板的“信箱”页支持选择 `manager` 或具体子代理直接发消息。发给主代理的消息进入主代理输入队列，发给子代理的消息写入任务板信箱，并显示“已写入信箱，等待读取”；消息必须绑定当前运行，发给不属于该运行的成员会被拒绝。

### CLI

```bash
node router.mjs "<总目标>" [选项]

选项:
  --repo <dir>        目标工作目录（默认 ./demo/todo-cli；直通模式不要求是 git 仓库）
  --agents <list>     参与的执行成员，逗号分隔（默认 claude,zcode；可选 devin,codex,opencode,antigravity）
  --main <agent>      主代理使用的 CLI（默认 claude；可选 zcode/devin/codex/opencode/antigravity，见下文「主代理可指定」）
  --timeout <sec>     单个子代理会话超时（默认 900）
  --data <dir>        运行数据目录（默认 ./data/<时间戳>）
  --worktree          隔离并行模式：每任务一个 worktree、完成后合并（默认直通模式）
  --max-rounds <n>    （已废弃）事件驱动模式下不再使用，仅为兼容 Web 表单保留
```

示例：

```bash
node router.mjs "给 todo-cli 添加优先级功能、补测试、更新 README" --agents claude,zcode
# 用 ZCode 当主代理（子代理照旧）：
node router.mjs "..." --main zcode --agents claude
# 旧隔离并行模式（每任务独立 worktree，可并行执行）：
node router.mjs "..." --agents claude,zcode --worktree
```

### 主代理可指定（--main）

主代理不一定是 Claude，六种 CLI 都可以担任；任务板、派发、收割、followup 协议完全不变，子代理也不感知主代理是谁：

| 主代理 | 常驻方式 | 说明 |
|---|---|---|
| `claude`（默认） | stream-json 双向流 | 长期进程，事件即时注入当前回合；`--resume` 续命重启 |
| `antigravity` | stream-json 双向流 | `agy --input-format stream-json` 常驻，与 claude 同构；`--conversation` 续命重启；需本地代理 |
| `devin` | ACP 常驻子进程 | 同一会话连续 `session/prompt`，事件实时流出；崩溃重建时优先 `session/load` 恢复上下文（需已 `devin auth login`） |
| `zcode` / `codex` / `opencode` | 回合串联 | 这三个 CLI 没有常驻双向流：每条注入消息触发一次 headless 运行，用 sessionId 续链上下文；事件在回合之间注入，回合内没有实时工具事件 |

Web 控制台与 dsh 运行设置里都有「主代理」下拉框；`main` 随运行设置保存，运行中不可更改。

### 提示词在哪看

发送给 AI 的完整内容都记录在会话线程里（`data/<run>/threads/*.jsonl`），两个界面可直接查看：
- dsh 聊天：manager 会话开头有一条「【系统提示词】」消息，其后每条用户消息（总目标、`[事件]`/`[信箱]`/`[用户]` 注入）即当回合实际收到的内容；子代理会话的第一条消息就是完整任务提示词。
- 经典控制台：任务卡「🧵 线程」或「查看日志」弹窗中，首条为可折叠的「📋 系统提示词」块。

系统提示词的注入方式随主代理不同：claude 经 `--append-system-prompt` 随每次请求生效；devin/zcode/codex/opencode/antigravity 没有系统提示词入口，由 Router 并入该会话的第一条消息（antigravity 常驻会话仅在新建会话时注入一次，续命重启不重复；回合串联模式在回合失败重开会话后会重新注入）。模板源码在 `lib/prompts.mjs`。

## 运行数据布局

```
data/<run>/
├── board.json           # 任务板：任务 + 信箱消息（MCP server 的存储）
├── logs/                # 每个会话的原始输出、manager 的完整事件流（manager-stream.log）
├── threads/             # 每个会话的事件线程；system 条目 = 实际发送给 AI 的系统提示词
└── worktrees/           # 仅 --worktree 或 isolated 任务使用（合并成功后自动删除）
```

## 任务板工具（所有 agent 可用）

| 工具 | 用途 |
|---|---|
| `create_task(title, spec, assignee, blocked_by?, isolated?)` | 创建任务（manager 用）；`isolated: true` 强制该任务走独立 worktree |
| `followup_task(task_id, message)` | **仅 manager**：指定某任务的原执行子代理带着原任务上下文继续，追加新指令 |
| `list_tasks` / `get_task` | 查看任务 |
| `update_task(task_id, status, result?, artifacts?)` | 领取（in_progress）/ 完成（done+result）/ 标记失败 |
| `send_message(to, content, task_id?)` | 给子代理、manager 或 `*`（全体）发信 |
| `read_inbox()` | 读自己的未读消息（读后自动标记已读） |
| `get_roster()` | 查看团队花名册 |
| `finish_run(summary)` | **仅 manager**：确认目标达成后结束整个运行 |

## 权限策略（默认完全访问）

所有子代理会话均以最高权限启动，使用任何工具都不需要人工确认：claude（主/子）为 `--permission-mode bypassPermissions`，zcode 为 `--mode yolo`，Codex 使用当前 CLI 的 `--dangerously-bypass-approvals-and-sandbox`，antigravity 为 `--dangerously-skip-permissions`，opencode 经 `OPENCODE_CONFIG_CONTENT` 将 `permission` 设为全 `allow`，devin（ACP）发来的 `session/request_permission` 请求由 Router 自动选择"允许"选项回复。

## 已知边界（MVP）

- 主代理默认为 Claude Code，可通过 `--main` / 运行设置换成 zcode / devin / codex / opencode / antigravity（zcode、codex、opencode 为回合串联模式：事件在回合之间注入，回合内没有实时工具事件流）。
- 主代理是单点：进程崩溃会自动 `--resume`（antigravity 为 `--conversation`）续命，但若连续退出超上限，运行会停在等待状态（可从 Web 控制台停止）。
- claude 子代理是一次性会话，中途收不到新留言（在开工/收尾节点读信箱）；zcode / devin / opencode / antigravity 同理。真正的实时双向只在主代理一侧（claude / antigravity / devin）。
- worktree 合并冲突时直接标记失败并推送事件，不做自动 rebase。
- OpenCode 的 zen 免费档模型多数仅限交互客户端使用（服务端按模型放行，报 "free tier can only be used from within OpenCode"）；无头可用性以实测为准，默认 `opencode/space-bunny-free` 可用。
- Antigravity CLI 生成接口有地区限制，必须走本地代理；其任务板 MCP 配置写入目标目录 `.agents/mcp_config.json`（运行结束还原，并已加入 `.git/info/exclude`）。
- Codex adapter 使用 `codex exec --json` 的 JSONL 事件流；当前桌面 CLI 使用 `--dangerously-bypass-approvals-and-sandbox`，任务板 MCP 按每次运行注入。
