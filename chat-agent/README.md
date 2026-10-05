# chat-agent

Plug a **chat-only model** (strong reasoning, no native tool calling) into an agent system. Zero dependencies, Node ≥ 18. Nothing in this directory imports from the rest of Agent Router. The router uses it through `index.mjs`.

| File | What it does |
|---|---|
| `provider.mjs` | `createProvider(cfg)`: calls any OpenAI-compatible `/chat/completions` endpoint (streamed, optional HTTP proxy, no idle timeouts), or loads a custom module |
| `protocol.mjs` | the text tool-calling protocol: `protocolPrompt(tools)` renders the tools for the system prompt, `parseReply(text)` extracts `<tool_call>` blocks, `formatResults()` builds `<tool_result>` blocks |
| `session.mjs` | `ChatAgentSession`: a persistent agent session that loops (model → tool calls → results → model) until a reply has no calls; queues messages that arrive mid-turn, trims old history, retries failed calls, and saves history per session id so it can be resumed |
| `fs-tools.mjs` | `createFsTools(root)`: read-only `read_file` / `list_files` / `search`, confined to `root` |
| `consult.mjs` | `createConsult({ provider, root })`: an "ask the expert" tool. The host attaches the files the caller lists, and the model answers in one shot |

## Protocol

The model is told to write:

```
<tool_call>
{"name": "create_task", "arguments": {"title": "...", "spec": "...", "assignee": "claude"}}
</tool_call>
```

The host runs each call in order and replies in the next user message with `<tool_result name="create_task">…</tool_result>`. A reply with no calls ends the turn, and its text is the answer to the user.

The tags are XML-style, not markdown fences, so specs that contain code blocks survive intact. The parser also tolerates a `json` fence inside the tag and an unterminated last block. It drops any `<tool_result>` blocks the model invents itself.

## Providers

```jsonc
// OpenAI-compatible endpoint
{ "label": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-reasoner",
  "apiKeyEnv": "DEEPSEEK_API_KEY", "params": { "temperature": 0.3 }, "proxy": null, "timeoutSec": 600 }

// anything else: a module whose default export is a provider or a factory (cfg) => provider
{ "label": "My bridge", "module": "./my-provider.mjs" }
```

A provider is `{ complete(messages, { signal }) → Promise<{ text, reasoning? }> }`. A reasoning trace (such as DeepSeek's `reasoning_content`) is recorded as a `thought` entry and never sent back to the model.

## Minimal use

```js
import { ChatAgentSession, createProvider, createFsTools } from './chat-agent/index.mjs';

const fsTools = createFsTools(process.cwd());
const session = new ChatAgentSession({
  provider: await createProvider({ baseUrl, model, apiKeyEnv: 'MY_KEY' }),
  systemPrompt: 'You help with this repository.',
  tools: fsTools.tools,
  invoke: (name, args) => fsTools.invoke(name, args),
  stateDir: './.chat-sessions',
  onText: text => console.log(text),
  onTurnEnd: () => console.log('-- turn done --')
});
session.start();
session.send('What does src/index.js do?');
```

Tests: `node --test chat-agent/test.mjs`.
