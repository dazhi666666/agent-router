# Agent Router

<div align="right">English · <b><a href="README.zh-CN.md">中文</a></b></div>

**A main agent runs the main thread (Claude Code by default; pick zcode / devin / codex / opencode / antigravity via `--main`)**: it holds a long-lived session, breaks the overall goal into tasks and dispatches them to local subagents (ZCode / Devin / Codex / OpenCode / Antigravity / other Claude Code instances). Dispatch is non-blocking — the manager creates tasks and immediately moves on; subagent progress (completion / failure / messages) is pushed back into the main session in real time. All agents collaborate through a **shared local task board** and exchange messages via the **board mailbox**; the Router handles automatic dispatch, harvest & merge, and the final summary.

Everything stays on your machine — agent runtimes, sessions, task data and communication. Model inference calls each vendor's API; that is the only boundary.

## How collaboration works

You chat with the **main agent**. It works like Claude Code: it answers and makes small changes itself, and delegates larger or parallelizable work to **subagents** (other coding-agent CLIs on this machine) with `create_task`. Each conversation runs in one Router process:

```
you ──message──▶ main agent session (persistent: claude / antigravity / devin; turn-chained: zcode / codex / opencode)
                   ├─ create_task / followup_task / cancel_task   (board tools via MCP)
                   └─ receives [事件] (finished + full report / failed / blocked) and [信箱] (subagent messages)
                         ▲ injected                      │ tool calls
   ┌─────────────────────┴──────────────────────────────▼──────────────────────────┐
   │ Router process                                                                │
   │   core/board.mjs      task board, in memory (board.json is only a snapshot)   │
   │   core/rpc.mjs        local RPC endpoint (127.0.0.1 + per-run token)          │
   │   core/scheduler.mjs  event-driven dispatch: dependencies, per-agent          │
   │                       concurrency, follow-ups, cancel                         │
   │   core/workspace.mjs  direct / worktree preparation and harvest               │
   └──────────────▲────────────────────────────────────────────────────────────────┘
                  │ lib/board-server.mjs: thin stdio MCP proxy started by every agent CLI
        claude -p · zcode -p · codex exec · opencode run · devin acp · agy   (subagent sessions)
```

- **Router-owned lifecycle**: a task is `in_progress` as soon as its session starts and `done` when the session ends normally; the subagent's **final reply is its report**. Subagents only call `update_task(status="failed")` to report failure, so a forgotten tool call can no longer turn finished work into a failure.
- **Full reports back to the main agent**: when a task finishes, its report (up to 4,000 characters; the full text stays on the board) and the harvest notes are injected as a `[事件]` message. Only completion, failure, blocked-dependency and subagent-message events wake the main agent; there are no "queued/started" notifications that cost a turn.
- **Concurrency**: each agent runs up to `maxConcurrent` tasks at once (`router.config.json`; defaults: claude/codex/opencode/devin 2, zcode/antigravity 1 because they write their MCP config into the working directory). Tasks with `blocked_by` start when their dependencies are done; if a dependency fails, the main agent is told the task is blocked.
- **Direct mode (default)**: subagents work in the shared working directory and commit exactly the files they changed. The Router never runs `git add -A` for them: it commits leftover changes only when no other task is running in that directory; otherwise it leaves them uncommitted and says so in the completion message, so changes are never attributed to the wrong task.
- **Isolated tasks**: `create_task(isolated: true)` or `--worktree` runs a task in its own `git worktree`. On success the branch is merged `--no-ff` (tasks without code changes are fine); on failure or a merge conflict the worktree and branch are kept for inspection.
- **Follow-ups**: `followup_task(task_id, message)` resumes the subagent's original session when the working directory is unchanged and the CLI supports it (claude, codex, opencode, zcode); otherwise a new session gets the original spec and previous report injected.
- **Cancel**: the main agent (`cancel_task`) or the web UI can cancel a queued or running task; the session is terminated and its changes are left in place.
- **Self-healing**: if the main session process dies it restarts into the same session (`--resume` / `--conversation`). In chat mode the Router sleeps after 30 idle minutes and the next message resumes the main agent's session; tasks that were running when the Router stopped are marked failed.
- **Git optional**: without git there are no commits, merges or isolation; everything else works.
- **Observability**: the main session's raw stream is in `data/<run>/logs/manager-stream.log`, every session's thread is in `data/<run>/threads/`, and the web app shows everything live.

