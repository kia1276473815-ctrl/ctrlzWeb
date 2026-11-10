/* 交流扩展复用主页面的请求、草稿、弹层和增量消息；所有异步结果绑定当前账号和服务。 */
(function(){
  'use strict';
  const scope=()=>JSON.stringify([API.base,API.epoch,ME]);
  const fresh=()=>({scope:scope(),version:null,versions:null,threads:{},next:null,requests:[],requestNext:null,requestError:'',tokens:{},unread:null,lastFull:0,failures:0,running:false,context:null,pins:new Set()});
  let state=fresh();
  const drafts=DmOutboxStore.create(globalThis.indexedDB),editors=new WeakMap(),commentMentions=new Map();
  const current=()=>{if(state.scope!==scope())state=fresh();return state;};
  const allowed=()=>!LIVE.cfg?.verifiedAccessRequired || LIVE.me?.accessState==='full';
  const same=s=>scope()===s && liveUser();
  const busy=async(b,fn)=>{if(b?.disabled)return;const s=scope();if(b){b.disabled=true;b.setAttribute('aria-busy','true');}try{await fn(()=>same(s));}catch(e){if(same(s))apiFail(e);}finally{if(b?.isConnected){b.disabled=false;b.removeAttribute('aria-busy');}}};
  function absorb(uid,value){
    if(!value)return;const s=current(),old=s.threads[uid];s.threads[uid]={...old,...value};
    if(old?.localRequest && value.state==='none' && [...DMOUT.rows.values()].some(row=>row.peer===uid && row.scope===dmScope())){s.threads[uid].localRequest=true;s.threads[uid].canSend=false;}else s.threads[uid].localRequest=false;
    if(value.clearThroughRevision>(old?.clearThroughRevision || 0)){
      CHATS[uid]=(CHATS[uid] || []).filter(m=>m.pend || m.createdRevision>value.clearThroughRevision);
      LDM.full.delete(uid);delete LDM.since[uid];delete LDM.before[uid];LDM.sig[uid]=null;CHAT_UNREAD[uid]=0;
    }
    if(CUR.key==='msg|'+uid)controls();
  }
  async function requests(){const s=current(),key=s.scope,r=await API.req('GET','/dm/requests?limit=50');if(!same(key))return;s.requests=r.items;s.requestNext=r.next;s.requestError='';r.items.forEach(t=>{apiUser(t.peer);absorb(t.peer.id,t.conversation);});}
  function incomingRequest(uid){const c=current().threads[uid];return c?.state==='pending' && c.requestedBy!==ME || c?.state==='rejected' && c.requestedBy!==ME;}
  function controls(){
    if(!liveUser())return;const uid=CUR.key?.startsWith('msg|') ? CUR.key.slice(4):'',s=current();
    if(uid && $('#cvB')){
      const c=s.threads[uid],host=$('.cv-h')?.parentElement;
      if(host && c){let note=host.querySelector('.comm-admission');if(!note){note=document.createElement('div');note.className='comm-admission';host.querySelector('.cv-h')?.after(note);}
        const pending=c.state==='pending' || c.state==='rejected';
        const html=pending ? `<span>${c.state==='rejected' ? '这条消息请求已被拒绝' : c.requestedBy===ME ? '请求已发送，等待对方接受' : '对方希望与你开始聊天；接受后才能继续沟通'}</span>${c.canAccept ? `<button class="pill sm" data-act="comm-accept" data-id="${esc(uid)}">${c.state==='rejected' ? '恢复聊天':'接受'}</button>${c.state==='pending' ? `<button class="pill sm lt" data-act="comm-reject" data-id="${esc(uid)}">拒绝</button>`:''}`:''}` : c.state==='none' && !c.canSendMedia ? '<span>可以先发送一条文字请求；对方接受后可发图片和分享。</span>':'';
        if(note.innerHTML!==html)note.innerHTML=html;note.hidden=!html;
        const send=$('[data-act="cv-send"]');if(send)send.disabled=!c.canSend;
        const file=$('#cvImg');if(file)file.disabled=!c.canSendMedia;
        const pick=$('[data-act="cv-pick"]');if(pick){pick.disabled=!c.canSendMedia;pick.title=c.canSendMedia ? '分享作品或商品':'对方接受请求后可以分享';}
      }
      const hostContext=$('.cv-h')?.parentElement;hostContext?.querySelector('.comm-context')?.remove();
      if(hostContext && s.context?.uid===uid){const bar=document.createElement('div');bar.className='comm-admission comm-context';bar.innerHTML=`<span>正在查看历史消息，新消息保持未读。</span>${s.context.after ? `<button class="pill sm lt" data-act="comm-context-next" data-id="${esc(s.context.after)}">后续消息</button>`:''}<button class="pill sm" data-act="comm-latest" data-id="${esc(uid)}">返回最新</button>`;hostContext.querySelector('.cv-h')?.after(bar);}
    }
    for(const input of [$('#cmtIn'),$('#rlIn')]){
      if(!input)continue;const pid=input.id==='rlIn' ? reelCur()?.id:CUR.post,p=POST(pid);attachEditor(input);
      const send=input.parentElement?.querySelector('[data-act="cmt"],[data-act="rl-send"]');
      if(send && p?.live){send.disabled=!!p.commentsClosed;send.title=p.commentsClosed ? '作者已关闭评论，草稿会保留':'';}
    }
    attachEditor($('#cBody'));attachEditor($('#peB'));
    const pid=CUR.post || (RL.on ? reelCur()?.id:null),p=POST(pid);
    if(p?.live){
      if(p.pinnedCommentId && !cmtsOf(pid).some(c=>c.id===p.pinnedCommentId) && !s.pins.has(pid+'|'+p.pinnedCommentId)){s.pins.add(pid+'|'+p.pinnedCommentId);void cmtForNotice(pid,p.pinnedCommentId).catch(()=>{});}
      const list=$('#post .comments') || $('#post .cmts') || $('#post .cmt-list') || $('#post .cmt')?.parentElement || $('#rlCm .cmt')?.parentElement;
      const anchor=list || $('#post .foot');
      if(anchor && !anchor.querySelector(`[data-comm-discussion="${CSS.escape(pid)}"]`)){
        const bar=document.createElement('div');bar.className='comm-discussion';bar.dataset.commDiscussion=pid;
        bar.innerHTML=`${p.commentsClosed ? '<span class="mut">评论已关闭</span>':''}${p.author===ME ? `<button class="pill sm lt" data-act="comm-close-comments" data-id="${esc(pid)}">${p.commentsClosed ? '重开评论':'关闭评论'}</button>`:''}`;
        anchor.prepend(bar);
      }
      for(const row of document.querySelectorAll('[data-cmt-id]')){
        const id=row.dataset.cmtId;if(!id)continue;row.classList.toggle('comm-pinned',id===p.pinnedCommentId);
        if(id===p.pinnedCommentId && !row.querySelector('.comm-pin-label')){const label=document.createElement('span');label.className='tag k comm-pin-label';label.textContent='作者置顶';row.querySelector('.h')?.append(label);}
        if(p.author===ME && !row.querySelector('[data-act="comm-pin-comment"]')){const c=cmtsOf(pid).find(c=>c.id===id);if(c && !c.review && !c.sendState){const b=document.createElement('button');b.dataset.act='comm-pin-comment';b.dataset.id=pid;b.dataset.cid=id;b.textContent=id===p.pinnedCommentId ? '取消置顶':'置顶';row.querySelector('.ctl')?.append(b);}}
      }
    }
  }
  function schedule(ms){clearTimeout(LDM.timer);clearInterval(LDM.timer);LDM.timer=0;if(!document.hidden && allowed() && liveUser() && API.on() && API.tok)LDM.timer=setTimeout(()=>void poll(),ms);}
  async function poll(){
    const s=current();if(s.running || !allowed() || document.hidden || !liveUser() || !API.on() || !API.tok)return;s.running=true;
    let wait=30000;
    try{
      const force=Date.now()-s.lastFull>=30000,previous=s.versions;
      const r=await API.req('GET','/me/communication/sync'+(s.version && !force ? '?since='+encodeURIComponent(s.version):''));if(!same(s.scope))return;
      for(const setting of r.settings || [])absorb(setting.peerId,setting);
      const open=CUR.key?.startsWith('msg|') ? CUR.key.slice(4):'',dmChanged=!previous || previous.dm!==r.versions.dm;
      if(dmChanged || force){await dmThreads();if(!same(s.scope))return;await requests();if(!same(s.scope))return;}
      if(open && s.context?.uid!==open && (dmChanged || !LDM.full.has(open)))await dmConv(open);
      if(!same(s.scope))return;
      if(!previous || previous.activity!==r.versions.activity || force){const loaded=await actLoad(true);if(!same(s.scope))return;if(loaded===false)throw Error('互动通知暂未同步完成');}
      if(!previous || previous.official!==r.versions.official || force){const loaded=await sysLoad(true);if(!same(s.scope))return;if(loaded===false)throw Error('官方通知暂未同步完成');}
      if(!same(s.scope))return;s.version=r.version;s.versions=r.versions;if(r.unread)s.unread=r.unread;if(force)s.lastFull=Date.now();s.failures=0;
      if(s.unread)LDM.unread=s.unread.dm;msgBadge();if(CUR.key?.startsWith('msg|'))dmPaint(open);controls();
      wait=open ? 4000:CUR.key?.startsWith('msg|') ? 10000:30000;
    }catch(e){if(same(s.scope)){s.failures++;wait=Math.min(60000,4000*2**Math.min(s.failures,4));if(CUR.key?.startsWith('msg|') && !s.versions){LDM.listState='error';dmPaint(CUR.key.slice(4));}}}
    finally{s.running=false;if(same(s.scope))schedule(Math.round(wait*(.95+Math.random()*.1)));}
  }
  async function start(){if(!allowed())return;clearInterval(LDM.timer);clearTimeout(LDM.timer);LDM.timer=0;await restoreComments();await poll();}
  const comm=globalThis.CZCommunication={get threads(){return current().threads;},contextFor(uid){return current().context?.uid===uid;},incomingRequest,absorb,controls,poll,start,
    threadPage(r,cursor){const s=current();s.next=r.next;if(!cursor && !r.next){const ids=new Set(r.items.map(t=>t.peer.id));for(const uid of Object.keys(s.threads))if(!ids.has(uid) && !incomingRequest(uid) && CUR.key!=='msg|'+uid && !CHATS[uid]?.some(m=>m.pend)){delete CHATS[uid];delete CHAT_UNREAD[uid];}}},
    activityToken(k,t){if(t)current().tokens[k]=t;},officialToken(t){if(t)current().tokens.official=t;},
    async saveComment(pid,c){try{const row={key:'comment|'+JSON.stringify([API.base,ME,c._client]),scope:'comment|'+JSON.stringify([API.base,ME]),pid,comment:{...c,sendState:'failed',_counted:false}};await drafts.put(row);return true;}catch(e){c.sendState='failed';c.sendError=e.message || '本机草稿未保存，请检查存储空间';cmtPaint(pid);return false;}},
    async forgetComment(c){if(c._client)await drafts.remove('comment|'+JSON.stringify([API.base,ME,c._client])).catch(()=>{});},
    ackComment(raw){if(!raw.clientCommentId || !raw.postId)return;const list=UI.newCmts[raw.postId] || [];for(let i=list.length-1;i>=0;i--){const c=list[i];if(c._client===raw.clientCommentId){c._acknowledged=true;void comm.forgetComment(c);list.splice(i,1);}}},
    claimCommentMentions(pid,c){const pending=commentMentions.get(pid);if(pending && pending.text===c.t){c.mentions=pending.mentions;commentMentions.delete(pid);}},
    mentionText,postMentions,searchRows,
  };
  async function restoreComments(){const s=scope();try{const rows=await drafts.list('comment|'+JSON.stringify([API.base,ME]));if(!same(s))return;for(const row of rows){const list=UI.newCmts[row.pid] ||= [];if(!list.some(c=>c._client===row.comment._client || c.clientCommentId===row.comment._client))list.push({...row.comment,sendState:'failed',sendError:row.comment._unknown ? '发送结果待确认，重试会使用原提交键':'未发送，草稿已从本机恢复',_counted:false});}}catch(e){if(same(s))toast('未能恢复本机评论草稿，可检查浏览器存储后重试','orange');}}
  dmPoll=poll;dmStart=()=>{void start();};
  const reset=dmReset;dmReset=function(){reset();state=fresh();};API.sessionReset=dmReset;
  const oldPaint=dmPaint;dmPaint=function(uid){oldPaint(uid);controls();};
  let enhanceQueued=false;
  const enhance=()=>{if(enhanceQueued)return;enhanceQueued=true;queueMicrotask(()=>{enhanceQueued=false;controls();});};
  const oldRenderPost=renderPost;renderPost=function(...args){const result=oldRenderPost(...args);enhance();return result;};
  const oldCommentPaint=cmtPaint;cmtPaint=function(...args){const result=oldCommentPaint(...args);enhance();return result;};
  const oldReelComments=openReelCm;openReelCm=function(...args){const result=oldReelComments(...args);enhance();return result;};
  const oldList=msgList;msgList=function(uid){const s=current(),html=oldList(uid);if(!liveUser())return html;return html.replace('<div class="m-list">',`<div class="comm-list-actions"><button class="pill sm lt" data-act="comm-requests">消息请求${s.unread?.requests ? ' · '+s.unread.requests:''}</button><button class="pill sm lt" data-act="comm-search">搜索聊天记录</button></div><div class="m-list">`)+(s.next ? '<button class="pill sm lt comm-more" data-act="comm-threads-more">加载更多会话</button>':'');};
  const oldBubble=bubble;bubble=function(m,uid){const html=oldBubble(m,uid);if(!dmLive(uid) || m.me || !m.id || m.pend || m.rc)return html;return html.replace(/<\/div>$/,`<button class="comm-report" data-act="report" data-k="message" data-id="${esc(m.id)}" aria-label="举报这条消息">举报</button></div>`);};
  const oldSend=sendMsg;sendMsg=async function(uid,message){
    if(!dmLive(uid))return oldSend(uid,message);const key=scope();let c=current().threads[uid];if(!c){await dmConv(uid);if(!same(key))return false;c=current().threads[uid];}
    if(!c?.canSend || message.t!=='text' && !c.canSendMedia){toast(c?.state==='pending' || c?.localRequest ? '等待首条请求确认或对方接受后再发送':c?.state==='rejected' ? '对方暂不接收消息':'先发送一条文字请求','orange');return false;}
    const firstRequest=c.state==='none' && !c.canSendMedia;
    if(firstRequest){c.localRequest=true;c.canSend=false;controls();}
    try{const result=await oldSend(uid,message);if(!result && firstRequest){c.localRequest=false;c.canSend=true;controls();}if(result){current().version=null;void poll();}return result;}
    catch(e){if(firstRequest){c.localRequest=false;c.canSend=true;controls();}throw e;}
  };
  const oldRemove=ACTIONS['dm-remove'];ACTIONS['dm-remove']=async b=>{await oldRemove(b);for(const [uid,c] of Object.entries(current().threads))if(c.localRequest && ![...DMOUT.rows.values()].some(row=>row.peer===uid && row.scope===dmScope())){c.localRequest=false;if(c.state==='none')c.canSend=true;}controls();};
  for(const action of ['accept','reject'])ACTIONS['comm-'+action]=b=>busy(b,async ok=>{const uid=b.dataset.id,r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/request/${action}`);if(!ok())return;absorb(uid,r);current().version=null;await poll();if($('#layer .comm-requests'))closeSheet();if(CUR.key==='msg|'+uid)rerender();toast(action==='accept' ? '已接受，可以开始聊天':'已拒绝这条请求');});
  ACTIONS['comm-threads-more']=b=>busy(b,async()=>{if(current().next)await dmThreads(current().next);dmPaint('');});
  ACTIONS['comm-requests']=b=>busy(b,async ok=>{await requests();if(!ok())return;drawRequests();});
  function drawRequests(){const s=current();sheet(`<h3>消息请求</h3><p class="mut2">陌生人只可先发一条文字请求。接受后才可继续沟通。</p><div class="comm-requests">${s.requests.map(t=>`<div class="comm-request"><a data-go="msg-${esc(t.peer.id)}">${av(t.peer.id)}<b>${esc(t.peer.name)}</b></a><p>${esc(t.last.body)}</p><div class="comm-actions"><button class="pill sm" data-act="comm-accept" data-id="${esc(t.peer.id)}">接受</button><button class="pill sm lt" data-act="comm-reject" data-id="${esc(t.peer.id)}">拒绝</button><button class="pill sm lt" data-act="report" data-k="message" data-id="${esc(t.last.id)}">举报</button></div></div>`).join('') || '<p class="mut">还没有消息请求</p>'}${s.requestNext ? '<button class="pill sm lt" data-act="comm-requests-more">加载更多</button>':''}</div>`);}
  ACTIONS['comm-requests-more']=b=>busy(b,async ok=>{const s=current(),r=await API.req('GET','/dm/requests?limit=50&cursor='+encodeURIComponent(s.requestNext));if(!ok())return;r.items.forEach(t=>apiUser(t.peer));s.requests.push(...r.items);s.requestNext=r.next;drawRequests();});
  const oldMore=ACTIONS['cv-more'];ACTIONS['cv-more']=b=>{if(!dmLive(b.dataset.id))return oldMore(b);const uid=b.dataset.id,c=current().threads[uid] || {};sheet(`<h3>${esc(uname(uid))}</h3><button class="pill lt lg" data-act="comm-setting" data-id="${esc(uid)}" data-key="pinned">${c.pinned ? '取消置顶':'置顶会话'}</button><button class="pill lt lg" data-act="comm-setting" data-id="${esc(uid)}" data-key="muted">${c.muted ? '关闭免打扰':'开启免打扰'}</button><p class="mut2">免打扰保留未读计数，关闭弹出提示和系统推送。</p><button class="pill lt lg" data-act="cv-clear" data-id="${esc(uid)}">清空我的聊天记录</button><button class="pill lt lg" data-act="report" data-k="user" data-id="${esc(uid)}">举报用户</button><button class="pill lt lg" data-act="blk" data-id="${esc(uid)}">${STATE.blocks.has(uid) ? '解除拉黑':'拉黑'}</button>`);};
  ACTIONS['comm-setting']=b=>busy(b,async ok=>{const uid=b.dataset.id,key=b.dataset.key,r=await API.req('PATCH',`/dm/with/${encodeURIComponent(uid)}/settings`,{[key]:!current().threads[uid]?.[key]});if(!ok())return;absorb(uid,r);current().version=null;closeSheet();await poll();});
  const oldClear=ACTIONS['cv-cgo'];ACTIONS['cv-cgo']=b=>{if(!dmLive(b.dataset.id))return oldClear(b);return busy(b,async ok=>{const uid=b.dataset.id,r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/clear`);if(!ok())return;absorb(uid,r);current().version=null;closeSheet();refreshConv(uid);await poll();toast('已清空你的聊天记录，对方记录不受影响');});};
  ACTIONS['dm-readall']=b=>busy(b,async ok=>{let cursor=null,items=[],seen=new Set();do{const r=await API.req('GET','/dm/threads?limit=50'+(cursor ? '&cursor='+encodeURIComponent(cursor):''));if(!ok())return;items.push(...r.items.filter(t=>t.unread>0).map(t=>({peerId:t.peer.id,through:t.readThrough})));cursor=r.next;if(cursor && seen.has(cursor))throw Error('会话分页未前进，请刷新后重试');seen.add(cursor);}while(cursor);for(let i=0;i<items.length;i+=100){if(!ok())return;await API.req('POST','/dm/read',{items:items.slice(i,i+100)});}if(!ok())return;current().version=null;await poll();if(ok())toast('已读范围已同步');});
  document.addEventListener('rendered',()=>{controls();if(liveUser() && API.on())schedule(0);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(LDM.timer);clearInterval(LDM.timer);LDM.timer=0;}else if(liveUser())schedule(0);});
  window.addEventListener('pagehide',()=>{clearTimeout(LDM.timer);clearInterval(LDM.timer);});
  // 其余扩展在下文注册，主页面的初始登录完成后仍会通过 dmStart 进入同一个调度器。

  function mentionText(text,mentions){let start=0,out='';for(const m of mentions || []){if(!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start<start || m.end>text.length || m.end<=m.start)continue;out+=esc(text.slice(start,m.start))+`<a class="comm-mention" data-go="user-${esc(m.userId)}">${esc(text.slice(m.start,m.end))}</a>`;start=m.end;}return out+esc(text.slice(start));}
  function postMentions(text){const input=$('#cBody'),data=input && editors.get(input),source=input?.value || UI.cp?.body || '',mentions=data?.mentions || UI.cp?.mentions || [],offset=source.indexOf(text);return offset<0 ? []:mentions.filter(m=>m.start>=offset && m.end<=offset+text.length).map(m=>({userId:m.userId,start:m.start-offset,end:m.end-offset}));}
  function attachEditor(input){if(!input || editors.has(input) || !liveUser())return;const data={text:input.value,mentions:input.id==='cBody' ? [...(UI.cp?.mentions || [])]:[],start:0,end:0};editors.set(input,data);
    input.addEventListener('input',()=>{const next=input.value,old=data.text;let left=0;while(left<old.length && left<next.length && old[left]===next[left])left++;let oldEnd=old.length,newEnd=next.length;while(oldEnd>left && newEnd>left && old[oldEnd-1]===next[newEnd-1]){oldEnd--;newEnd--;}const delta=(newEnd-left)-(oldEnd-left);data.mentions=data.mentions.filter(m=>m.end<=left || m.start>=oldEnd).map(m=>m.start>=oldEnd ? {...m,start:m.start+delta,end:m.end+delta}:m);data.text=next;if(input.id==='cBody' && UI.cp)UI.cp.mentions=data.mentions;});
    const b=document.createElement('button');b.type='button';b.className='pill sm lt comm-at';b.textContent='@';b.setAttribute('aria-label','提及用户');b.addEventListener('click',()=>openMention(input,data));
    const dock=input.parentElement?.querySelector('.cdock');if(dock)dock.append(b);else input.before(b);
  }
  function openMention(input,data){
    document.querySelector('.comm-picker')?.remove();data.start=input.selectionStart ?? input.value.length;data.end=input.selectionEnd ?? data.start;const key=scope(),box=document.createElement('div');box.className='comm-picker';box.setAttribute('role','dialog');box.setAttribute('aria-label','选择提及用户');box.innerHTML='<div class="comm-actions"><label for="commMentionQuery">提及用户</label><button class="pill sm lt" type="button" data-close>关闭</button></div><input class="inp" id="commMentionQuery" type="search" placeholder="搜索昵称或ID" autocomplete="off"><div class="comm-picker-results" role="status">输入昵称或ID查找用户</div>';document.body.append(box);const query=box.querySelector('input'),results=box.querySelector('[role="status"]');let timer,seq=0;box.querySelector('[data-close]').onclick=()=>{clearTimeout(timer);box.remove();input.isConnected && input.focus();};
    query.addEventListener('input',()=>{clearTimeout(timer);const q=query.value.trim(),run=++seq;if(!q){results.textContent='输入昵称或ID查找用户';return;}results.textContent='正在查找…';timer=setTimeout(async()=>{try{const r=await API.req('GET','/users?q='+encodeURIComponent(q)+'&limit=20');if(run!==seq || !same(key) || !box.isConnected)return;results.replaceChildren();for(const u of r.items){const b=document.createElement('button');b.type='button';b.className='comm-user';b.textContent=u.name+' · '+u.handle;b.onclick=()=>{if(!same(key) || !input.isConnected)return;if(data.mentions.length>=10){toast('每条内容最多提及10人','orange');return;}apiUser(u);const label='@'+u.name,before=input.value.slice(0,data.start),after=input.value.slice(data.end);input.value=before+label+' '+after;input.dispatchEvent(new Event('input',{bubbles:true}));data.mentions.push({userId:u.id,start:before.length,end:before.length+label.length});data.mentions.sort((a,b)=>a.start-b.start);data.text=input.value;if(input.id==='cBody' && UI.cp){UI.cp.mentions=data.mentions;cpAutosave();}box.remove();input.focus();input.setSelectionRange(before.length+label.length+1,before.length+label.length+1);autoGrow(input);};results.append(b);}if(!r.items.length)results.textContent='没有匹配用户';}catch(e){if(run===seq && box.isConnected)results.textContent=e.message+'，请修改关键词重试';}},300);});query.addEventListener('keydown',e=>{if(e.key==='Escape')box.querySelector('[data-close]').click();});query.focus();
  }
  for(const name of ['cmt','rl-send']){const original=ACTIONS[name];ACTIONS[name]=function(b,e){const input=name==='cmt' ? $('#cmtIn'):$('#rlIn'),pid=name==='cmt' ? b.dataset.id:reelCur()?.id,p=POST(pid);if(p?.live && p.commentsClosed){toast('作者已关闭评论，草稿已保留','orange');return;}if(input && pid){const data=editors.get(input),text=input.value.trim(),leading=input.value.length-input.value.trimStart().length;commentMentions.set(pid,{text,mentions:(data?.mentions || []).filter(m=>m.start>=leading && m.end<=leading+text.length).map(m=>({...m,start:m.start-leading,end:m.end-leading}))});}return original(b,e);};}

  function searchRows(el,remote){if(el._remote?.query===remote.query)el._draw?.();}
  ACTIONS['comm-search']=()=>openSearch('msg');
  ACTIONS['comm-search-more']=b=>busy(b,async ok=>{
    const el=$('#srch'),remote=el?._remote,query=b.dataset.query,cursor=b.dataset.cursor;
    if(!el?.isConnected || !remote || remote.query!==query || remote.messageNext!==cursor)return;
    const r=await API.req('GET','/dm/search?q='+encodeURIComponent(query)+'&cursor='+encodeURIComponent(cursor));
    if(!ok() || $('#srch')!==el || !el.isConnected || el._remote!==remote || remote.messageNext!==cursor)return;
    remote.messages.push(...r.items);remote.messageNext=r.next;searchRows(el,remote);
  });
  ACTIONS['comm-jump-message']=b=>busy(b,async ok=>{const r=await API.req('GET',`/dm/messages/${encodeURIComponent(b.dataset.id || b.dataset.messageId)}/context`);if(!ok())return;const uid=r.peer.id;apiUser(r.peer);current().context={uid,after:r.after};LDM.full.add(uid);dmMerge(uid,r.items,true);LDM.before[uid]=r.before;closeSearch(false);closeSheet();go('msg-'+uid);LDM.sig[uid]=null;dmPaint(uid);requestAnimationFrame(()=>{const el=[...document.querySelectorAll('[data-dm]')].find(el=>el.dataset.dm==='msg-'+r.target);el?.scrollIntoView({block:'center'});el?.classList.add('flash');});});
  ACTIONS['comm-context-next']=b=>busy(b,async ok=>{const r=await API.req('GET',`/dm/messages/${encodeURIComponent(b.dataset.id)}/context`);if(!ok())return;dmMerge(r.peer.id,r.items);current().context={uid:r.peer.id,after:r.after};LDM.sig[r.peer.id]=null;dmPaint(r.peer.id);});
  ACTIONS['comm-latest']=b=>busy(b,async ok=>{const uid=b.dataset.id;current().context=null;LDM.full.delete(uid);await dmConv(uid);if(!ok())return;LDM.sig[uid]=null;dmPaint(uid);const box=$('#cvB');if(box)box.scrollTop=box.scrollHeight;});

  async function discussion(id,patch){const p=POST(id);if(!p?.live || p.author!==ME)return;const key=scope(),r=await API.req('PATCH',`/posts/${encodeURIComponent(id)}/discussion`,{...patch,expectedVersion:p.discussionVersion || 0});if(!same(key))return;Object.assign(p,r);delete STATE.solved[id];cmtPaint(id);controls();}
  const oldSolve=ACTIONS.solve;ACTIONS.solve=b=>POST(b.dataset.id)?.live ? busy(b,()=>discussion(b.dataset.id,{solved:!POST(b.dataset.id).solved})):oldSolve(b);
  ACTIONS['comm-close-comments']=b=>busy(b,()=>discussion(b.dataset.id,{commentsClosed:!POST(b.dataset.id)?.commentsClosed}));
  ACTIONS['comm-pin-comment']=b=>busy(b,()=>discussion(b.dataset.id,{pinnedCommentId:POST(b.dataset.id)?.pinnedCommentId===b.dataset.cid ? null:b.dataset.cid}));
  const oldForNotice=cmtForNotice;cmtForNotice=async function(pid,id,force){if(!POST(pid)?.live)return oldForNotice(pid,id,force);const key=scope();try{const r=await API.req('GET',`/posts/${encodeURIComponent(pid)}/comments/context?target=${encodeURIComponent(id)}`);if(!same(key))return null;const old=COMMENTS[pid] ||= [],byId=new Map(old.map(c=>[c.id,c]));for(const raw of [...(r.parent ? [r.parent]:[]),...r.items])byId.set(raw.id,apiCmt(raw));COMMENTS[pid]=[...byId.values()];cmtPaint(pid);return COMMENTS[pid].find(c=>c.id===id) || null;}catch(e){if([403,404].includes(e.status))return null;throw e;}};
  const oldJump=commentJumpReady;commentJumpReady=async function(pid){const target=UI.commentJump?.p===pid && UI.commentJump.id;if(target && POST(pid)?.live && !cmtsOf(pid).some(c=>c.id===target))await cmtForNotice(pid,target);return oldJump(pid);};

  comm.openActivity=async function(orig,b,e){const key=scope(),kind=b.dataset.v,count=NOTE_NEW[kind],reads=(NOTES[kind] || []).map(n=>[n,!!n.read]);orig(b,e);NOTE_NEW[kind]=count;reads.forEach(([n,read])=>n.read=read);msgBadge();const list=$('#layer .m-list');if(list){LACT.panel={k:kind,list,current:dmSession()};actPanelPaint();}
    try{await actLoad(true);if(!same(key))return;const token=current().tokens[kind];if(!token)throw Error('通知快照未读取成功，请重试');await API.req('POST','/me/activity/read',{kind,through:token});if(!same(key))return;current().version=null;await actLoad(true);await poll();}catch(err){if(same(key)){apiFail(err);actPanelPaint();}}
  };
  const oldAtMark=atMark;atMark=function(id){if(!liveUser() || !/^ac_/.test(id))return oldAtMark(id);if(AT_READ.has(id))return;const key=scope();void API.req('POST','/me/activity/read',{ids:[id]}).then(async()=>{if(!same(key))return;AT_READ.add(id);const item=(NOTES.at || []).find(n=>n.id===id);if(item)item.read=true;current().version=null;await actLoad(true);msgBadge();}).catch(e=>{if(same(key))apiFail(e);});};
  ACTIONS['at-all']=b=>busy(b,async ok=>{if(!current().tokens.at){const loaded=await actLoad(true);if(!ok())return;if(loaded===false)throw Error('通知尚未读取成功，请重试');}if(!ok())return;const through=current().tokens.at;if(!through)throw Error('通知尚未读取成功，请重试');await API.req('POST','/me/activity/read',{kind:'at',through});if(!ok())return;current().version=null;await actLoad(true);if(ok())await poll();});
  comm.openOfficial=async function(orig,b,e){const key=scope(),old=(ADM.inbox[ME] || []).map(n=>[n,n.read]);orig(b,e);old.forEach(([n,read])=>n.read=read);msgBadge();try{LDM.sysMark=null;const loaded=await sysLoad();if(!same(key))return;const through=current().tokens.official;if(loaded===false || !through)throw Error('官方通知尚未读取成功，请重试');await API.req('POST','/notifications/read-all?through='+encodeURIComponent(through));if(!same(key))return;current().version=null;LDM.sysMark=null;await sysLoad();if(same(key))await poll();}catch(err){if(same(key))apiFail(err);}};

  let editing=null;
  const oldEdit=ACTIONS['post-edit'];ACTIONS['post-edit']=b=>{const p=POST(b.dataset.id);if(!p?.live)return oldEdit(b);if(p.author!==ME)return;if(p.serverStatus==='taken_down')return ACTIONS['comm-appeal'](b);
    editing={id:p.id,scope:scope(),files:[],retained:(p.serverMedia || []).map(m=>m.key)};
    const media=(p.serverMedia || []).map((m,i)=>`<label><input type="checkbox" data-comm-retain="${esc(m.key)}" checked>保留${m.kind==='image' ? '图片':m.kind==='audio' ? '音频':'媒体'} ${i+1}</label>`).join('');
    sheet(`<h3>编辑帖子</h3><label class="ad-lab" for="peT">标题</label><input class="inp" id="peT" value="${esc(p.title)}" maxlength="60"><label class="ad-lab" for="peB">正文</label><textarea class="inp" id="peB" rows="6" maxlength="5000">${esc(p.rawBody || '')}</textarea>${media ? '<div class="comm-media-list">'+media+'</div>':''}${['image','audio'].includes(p.serverMedia?.[0]?.kind) ? `<label class="ad-lab" for="commMedia">追加或替换媒体</label><input class="inp" id="commMedia" type="file" ${p.serverMedia[0].kind==='image' ? 'accept="image/*" multiple':'accept="audio/*"'}><p class="mut2">替换时取消勾选原媒体，最多9个文件。图片和音频改动可能重新送审。</p>`:''}<p class="comm-editor-note">需要复审时，整帖暂时仅自己可见。保存失败会保留当前输入。</p><button class="pill lg" data-act="post-esave" data-id="${esc(p.id)}">保存修改</button>`,d=>{attachEditor($('#peB',d));const data=editors.get($('#peB',d));if(data)data.mentions=[...(p.mentions || [])];$('#commMedia',d)?.addEventListener('change',e=>{editing.files=[...e.target.files].map(file=>({file,uploadId:null}));});});
  };
  const oldSave=ACTIONS['post-esave'];ACTIONS['post-esave']=b=>{const p=POST(b.dataset.id);if(!p?.live)return oldSave(b);return busy(b,async ok=>{
    const title=$('#peT')?.value.trim(),input=$('#peB'),text=input?.value || '';if(!title){toast('请填写标题','orange');return;}const editor=editing;if(!input || !editor || editor.id!==p.id || editor.scope!==scope())return;
    const active=()=>ok() && editing===editor && $('#peB')===input && input.isConnected;
    const retained=[...document.querySelectorAll('[data-comm-retain]:checked')].map(el=>el.dataset.commRetain),uploadIds=[];
    if(retained.length+editor.files.length>9){toast('最多保留或上传9个文件','orange');return;}
    for(const entry of editor.files){if(!active())return;entry.uploadId ||= (await liveUpload(entry.file,entry.file.type.startsWith('image/') ? 'post_image':'post_audio')).id;if(!active())return;uploadIds.push(entry.uploadId);}
    if(!active())return;const mentions=editors.get(input)?.mentions || [],body={title,body:text,mentions};
    if(p.serverMedia?.length || uploadIds.length)Object.assign(body,{uploadIds,retainedMediaKeys:retained});
    const raw=await API.req('PATCH',`/posts/${encodeURIComponent(p.id)}`,body);if(!active())return;Object.assign(p,apiPost(raw));editing=null;closeSheet();softRefresh();toast(p.review ? '修改已提交复审，通过前仅自己可见':'修改已保存');
  });};

  // 后续发布管理与通知操作均在当前账号完成服务器确认后才更新页面。
  const mePage=ROUTES.me;ROUTES.me=function(arg){const h=mePage(arg);return liveUser() && !arg ? h.replace(/(<div class="wrap[^>]*>)/,'$1<div class="comm-list-actions"><button class="pill sm lt" data-act="comm-publications">我的发布与审核</button></div>'):h;};
  let publicationPage=null;
  ACTIONS['comm-publications']=b=>busy(b,()=>publications('all'));
  async function publications(filter,cursor){const key=scope(),r=await API.req('GET','/me/posts?limit=20&status='+filter+(cursor ? '&cursor='+encodeURIComponent(cursor):''));if(!same(key))return;for(const raw of r.items){const p=apiPost(raw),old=POST(p.id);if(old)Object.assign(old,p);else POSTS.push(p);}publicationPage={filter,next:r.next,rows:cursor ? [...(publicationPage?.rows || []),...r.items]:r.items};drawPublications();}
  function drawPublications(){const s=publicationPage;sheet(`<h3>我的发布</h3><div class="comm-actions">${[['all','全部'],['published','已公开'],['review','审核中'],['taken_down','未通过 / 已下架']].map(([k,label])=>`<button class="pill sm ${s.filter===k ? '':'lt'}" data-act="comm-publication-filter" data-filter="${k}" aria-pressed="${s.filter===k}">${label}</button>`).join('')}</div><div class="comm-publications">${s.rows.map(p=>`<article class="comm-publication"><a data-go="post-${esc(p.id)}"><b>${esc(p.title)}</b></a><span class="mut2">${p.status==='review' ? '审核中':p.status==='taken_down' ? '未通过审核或已下架':'已公开'}</span>${p.takedownReason ? `<p>${esc(p.takedownReason)}</p>`:''}<div class="comm-actions">${p.status==='taken_down' ? `<button class="pill sm lt" data-act="comm-appeal" data-id="${esc(p.id)}">申诉</button>`:`<button class="pill sm lt" data-act="post-edit" data-id="${esc(p.id)}">编辑</button>`}</div></article>`).join('') || '<p class="mut">当前分类没有发布记录</p>'}</div>${s.next ? '<button class="pill sm lt" data-act="comm-publications-more">加载更多</button>':''}`);}
  ACTIONS['comm-publication-filter']=b=>busy(b,()=>publications(b.dataset.filter));
  ACTIONS['comm-publications-more']=b=>busy(b,()=>publications(publicationPage.filter,publicationPage.next));
  ACTIONS['comm-appeal']=b=>sheet(`<h3>申诉「${esc(POST(b.dataset.id)?.title || '')}」</h3><label class="ad-lab" for="commAppeal">说明情况</label><textarea class="inp" id="commAppeal" rows="5" minlength="4" maxlength="2000"></textarea><button class="pill lg" data-act="comm-appeal-send" data-id="${esc(b.dataset.id)}">发送申诉</button>`);
  ACTIONS['comm-appeal-send']=b=>busy(b,async ok=>{const text=$('#commAppeal')?.value.trim();if(!text || text.length<4){toast('请至少填写4个字说明情况','orange');return;}await API.req('POST','/me/appeals',{text,ref:b.dataset.id});if(ok()){closeSheet();toast('申诉已提交，处理结果会通过官方通知告知');}});
  let relationPage=null;
  liveRelSheet=async function(uid,k){const key=scope();try{const r=await API.req('GET',`/users/${encodeURIComponent(uid)}/${k==='fans' ? 'followers':'following'}?limit=50`);if(!same(key))return;relationPage={uid,k,rows:r.items,next:r.next};drawRelations();}catch(e){if(same(key))apiFail(e);}};
  function drawRelations(){const s=relationPage;s.rows.forEach(apiUser);sheet(`<h3>${s.uid===ME ? '我的':esc(uname(s.uid))+'的'}${s.k==='fans' ? '粉丝':'关注'}</h3><div class="m-list">${s.rows.map(u=>`<div class="mrow"><a data-go="user-${esc(u.id)}">${av(u.id)}</a><a class="mt" data-go="user-${esc(u.id)}"><b>${esc(u.name)}</b><span>${esc(u.bio || '')}</span></a>${u.id===ME ? '<span class="tag k">我</span>':`<button class="pill sm ${STATE.follows.has(u.id) ? 'lt':''}" data-act="follow" data-id="${esc(u.id)}">${STATE.follows.has(u.id) ? '已关注':'关注'}</button>`}</div>`).join('') || '<p class="mut">还没有</p>'}</div>${s.next ? '<button class="pill sm lt" data-act="comm-relations-more">加载更多</button>':''}`);}
  ACTIONS['comm-relations-more']=b=>busy(b,async ok=>{const s=relationPage,r=await API.req('GET',`/users/${encodeURIComponent(s.uid)}/${s.k==='fans' ? 'followers':'following'}?limit=50&cursor=${encodeURIComponent(s.next)}`);if(!ok())return;const byId=new Map(s.rows.map(u=>[u.id,u]));r.items.forEach(u=>byId.set(u.id,u));s.rows=[...byId.values()];s.next=r.next;drawRelations();});
  document.addEventListener('rendered',()=>{document.querySelector('.comm-picker')?.remove();});
  controls();if(liveUser() && API.on() && API.tok)void start();
})();
