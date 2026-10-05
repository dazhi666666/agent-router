import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createApp } from './server.mjs';
import { Sessions, threadSessionId, writeJson } from './sessions.mjs';
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
  assert.throws(()=>f.runs.start({goal:'collision',repo:f.repoA}),/重叠/);
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
  assert.throws(()=>f.bridge.unary('session/prompt',{sessionId:idA,content:[{type:'text',text:'wrong'}]}),/已结束/);
  assert.throws(()=>f.bridge.unary('session/cancel',{sessionId:idA}),/只有/);
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
  const config=path.join(f.root,'config.json');writeJson(config,{claude:{model:'isolated-model'}});
  const original=loadConfig().claude.model;process.env.AGENT_ROUTER_RUN_CONFIG=config;
  assert.equal(loadConfig().claude.model,'isolated-model');delete process.env.AGENT_ROUTER_RUN_CONFIG;assert.equal(loadConfig().claude.model,original);
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
  assert.equal((await f.call('/api/runs','POST',{goal:'invalid',repo:f.repoA,timeout:1})).status,400);
  const a=f.runs.start({goal:'A',repo:f.repoA});
  f.runs.active.delete(a.id);assert.equal(f.runs.detail(a.id).status,'interrupted');
  clearInterval([...f.launches].length&&undefined);
});
