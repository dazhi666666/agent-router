// 端到端测试用的假对话模型（chat-agent 的 module provider）。主代理跑在真实 Codex 里（经 gateway），
// 这里按最后一条消息给出脚本化回复；工具名从系统提示词里的工具列表找（Codex 决定 MCP 工具的完整名字）。
const toolNamed = (system, suffix) => (system.match(/^## (\S+)/gm) || []).map(l => l.slice(3)).find(n => n.endsWith(suffix));

export default {
  label: 'Fake Brain',
  async complete(messages) {
    const system = messages[0].content, last = messages.at(-1).content;
    if (system.startsWith('You are a senior engineer')) return { text: 'ADVICE-42' }; // consult
    const shell = toolNamed(system, 'exec_command') ? { name: 'exec_command', arguments: { cmd: 'Get-Content README.md' } } : { name: 'shell_command', arguments: { command: 'Get-Content README.md' } };
    const create = toolNamed(system, 'create_task');
    if (/任务 T1「[^」]*」（claude）已完成/.test(last)) return { text: `FINAL: chat main got ${last.includes('consulted: ADVICE-42') ? 'the consult answer' : 'a report'}` };
    if (last.includes(`<tool_result name="${create}">`)) return { text: 'Dispatched T1 to claude.' };
    if (last.includes(`<tool_result name="${shell.name}">`) && last.includes('HELLO README')) {
      return { text: `<tool_call>${JSON.stringify({ name: create, arguments: { title: 'build', spec: 'consult please, then build', assignee: 'claude' } })}</tool_call>` };
    }
    if (last.includes('design it')) return { text: `Reading first.\n<tool_call>${JSON.stringify(shell)}</tool_call>` };
    return { text: 'ok' };
  }
};
