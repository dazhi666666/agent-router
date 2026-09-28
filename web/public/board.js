'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params = new URLSearchParams(location.search), embedded = params.get('embedded') === '1';
document.body.classList.toggle('embedded', embedded);
let runId = params.get('runId'), data, abort, generation = 0, es, visible = true, signature = '', timer, dialogOpener, logAbort;
const pending = new Set(), openTasks = new Set();
const labels = {pending:'待执行',in_progress:'执行中',done:'已完成',failed:'失败'};
async function request(url, opts = {}) { const r = await fetch(url, { ...opts, headers:{'Content-Type':'application/json',...opts.headers} }); const d = await r.json(); if (!r.ok || d.ok === false) throw new Error(d.error || '请求失败'); return d; }
function error(text) { $('#error').textContent = text; }
const empty = (title, detail) => `<div class="empty-state"><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
function render() {
  const tasks = data?.board?.tasks || [], messages = data?.board?.messages || [], live = data?.status === 'running';
  $('#goal').textContent = data?.goal || (runId ? '历史运行 · 目标未记录' : '尚未启动运行');
  $('#run-meta').textContent = data ? `${data.settings?.repo || '工作目录未记录'} · ${data.settings?.agents?.join(' / ') || '成员配置未记录'}` : '配置工作目录后，在主代理聊天中发送目标。';
  $('#metrics').innerHTML = [['全部任务',tasks.length],['执行中',tasks.filter(t=>t.status==='in_progress').length],['已完成',tasks.filter(t=>t.status==='done').length],['失败',tasks.filter(t=>t.status==='failed').length]].map(([label,n])=>`<div class="metric"><b>${n}</b><span>${label}</span></div>`).join('');
  $('#t-count').textContent = tasks.length; $('#m-count').textContent = messages.length;
  const finish = data?.board?.finished;
  $('#finish-banner').hidden = !finish; $('#finish-banner').textContent = finish ? `运行总结\n${finish.summary}` : '';
  const agents = [...new Set(['manager',...(data?.settings?.agents || []),...tasks.map(t=>t.assignee)])];
  for (const [selector, all] of [['#filter-agent',true],['#recipient',false]]) {
    const select=$(selector), before=select.value;
    const html=(all?'<option value="">全部成员</option>':'')+agents.map(a=>`<option value="${esc(a)}">${esc(a==='manager'?'manager · 主代理':a)}</option>`).join('');
    if (select.innerHTML !== html) { select.innerHTML=html; if([...select.options].some(o=>o.value===before))select.value=before; }
  }
  const subset=tasks.filter(t=>(!$('#filter-status').value||t.status===$('#filter-status').value)&&(!$('#filter-agent').value||t.assignee===$('#filter-agent').value));
  const order={in_progress:0,failed:1,pending:2,done:3}; subset.sort((a,b)=>(order[a.status]??4)-(order[b.status]??4));
  const next=JSON.stringify([subset,live,[...pending]]);
  if(next!==signature){
    signature=next;
    $('#tasks').innerHTML=subset.map(t=>`<details class="task-card ${esc(t.status)}" data-task="${esc(t.id)}" ${openTasks.has(t.id)?'open':''}><summary><span class="task-marker">${{pending:'○',in_progress:'↻',done:'✓',failed:'!'}[t.status]||'○'}</span><div class="task-title"><strong>${esc(t.title)}</strong><small>${esc(t.id)} · ${esc(t.assignee)}${t.blocked_by?.length?' · 依赖 '+esc(t.blocked_by.join(', ')):''}${t.isolated?' · 隔离执行':''}</small></div><span class="task-badge">${labels[t.status]||esc(t.status)}</span></summary><div class="task-details"><h3>任务说明</h3><p>${esc(t.spec||'未填写')}</p><h3>结果</h3><p>${esc(t.result||'尚无结果')}</p>${t.artifacts?.length?`<h3>产物</h3><ul>${t.artifacts.map(a=>`<li>${esc(typeof a==='string'?a:JSON.stringify(a))}</li>`).join('')}</ul>`:''}${t.worktree?`<h3>现场路径</h3><p>${esc(t.worktree)}\n${esc(t.branch||'')}</p>`:''}${t.started_at?`<h3>开始时间</h3><p>${esc(new Date(t.started_at).toLocaleString('zh-CN'))}</p>`:''}${t.continuations?`<h3>续派</h3><p>已继续 ${t.continuations} 次</p>`:''}<div class="task-actions"><button data-log="${esc(t.id+'-'+t.assignee+'.jsonl')}">查看会话</button><button data-to="${esc(t.assignee)}" ${!live?'disabled':''}>发消息</button>${live&&t.status==='in_progress'?`<button class="danger" data-action="cancel" ${pending.has(t.id)?'disabled':''}>${pending.has(t.id)?'请求已排队':'取消任务'}</button>`:''}${live&&t.status==='failed'?`<button data-action="retry" ${pending.has(t.id)?'disabled':''}>${pending.has(t.id)?'请求已排队':'重试任务'}</button>`:''}</div></div></details>`).join('')||empty(runId?'暂无匹配任务':'等待你的第一个目标',runId?'任务会在主代理分派后出现在这里。':'启动后，这里将展示成员分工与执行结果。');
    $('#tasks').querySelectorAll('details').forEach(el=>el.addEventListener('toggle',()=>{if(el.open)openTasks.add(el.dataset.task);else openTasks.delete(el.dataset.task);}));
  }
  const mailbox=messages.slice().reverse().map(m=>`<article class="mail-card"><div class="mail-head"><strong>${esc(m.from)}</strong><span>→</span><strong>${esc(m.to)}</strong>${m.task_id?`<span>${esc(m.task_id)}</span>`:''}<time>${esc(new Date(m.ts).toLocaleString('zh-CN',{hour12:false}))}</time></div><p>${esc(m.content)}</p><small>${m.read?'已读取':'已写入信箱 · 等待读取'}</small></article>`).join('')||empty('信箱暂时没有消息','成员之间的协作消息与用户指示会显示在这里。');
  if($('#mail').innerHTML!==mailbox)$('#mail').innerHTML=mailbox;
  $('#message').disabled=!live; $('#recipient').disabled=!live; $('#send').disabled=!live||pending.has('message');
}
function tab(name){for(const key of ['tasks','mail']){$('#tab-'+key).setAttribute('aria-selected',String(key===name));$('#'+key+'-panel').hidden=key!==name;}}
$('#tab-tasks').onclick=()=>tab('tasks');$('#tab-mail').onclick=()=>tab('mail');
$('.board-tabs').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const name=$('#tab-tasks').getAttribute('aria-selected')==='true'?'mail':'tasks';tab(name);$('#tab-'+name).focus();}});
$('#filter-status').onchange=render;$('#filter-agent').onchange=render;
async function load(){
  if(!visible||document.hidden||!runId)return;
  const token=generation,id=runId; abort?.abort();abort=new AbortController();
  try{const d=await request(`/api/runs/${encodeURIComponent(id)}`,{signal:abort.signal});if(token!==generation)return;
    for(const key of [...pending])if(key!=='message'&&data?.board?.tasks?.find(t=>t.id===key)?.status!==d.board?.tasks?.find(t=>t.id===key)?.status)pending.delete(key);
    data=d;error('');render();$('#connection').textContent=d.status==='running'?'实时同步':({finished:'运行已结束',failed:'运行失败',interrupted:'运行已中断'}[d.status]||'历史记录');
    if(d.status==='running'&&!es)connect();else if(d.status!=='running'){es?.close();es=null;}
  }catch(e){if(e.name!=='AbortError'&&token===generation){error(e.message);$('#connection').textContent='连接中断 · 正在重试';}}
}
function connect(){const id=runId,token=generation;es=new EventSource(`/api/events?runId=${encodeURIComponent(id)}`);es.onmessage=e=>{if(token!==generation)return;const m=JSON.parse(e.data);if(m.runId!==id)return;if(m.type==='snapshot'){data=m.run;render();$('#connection').textContent='实时同步';}if(m.type==='exit')load();if(m.type==='hello'&&!m.running){es?.close();es=null;load();}};es.onerror=()=>{$('#connection').textContent='连接恢复中 · 自动重试';};}
async function select(id){generation++;abort?.abort();logAbort?.abort();es?.close();es=null;runId=id||null;data=null;signature='';pending.clear();openTasks.clear();$('#log-dialog').close();$('#message').value='';$('#message-result').textContent='';render();await load();}
async function list(){if(embedded)return;try{const items=await request('/api/runs'),old=runId;$('#run-sel').innerHTML=items.map(r=>`<option value="${esc(r.id)}">${r.live?'● ':''}${esc((r.goal||r.id).slice(0,45))}</option>`).join('')||'<option value="">暂无运行</option>';if(old&&items.some(r=>r.id===old))$('#run-sel').value=old;else if(!old&&items[0])await select(items[0].id);}catch(e){error(e.message);}}
$('#run-sel').onchange=()=>select($('#run-sel').value);
$('#tasks').onclick=async e=>{
  const b=e.target.closest('button'),card=b?.closest('[data-task]');if(!b||!card)return;
  if(b.dataset.to){tab('mail');$('#recipient').value=b.dataset.to;$('#message').focus();return;}
  if(b.dataset.log){
    dialogOpener=b;$('#log-title').textContent=card.dataset.task+' · 会话日志';$('#log-content').textContent='加载中…';$('#log-dialog').showModal();
    logAbort?.abort();logAbort=new AbortController();const token=generation;
    try{const d=await request(`/api/runs/${runId}/thread/${encodeURIComponent(b.dataset.log)}`,{signal:logAbort.signal});if(token===generation)$('#log-content').textContent=d.entries.map(en=>`[${en.kind}] ${en.data?.text||en.data?.name||JSON.stringify(en.data)} `).join('\n\n')||'暂无会话记录';}catch(err){if(err.name!=='AbortError')$('#log-content').textContent=err.message;}return;
  }
  if(b.dataset.action){const id=card.dataset.task,action=b.dataset.action,target=runId,token=generation;if(pending.has(id))return;if(action==='cancel'&&!confirm('取消此任务？其他任务将继续执行。'))return;pending.add(id);render();try{await request(`/api/runs/${target}/task/${id}/${action}`,{method:'POST'});if(token===generation){error('');await load();}}catch(err){if(token===generation){pending.delete(id);error(err.message);render();}}}
};
$('#log-close').onclick=()=>$('#log-dialog').close();$('#log-dialog').addEventListener('close',()=>{logAbort?.abort();dialogOpener?.focus();});
$('#message-form').onsubmit=async e=>{e.preventDefault();const text=$('#message').value.trim(),to=$('#recipient').value,token=generation,id=runId;if(!text||pending.has('message'))return;pending.add('message');render();try{const d=await request(`/api/runs/${id}/message`,{method:'POST',body:JSON.stringify({text,to})});if(token===generation){$('#message').value='';$('#message-result').textContent=d.delivery==='mailbox'?'已写入信箱，等待读取。':'已排队发送给主代理。';await load();}}catch(err){if(token===generation)$('#message-result').textContent='发送失败：'+err.message;}finally{if(token===generation){pending.delete('message');render();}}};
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='ar:visibility')return;visible=e.data.visible===true;if(!visible){abort?.abort();es?.close();es=null;}else load();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#log-dialog').open&&embedded)parent.postMessage({type:'ar:close'},location.origin);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){es?.close();es=null;abort?.abort();}else load();});
render();list();if(runId)load();timer=setInterval(()=>{if(visible&&!document.hidden){if(!data||data.status==='running'||$('#error').textContent)load();if(!embedded)list();}},5000);
