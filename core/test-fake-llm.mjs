// 端到端测试用的假对话模型（chat-agent 的 module provider）：按最后一条消息给出脚本化回复。
export default {
  label: 'Fake Brain',
  async complete(messages) {
    const last = messages.at(-1).content;
    if (messages[0].content.startsWith('You are a senior engineer')) return { text: 'ADVICE-42' }; // consult
    if (last.includes('design it')) return { text: 'Reading first.\n<tool_call>\n{"name": "read_file", "arguments": {"path": "README.md"}}\n</tool_call>' };
    if (last.includes('<tool_result name="read_file">') && last.includes('HELLO README')) {
      return { text: '<tool_call>{"name":"create_task","arguments":{"title":"build","spec":"consult please, then build","assignee":"claude"}}</tool_call>' };
    }
    if (last.includes('<tool_result name="create_task">')) return { text: 'Dispatched T1 to claude.' };
    if (/任务 T1「[^」]*」（claude）已完成/.test(last)) return { text: `FINAL: chat main got ${last.includes('consulted: ADVICE-42') ? 'the consult answer' : 'a report'}` };
    return { text: 'ok' };
  }
};
