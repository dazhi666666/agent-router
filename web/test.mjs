import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { createApp } from './server.mjs';
import { Sessions, threadSessionId, writeJson } from './sessions.mjs';
import { UiState } from './uistate.mjs';
import { runtimeConfig, validateModels, validateEfforts, validateMcpServers, modelCatalog } from './models.mjs';
import { withConfigLock, withWorkspaceConfig, writeConfigEra } from '../lib/spawn-util.mjs';
import { mutate, read } from '../lib/store.mjs';
import { loadConfig } from '../lib/config.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-router-test-'));
  const dataDir = path.join(root, 'data'), repoA = path.join(root, 'a'), repoB = path.join(root, 'b');
  fs.mkdirSync(repoA); fs.mkdirSync(repoB);
  const launches = [], killed = [];
  const app = createApp({ dataDir, launch(args, env) { const child = new EventEmitter(); child.pid = launches.length + 100; child.stdout = new PassThrough(); child.stderr = new PassThrough(); launches.push({ child, args, env }); return child; }, kill(child) { killed.push(child.pid); child.emit('close', 1); } });
  t.after(async () => {
    for (const run of app.runs.active.values()) { clearInterval(run.timer); for (const res of run.clients) res.end(); }
    app.server.closeAllConnections();
    if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { ...app, root, dataDir, repoA, repoB, launches, killed };
}
async function httpFixture(t) {
  const f = fixture(t); await new Promise(resolve => f.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${f.server.address().port}`;
  f.call = async (url, method='GET', value) => { const response = await fetch(base+url, { method, headers:{'Content-Type':'application/json'}, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }); return { status:response.status, data:await response.json() }; };
  f.base = base; return f;
}
test('empty installation: draft settings persist, invalid settings retain draft, first prompt starts only once', async t => {
  const f = await httpFixture(t);
  assert.equal((await f.call('/dsh-api/health','POST',{})).data.ok,true);
  const created=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  assert.equal(f.launches.length,0);
  assert.equal((await f.call(`/api/sessions/${created}/settings`,'PATCH',{repo:f.repoA,agents:['claude'],models:{claude:'mock-a'}})).status,200);
  assert.equal((await f.call(`/api/sessions/${created}/settings`,'PATCH',{repo:path.join(f.root,'missing')})).status,404);
  const recovered=new Sessions(f.dataDir,f.repoB).resolve(created);
  assert.equal(recovered.settings.repo,f.repoA);
  const prompt={sessionId:created,content:[{type:'text',text:'实现目标 A'}]};
  assert.equal((await f.call('/dsh-api/session/prompt','POST',prompt)).data.ok,true);
  assert.equal(f.launches.length,1);
  assert.equal((await f.call(`/api/sessions/${created}/settings`,'PATCH',{repo:f.repoB})).status,409);
  assert.equal((await f.call('/dsh-api/session/prompt','POST',prompt)).data.ok,true);
  assert.equal(f.launches.length,1);
  const runId=f.sessions.resolve(created).runId;
  assert.match(fs.readFileSync(path.join(f.runs.dir(runId),'commands.jsonl'),'utf8'),/实现目标 A/);
});
test('concurrent runs isolate process, model configuration, messages, SSE, and stop', async t => {
  const f=await httpFixture(t);
  const a=f.runs.start({goal:'A',repo:f.repoA,agents:['claude'],models:{claude:'model-a'}});
  const b=f.runs.start({goal:'B',repo:f.repoB,agents:['zcode'],models:{claude:'model-b'}});
  assert.equal(f.runs.list().filter(r=>r.live).length,2);
  // dsh 工作区模型：同一工作目录允许多个运行并行，互不隔离进程
  const c=f.runs.start({goal:'collision',repo:f.repoA,agents:['claude']});
  assert.equal(f.runs.list().filter(r=>r.live).length,3);
  assert.notEqual(f.launches[0].env.AGENT_ROUTER_RUN_CONFIG,f.launches[1].env.AGENT_ROUTER_RUN_CONFIG);
  assert.equal(JSON.parse(fs.readFileSync(f.launches[0].env.AGENT_ROUTER_RUN_CONFIG)).claude.model,'model-a');
  const ctrl=new AbortController();
  const response=await fetch(`${f.base}/api/events?runId=${a.id}`,{signal:ctrl.signal});
  const reader=response.body.getReader();
  const initial=new TextDecoder().decode((await reader.read()).value);
  assert.match(initial,new RegExp(a.id)); assert.ok(!initial.includes(b.id));
  f.launches[0].child.stdout.write('ONLY-A\n');
  const update=new TextDecoder().decode((await reader.read()).value);assert.match(update,/ONLY-A/);assert.ok(!update.includes(b.id));
  ctrl.abort();
  f.runs.message(a.id,{text:'a instruction'});assert.ok(!fs.existsSync(path.join(f.runs.dir(b.id),'commands.jsonl')));
  const models=(await f.call(`/api/runs/${a.id}/models`,'PATCH',{models:{claude:'model-c'}})).data;
  assert.equal(models.ok,true);assert.equal(f.runs.detail(b.id).settings.models.claude,'model-b');
  f.runs.stop(a.id);assert.deepEqual(f.killed,[100]);assert.equal(f.runs.running(b.id),true);
  // 对话模式：停止后再发消息 = 用 --resume 续接原会话
  assert.equal(f.runs.message(a.id,{text:'late'}).delivery,'resumed');
  const resumed=f.launches[f.launches.length-1].args;
  assert.equal(resumed[0],'late');assert.ok(resumed.includes('--chat')&&resumed.includes('--resume'));
  assert.equal(resumed[resumed.indexOf('--data')+1],f.runs.dir(a.id));
  // 只有发给主代理的消息会唤醒对话；运行停止时不能直接给子代理留言
  f.runs.stop(a.id);
  assert.throws(()=>f.runs.message(a.id,{text:'y',to:'claude'}),/不在进行中/);
});
test('workspace directory is workspace-level: drafts follow it, new sessions inherit it', async t => {
  const f = await httpFixture(t), demo = path.join(f.dataDir, 'demo', 'todo-cli');
  assert.equal((await f.call('/api/workspace')).data.repo, demo);
  const first=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  assert.equal(f.sessions.resolve(first).settings.repo, demo);
  const patched=(await f.call('/api/workspace','PATCH',{repo:f.repoA})).data;
  assert.equal(patched.repo, fs.realpathSync(f.repoA));
  // 切换工作区目录后：已有草稿会话跟到新目录，新建会话直接继承
  assert.equal(f.sessions.resolve(first).settings.repo, fs.realpathSync(f.repoA));
  const second=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  assert.equal(f.sessions.resolve(second).settings.repo, fs.realpathSync(f.repoA));
  assert.equal((await f.call('/api/workspace','PATCH',{repo:path.join(f.root,'missing')})).status,400);
});
test('switching the main agent: live runs get a command, sleeping runs relaunch with the new main', async t => {
  const f=await httpFixture(t), a=f.runs.start({goal:'A',repo:f.repoA,agents:['claude'],main:'claude'});
  const r=await f.call(`/api/runs/${a.id}/main`,'PATCH',{main:'zcode'});
  assert.equal(r.data.applied,'after_turn');
  assert.match(fs.readFileSync(path.join(a.dir,'commands.jsonl'),'utf8'),/"type":"switch_main","main":"zcode"/);
  assert.equal(f.runs.detail(a.id).settings.main,'zcode');
  f.runs.stop(a.id);
  assert.equal(f.runs.switchMain(a.id,'codex').applied,'next_message');
  f.runs.message(a.id,{text:'wake up'});
  const args=f.launches.at(-1).args;
  assert.equal(args[args.indexOf('--main')+1],'codex');assert.ok(args.includes('--resume'));
  assert.equal((await f.call(`/api/runs/${a.id}/main`,'PATCH',{main:'nope'})).status,400);
});
test('dsh bridge: titled sessions, subagent catalog on the manager, subagent addresses', t => {
  const f=fixture(t),a=f.runs.start({goal:'Build the thing',repo:f.repoA,agents:['zcode']});
  fs.mkdirSync(path.join(a.dir,'threads'),{recursive:true});
  fs.writeFileSync(path.join(a.dir,'threads','manager.jsonl'),JSON.stringify({seq:1,ts:'2026-09-28T00:00:00Z',kind:'user',data:{text:'Build the thing'}})+'\n');
  fs.writeFileSync(path.join(a.dir,'threads','T1-zcode.jsonl'),JSON.stringify({seq:1,ts:'2026-09-28T00:00:01Z',kind:'assistant',data:{text:'SUB-REPORT'}})+'\n');
  writeJson(path.join(a.dir,'board.json'),{seq:{task:1,msg:0},tasks:[{id:'T1',title:'Write tests',assignee:'zcode',status:'in_progress',created_at:'2026-09-28T00:00:01Z'}],messages:[]});
  const items=f.bridge.unary('session/list',{}).value.items;
  const mgr=f.sessions.managerId(a.id),child=threadSessionId(a.id,'T1-zcode');
  assert.equal(items.find(i=>i.sessionId===mgr).title,'Build the thing');
  assert.equal(items.find(i=>i.sessionId===child).title,'↳ T1 · ZCode · Write tests');
  const catalog=f.bridge.unary('session/projections',{sessionId:mgr}).value.values.subagentCatalog;
  assert.deepEqual(catalog.map(c=>[c.id,c.mode,c.label]),[[child,'continuable','T1 · ZCode · Write tests']]);
  // 从目录进入子代理时，dsh 用 { parentSessionId, childSessionId } 寻址
  const page=f.bridge.unary('session/page',{address:{parentSessionId:mgr,childSessionId:child,mode:'continuable'}});
  assert.match(JSON.stringify(page),/SUB-REPORT/);
  assert.equal(f.bridge.unary('subagents/prompt',{requestId:'r',parentSessionId:mgr,childSessionId:child,mode:'continuable',delivery:'queue',content:[{type:'text',text:'hi sub'}]}).value.accepted,true);
  assert.match(fs.readFileSync(path.join(a.dir,'commands.jsonl'),'utf8'),/"to":"zcode","task_id":"T1","text":"hi sub"/);
  assert.equal(f.bridge.unary('subagents/interruptByParent',{args:[child,mgr,'continuable']}).value.accepted,true);
  assert.match(fs.readFileSync(path.join(a.dir,'commands.jsonl'),'utf8'),/"type":"cancel","task_id":"T1"/);
});
test('dsh bridge: workspace stream sends one baseline, then upserts new sessions', t => {
  const f = fixture(t), frames = [];
  const stop = f.bridge.stream('workspace/follow', {}, frame => frames.push(frame)); t.after(stop);
  assert.deepEqual(frames.map(x => x.type), ['baseline']);
  const created = f.bridge.unary('session/create', {}).value.sessionId;
  return new Promise(resolve => setTimeout(() => {
    assert.deepEqual(frames.map(x => x.type), ['baseline', 'upsert']);
    assert.ok(frames[1].workspace.sessionIds.includes(created));
    resolve();
  }, 1700));
});
test('goal-mode runs cannot be resumed after stopping', async t => {
  const f=fixture(t), g=f.runs.start({goal:'G',mode:'goal',repo:f.repoA});
  assert.ok(!f.launches[0].args.includes('--chat'));
  f.runs.stop(g.id);
  assert.throws(()=>f.runs.message(g.id,{text:'late'}),/不在进行中/);
  // 桥接层同样拒绝：目标模式会话结束只能新建运行
  assert.throws(()=>f.bridge.unary('session/prompt',{sessionId:f.sessions.managerId(g.id),content:[{type:'text',text:'late'}]}),/已结束/);
});
test('historical same-name sessions and streams remain bound to the correct run', async t => {
  const f=fixture(t), a=f.runs.start({goal:'A',repo:f.repoA}), b=f.runs.start({goal:'B',repo:f.repoB});
  for(const [run,text] of [[a,'ONLY-A'],[b,'ONLY-B']]) {
    fs.mkdirSync(path.join(run.dir,'threads'));
    fs.writeFileSync(path.join(run.dir,'threads','manager.jsonl'),JSON.stringify({kind:'user',ts:'2026-09-28T00:00:00Z',data:{text}})+'\n');
    fs.writeFileSync(path.join(run.dir,'threads','T1-claude.jsonl'),JSON.stringify({kind:'assistant',ts:'2026-09-28T00:00:00Z',data:{text}})+'\n');
    mutate(path.join(run.dir,'board.json'),board=>board.tasks.push({id:'T1',assignee:'claude',status:'in_progress'}));
  }
  const idA=threadSessionId(a.id,'manager'),idB=threadSessionId(b.id,'manager');
  assert.notEqual(idA,idB);
  const page=f.bridge.unary('session/page',{address:{sessionId:idA}});
  assert.match(JSON.stringify(page),/ONLY-A/);assert.ok(!JSON.stringify(page).includes('ONLY-B'));
  const frames=[];const stop=f.bridge.stream('session/follow',{address:{sessionId:idA}},frame=>frames.push(frame));t.after(stop);
  fs.appendFileSync(path.join(a.dir,'threads','manager.jsonl'),JSON.stringify({kind:'assistant',ts:'2026-09-28T00:00:01Z',data:{text:'A-next'}})+'\n');
  await new Promise(r=>setTimeout(r,1100));stop();
  assert.match(JSON.stringify(frames),/A-next/);assert.ok(!JSON.stringify(frames).includes('ONLY-B'));
  const seq=frames.flatMap(f=>f.records?.map(r=>r.event.seq)|| (f.event?[f.event.seq]:[]));assert.equal(new Set(seq).size,seq.length);
  assert.equal(f.bridge.unary('session/search',{query:'ONLY-B'}).value.items.length,2);
  f.runs.stop(a.id);
  assert.throws(()=>f.bridge.unary('session/cancel',{sessionId:idA}),/只有/);
  // 停止后的对话会话可无缝续聊：下一条消息经 runs.message → resume 用 --resume 拉起原 Router
  assert.equal(f.bridge.unary('session/prompt',{sessionId:idA,content:[{type:'text',text:'续聊'}]}).value.delivery,'resumed');
  assert.equal(f.runs.running(a.id),true);
  assert.ok(f.launches.at(-1).args.includes('--resume'));
  assert.equal(f.runs.running(b.id),true);
  const restarted=new Sessions(f.dataDir,f.repoA);assert.equal(restarted.resolve(idA).runId,a.id);
});
test('direct subagent messages record unread/read state and validate target ownership',t=>{
  const f=fixture(t),a=f.runs.start({goal:'A',repo:f.repoA,agents:['claude']});
  mutate(path.join(a.dir,'board.json'),b=>b.tasks.push({id:'T1',assignee:'claude',status:'in_progress'}));
  const id=threadSessionId(a.id,'T1-claude');
  const result=f.bridge.unary('session/prompt',{sessionId:id,content:[{type:'text',text:'用户直接消息'}]});
  assert.equal(result.value.delivery,'mailbox');
  // 任务板归 Router 进程所有：Web 端的留言以命令形式交给 Router
  const cmd=JSON.parse(fs.readFileSync(path.join(a.dir,'commands.jsonl'),'utf8').trim().split('\n').pop());
  assert.deepEqual([cmd.type,cmd.to,cmd.text],['message','claude','用户直接消息']);
  const file=path.join(a.dir,'board.json');mutate(file,b=>b.messages.push({id:'M1',from:'user',to:'claude',read:false}));
  assert.throws(()=>f.runs.message(a.id,{text:'bad',to:'devin'}),/不属于/);
  assert.throws(()=>f.runs.message(a.id,{text:'bad',to:'claude',task_id:'T2'}),/不匹配/);
  mutate(file,b=>b.messages[0].read=true);assert.equal(f.runs.detail(a.id).board.messages[0].read,true);
  assert.throws(()=>f.bridge.unary('session/cancel',{sessionId:id}),/只有/);
});
test('runtime model overrides do not alter global configuration',t=>{
  const f=fixture(t), previous=process.env.AGENT_ROUTER_RUN_CONFIG;
  t.after(()=>{if(previous===undefined)delete process.env.AGENT_ROUTER_RUN_CONFIG;else process.env.AGENT_ROUTER_RUN_CONFIG=previous;});
  const config=path.join(f.root,'config.json');writeJson(config,{claude:{model:'isolated-model'},main:{model:'main-only'},mcpServers:{fetch:{type:'stdio',command:'mcp-cmd'}}});
  const original=loadConfig().claude.model;process.env.AGENT_ROUTER_RUN_CONFIG=config;
  assert.equal(loadConfig().claude.model,'isolated-model');assert.equal(loadConfig().main.model,'main-only');assert.equal(loadConfig().mcpServers.fetch.command,'mcp-cmd');
  delete process.env.AGENT_ROUTER_RUN_CONFIG;assert.equal(loadConfig().claude.model,original);assert.equal(loadConfig().main.model,undefined);assert.deepEqual(loadConfig().mcpServers,{});
});
test('conversation MCP servers: validation, draft persistence, runtime-config, live and dormant edits',async t=>{
  const f=await httpFixture(t);
  // 校验与规范化：stdio/http 合法形状通过；坏名字、未知字段、缺 command/url 拒绝
  assert.deepEqual(validateMcpServers({fetch:{command:'npx',args:['-y','mcp-server-fetch'],env:{K:'v'}},docs:{url:'https://example.com/mcp',headers:{A:'b'}},off:{command:'x',enabled:false}}),{
    fetch:{type:'stdio',command:'npx',args:['-y','mcp-server-fetch'],env:{K:'v'}},
    docs:{type:'http',url:'https://example.com/mcp',headers:{A:'b'}},
    off:{type:'stdio',command:'x',enabled:false}
  });
  assert.throws(()=>validateMcpServers({'bad name':{command:'x'}}),/名字/);
  assert.throws(()=>validateMcpServers({x:{command:'x',foo:1}}),/未知字段/);
  assert.throws(()=>validateMcpServers({x:{}}),/command（本地进程）或 url/);
  assert.throws(()=>validateMcpServers({x:{type:'http',command:'y'}}),/url/);
  assert.deepEqual(validateMcpServers(undefined),{});
  // 草稿保存 + 启动时进 runtime-config.json
  const sid=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  assert.equal((await f.call(`/api/sessions/${sid}/settings`,'PATCH',{repo:f.repoA,agents:['zcode'],mcpServers:{fetch:{command:'npx',args:['-y','mcp-server-fetch']}}})).status,200);
  assert.equal((await f.call(`/api/sessions/${sid}/settings`,'PATCH',{mcpServers:{x:{nope:1}}})).status,400);
  assert.equal((await f.call('/dsh-api/session/prompt','POST',{sessionId:sid,content:[{type:'text',text:'开始'}]})).data.ok,true);
  const runId=f.sessions.resolve(sid).runId;
  const cfg=JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8'));
  assert.deepEqual(cfg.mcpServers,{fetch:{type:'stdio',command:'npx',args:['-y','mcp-server-fetch']}});
  // 运行中改 MCP 即时落盘（下一个拉起的 CLI 进程重读），改模型不丢 MCP 段
  assert.equal((await f.call(`/api/runs/${runId}/mcp`,'PATCH',{mcpServers:{docs:{url:'https://example.com/mcp'}}})).status,200);
  assert.equal((await f.call(`/api/runs/${runId}/models`,'PATCH',{models:{claude:'m2'}})).status,200);
  const cfg2=JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8'));
  assert.deepEqual(cfg2.mcpServers,{docs:{type:'http',url:'https://example.com/mcp'}});
  assert.equal(f.runs.detail(runId).settings.mcpServers.docs.url,'https://example.com/mcp');
  // 非法输入 400 且不落盘
  assert.equal((await f.call(`/api/runs/${runId}/mcp`,'PATCH',{mcpServers:{'bad name':{command:'x'}}})).status,400);
  assert.equal(f.runs.detail(runId).settings.mcpServers.docs.url,'https://example.com/mcp');
  // 休眠后仍可改：下一条消息唤醒的 Router 带新配置；清空后 runtime-config 不再带该段
  f.runs.stop(runId);
  assert.equal((await f.call(`/api/runs/${runId}/mcp`,'PATCH',{mcpServers:{}})).status,200);
  assert.deepEqual(f.runs.detail(runId).settings.mcpServers,{});
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8')).mcpServers,undefined);
});
test('config file lock serializes the write-spawn-read window and recovers stale locks',async t=>{
  const f=fixture(t),file=path.join(f.root,'shared.json'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const events=[];
  await Promise.all([
    withConfigLock(file,async()=>{events.push('a-in');await sleep(60);events.push('a-out');}),
    withConfigLock(file,async()=>{events.push('b-in');events.push('b-out');})
  ]);
  assert.deepEqual(events,['a-in','a-out','b-in','b-out']); // 第二个等第一个出临界区（含读配置缓冲）
  // 崩溃残锁（超过回收线的 mtime）会被自动接管
  const lock=`${file}.lock`;fs.writeFileSync(lock,'stale');
  const past=new Date(Date.now()-60000);fs.utimesSync(lock,past,past);
  let ran=false;await withConfigLock(file,async()=>{ran=true;});
  assert.equal(ran,true);assert.ok(!fs.existsSync(lock));
  await sleep(10);
});
test('workspace config window isolates parallel users: snapshots stay original, file restored after read window',async t=>{
  const f=fixture(t),file=path.join(f.root,'ws.json');
  fs.writeFileSync(file,JSON.stringify({keep:1}));
  const snapshots=[];
  const run=who=>withWorkspaceConfig(
    file,
    era=>{
      const base=JSON.parse(era.original?.toString('utf8')||'{}');
      assert.ok(!('who' in base),`${who} 的快照不该包含别人的内容`);
      base.who=who;
      writeConfigEra(era,file,JSON.stringify(base));
    },
    ()=>{snapshots.push(JSON.parse(fs.readFileSync(file,'utf8')));return null;}
  );
  await Promise.all([run('a'),run('b')]);
  // 拉起进程时各自只看到自己的写入；全部结束后共享文件还原成原件（后开始的用户快照干净的关键）
  assert.deepEqual(snapshots.map(s=>s.who).sort(),['a','b']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{keep:1});
  // startSpawn 的 promise 原样透传（含失败），缓冲期内提前失败不算 unhandledRejection
  await assert.rejects(()=>withWorkspaceConfig(file,()=>{},()=>Promise.reject(new Error('spawn-fail'))),/spawn-fail/);
});
test('main and subagent models are chosen separately',async t=>{
  const f=await httpFixture(t);
  const sid=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  // 草稿：主代理模型（main 键）与子代理类型模型（类型键）并存保存
  assert.equal((await f.call(`/api/sessions/${sid}/settings`,'PATCH',{repo:f.repoA,agents:['claude'],main:'claude',models:{main:'main-model-x',claude:'sub-model-y'}})).status,200);
  assert.equal((await f.call('/dsh-api/session/prompt','POST',{sessionId:sid,content:[{type:'text',text:'开始'}]})).data.ok,true);
  const runId=f.sessions.resolve(sid).runId;
  const cfg=JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8'));
  assert.deepEqual(cfg,{claude:{model:'sub-model-y'},devin:{},codex:{},opencode:{},antigravity:{},zcode:{},'zcode-oss':{},main:{model:'main-model-x'}});
  // 运行中改模型：main 段与类型段一起落盘
  assert.equal((await f.call(`/api/runs/${runId}/models`,'PATCH',{models:{main:'main-model-z',claude:'sub-model-y2'}})).status,200);
  const cfg2=JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8'));
  assert.equal(cfg2.main.model,'main-model-z');assert.equal(cfg2.claude.model,'sub-model-y2');
  // 换主代理类型：原类型的主代理模型清空，回退类型默认
  assert.equal((await f.call(`/api/runs/${runId}/main`,'PATCH',{main:'devin'})).status,200);
  assert.equal(f.runs.detail(runId).settings.models.main,undefined);
  // 草稿里换主代理类型同样清空，不会拿旧类型的模型名去校验
  const sid2=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  await f.call(`/api/sessions/${sid2}/settings`,'PATCH',{main:'claude',models:{main:'m1',claude:'c1'}});
  assert.equal((await f.call(`/api/sessions/${sid2}/settings`,'PATCH',{main:'devin'})).status,200);
  assert.equal(f.sessions.resolve(sid2).settings.models.main,undefined);
  // main 段按类型解析：opencode 带 @variant、antigravity 带 -effort 后缀
  assert.deepEqual(runtimeConfig({main:'p/m@high',opencode:'p/m2'},{},'opencode'),{claude:{},devin:{},codex:{},opencode:{model:'p/m2'},antigravity:{},zcode:{},'zcode-oss':{},main:{model:'p/m',variant:'high'}});
  assert.deepEqual(runtimeConfig({main:'gemini-3.8-flash-high'},{},'antigravity').main,{model:'gemini-3.8-flash',effort:'high'});
  assert.deepEqual(runtimeConfig({main:'m'},{},'claude').main,{model:'m'});
  // 开源 ZCode 类型：模型段走 runtime-config 的 zcode-oss 键，validateModels 接受该类型
  assert.deepEqual(runtimeConfig({'zcode-oss':'p/oss'},{},null)['zcode-oss'],{model:'p/oss'});
  // 对话模型主代理不支持单独选模型
  assert.throws(()=>validateModels({main:'x'},'not-a-cli'),/不支持单独选择模型/);
});
test('zcode reasoning effort flows through settings and runtime config',async t=>{
  const f=await httpFixture(t);
  const cat=modelCatalog(),values=cat.zcode.efforts?.[cat.zcode.default]||[];
  if (!values.length) { t.skip('本机没有 ZCode 思考档位注册表'); return; }
  const eff=values.at(-1);
  const sid=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  // 草稿：只选强度不选模型也生效（zcode 段/主代理段都只有 effort）；换主类型和选强度分两次保存（与 UI 一致）
  assert.equal((await f.call(`/api/sessions/${sid}/settings`,'PATCH',{repo:f.repoA,agents:['claude'],main:'zcode'})).status,200);
  assert.equal((await f.call(`/api/sessions/${sid}/settings`,'PATCH',{efforts:{zcode:eff,main:eff}})).status,200);
  await f.call('/dsh-api/session/prompt','POST',{sessionId:sid,content:[{type:'text',text:'开始'}]});
  const runId=f.sessions.resolve(sid).runId;
  const cfg=JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8'));
  assert.deepEqual(cfg.zcode,{effort:eff});
  assert.deepEqual(cfg.main,{effort:eff});
  // 运行中改强度：类型段跟随落盘
  const eff2=values[0];
  assert.equal((await f.call(`/api/runs/${runId}/models`,'PATCH',{efforts:{zcode:eff2}})).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.runs.dir(runId),'runtime-config.json'),'utf8')).zcode.effort,eff2);
  // 换主代理类型：efforts.main 一并清空，回退类型默认
  assert.equal((await f.call(`/api/runs/${runId}/main`,'PATCH',{main:'claude'})).status,200);
  assert.equal(f.runs.detail(runId).settings.efforts.main,undefined);
  // 不在该模型注册表档位里的取值被拒；其它类型暂不支持单独选强度（草稿会话上验证 HTTP 层）
  const sid2=(await f.call('/dsh-api/session/create','POST',{})).data.value.sessionId;
  assert.equal((await f.call(`/api/sessions/${sid2}/settings`,'PATCH',{efforts:{zcode:'bogus-level'}})).status,400);
  assert.equal((await f.call(`/api/sessions/${sid2}/settings`,'PATCH',{efforts:{claude:'high'}})).status,400);
  assert.throws(()=>validateEfforts({claude:'high'},{},'claude'),/暂不支持/);
  assert.throws(()=>validateEfforts({zcode:'bogus-level'},{},'zcode'),/不支持思考强度/);
});
test('cross-process task-board updates do not overwrite each other',async t=>{
  const f=fixture(t),file=path.join(f.root,'board.json'),module=new URL('../lib/store.mjs',import.meta.url).href;
  const children=Array.from({length:4},()=>new Promise((resolve,reject)=>{
    const code=`import {mutate} from ${JSON.stringify(module)};for(let i=0;i<30;i++)mutate(${JSON.stringify(file)},b=>{b.seq.msg++;b.messages.push({id:b.seq.msg});});`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true});let stderr='';child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',c=>c===0?resolve():reject(new Error(stderr)));
  }));
  await Promise.all(children);assert.equal(read(file).messages.length,120);assert.equal(new Set(read(file).messages.map(m=>m.id)).size,120);
});
test('routes, validation, and interruption reporting',async t=>{
  const f=await httpFixture(t);
  for(const url of ['/','/console/','/board','/router-ui.css','/router-integration.js','/board-embed.js'])assert.equal((await fetch(f.base+url)).status,200);
  assert.equal((await fetch(f.base+'/chat')).status,404);
  assert.equal((await f.call('/api/events')).status,400);
  assert.equal((await f.call('/api/runs','POST',{goal:'invalid',repo:f.repoA,agents:['unknown']})).status,400);
  assert.equal((await f.call('/api/runs','POST',{goal:'invalid',repo:f.repoA,main:'unknown'})).status,400);
  const a=f.runs.start({goal:'A',repo:f.repoA});
  f.runs.active.delete(a.id);assert.equal(f.runs.detail(a.id).status,'interrupted');
  clearInterval([...f.launches].length&&undefined);
});
test('dsh 前端补全端点：改名/归档/置顶、工作区文件、附件、改动审查、优雅降级', async t => {
  const f = await httpFixture(t);
  // repoA 初始化为真实 git 仓库并制造未提交改动
  const git = (...args) => execFileSync('git', ['-C', f.repoA, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  fs.writeFileSync(path.join(f.repoA, 'app.py'), 'print(1)\nprint(2)\n');
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(f.repoA, 'app.py'), 'print(1)\nprint(2 changed)\nprint(3)\n');
  fs.writeFileSync(path.join(f.repoA, 'new.txt'), 'hello\n');
  const sid = f.bridge.unary('session/create', {}).value.sessionId;
  await f.call(`/api/sessions/${sid}/settings`, 'PATCH', { repo: f.repoA, agents: ['claude'] });

  // 会话改名：结果即时生效、落 ui-state、session/list 可见
  assert.equal(f.bridge.unary('session/rename', { sessionId: sid, title: '我的会话' }).value.title, '我的会话');
  assert.equal(new UiState(f.dataDir).title(sid), '我的会话');
  assert.equal(f.bridge.unary('session/list', {}).value.items.find(i => i.sessionId === sid).title, '我的会话');

  // 归档/置顶：workspace/follow 基线反映，归档会话移出工作区
  f.bridge.unary('workspace/pinSession', { sessionId: sid });
  f.bridge.unary('workspace/archiveSession', { sessionId: sid });
  const frames = []; const stop = f.bridge.stream('workspace/follow', {}, x => frames.push(x)); t.after(stop);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(frames[0].value.pinnedSessionIds.includes(sid));
  assert.ok(frames[0].value.archivedSessionIds.includes(sid));
  assert.ok(!frames[0].value.items[0].sessionIds.includes(sid));
  f.bridge.unary('workspace/unarchiveSession', { sessionId: sid });

  // 工作区文件浏览：list/read(1 起始行号分页)/stat 与路径越界
  const list = f.bridge.unary('workspaceFiles/list', { sessionId: sid, path: '' }).value;
  assert.ok(list.entries.some(e => e.name === 'app.py' && e.type === 'file'));
  const read1 = f.bridge.unary('workspaceFiles/read', { sessionId: sid, path: 'app.py', options: { offset: 1 } }).value;
  assert.equal(read1.offset, 1); assert.equal(read1.lines, 3); assert.equal(read1.eof, true);
  assert.match(f.bridge.unary('workspaceFiles/read', { sessionId: sid, path: 'app.py', options: { offset: 2 } }).value.text, /changed/);
  const stat = f.bridge.unary('workspaceFiles/stat', { sessionId: sid, path: 'app.py' }).value;
  assert.ok(stat.bytes > 0 && stat.absolutePath.endsWith('app.py'));
  assert.throws(() => f.bridge.unary('workspaceFiles/read', { sessionId: sid, path: '../outside' }), /越界/);

  // 附件：上传 PNG → 回执 → session/attachment 取回字节；文件回执在消息里变成磁盘路径注记
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = f.bridge.unary('fileUploads/upload', { data: png.toString('base64'), name: 'dot.png' }).value;
  assert.equal(up.file.bytes, png.length);
  const att = f.bridge.unary('session/attachment', { sessionId: sid, attachmentId: up.file.attachmentId }).value;
  assert.equal(att.attachment.mediaType, 'image/png'); assert.equal(att.attachment.width, 1);
  assert.equal(Buffer.from(att.data, 'base64').length, png.length);
  const up2 = f.bridge.unary('fileUploads/upload', { data: Buffer.from('data').toString('base64'), name: 'notes.txt' }).value;
  f.bridge.unary('session/prompt', { sessionId: sid, requestId: 'rpc-1', content: [{ type: 'text', text: '看看这个文件' }, { type: 'file', receiptId: up2.receiptId }] });
  assert.equal(f.launches.length, 1);
  assert.match(f.launches[0].args[0], /notes\.txt 已保存到/);

  // 改动审查：summary 覆盖已修改与未跟踪文件；diff 区分新建（before=false）与修改
  const sum = (await f.call(`/api/changes.summary?sessionId=${sid}&seq=5`)).data;
  assert.equal(sum.turn, 5);
  assert.deepEqual(sum.files.map(x => x.path).sort(), ['app.py', 'new.txt']);
  const diff = (await f.call(`/api/changes.diff?sessionId=${sid}&seq=5&index=${sum.files.findIndex(x => x.path === 'app.py')}`)).data;
  assert.equal(diff.kind, 'text'); assert.equal(diff.before, true); assert.equal(diff.after, true);
  assert.ok(diff.hunks.length >= 1 && diff.hunks.some(h => h.lines.some(l => l.startsWith('+'))));
  const diffNew = (await f.call(`/api/changes.diff?sessionId=${sid}&seq=5&index=${sum.files.findIndex(x => x.path === 'new.txt')}`)).data;
  assert.equal(diffNew.before, false);
  assert.ok(diffNew.hunks.length >= 1 && diffNew.hunks.every(h => h.lines.every(l => l.startsWith('+'))));

  // 设置命名空间：ui-settings.developerTools 默认开启（改动卡片靠它），mutate 带 revision 递增
  const ui = f.bridge.unary('settings/describe', {}).value.namespaces.find(n => n.ns === 'ui-settings');
  assert.equal(ui.value.enabled, true);
  const after = f.bridge.unary('settings/mutate', { ns: 'ui-settings', ops: [{ op: 'set', path: ['enabled'], value: false }] }).value;
  assert.equal(after.value.enabled, false); assert.equal(after.revision, ui.revision + 1);

  // 流端点与降级：job/list 是流（rows 帧）、遥测恒关、其余端点返回空清单/无操作
  const jobFrames = []; const stopJob = f.bridge.stream('job/list', {}, x => jobFrames.push(x)); t.after(stopJob);
  assert.deepEqual(jobFrames, [{ type: 'rows', jobs: [] }]);
  const pol = []; const stopPol = f.bridge.stream('productAnalytics/watchPolicy', {}, x => pol.push(x)); t.after(stopPol);
  assert.deepEqual(pol, [false]);
  assert.equal(f.bridge.unary('session/canOpenWorkspacePath', {}).value, process.platform === 'win32');
  assert.deepEqual(f.bridge.unary('skills/list', { sessionId: sid }).value, { skills: [] });
  assert.deepEqual(f.bridge.unary('commands/list', { sessionId: sid }).value, []);
  assert.equal(f.bridge.unary('sessionFeedback/record', { sessionId: sid }).value.value.recorded, true);
  assert.deepEqual(f.bridge.unary('permissionPresets/catalog', {}).value, { options: [], defaultOptions: [], defaultPreset: '' });
});

test('dsh 合成：turn usage 只挂回合内最后一条 assistant，排队消息送达前后注记切换', async t => {
  const { synthesizeSessionEvents, toTokenUsage } = await import('./dsh-bridge.mjs');
  const usage = { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, cacheReadTokens: 800, cacheWriteTokens: 100, reasoningTokens: 50, modelRequestCount: 2 };
  const entries = [
    { seq: 1, ts: '2026-10-14T07:00:00Z', kind: 'user', data: { text: '第一问' } },
    { seq: 2, ts: '2026-10-14T07:00:10Z', kind: 'assistant', data: { text: '答一' } },
    { seq: 3, ts: '2026-10-14T07:00:20Z', kind: 'tool_use', data: { id: 'c1', name: 'bash', input: {} } },
    { seq: 4, ts: '2026-10-14T07:00:30Z', kind: 'tool_result', data: { id: 'c1', text: 'ok' } },
    { seq: 5, ts: '2026-10-14T07:00:40Z', kind: 'assistant', data: { text: '答二' } },
    { seq: 6, ts: '2026-10-14T07:00:50Z', kind: 'result', data: { text: '答二', isError: false, usage } },
    { seq: 7, ts: '2026-10-14T07:01:00Z', kind: 'user', data: { text: '插话', queued: true } }
  ];
  const events = synthesizeSessionEvents(entries);
  const msgs = events.filter(e => e.type === 'assistant/message');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].data.usage, undefined); // 同回合第二条不挂 usage：客户端按回合求和，挂两条会翻倍
  assert.deepEqual(msgs[1].data.usage, toTokenUsage(usage));
  const users = events.filter(e => e.type === 'user/message');
  assert.match(users.at(-1).data.content[0].text, /已排队/); // 其后没有 result → 仍排队
  const delivered = synthesizeSessionEvents([...entries, { seq: 8, ts: '2026-10-14T07:02:00Z', kind: 'result', data: { text: '后续', isError: false, usage } }]);
  assert.doesNotMatch(delivered.filter(e => e.type === 'user/message').at(-1).data.content[0].text, /已排队/);
  assert.equal(toTokenUsage({ inputTokens: 0, outputTokens: 0 }), undefined);
  assert.equal(toTokenUsage(null), undefined);
});

test('主动压缩：commands/list 按主代理类型门控，execute 走专用命令通道', async t => {
  const f = await httpFixture(t);
  const compactCmd = { name: 'compact', description: '主动压缩上下文：总结历史，释放上下文空间' };
  const sid = f.bridge.unary('session/create', {}).value.sessionId;
  await f.call(`/api/sessions/${sid}/settings`, 'PATCH', { repo: f.repoA, agents: ['zcode'], main: 'zcode' });
  assert.deepEqual(f.bridge.unary('commands/list', { sessionId: sid }).value, [compactCmd]);
  f.bridge.unary('session/prompt', { sessionId: sid, content: [{ type: 'text', text: '开始' }] });
  assert.equal(f.launches.length, 1);
  const pos = f.bridge.unary('commands/execute', { args: [sid, '/compact', []] });
  assert.equal(pos.value.result.kind, 'success');
  const runId = f.bridge.context(sid).runId;
  const lines = fs.readFileSync(path.join(f.dataDir, runId, 'commands.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(lines.at(-1).type, 'compact'); // 专用通道，不与文本队列混合
  // 非 zcode 主代理拒绝；未知命令返回 undefined（交给客户端按普通输入处理）
  const sid2 = f.bridge.unary('session/create', {}).value.sessionId;
  await f.call(`/api/sessions/${sid2}/settings`, 'PATCH', { repo: f.repoA, agents: ['claude'] });
  assert.deepEqual(f.bridge.unary('commands/list', { sessionId: sid2 }).value, []);
  assert.equal(f.bridge.unary('commands/execute', { args: [sid2, '/compact', []] }).value.result.kind, 'error');
  assert.equal(f.bridge.unary('commands/execute', { args: [sid2, '/hello', []] }).value, undefined);
});

test('用量投影：tokenUsage 累计四桶，contextPressure 取末回合输入侧', async t => {
  const f = await httpFixture(t);
  const sid = f.bridge.unary('session/create', {}).value.sessionId;
  await f.call(`/api/sessions/${sid}/settings`, 'PATCH', { repo: f.repoA, agents: ['zcode'], main: 'zcode' });
  f.bridge.unary('session/prompt', { sessionId: sid, content: [{ type: 'text', text: '开始' }] });
  const runId = f.bridge.context(sid).runId;
  fs.mkdirSync(path.join(f.dataDir, runId, 'threads'), { recursive: true }); // 假启动没有 Router 落线程目录
  const thread = path.join(f.dataDir, runId, 'threads', 'manager.jsonl');
  fs.appendFileSync(thread, JSON.stringify({ seq: 1, ts: new Date().toISOString(), kind: 'user', data: { text: '第一问' } }) + '\n');
  fs.appendFileSync(thread, JSON.stringify({ seq: 2, ts: new Date().toISOString(), kind: 'result', data: { text: '答', isError: false, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 100 } } }) + '\n');
  const values = f.bridge.unary('session/projections', { sessionId: sid }).value.values;
  assert.deepEqual(values.tokenUsage, { uncachedInputTokens: 500, outputTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 100 });
  assert.equal(values.contextPressure.pressureTokens, 1000);
});
