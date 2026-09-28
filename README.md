# Agent Router

<div align="right">English · <b><a href="README.zh-CN.md">中文</a></b></div>

**A main agent runs the main thread (Claude Code by default; pick zcode / devin / codex / opencode / antigravity via `--main`)**: it holds a long-lived session, breaks the overall goal into tasks and dispatches them to local subagents (ZCode / Devin / Codex / OpenCode / Antigravity / other Claude Code instances). Dispatch is non-blocking — the manager creates tasks and immediately moves on; subagent progress (completion / failure / messages) is pushed back into the main session in real time. All agents collaborate through a **shared local task board** and exchange messages via the **board mailbox**; the Router handles automatic dispatch, harvest & merge, and the final summary.

Everything stays on your machine — agent runtimes, sessions, task data and communication. Model inference calls each vendor's API; that is the only boundary.

## Communication: shared task board + event-driven

Agents never talk to each other directly — everything goes through one **local MCP server** (stdio + a JSON file); the Router is the main agent's "hands and feet" (scheduler + event layer):

```
you ──goal──▶ main agent session (main thread, persistent, bidirectional stream-json)
                ├─ create_task → returns instantly, keeps working on its own stuff
                ├─ followup_task → a subagent continues with the original task context
                ├─ receives [event]/[mailbox] pushes → replies / spawns follow-ups / codes itself
                └─ goal achieved → calls finish_run to end the run
                      ▲ events injected live            │ dispatch / harvest (Node scheduler)
                ┌─────┴──────────────────────────────┴─────┐
                │        board-server.mjs (MCP/stdio)      │
                │   tasks + mailbox → data/<run>/board.json│
                └─────┬──────────┬───────────┬─────────────┘
              claude -p   agy(stream-json)  zcode -p   opencode run   devin acp
             (subagents execute tasks: shared working tree by default, optional worktree isolation)
```

- **Non-blocking dispatch**: after the manager calls `create_task`, the scheduler dispatches ready tasks to the matching subagent within a second (concurrency 1 per subagent, FIFO), and pushes a "queued" event back to the main session.
- **Follow-up (`followup_task`, Codex-style)**: the manager can ask the original subagent of a finished task to **continue** — the Router injects the original spec, previous result and the new instruction into a fresh session (no session resume: claude/zcode shell snapshots are anchored to the original session directory; resuming into a new directory breaks the Bash tool). The original task's execution mode is reused (direct, or worktree `task/T<id>-c<N>`); the harvest runs as usual afterwards.
- **Live events**: task merge, failures, and subagent messages (`send_message` to manager) are injected into the main session immediately — no waiting for batch boundaries.
- **The manager codes too**: tasks with `assignee: manager` are done by the main agent itself (in the main working tree, committing on its own).
- **Dispatch mode (direct by default)**: subagents work directly in the main working tree (Codex-style shared workspace); multiple tasks run **simultaneously** — the only concurrency limit is "one task at a time per subagent". On completion the Router only force-commits changes the subagent forgot to commit; tasks without code changes are legitimate. For risky, experimental changes: `create_task` with `isolated: true` (per-task isolation), or run with `--worktree` (isolate everything). Note: parallel direct tasks share one working tree — editing the same files can conflict, so keep change scopes disjoint when planning.
- **Git optional**: direct mode does not require a git repository — without git there are no commits, merges or rollbacks; the Router skips all git actions. `--worktree` isolation requires git.
- **Isolation & harvest (worktree mode)**: one `git worktree` per task (`task/T<id>` branch); after the session the Router force-commits uncommitted changes, verifies the commit count, merges `--no-ff` back to the main branch, and on failure preserves the scene and pushes an event.
- **Self-healing**: if the main session process dies it restarts with `--resume` (antigravity: `--conversation`) into the same session, losing no context; 10 minutes of total silence also triggers a forced restart.
- **Observability**: the full main-session event stream is in `data/<run>/logs/manager-stream.log`; per-member output in `logs/`; the web console shows everything live.

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
- opencode: `exe` likewise points at the native binary; `model` is `provider/model` (list with `opencode models`). Note: most zen free-tier models (`-free` suffix) are server-side restricted to the interactive client only; the free model verified to work headless is `opencode/space-bunny-free`. The board MCP and permission allowances are injected inline via `OPENCODE_CONFIG_CONTENT` — your global config is untouched.
- antigravity: `model` takes a name from `agy models` (e.g. `gemini-3.8-flash-high`, `claude-sonnet-4-6`); the `-high/-medium/-low/-max` suffix becomes `--effort`; `proxy` is required — without it the API returns "User location is not supported". The board MCP is injected via the workspace-level `.agents/mcp_config.json` (write-restore, and added to `.git/info/exclude` so it never gets committed).

