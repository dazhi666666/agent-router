// chat-agent: connect chat-only models (no native tool use) to an agent system.
//   startGateway       Responses API gateway: lets Codex run a chat-only model as its model (Codex stays the agent)
//   codexProviderArgs  Codex command-line overrides that select a gateway model
//   prepareCodexHome   dedicated CODEX_HOME with the model catalog and a minimal feature set
//   createProvider     OpenAI-compatible endpoint or a custom module
//   createConsult      "ask the expert" tool other agents can call
export { startGateway, codexProviderArgs, codexModelInfo, convertTools, convertInput, toOutputItems } from './gateway.mjs';
export { prepareCodexHome } from './codex-home.mjs';
export { createProvider, providerReady, openAiProvider } from './provider.mjs';
export { protocolPrompt, parseReply, resolveArguments, formatResults } from './protocol.mjs';
export { createConsult, consultSchema } from './consult.mjs';
