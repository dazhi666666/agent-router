// chat-agent: plug a chat-only model (no native tool use) into an agent system.
//   createProvider   OpenAI-compatible endpoint or a custom module
//   ChatAgentSession  persistent agent session over a text tool-calling protocol
//   createFsTools     read-only file tools for the model, confined to a directory
//   createConsult     "ask the expert" tool other agents can call
export { createProvider, providerReady, openAiProvider } from './provider.mjs';
export { protocolPrompt, parseReply, formatResults } from './protocol.mjs';
export { ChatAgentSession } from './session.mjs';
export { createFsTools, FS_TOOL_SCHEMAS, resolveInside } from './fs-tools.mjs';
export { createConsult, consultSchema } from './consult.mjs';