## Usage

### Web console (dsh-native UI + classic console, same port)

```bash
node web/server.mjs        # dsh UI: http://127.0.0.1:2288/   classic console: /console/
```

> `dsh-web/` (a local deepseek-harness build) ships with the repository — the full dsh UI works out of the box; you can also replace it with your own build (must contain `index.html` and `dist/`).

- **`/` (default)**: the deepseek-harness native web UI. The workspace sidebar lists each run's agent session threads (one thread per session); click through for the full conversation — task prompts, event notifications, expandable tool-call cards, AI replies — streamed live as thread files change. The "⧉ task board" button in the corner opens the board drawer (iframe integration, not a plugin).
- **New session / messages in dsh** (bridged to this project's run model): "New session" just registers an empty session; the **first message = the overall goal, which starts a run** (default repo `demo/todo-cli`, members claude+zcode, direct mode; a `cwd` path in the message is used as the target directory if it exists and is not under the data dir). More messages during a run = **interjections to the manager**; "stop generating" = stop the run. That session's dsh conversation is the run's manager thread.
- **dsh UI trims** (board-embed.js injection): hides buttons with no counterpart here — good/bad answer, branch in new conversation, add workspace, add files or instructions, feedback, model selector; "search sessions" still works; finished runs are no longer mislabelled as running.
- **`/board`**: a redesigned task board page (openable standalone): run picker, status stats, task cards (status / assignee / duration / result / scene path) and the mailbox, auto-refresh every 2.5 s.
- **`/console/`**: the classic lightweight console (task board / mailbox / interjections / cancel & retry / log modal).
- Both UIs share the same data (`data/<run>/threads/*.jsonl`); dsh traffic is bridged to the dsh SessionEvent protocol by `web/dsh-bridge.mjs`.

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
node router.mjs "<overall goal>" [options]

Options:
  --repo <dir>        target working directory (default ./demo/todo-cli; direct mode doesn't require git)
  --agents <list>     participating members, comma-separated (default claude,zcode; options: devin,codex,opencode,antigravity)
  --main <agent>      which CLI the main agent uses (default claude; options: zcode/devin/codex/opencode/antigravity, see "The main agent is selectable")
  --timeout <sec>     per-subagent session timeout (default 900)
  --data <dir>        run data directory (default ./data/<timestamp>)
  --worktree          isolated parallel mode: one worktree per task, merged on completion (default: direct)
  --max-rounds <n>    (deprecated) unused in event-driven mode, kept for web-form compatibility
```

Examples:

```bash
node router.mjs "Add priority sorting to todo-cli, plus tests and a README update" --agents claude,zcode
# ZCode as the main agent (subagents unchanged):
node router.mjs "..." --main zcode --agents claude
# Legacy isolated parallel mode (one worktree per task, parallel execution):
node router.mjs "..." --agents claude,zcode --worktree
```

### The main agent is selectable (--main)

The main agent doesn't have to be Claude — any of the six CLIs can take the role; the board, dispatch, harvest and followup protocols are unchanged, and subagents never know who the manager is:

| Main agent | Persistence | Notes |
|---|---|---|
| `claude` (default) | bidirectional stream-json | long-lived process, events injected into the current turn; `--resume` self-healing restarts |
| `antigravity` | bidirectional stream-json | `agy --input-format stream-json` persistent, structurally identical to claude; `--conversation` self-healing; needs a local proxy |
| `devin` | persistent ACP child process | sequential `session/prompt` on one session, events stream live; on crash rebuild prefers `session/load` context restore (requires `devin auth login`) |
| `zcode` / `codex` / `opencode` | turn chaining | these CLIs have no persistent bidirectional stream: each injected message triggers one headless run, chained via sessionId; events are injected between turns, no live tool events within a turn |

Both the web console and the dsh run settings have a "main agent" dropdown; `main` is saved with the run settings and cannot change while running.

### Where to see the prompts

Everything sent to the AI is recorded in session threads (`data/<run>/threads/*.jsonl`), viewable in both UIs:
- dsh chat: the manager session starts with a "【system prompt】" message, followed by every user message (goal, `[event]`/`[mailbox]`/`[user]` injections) as actually received that turn; a subagent session's first message is the full task prompt.
- Classic console: the task card's "🧵 thread" or "view log" modal shows a collapsible "📋 system prompt" block first.

System prompt injection differs per main agent: claude uses `--append-system-prompt` (effective on every request); devin/zcode/codex/opencode/antigravity have no system prompt entry, so the Router folds it into the session's first message (antigravity's persistent session injects once per new session and not again after self-healing restarts; turn-chained modes re-inject when a failed turn reopens the session). Template source: `lib/prompts.mjs`.

## Run data layout

```
data/<run>/
├── board.json           # the task board: tasks + mailbox (the MCP server's storage)
├── logs/                # raw output per session; the manager's full event stream (manager-stream.log)
├── threads/             # event thread per session; system entries = the actual system prompt sent to the AI
└── worktrees/           # only for --worktree or isolated tasks (auto-removed after a successful merge)
```

## Board tools (available to every agent)

| Tool | Purpose |
|---|---|
| `create_task(title, spec, assignee, blocked_by?, isolated?)` | create a task (manager); `isolated: true` forces a dedicated worktree |
| `followup_task(task_id, message)` | **manager only**: have a task's original subagent continue with the original context, appending new instructions |
| `list_tasks` / `get_task` | inspect tasks |
| `update_task(task_id, status, result?, artifacts?)` | claim (in_progress) / finish (done + result) / mark failed |
| `send_message(to, content, task_id?)` | message a subagent, the manager, or `*` (everyone) |
| `read_inbox()` | read your unread messages (auto-marked read) |
| `get_roster()` | view the team roster |
| `finish_run(summary)` | **manager only**: end the whole run once the goal is achieved |

## Permission policy (full access by default)

Every subagent session runs with maximum permissions; no tool use ever waits for human approval: claude (main/sub) uses `--permission-mode bypassPermissions`, zcode uses `--mode yolo`, Codex uses the CLI's `--dangerously-bypass-approvals-and-sandbox`, antigravity uses `--dangerously-skip-permissions`, opencode sets `permission` to all-`allow` via `OPENCODE_CONFIG_CONTENT`, and devin's (ACP) `session/request_permission` requests are answered by the Router with the "allow" option.

## Known limitations (MVP)

- The main agent defaults to Claude Code; switch via `--main` / run settings to zcode / devin / codex / opencode / antigravity (zcode, codex, opencode are turn-chained: events are injected between turns, no live tool event stream within a turn).
- The main agent is a single point: process crashes self-heal via `--resume` (antigravity: `--conversation`), but if restarts exceed the limit the run stalls (stoppable from the web console).
- claude subagents are one-shot sessions and don't receive new messages mid-run (they check the mailbox at start/wrap-up); zcode / devin / opencode / antigravity are the same. True real-time bidirectionality exists only on the manager side (claude / antigravity / devin).
- Worktree merge conflicts mark the task failed and push an event; no automatic rebase.
- Most of OpenCode's zen free-tier models are restricted server-side to the interactive client ("free tier can only be used from within OpenCode"); headless availability must be verified per model — the default `opencode/space-bunny-free` works.
- The Antigravity CLI's generation API is geo-restricted and requires a local proxy; its board MCP config is written into the target directory as `.agents/mcp_config.json` (restored when the run ends, and added to `.git/info/exclude`).
- The Codex adapter consumes `codex exec --json` JSONL events; the current desktop CLI uses `--dangerously-bypass-approvals-and-sandbox`, with the board MCP injected per run.
