# Agent Router

<div align="right"><b>English</b> · <a href="README.zh-CN.md">中文</a></div>


**主代理担任主线程（默认 Claude Code，可用 `--main` 指定为 zcode / devin / codex / opencode / antigravity）**：它常驻一个长期会话，把总目标拆解成任务派给本地子代理（ZCode / Devin / Codex / OpenCode / Antigravity / 其他 Claude Code 实例），派完活不等待、继续干自己的事；子代理的动向（完成/失败/留言）由 Router 实时推送回主会话。所有 agent 通过**本地任务板**协作、经**任务板信箱**互发消息，Router 负责自动派发、收割合并、汇总产出。

所有 agent 运行时、会话、任务数据、通信全部在本机（模型推理走各自厂商 API，这是唯一的边界）。

## 协作方式

你和**主代理**对话。它的用法和 Claude Code 一样：简单的问题和小改动自己完成，工作量大、可并行的部分用 `create_task` 派给**子代理**（本机的其他编程 agent CLI）。每段对话对应一个 Router 进程：

```
你 ──消息──▶ 主代理会话（常驻：claude / antigravity / devin；回合串联：zcode / codex / opencode）
               ├─ create_task / followup_task / cancel_task   （经 MCP 调用任务板工具）
               └─ 收到 [事件]（完成+完整报告 / 失败 / 依赖受阻）与 [信箱]（子代理留言）
                     ▲ 注入                          │ 工具调用
   ┌─────────────────┴──────────────────────────────▼──────────────────────────┐
   │ Router 进程                                                               │
   │   core/board.mjs      任务板，状态在内存（board.json 只是快照）            │
   │   core/rpc.mjs        本地 RPC 端点（127.0.0.1 + 每次运行随机 token）      │
   │   core/scheduler.mjs  事件驱动派发：依赖、每 agent 并发上限、续派、取消    │
   │   core/workspace.mjs  直通 / worktree 的准备与收割                         │
   └──────────────▲────────────────────────────────────────────────────────────┘
                  │ lib/board-server.mjs：每个 agent CLI 拉起的轻量 stdio MCP 代理
        claude -p · zcode -p · codex exec · opencode run · devin acp · agy   （子代理会话）
```

- **生命周期由 Router 掌管**：子代理会话启动即 `in_progress`，正常结束即 `done`，**最终回复就是报告**。子代理只在需要报告失败时调用 `update_task(status="failed")`，不会再因为漏调工具把已完成的工作判成失败。
- **完整报告回传主代理**：任务完成时，报告（最多 4000 字，全文保留在任务板上）和收割备注作为 `[事件]` 注入主会话。只有完成、失败、依赖受阻、子代理留言会唤醒主代理，不再发"已排队/已开始"这类白白消耗一个回合的通知。
- **并发**：每个 agent 同时执行的任务数默认不限；需要限制某家时在 `router.config.json` 里配 `maxConcurrent`（如 `{"zcode": {"maxConcurrent": 2}}`）。带 `blocked_by` 的任务在依赖完成后开始；依赖失败时主代理会收到"受阻"通知。
- **直通模式（默认）**：子代理在共享工作目录里干活，并只提交自己改过的文件。Router 不再替它们 `git add -A`：只有在该目录没有其他任务进行时才兜底提交遗留改动，否则原样保留并在完成通知里说明，改动不会被记到错误的任务名下。
- **隔离任务**：`create_task(isolated: true)` 或 `--worktree` 让任务在独立 `git worktree` 中执行；成功则 `--no-ff` 合并（没有代码改动的任务也算成功），失败或合并冲突时保留 worktree 与分支供检查。
- **续派**：`followup_task(task_id, message)` 在工作目录不变且 CLI 支持时 resume 子代理的原会话（claude、codex、opencode、zcode）；否则开新会话并注入原任务说明与上一轮报告。
- **取消**：主代理（`cancel_task`）或网页都可以取消排队中或执行中的任务，会话被终止，已做的改动保留原样。
- **自愈**：主会话进程意外退出会续接同一会话重启（`--resume` / `--conversation`）。对话模式空闲 30 分钟后 Router 休眠，下一条消息续接主代理会话；Router 停止时仍在执行的任务会被标记为失败。
- **git 可选**：非 git 目录没有提交、合并和隔离，其余照常。
- **可观测**：主会话原始事件流在 `data/<run>/logs/manager-stream.log`，每个会话的线程在 `data/<run>/threads/`，网页实时展示。

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

