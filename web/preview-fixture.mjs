// Deterministic local UI sandbox. No real agent processes or API calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createApp } from './server.mjs';
import { mutate } from '../lib/store.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-router-preview-'));
const children = [];
const app = createApp({ dataDir: path.join(root, 'data'), launch() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 100 + children.length; children.push(child); return child;
}, kill(child) { child.emit('close', 1); } });
for (const [index, goal] of ['升级项目的协作体验：梳理任务、验证并发执行、完善错误反馈', '核对 API 与界面，补充集成测试和交付文档'].entries()) {
  const repo = path.join(root, `workspace-${index + 1}`); fs.mkdirSync(repo);
  const run = app.runs.start({ goal, repo, agents: ['claude', 'zcode'], models: { claude: 'preview-model' } });
  fs.mkdirSync(path.join(run.dir, 'threads'));
  const writeThread = (name, text) => fs.writeFileSync(path.join(run.dir, 'threads', `${name}.jsonl`), [{ kind:'user', data:{text:goal} },{ kind:'assistant',data:{text} }, {kind:'tool_use',data:{id:'call-1',name:'read_file',input:{path:'src/components/collaboration-panel.js'}}}, {kind:'tool_result',data:{id:'call-1',text:'文件已读取。任务板与消息接口已确认。'}}].map((e,i)=>JSON.stringify({seq:i+1,ts:'2026-09-28T04:30:00Z',...e})).join('\n')+'\n');
  writeThread('manager', '我已把目标拆成三个任务。Claude 正在处理界面，ZCode 已完成接口梳理。\n\n接下来检查状态同步与异常处理，让你在一个会话中掌握协作进展。');
  writeThread('T1-claude', '正在调整运行栏和任务卡的层次，并检查窄屏下的输入与滚动体验。');
  mutate(path.join(run.dir,'board.json'), b => {
    b.tasks = [
      { id:'T1',title:'优化聊天页运行栏与成员状态',spec:'将运行信息与聊天上下文绑定。验证长中文目标、超长工作目录路径，以及键盘焦点。',assignee:'claude',status:'in_progress',started_at:'2026-09-28T04:30:00Z',artifacts:['web/public/router-ui.css'],blocked_by:[] },
      { id:'T2',title:'验证多运行事件隔离',spec:'两个工作目录同时执行，各自的消息与事件只进入对应运行。',assignee:'zcode',status:'done',result:'并发消息、任务状态和模型配置隔离验证通过。',artifacts:['web/test.mjs'],blocked_by:[] },
      { id:'T3',title:'处理断线后的状态恢复',spec:'模拟网络中断并确认恢复后无重复消息。',assignee:'claude',status:'failed',result:'连接中断测试需要补充重连后的游标验证。请重试。',blocked_by:['T2'],worktree:repo+'\\very-long-project-directory\\integration-tests\\connection-recovery',branch:'task/t3-preview' }
    ]; b.seq.task = 3;
    b.messages = [{id:'M1',from:'zcode',to:'manager',content:'接口梳理完成，任务板与会话绑定可以进入联调。',read:true,ts:'2026-09-28T04:35:00Z'}]; b.seq.msg = 1;
  });
  if(index===1)children[index].emit('close',0);
}
const timer = setInterval(() => {
  for (const run of app.runs.active.values()) {
    if (!app.runs.running(run.id)) continue;
    mutate(path.join(run.dir,'board.json'), b => { for (const m of b.messages) if(m.from==='user')m.read=true; });
  }
}, 8000);
app.server.listen(Number(process.env.PORT || 2291),'127.0.0.1',()=>console.log(`模拟预览：http://127.0.0.1:${app.server.address().port}（临时数据，不调用 Agent）`));
process.on('SIGINT',()=>{clearInterval(timer);for(const run of app.runs.active.values())clearInterval(run.timer);app.server.closeAllConnections();app.server.close(()=>process.exit());});
