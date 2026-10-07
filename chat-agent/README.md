# chat-agent

Connect **chat-only models** (strong reasoning, no native tool calling) to coding agents. Zero dependencies, Node ≥ 18. Nothing in this directory imports from the rest of Agent Router.

The agent itself is [Codex](https://github.com/openai/codex), unchanged. Its own tools, sandbox, `apply_patch`, compaction and MCP support all apply. Codex talks to custom model providers only over the OpenAI Responses API, so this module provides a **Responses gateway**. It translates between Codex and a model that can only produce text.

```
Codex CLI ── Responses API ──▶ gateway ── chat messages ──▶ chat-only model
   ▲          (tools, input items)        (tools as text, <tool_call> blocks)   │
   └──── function_call / custom_tool_call items ◀── parsed from the reply ──────┘
```

| File | What it does |
|---|---|
| `gateway.mjs` | `startGateway()` serves `POST /v1/responses` (SSE) and `GET /v1/models`. It renders Codex's tools (function, custom/freeform, namespaced MCP tools) into the text protocol and earlier calls and outputs back into `<tool_call>` / `<tool_result>` text. It parses the reply into `function_call` / `custom_tool_call` items, and bounces malformed or unknown calls back to the model before answering Codex. `codexModelInfo()` describes a chat model to Codex: freeform `apply_patch`, text-only input, Codex's base instructions. `codexProviderArgs()` gives the `-c` overrides that select it |
| `codex-home.mjs` | `prepareCodexHome()` writes a dedicated `CODEX_HOME`: a model catalog plus a minimal feature set (no Codex sub-agents, goals, images, web search, apps or skills), so the user's own Codex setup stays out |
| `protocol.mjs` | The text tool-calling protocol. JSON calls look like `<tool_call>{"name": …, "arguments": …}</tool_call>`. Freeform calls such as a patch use `<tool_call name="apply_patch">raw text</tool_call>` |
| `provider.mjs` | `createProvider(cfg)` calls any OpenAI-compatible `/chat/completions` endpoint (streamed, optional HTTP proxy), or loads a custom module that exports `complete(messages)` |
| `consult.mjs` | `createConsult()` is an "ask the expert" tool other agents can call. The listed files are attached and the model answers in one shot |
| `codex/base_instructions.md` | Codex's default base instructions, copied from openai/codex (Apache-2.0, see `codex/README.md`) |

## Run Codex on a chat model

```js
import { startGateway, prepareCodexHome, codexProviderArgs, createProvider } from './chat-agent/index.mjs';

const model = await createProvider({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', apiKeyEnv: 'DEEPSEEK_API_KEY' });
const gw = await startGateway({ models: async name => name === 'deepseek' ? model : null });
const home = prepareCodexHome({ dir: './.codex-gateway', models: [{ name: 'deepseek', label: 'DeepSeek', contextWindow: 128000 }] });
// CODEX_HOME=<home> CHAT_GATEWAY_TOKEN=<gw.token> codex exec ...codexProviderArgs({ url: gw.url, model: 'deepseek', tokenEnv: 'CHAT_GATEWAY_TOKEN' }) "task"
```

Tests: `node --test chat-agent/test.mjs`. The last test drives the real Codex CLI and is skipped when Codex is not installed.