### Web 应用（推荐）

```bash
node web/server.mjs        # http://127.0.0.1:2288/
```

Web 应用是 DeepSeek harness（dsh）的聊天界面（随仓库分发的 `dsh-web/` 构建），上面叠加了 Agent Router 的暖色主题、顶栏和面板。用起来和与 Claude Code 聊天一样：直接把需求告诉主代理。简单的问题和小改动它自己完成；工作量大、可并行的部分它用 `create_task` 分派给子代理（类似 Claude Code 的 subagent），子代理的结果自动回到对话里，由它向你汇报。

- **新会话**：点侧栏的「新会话」，会自动打开运行设置：工作目录（粘贴路径或浏览选择）、主代理（任一编程 CLI，或配置好的对话模型）、子代理（未安装的 CLI 置灰）、直通 / 隔离模式、各代理的模型。设置自动保存；输入框上方的文件夹按钮显示当前目录，点击可重新打开设置。
- **对话就是主代理的会话**：回复、思考过程和工具调用都由 dsh 原生渲染。Router 注入的 `[事件]` / `[信箱]` 显示为紧凑的提示条（点击展开）。
- **子代理**：主代理会话标题栏有 dsh 的「N 个子智能体」下拉（实时状态、点击进入子代理的完整对话、面包屑返回）；侧栏里子代理会话标题为 `↳ T1 · ZCode · <任务>`。给子代理发消息会写入它的信箱，中断它会取消它的任务。
- **顶栏**：运行状态和工作目录，以及「运行记录」「任务」（任务板与信箱）「设置」（运行开始后仍可切换主代理、修改模型）「环境」（找到了哪些 CLI、安装与登录提示、解析出的路径、对话模型的 API Key）。
- **对话不会"结束"**：在同一个会话里继续回复即可。空闲 30 分钟后后台进程休眠，下一条消息会唤醒它并恢复同一个主代理会话（`router.mjs --chat --resume`）。
- 浅色 / 深色模式跟随系统设置。

`/board`（任务板页）与 `/console/`（经典控制台）仍可使用，所有界面共用同一份数据（`data/<run>/`）。没有 `dsh-web/` 时，`/` 会跳转到经典控制台。

<details><summary>重建 <code>dsh-web/</code></summary>

> `dsh-web/`（deepseek-harness 的本地构建）随仓库分发；也可替换为你自己的构建（需含 `index.html` 与 `dist/`）。

> deepseek-harness 更新后重建 `dsh-web/`（当前基线：0.2.1-alpha.1）：harness 源码放在项目内的 `deepseek-harness/`（已加入 .gitignore，没有就先 `git clone` 一份）。把 `web/dsh-harness-patch/` 里的两个集成文件拷进去（`router-transport.ts` → `apps/web/src/`，以及把 `start()` 包在 `router-transport` 导入之后的 `main.ts`），然后 `pnpm install && pnpm build`。再运行 `node web/dsh-harness-patch/capture-dsh-web.mjs <harnessRoot> <projectRoot>/dsh-web 3080` 自动抓取：它用临时 `DSH_HOME` 启动 web profile、带 token URL 取登录 cookie，把渲染后的 `/` HTML 存为 `dsh-web/index.html`，并把 `__DSH_BOOT__` 清单里的全部 URL 抓到 `dsh-web/plugins/`（`pN.js` + `map.json`）。`apps/web/dist/{assets,favicon.svg,favicon-dark.svg,manifest.webmanifest}` 仍需手动拷到 `dsh-web/dist/`。清单 rev 由 bundle 的 mtime 哈希而来，每次重建都要重新抓取 plugins。

> Agent Router 的外观不在构建里：`web/public/router-ui.css` 重设了 dsh 的基础色板（`--dsw-static-neutral-bluish-*`、`--dsw-static-deepseek-*`），`web/public/board-embed.js` 加上顶栏和面板；数据经 `web/dsh-bridge.mjs` 桥接为 dsh 的协议。
</details>

### 经典控制台

零依赖（node:http），只监听 127.0.0.1。页面上可以：

- **新建运行**：填总目标、选仓库、勾选执行成员（旁边显示各自模型，未就绪自动禁用）；
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
node router.mjs "<消息>" --chat [选项]      # 对话模式（Web 应用使用的方式）
node router.mjs "<总目标>" [选项]           # 目标模式：拆解目标，完成后 finish_run 结束