## Prerequisites

| Member | Dependency | Notes |
|---|---|---|
| manager / claude | Claude Code CLI (installed under local `Claude-3p`, claude.ai login) + local proxy | `claude.proxy` in `router.config.json` points to the v2rayN mixed port |
| zcode | `npm i -g zcode-app-cli`, reuses desktop GLM plan credentials | preconfigured (`defaultModelSelection` in `provider_config.json`) |
| devin | Devin CLI + one-time `devin auth login` (browser OAuth) | the Router warns and skips when not logged in |
| codex | Codex CLI (`npm i -g @openai/codex`, `codex exec --json`, ChatGPT login) | uses the machine's Codex login and model config |
| opencode | OpenCode CLI (`npm i -g opencode-ai`) | uses the machine's `opencode auth` credentials; default model `opencode/space-bunny-free` |
| antigravity | Antigravity CLI (official installer → `%LOCALAPPDATA%\agy\bin`, command `agy`) | silent keyring login (reuses IDE credentials); the generation API is geo-restricted — `antigravity.proxy` must point to a local proxy |

`router.config.json` can override each agent's executable path, proxy and model (omit a field to use the client default):

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

- claude: `model` maps to `--model` (e.g. `claude-opus-5-5`), `effort` to `--effort` (low/medium/high); also overridable via `AGENT_ROUTER_CLAUDE_MODEL` / `AGENT_ROUTER_CLAUDE_EFFORT`.
- devin: `model` is injected as the `DEVIN_MODEL` env var (`devin models list` to see options).
- zcode: the model follows `defaultModelSelection` in `~/.zcode/v2/provider_config.json` (shared with the desktop app).
- codex: `exe` must point to the native binary inside the npm package (the `codex` on PATH is a .cmd shim Node can't spawn); set `proxy` to a local proxy — direct connections make Codex's WebSocket time out repeatedly before the HTTPS fallback (~90 s), through a proxy it connects instantly.
- opencode: `exe` likewise points at the native binary, **requires CLI ≥ 1.18** (`npm i -g opencode-ai@latest`) — older versions (1.1.x) send request headers that the zen server treats as "not the OpenCode client", and every free-tier model is rejected with 403. `model` is `provider/model`, optionally with a reasoning-effort variant appended as `provider/model@variant` (e.g. `opencode/space-bunny-free@high`, which becomes `run --variant high`); the valid variants per model come from models.dev's `reasoning_options` and are offered as a dropdown in the web settings. All zen free-tier models work, but the first token often queues for 1–2 minutes (`space-bunny-free` responds fastest and stays the default). The Router injects `small_model` and passes an explicit `--title` so auxiliary calls (auto title, session summary) never hit the paid small model — on a free-tier account that call fails with "Insufficient account funds" and the whole session hangs. The board MCP and permission allowances are injected inline via `OPENCODE_CONFIG_CONTENT` — your global config is untouched.
- antigravity: `model` takes a name from `agy models` (e.g. `gemini-3.8-flash-high`, `claude-sonnet-4-6`); the `-high/-medium/-low/-max` suffix becomes `--effort` — the reasoning strength is part of the model name, and the web settings dropdown shows the human labels (e.g. "Gemini 3.8 Flash (High)"). `proxy` is required — without it the API returns "User location is not supported". The board MCP is injected via the workspace-level `.agents/mcp_config.json` (write-restore, and added to `.git/info/exclude` so it never gets committed).

The web settings panel fills the model dropdowns from each CLI (`opencode models`, `agy models`, `devin models list`, ZCode provider config, cached 10 minutes) — pick instead of type; claude / codex stay free-text (their CLIs don't expose a model list). Devin's several hundred models render as a combo box (type to filter).

## Usage

### Web app (recommended)

```bash
node web/server.mjs        # http://127.0.0.1:2288/
```

The web app is the DeepSeek harness (dsh) chat UI (the bundled `dsh-web/` build) with Agent Router's warm theme, top bar and panels injected on top. It works like a plain chat with Claude Code: tell the main agent what you want. It answers questions and makes small changes itself, and hands larger or parallelizable work to subagents with `create_task` (much like Claude Code's subagents). Their results flow back into the chat and it reports to you.

- **New conversation**: click **新会话** in the sidebar. The run settings panel opens: working directory (paste a path, or browse), the main agent (any coding CLI, or a configured chat model), subagents (CLIs that aren't installed are greyed out), direct / isolated mode, subagent timeout and per-agent models. Settings save automatically; the folder chip above the input shows the directory and reopens the panel.
- **The conversation is the main agent's session**: dsh renders replies, reasoning and tool calls natively. `[事件]` / `[信箱]` injections from the Router show as compact notices (click to expand).
- **Subagents**: the main agent's session header has dsh's subagent dropdown (live status, click through to each subagent's full conversation, breadcrumb back). Subagent sessions appear in the sidebar as `↳ T1 · ZCode · <task>`. Messaging a subagent goes to its inbox; interrupting it cancels its task.
- **Top bar**: run status and directory, plus **运行记录** (run history), **任务** (task board and mailbox), **设置** (run settings; after a run starts you can still switch the main agent and change models) and **环境** (which CLIs were found, install/login hints, resolved paths, chat-model API keys).
- **Conversations never "finish"**: keep replying in the same session. After 30 idle minutes the background process sleeps; your next message wakes it and resumes the same main-agent session (`router.mjs --chat --resume`).
- Light and dark mode follow the system setting.

`/board` (task board page) and `/console/` (classic console) are still available. Everything shares the same data (`data/<run>/`). Without `dsh-web/`, `/` redirects to the classic console.

<details><summary>Rebuilding <code>dsh-web/</code></summary>

> `dsh-web/` (a local deepseek-harness build) ships with the repository; you can also replace it with your own build (must contain `index.html` and `dist/`).

> Rebuilding `dsh-web/` after a deepseek-harness update (current base: **0.2.1-alpha.1**): the harness frontend source tree lives in-project at `deepseek-harness/` (gitignored; `git clone` it there once if missing). Copy the two integration files from `web/dsh-harness-patch/` into the tree (`router-transport.ts` → `apps/web/src/`, plus the patched `main.ts` that wraps `start()` behind a `router-transport` import) — then `pnpm install && pnpm build` (proxy env needed for the install). Finally run the automated capture: `node web/dsh-harness-patch/capture-dsh-web.mjs <harnessRoot> <projectRoot>/dsh-web 3080` — it boots the web profile with a scratch `DSH_HOME`, follows the token URL for the auth cookie, saves the rendered `/` HTML as `dsh-web/index.html`, fetches every `__DSH_BOOT__` manifest URL into `dsh-web/plugins/` (`pN.js` + `map.json`); you still copy `apps/web/dist/{assets,favicon.svg,favicon-dark.svg,manifest.webmanifest}` to `dsh-web/dist/` by hand. The manifest revs hash bundle mtimes, so plugins must be re-captured on every rebuild.

> The Agent Router look is not part of the build: `web/public/router-ui.css` re-tints dsh's base palettes (`--dsw-static-neutral-bluish-*`, `--dsw-static-deepseek-*`), and `web/public/board-embed.js` adds the top bar and panels. Traffic is bridged to the dsh protocol by `web/dsh-bridge.mjs`.
</details>

### Classic console

Zero dependencies (node:http), listens on 127.0.0.1 only. From the page you can:

- **Start a run**: enter the goal, pick the repo, check members (their models shown next to each; unavailable ones disabled), set the timeout;
- **Monitor live**: SSE pushes console output and board/mailbox snapshots; task cards change color in real time; filter the console by manager/events/mailbox; a status strip shows the manager's online state / turns / cost / current tool;
- **Human in the loop**: while running, type into the input box under the console to interject with the manager (`[user]` messages, top priority); cancel running / retry failed tasks from the task card;
- **Run summary**: once the manager calls finish_run, the closing summary stays pinned to the top of the page;
- **Task board / mailbox**: task status, assignee, dependencies, duration, result summaries and scene paths (worktree kept on failure), plus the inter-member message flow;
- **Session logs**: click a task card's "log" button for the agent's full session output;
- **Run history**: every run under `data/` (CLI-started ones included); click to review; running ones can be stopped with one click.

### Multiple runs & member collaboration

The web console can run several runs at once. Each run must use non-overlapping working directories (or independent git worktrees); the run list, SSE events, task board and session threads are all isolated by `runId`; messages or stops are never forwarded to another run.

The run settings panel selects a model for each of the six members (Claude, ZCode, Devin, Codex, OpenCode, Antigravity) separately. Settings go into that run's `runtime-config.json` and never touch global config; the manager reloads config after its current turn, subagents pick the model up when their next session starts.

The board "mailbox" page can send messages to `manager` or a specific subagent. Messages to the manager enter the manager's input queue; messages to subagents go into the board mailbox with an "written to mailbox, waiting to be read" note; messages are bound to the current run, and recipients outside the run are rejected.

### CLI

```bash
node router.mjs "<message>" --chat [options]   # chat mode (what the web app uses)
node router.mjs "<overall goal>" [options]     # goal mode: decompose the goal, finish_run when done

Options:
  --repo <dir>        working directory (default ./demo/todo-cli; git is optional except for isolation)
  --agents <list>     subagents, comma-separated (default claude,zcode; options: devin,codex,opencode,antigravity)
  --main <agent>      which CLI the main agent uses (default claude; see "The main agent is selectable")
  --timeout <sec>     per-subagent session timeout (default 900)
  --data <dir>        run data directory (default ./data/run-<timestamp>)
  --worktree          run every task in its own git worktree (default: direct; isolated:true isolates one task)
  --chat              chat mode: no finish_run; sleeps after 30 idle minutes
  --resume            with --data: resume the main agent's previous session in that directory
```

### The main agent is selectable (--main)

The main agent doesn't have to be Claude — any of the six CLIs can take the role; the board, dispatch, harvest and followup protocols are unchanged, and subagents never know who the manager is:

| Main agent | Persistence | Notes |
|---|---|---|
| `claude` (default) | bidirectional stream-json | long-lived process, events injected into the current turn; `--resume` self-healing restarts |
| `antigravity` | bidirectional stream-json | `agy --input-format stream-json` persistent, structurally identical to claude; `--conversation` self-healing; needs a local proxy |
| `devin` | persistent ACP child process | sequential `session/prompt` on one session, events stream live; on crash rebuild prefers `session/load` context restore (requires `devin auth login`) |
| `zcode` / `codex` / `opencode` | turn chaining | these CLIs have no persistent bidirectional stream: each injected message triggers one headless run, chained via sessionId; events are injected between turns, no live tool events within a turn |

**Switching the main agent**: pick it in the run settings panel before the first message, or switch it there later inside a conversation. A running conversation switches after the current turn, and running subagent tasks are unaffected. A sleeping one switches when the next message wakes it. Sessions cannot be shared between CLIs, so the new main agent starts a fresh session and receives a handoff with the earlier conversation and the task board (`handoffMessage` in `lib/prompts.mjs`). From the API: `PATCH /api/runs/:id/main {"main": "zcode"}`.

### Chat-only models (no tool use)

A model that can only chat (DeepSeek, Kimi, a local model, or anything you can wrap) can join in two ways. The code lives in the standalone [`chat-agent/`](chat-agent/README.md) module.

- **As the main agent.** The Router runs a text tool-calling protocol on its behalf: the model writes `<tool_call>{"name": …, "arguments": …}</tool_call>` blocks, the Router runs them (the board tools plus read-only `read_file` / `list_files` / `search` in the working directory), and the results go back in the next message. The model cannot edit or run anything itself, so it plans, delegates every change to subagents, and reviews their reports. History is saved under `data/<run>/chat-sessions/`, so `--resume` and switching main agents work as usual.
- **As a `consult` tool.** Every agent (the main agent and subagents) gets a `consult(question, context?, files?)` tool that asks the model for a second opinion. The Router attaches the listed files.

Configure models in `router.config.json`. Each name under `llm` becomes a main-agent choice (`--main deepseek`, or the "对话模型" section of the picker):

```json
{
  "llm": {
    "deepseek": { "label": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-reasoner", "apiKeyEnv": "DEEPSEEK_API_KEY" }
  },
  "consult": "deepseek"
}
```

Any OpenAI-compatible endpoint works; add `"proxy": "http://127.0.0.1:10808"` if needed. For anything else, point `"module"` at a JS file that exports `{ complete(messages) → { text } }`.

### Where to see the prompts

Everything sent to the AI is recorded in session threads (`data/<run>/threads/*.jsonl`), viewable in both UIs:
- dsh chat: the manager session starts with a "【system prompt】" message, followed by every user message (goal, `[event]`/`[mailbox]`/`[user]` injections) as actually received that turn; a subagent session's first message is the full task prompt.
- Classic console: the task card's "🧵 thread" or "view log" modal shows a collapsible "📋 system prompt" block first.

System prompt injection differs per main agent: claude uses `--append-system-prompt` (effective on every request); devin/zcode/codex/opencode/antigravity have no system prompt entry, so the Router folds it into the session's first message (antigravity's persistent session injects once per new session and not again after self-healing restarts; turn-chained modes re-inject when a failed turn reopens the session). Template source: `lib/prompts.mjs`.

## Run data layout

```
data/<run>/
├── board.json           # snapshot of the task board (tasks + mailbox); the Router process owns the live state
├── status.json          # main agent status + session id (used by --resume)
├── commands.jsonl       # web → Router channel (messages, cancel, retry, model changes)
├── logs/                # raw output per session; the manager's full event stream (manager-stream.log)
├── threads/             # event thread per session; system entries = the actual system prompt sent to the AI
├── chat-sessions/       # message history of a chat-model main agent (chat-agent/), one file per session id
└── worktrees/           # only for --worktree or isolated tasks (auto-removed after a successful merge)
```

## Board tools

| Tool | Who | Purpose |
|---|---|---|
| `create_task(title, spec, assignee, blocked_by?, isolated?)` | manager | launch a subagent on a self-contained task (non-blocking) |
| `followup_task(task_id, message)` | manager | have the original subagent continue a finished task |
| `cancel_task(task_id, reason?)` | manager | cancel a queued or running task |
| `list_tasks` / `get_task` | all | inspect tasks and full reports |
| `update_task(task_id, status?, result?, artifacts?)` | all | subagents: report failure or attach a structured result (done is automatic); manager: complete its own tasks |
| `send_message(to, content, task_id?)` | all | message a member, the manager, or `*` |
| `read_inbox()` | all | read your messages |
| `get_roster()` | all | view the team |
| `finish_run(summary)` | manager | goal mode only: end the run |
| `consult(question, context?, files?)` | all | only when `consult` is configured: ask a chat-only model for a second opinion |

Tool definitions and permissions live in `core/tools.mjs`. Tests for the collaboration core: `node --test core/test.mjs` (includes an end-to-end run of `router.mjs` with fake agents).

## Permission policy (full access by default)

Every subagent session runs with maximum permissions; no tool use ever waits for human approval: claude (main/sub) uses `--permission-mode bypassPermissions`, zcode uses `--mode yolo`, Codex uses the CLI's `--dangerously-bypass-approvals-and-sandbox`, antigravity uses `--dangerously-skip-permissions`, opencode sets `permission` to all-`allow` via `OPENCODE_CONFIG_CONTENT`, and devin's (ACP) `session/request_permission` requests are answered by the Router with the "allow" option.

## Known limitations (MVP)

- The main agent defaults to Claude Code; switch via `--main` / run settings to zcode / devin / codex / opencode / antigravity (zcode, codex, opencode are turn-chained: events are injected between turns, no live tool event stream within a turn).
- The main agent is a single point: process crashes self-heal via `--resume` (antigravity: `--conversation`), but if restarts exceed the limit the run stalls (stoppable from the web console).
- Subagents are one-shot sessions and don't receive new messages mid-run (they check the mailbox at the start and before finishing). True real-time bidirectionality exists only on the manager side (claude / antigravity / devin).
- Worktree merge conflicts mark the task failed and push an event; no automatic rebase.
- OpenCode requires CLI ≥ 1.18: on older versions (1.1.x) the zen server rejects every free-tier model headless with "free tier can only be used from within OpenCode". Free models queue for the first token (commonly 1–2 minutes) — use a subagent timeout of 300 s or more.
- The Antigravity CLI's generation API is geo-restricted and requires a local proxy; its board MCP config is written into the target directory as `.agents/mcp_config.json` (restored when the run ends, and added to `.git/info/exclude`).
- The Codex adapter consumes `codex exec --json` JSONL events; the current desktop CLI uses `--dangerously-bypass-approvals-and-sandbox`, with the board MCP injected per run.
