/* 已发送消息的编辑草稿与回应；不复用发送框，也不自动重放失败的编辑。 */
(function(){
  'use strict';
  const choices=[['❤️','爱心'],['👍','赞'],['😂','笑哭'],['😮','惊讶'],['😢','难过'],['🙏','感谢']];
  const store=DmOutboxStore.create(globalThis.indexedDB),writes=new Map(),reacting=new Set(),editing=new Set(),saved=new Set();
  const scope=()=>JSON.stringify([API.base,API.epoch,ME]);
  const same=s=>s===scope()&&liveUser();
  const draftScope=()=> 'dm-edit|'+JSON.stringify([API.base,ME]);
  const find=(uid,id)=>(CHATS[uid]||[]).find(m=>m.id===id&&!m.pend);
  const editable=m=>m?.me&&m.t==='text'&&!m.rc&&m.canEdit===true&&Date.now()<+new Date(m.editUntil);
  let panel=null;
  function merge(uid,row){dmMerge(uid,[row]);LDM.sig[uid]=null;if(CUR.key==='msg|'+uid)dmPaint(uid);}
  function save(p){
    const row={key:p.key,scope:p.draftScope,id:p.id,uid:p.uid,text:p.text,version:p.version,clientEditId:p.clientEditId,unknown:p.unknown};
    const previous=writes.get(p.key)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>store.put(row)).then(()=>{saved.add(p.key);});writes.set(p.key,next);
    next.catch(e=>{if(panel===p&&p.host?.isConnected)status(p,e.message||'编辑草稿未保存，请检查本机存储后重试');});
    return next;
  }
  function status(p,text){const el=p.host?.querySelector('[data-edit-status]');if(el)el.textContent=text;}
  function paint(p){
    if(!same(p.scope)||panel!==p)return;
    const m=find(p.uid,p.id),expired=!editable(m),locked=p.unknown||expired;
    sheet(`<h3>编辑消息</h3><div class="dm-edit-panel"><p class="comm-editor-note">发送后15分钟内可修改文字，对方会看到“已编辑”。聊天输入框的草稿会保留。</p>${p.conflict?`<details class="dm-edit-current"><summary>查看另一台设备的当前消息</summary><p>${esc(m?.text||'消息已不可访问')}</p></details>`:''}<label class="ad-lab" for="dmEditBody">修改后的内容</label><textarea class="inp" id="dmEditBody" rows="5" maxlength="4000"${locked?' readonly':''}>${esc(p.text)}</textarea><p class="comm-editor-note" data-edit-status role="status">${esc(p.error||(expired?'编辑时间已过或消息不可编辑；可选中文字复制。':p.unknown?'上次保存结果待确认，请先使用原提交键重试确认。':'编辑草稿仅保存在此设备。'))}</p><div class="comm-actions">${p.conflict&&!expired?'<button class="pill lg" data-act="dm-edit-rebase">按当前版本重新提交</button>':!expired||p.unknown?`<button class="pill lg" data-act="dm-edit-save">${p.unknown?'确认上次保存结果':'保存修改'}</button>`:''}<button class="pill lt lg" data-act="dm-edit-discard">放弃编辑草稿</button></div></div>`,host=>{
      p.host=host;
      const input=host.querySelector('#dmEditBody');
      input.addEventListener('input',()=>{if(p.unknown||p.sending)return;p.text=input.value;p.clientEditId=crypto.randomUUID();p.error='';void save(p);});
      return()=>{if(panel===p)panel=null;};
    });
    // sheet() 会先清理旧面板；新面板仍属于同一份草稿。
    panel=p;
  }
  async function open(uid,id,anchor){
    const s=scope(),m=find(uid,id);if(!dmLive(uid)||m&&(!m.me||m.t!=='text'))return;if(editing.has(s+'|'+id)){toast('这条消息正在保存，稍后可恢复编辑草稿');return;}
    const ds=draftScope(),key=ds+'|'+id;
    let old;
    try{old=(await store.list(ds)).find(r=>r.key===key);}catch(e){if(same(s))toast(e.message||'未能恢复本机编辑草稿','orange');return;}
    if(!same(s)||CUR.key!=='msg|'+uid||anchor?.isConnected===false)return;
    const now=find(uid,id);if(!old&&!editable(now)){toast('这条消息已不可编辑','orange');return;}
    const p={key,draftScope:ds,scope:s,uid,id,text:old?.text??now.text,version:old?.version??now.editVersion,clientEditId:old?.clientEditId||crypto.randomUUID(),unknown:!!old?.unknown,conflict:!!old&&!old.unknown&&!!now&&old.version!==now.editVersion,error:'',sending:false};
    panel=p;paint(p);
  }
  async function refresh(p){
    const r=await API.req('GET',`/dm/messages/${encodeURIComponent(p.id)}/context`);
    if(!same(p.scope))return;
    dmMerge(p.uid,r.items);LDM.sig[p.uid]=null;if(CUR.key==='msg|'+p.uid)dmPaint(p.uid);
  }
  async function submit(rebase=false){
    const p=panel;if(!p||p.sending||!same(p.scope)||editing.has(p.scope+'|'+p.id))return;
    if(rebase){const m=find(p.uid,p.id);if(!editable(m)){p.error='消息已不可编辑；草稿仍保留。';paint(p);return;}p.version=m.editVersion;p.clientEditId=crypto.randomUUID();p.conflict=false;}
    if(!p.text.trim()){status(p,'写点内容再保存');return;}
    p.sending=true;editing.add(p.scope+'|'+p.id);const host=p.host;host?.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);status(p,'正在保存修改…');
    try{
      // 请求前先持久化原键和原版本；网络超时后禁止把不确定的提交改成另一份内容。
      p.unknown=true;await save(p);
      const row=await API.req('PATCH',`/dm/messages/${encodeURIComponent(p.id)}`,{body:p.text,version:p.version,clientEditId:p.clientEditId});
      if(!same(p.scope))return;
      merge(p.uid,row);await (writes.get(p.key)||Promise.resolve()).catch(()=>{});await store.remove(p.key);saved.delete(p.key);writes.delete(p.key);
      if(panel===p&&host?.isConnected){closeSheet();toast(row.recalled?'消息已撤回，原编辑结果已确认':'消息已更新');}
    }catch(e){
      if(!same(p.scope))return;
      if(e.status&&e.status<500){p.unknown=false;p.conflict=e.status===409;}
      p.error=p.conflict?'另一台设备已修改这条消息。你的草稿保留在下方；核对当前内容后，可按当前版本重新提交。':e.message||'保存未确认，草稿已保留';
      if(p.conflict)try{await refresh(p);}catch{}
      await save(p).catch(()=>{});
      if(panel===p&&host?.isConnected)paint(p);
    }finally{p.sending=false;editing.delete(p.scope+'|'+p.id);}
  }
  ACTIONS['dm-message-edit']=b=>open(b.dataset.uid,b.dataset.id,b);
  ACTIONS['dm-edit-drafts']=async b=>{
    const s=scope(),uid=b.dataset.id;try{const rows=(await store.list(draftScope())).filter(r=>r.uid===uid);if(!same(s)||b.isConnected===false)return;
      sheet(`<h3>本机编辑草稿</h3><p class="comm-editor-note">仅保存在此设备；聊天记录清空或编辑时间已过后，仍可恢复文字或放弃草稿。</p>${rows.map(r=>`<button class="dm-local-edit" data-act="dm-message-edit" data-uid="${esc(uid)}" data-id="${esc(r.id)}"><b>${r.unknown?'保存结果待确认':'未保存的修改'}</b><span>${esc(Array.from(r.text||'').slice(0,180).join(''))}</span></button>`).join('')||'<p class="comm-editor-note">没有待处理的编辑草稿。</p>'}`);
    }catch(e){if(same(s))apiFail(e);}
  };
  ACTIONS['dm-edit-save']=()=>submit();ACTIONS['dm-edit-rebase']=()=>submit(true);
  ACTIONS['dm-edit-discard']=async()=>{const p=panel;if(!p||p.sending)return;try{await (writes.get(p.key)||Promise.resolve()).catch(()=>{});await store.remove(p.key);saved.delete(p.key);writes.delete(p.key);if(panel===p&&same(p.scope))closeSheet();}catch(e){if(panel===p)status(p,e.message||'未能移除草稿，请重试');}};
  ACTIONS['dm-react']=async b=>{
    const uid=b.dataset.uid,id=b.dataset.id,s=scope(),key=s+'|'+id,m=find(uid,id),emoji=b.dataset.emoji;
    if(!dmLive(uid)||!m?.canReact||m.rc||reacting.has(key)||!choices.some(c=>c[0]===emoji))return;
    const mine=m.reactions?.some(r=>r.mine&&r.emoji===emoji);reacting.add(key);
    const host=b.closest('.sheet');host?.querySelectorAll('[data-act="dm-react"]').forEach(el=>el.disabled=true);
    b.setAttribute('aria-busy','true');
    try{const row=await API.req(mine?'DELETE':'PUT',`/dm/messages/${encodeURIComponent(id)}/reaction`,mine?undefined:{emoji});if(!same(s))return;merge(uid,row);if(host?.isConnected)closeSheet();}
    catch(e){if(same(s)){apiFail(e);if(host?.isConnected)host.querySelectorAll('[data-act="dm-react"]').forEach(el=>el.disabled=false);}}
    finally{reacting.delete(key);b.removeAttribute('aria-busy');}
  };
  globalThis.CZDmExpressions={
    async prepare(){const s=scope(),ds=draftScope();try{const rows=await store.list(ds);if(same(s)){for(const key of saved)if(key.startsWith(ds+'|'))saved.delete(key);rows.forEach(r=>saved.add(r.key));}}catch{}return same(s);},
    menu(m,uid){return `${editable(m)||saved.has(draftScope()+'|'+m.id)?`<button class="pill lt lg" data-act="dm-message-edit" data-uid="${esc(uid)}" data-id="${esc(m.id)}">${editable(m)?'编辑消息':'恢复编辑草稿'}</button>`:''}${m.canReact?`<fieldset class="dm-reaction-picker"><legend>回应这条消息</legend><div>${choices.map(([emoji,label])=>`<button data-act="dm-react" data-uid="${esc(uid)}" data-id="${esc(m.id)}" data-emoji="${emoji}" aria-label="${label}" aria-pressed="${!!m.reactions?.some(r=>r.mine&&r.emoji===emoji)}">${emoji}</button>`).join('')}</div><p>再点已选的表情可取消；每人保留一个回应。</p></fieldset>`:''}`;},
    chips(m,uid){return !m.rc&&m.reactions?.length?`<div class="dm-reactions" aria-label="消息回应">${m.reactions.filter(r=>choices.some(c=>c[0]===r.emoji)&&Number.isInteger(r.count)&&r.count>0&&r.count<=2).map(r=>`<button data-act="dm-react" data-uid="${esc(uid)}" data-id="${esc(m.id)}" data-emoji="${r.emoji}" aria-label="${choices.find(c=>c[0]===r.emoji)[1]}，${r.count}人${r.mine?'，你已回应':''}" aria-pressed="${!!r.mine}"${m.canReact?'':' disabled'}>${r.emoji}<span>${r.count}</span></button>`).join('')}</div>`:'';}
  };
})();