选项:
  --repo <dir>        工作目录（默认 ./demo/todo-cli；除隔离模式外不要求 git）
  --agents <list>     子代理，逗号分隔（默认 claude,zcode；可选 devin,codex,opencode,antigravity）
  --main <agent>      主代理使用的 CLI（默认 claude，见"主代理可指定"）
  --timeout <sec>     单个子代理会话超时（默认 0：不限时）
  --data <dir>        运行数据目录（默认 ./data/run-<时间戳>）
  --worktree          所有任务都在独立 git worktree 中执行（默认直通；isolated:true 可隔离单个任务）
  --chat              对话模式：不需要 finish_run，空闲 30 分钟后休眠
  --resume            与 --data 搭配：续接该目录里上次的主代理会话
```

### 主代理可指定（--main）

主代理不一定是 Claude，六种 CLI 都可以担任；任务板、派发、收割、followup 协议完全不变，子代理也不感知主代理是谁：

| 主代理 | 常驻方式 | 说明 |
|---|---|---|
| `claude`（默认） | stream-json 双向流 | 长期进程，事件即时注入当前回合；`--resume` 续命重启 |
| `antigravity` | stream-json 双向流 | `agy --input-format stream-json` 常驻，与 claude 同构；`--conversation` 续命重启；需本地代理 |
| `devin` | ACP 常驻子进程 | 同一会话连续 `session/prompt`，事件实时流出；崩溃重建时优先 `session/load` 恢复上下文（需已 `devin auth login`） |
| `zcode` / `codex` / `opencode` | 回合串联 | 这三个 CLI 没有常驻双向流：每条注入消息触发一次 headless 运行，用 sessionId 续链上下文；事件在回合之间注入，回合内没有实时工具事件 |

**切换主代理**：发送第一条消息前在运行设置面板里选择；对话开始后也可以在同一个面板里切换。运行中会在当前回合结束后切换，正在执行的子代理任务不受影响；休眠中的对话在下一条消息唤醒时切换。不同 CLI 的会话不能互通，新主代理会开新会话，并收到之前的对话记录和任务板作为交接（`lib/prompts.mjs` 的 `handoffMessage`）。API：`PATCH /api/runs/:id/main {"main": "zcode"}`。

### 只能对话的模型（不能用工具）

只能对话的模型（DeepSeek、Kimi、本地模型，或任何你能包装成接口的 AI）**跑在 Codex 里**，就成了完整的编程代理。Codex 仍然是 agent：shell、`apply_patch`、沙箱、上下文压缩和任务板 MCP 工具都是 Codex 自己的。Router 会启动一个本地 Responses gateway（独立模块 [`chat-agent/`](chat-agent/README.md)），Codex 把它当作模型提供方。gateway 把 Codex 的工具渲染成文本给模型，再把模型写的 `<tool_call>` 块转回真正的工具调用。因此需要安装 Codex CLI。

- **当主代理或子代理**：`llm` 下的每个名字都和 CLI 一样是团队成员，可以用 `--main deepseek`、`--agents claude,deepseek`，或在设置面板的「对话模型」里选。会话就是 Codex 会话，`--resume`、续派和切换主代理照常可用。Codex 使用专用的 `CODEX_HOME`（`data/<run>/codex-home/`），里面描述了这个模型，并关掉了对话模型用不上的功能（Codex 自带的子代理、目标、图片、联网搜索、应用）。
- **当 consult 顾问工具**：所有 agent 都能调用 `consult(question, context?, files?)` 向它请教。Router 会把列出的文件内容附上。

在 `router.config.json` 里配置：

```json
{
  "llm": {
    "deepseek": { "label": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-reasoner", "apiKeyEnv": "DEEPSEEK_API_KEY" }
  },
  "consult": "deepseek"
}
```

任何 OpenAI 兼容接口都可以直接用。需要代理时加 `"proxy": "http://127.0.0.1:10808"`；`"contextWindow"`（token 数，默认 128000）让 Codex 及时压缩上下文；`"maxConcurrent"` 限制并行的子代理任务数。其他接入方式可以用 `"module"` 指向一个 JS 文件，导出 `{ complete(messages) → { text } }` 即可。

### 提示词在哪看

发送给 AI 的完整内容都记录在会话线程里（`data/<run>/threads/*.jsonl`），两个界面可直接查看：
- dsh 聊天：manager 会话开头有一条「【系统提示词】」消息，其后每条用户消息（总目标、`[事件]`/`[信箱]`/`[用户]` 注入）即当回合实际收到的内容；子代理会话的第一条消息就是完整任务提示词。
- 经典控制台：任务卡「🧵 线程」或「查看日志」弹窗中，首条为可折叠的「📋 系统提示词」块。

系统提示词的注入方式随主代理不同：claude 经 `--append-system-prompt` 随每次请求生效；devin/zcode/codex/opencode/antigravity 没有系统提示词入口，由 Router 并入该会话的第一条消息（antigravity 常驻会话仅在新建会话时注入一次，续命重启不重复；回合串联模式在回合失败重开会话后会重新注入）。模板源码在 `lib/prompts.mjs`。

## 运行数据布局

```
data/<run>/
├── board.json           # 任务板快照（任务 + 消息）；实时状态归 Router 进程所有
├── status.json          # 主代理状态与会话 id（--resume 用）
├── commands.jsonl       # Web → Router 命令通道（消息、取消、重试、切换模型）
├── logs/                # 每个会话的原始输出、manager 的完整事件流（manager-stream.log）
├── threads/             # 每个会话的事件线程；system 条目 = 实际发送给 AI 的系统提示词
├── codex-home/          # 对话模型经 gateway 运行时的 CODEX_HOME（模型目录、配置、Codex 会话）
└── worktrees/           # 仅 --worktree 或 isolated 任务使用（合并成功后自动删除）
```

## 任务板工具

| 工具 | 谁可用 | 用途 |
|---|---|---|
| `create_task(title, spec, assignee, blocked_by?, isolated?)` | 主代理 | 派一个自包含的任务给子代理（非阻塞） |
| `followup_task(task_id, message)` | 主代理 | 让原子代理继续一个已结束的任务 |
| `cancel_task(task_id, reason?)` | 主代理 | 取消排队中或执行中的任务 |
| `list_tasks` / `get_task` | 全部 | 查看任务与完整报告 |
| `update_task(task_id, status?, result?, artifacts?)` | 全部 | 子代理：报告失败或附加结构化结果（完成是自动的）；主代理：完成自己的任务 |
| `send_message(to, content, task_id?)` | 全部 | 给成员、主代理或 `*` 发消息 |
| `read_inbox()` | 全部 | 读取自己的消息 |
| `get_roster()` | 全部 | 查看团队 |
| `finish_run(summary)` | 主代理 | 仅目标模式：结束运行 |
| `consult(question, context?, files?)` | 全部 | 配置了 consult 时才有：向只能对话的模型请教 |

工具定义与权限在 `core/tools.mjs`。协作核心的测试：`node --test core/test.mjs`（包含用假 agent 端到端跑 `router.mjs`）。

## 权限策略（默认完全访问）

所有子代理会话均以最高权限启动，使用任何工具都不需要人工确认：claude（主/子）为 `--permission-mode bypassPermissions`，zcode 为 `--mode yolo`，Codex 使用当前 CLI 的 `--dangerously-bypass-approvals-and-sandbox`，antigravity 为 `--dangerously-skip-permissions`，opencode 经 `OPENCODE_CONFIG_CONTENT` 将 `permission` 设为全 `allow`，devin（ACP）发来的 `session/request_permission` 请求由 Router 自动选择"允许"选项回复。

## 已知边界（MVP）

- 主代理默认为 Claude Code，可通过 `--main` / 运行设置换成 zcode / devin / codex / opencode / antigravity（zcode、codex、opencode 为回合串联模式：事件在回合之间注入，回合内没有实时工具事件流）。
- 主代理是单点：进程崩溃会自动 `--resume`（antigravity 为 `--conversation`）续命，但若连续退出超上限，运行会停在等待状态（可从 Web 控制台停止）。
- 子代理是一次性会话，中途收不到新留言（在开工和收尾前读信箱）。真正的实时双向只在主代理一侧（claude / antigravity / devin）。
- worktree 合并冲突时直接标记失败并推送事件，不做自动 rebase。
- OpenCode 的 zen 免费档模型多数仅限交互客户端使用（服务端按模型放行，报 "free tier can only be used from within OpenCode"）；无头可用性以实测为准，默认 `opencode/space-bunny-free` 可用。
- Antigravity CLI 生成接口有地区限制，必须走本地代理；其任务板 MCP 配置写入目标目录 `.agents/mcp_config.json`（运行结束还原，并已加入 `.git/info/exclude`）。
- Codex adapter 使用 `codex exec --json` 的 JSONL 事件流；当前桌面 CLI 使用 `--dangerously-bypass-approvals-and-sandbox`，任务板 MCP 按每次运行注入。
