/* 交流扩展复用主页面的请求、草稿、弹层和增量消息；所有异步结果绑定当前账号和服务。 */
(function(){
  'use strict';
  const scope=()=>JSON.stringify([API.base,API.epoch,ME]);
  const fresh=()=>({scope:scope(),version:null,versions:null,threads:{},next:null,requests:[],requestNext:null,requestError:'',tokens:{},unread:null,lastFull:0,failures:0,running:false,context:null,pins:new Set(),receiptActive:'',receiptPolicy:null,receiptEpoch:0,receiptDefault:undefined});
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
  function canShowReceipt(uid){const s=current();return s.receiptDefault!==false&&s.threads[uid]?.readReceipts!==false&&s.receiptActive===uid&&s.receiptPolicy?.peerId===uid&&s.receiptPolicy.enabled===true;}
  function canMarkRead(uid){const box=$('#cvB');return !document.hidden&&(typeof HST==='undefined'||!HST.ov)&&CUR.key==='msg|'+uid&&current().context?.uid!==uid&&!!box&&box.scrollHeight-box.scrollTop-box.clientHeight<120;}
  function redactReceipts(uid){for(const m of CHATS[uid]||[])if(m.me){m.read=false;if(m.delivery)m.delivery='sent';}LDM.sig[uid]=null;}
  function receiptView(uid){const s=current();if(s.receiptActive===uid)return;s.receiptActive=uid;s.receiptPolicy=null;s.receiptEpoch++;if(uid)redactReceipts(uid);}
  function receiptPolicy(value,uid){const s=current(),next=value?.peerId===uid?value:null,old=s.receiptPolicy,masterChanged=typeof next?.ownEnabled==='boolean'&&next.ownEnabled!==s.receiptDefault;if(masterChanged){s.receiptDefault=next.ownEnabled;if(!next.ownEnabled)for(const peer of Object.keys(CHATS))redactReceipts(peer);}if(!masterChanged&&old?.peerId===next?.peerId&&old?.enabled===next?.enabled)return false;s.receiptPolicy=next;s.receiptEpoch++;if(uid&&!canShowReceipt(uid))redactReceipts(uid);return true;}
  async function refreshReceipts(uid){
    const s=current(),key=s.scope,epoch=s.receiptEpoch,ids=[...new Set((CHATS[uid]||[]).filter(m=>m.id&&!m.pend&&!m.rc).map(m=>m.id))];let changed=false;
    for(let i=0;i<ids.length;i+=200){const r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/receipts`,{ids:ids.slice(i,i+200)});if(!same(key)||current().receiptEpoch!==epoch||CUR.key!=='msg|'+uid)return;
      const byId=new Map(r.items.map(m=>[m.id,m])),previous=CHATS[uid]||[];CHATS[uid]=previous.filter(m=>!byId.get(m.id)?.hidden);if(previous.length!==CHATS[uid].length)changed=true;for(const m of CHATS[uid]){const value=byId.get(m.id);if(!value||m.rc)continue;const read=m.me?!!value.read&&canShowReceipt(uid):!!value.read,delivery=value.receipt ? value.receipt==='read'&&canShowReceipt(uid)?'read':'sent':null;if(m.read!==read||m.delivery!==delivery){m.read=read;m.delivery=delivery;changed=true;}}
    }
    if(changed&&same(key)){LDM.sig[uid]=null;dmPaint(uid);}
  }
  function replyTarget(uid){return CUR.key==='msg|'+uid ? $('#cvIn')?._dmReplyToId || null : null;}
  function cancelDmReply(uid,id){if(CUR.key!=='msg|'+uid)return;const input=$('#cvIn');if(!input || id && input._dmReplyToId!==id)return;input._dmReplyToId=null;inputDraftSave(input);paintDmReply();}
  function paintDmReply(){
    const input=$('#cvIn'),uid=CUR.key?.startsWith('msg|') ? CUR.key.slice(4):'',host=input?.closest('.conv');if(!host)return;
    let bar=host.querySelector('.comm-dm-reply');const id=input._dmReplyToId;if(!id){bar?.remove();return;}
    const target=(CHATS[uid] || []).find(m=>m.id===id),unavailable=target?.rc || target?.hidden;
    const text=unavailable ? '原消息已不可访问，请取消引用后发送' : target ? msgPreview(target) : '历史消息，发送时会重新校对';
    const html=`<span><b>回复${target ? target.me ? '自己' : esc(uname(uid)) : '消息'}</b><span>${esc(text)}</span></span><button data-act="comm-reply-cancel" data-id="${esc(uid)}" aria-label="取消引用回复">×</button>`;
    if(!bar){bar=document.createElement('div');bar.className='comm-dm-reply';bar.setAttribute('role','status');host.querySelector('.cv-f')?.before(bar);}if(bar.innerHTML!==html)bar.innerHTML=html;
  }
  function controls(){
    if(!liveUser())return;const uid=CUR.key?.startsWith('msg|') ? CUR.key.slice(4):'',s=current();
    receiptView(uid);
    paintDmReply();
    if(uid && $('#cvB')){
      const c=s.threads[uid],host=$('.cv-h')?.parentElement;
      if(host && c){let note=host.querySelector('.comm-admission');if(!note){note=document.createElement('div');note.className='comm-admission';host.querySelector('.cv-h')?.after(note);}
        const pending=c.state==='pending' || c.state==='rejected';
        const html=pending ? `<span>${c.state==='rejected' ? '这条消息请求已被拒绝' : c.requestedBy===ME ? '请求已发送，等待对方接受' : '对方希望与你开始聊天；接受后才能继续沟通'}</span>${c.canAccept ? `<button class="pill sm" data-act="comm-accept" data-id="${esc(uid)}">${c.state==='rejected' ? '恢复聊天':'接受'}</button>${c.state==='pending' ? `<button class="pill sm lt" data-act="comm-reject" data-id="${esc(uid)}">拒绝</button>`:''}`:''}` : c.state==='none' && !c.canSend ? '<span>对方暂不接收新的私信请求。</span>' : c.state==='none' && !c.canSendMedia ? '<span>可以先发送一条文字请求；对方接受后可发图片和分享。</span>':'';
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
  async function refreshReferences(uid,staleOnly=false){
    const key=scope(),now=Date.now(),ids=[...new Set((CHATS[uid] || []).filter(m=>m.id&&!m.pend&&!m.rc&&(['post','prod'].includes(m.t)||m.reply)&&(!staleOnly||!m._refCheckedAt||now<m._refCheckedAt||now-m._refCheckedAt>=30000)).map(m=>m.id))];
    let lastBox,lastTop,lastContext,reading=false;
    const paint=()=>{
      if(CUR.key!=='msg|'+uid)return;const context=current().context,box=$('#cvB'),top=box?.getBoundingClientRect().top,keep=box&&(context?.uid===uid||box.scrollHeight-box.scrollTop-box.clientHeight>=120||reading&&context===lastContext&&box===lastBox&&Math.abs(box.scrollTop-lastTop)<1);
      const anchor=keep?[...box.children].find(el=>{const rect=el.getBoundingClientRect();return el.dataset.dm?.startsWith('msg-')&&rect.top>=top&&rect.top<top+box.clientHeight;}):null,id=anchor?.dataset.dm,offset=anchor?anchor.getBoundingClientRect().top-top:0;
      LDM.sig[uid]=null;dmPaint(uid);
      const restored=id&&box.isConnected&&$('#cvB')===box?[...box.children].find(el=>el.dataset.dm===id):null;
      if(restored)box.scrollTop+=restored.getBoundingClientRect().top-box.getBoundingClientRect().top-offset;
      reading=!!keep;lastBox=box;lastTop=box?.scrollTop;lastContext=context;
    };
    for(let i=0;i<ids.length;i+=200){
      if(!same(key))return;const batch=ids.slice(i,i+200),requested=new Set(batch),r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/references`,{ids:batch});if(!same(key))return;
      const byId=new Map(r.items.map(m=>[m.id,m]));
      CHATS[uid]=(CHATS[uid] || []).flatMap(m=>{
        if(!requested.has(m.id))return [m];const raw=byId.get(m.id);if(!raw||raw.hidden)return [];if(m.rc)return [m];
        if(raw.ref){const target=m.t+':'+raw.ref;LDM.miss.delete(target);LDM.missAt?.delete(target);LDM.miss.delete(raw.ref);}
        return [{...m,reply:raw.reply || null,ref:raw.recalled||raw.refState==='unavailable'?undefined:raw.ref || undefined,text:raw.recalled?'':raw.body,refState:raw.refState,rc:!!raw.recalled,_refCheckedAt:Date.now()}];
      });
      paint();
    }
    const metadataAt=Date.now(),box=CUR.key==='msg|'+uid?$('#cvB'):null,visible=new Set();
    if(box){const bounds=box.getBoundingClientRect(),ids=new Set([...box.children].filter(el=>{const r=el.getBoundingClientRect();return el.dataset.dm?.startsWith('msg-')&&r.bottom>bounds.top&&r.top<bounds.bottom;}).map(el=>el.dataset.dm.slice(4)));for(const m of CHATS[uid] || [])if(ids.has(m.id)&&m.ref)visible.add(m.t+':'+m.ref);}
    const outcomes=await dmRefs(CHATS[uid] || [],visible);if(!same(key))return;
    if(outcomes?.get)CHATS[uid]=(CHATS[uid] || []).map(m=>{
      if(m.rc||!m.ref||m._refCheckedAt>metadataAt)return m;const result=outcomes.get(m.t+':'+m.ref),off=result==='available'&&m.t==='prod'&&P(m.ref)?.status&&P(m.ref).status!=='on_sale';
      return result==='unavailable'||off?{...m,ref:undefined,refState:'unavailable',text:'',_refCheckedAt:Date.now()}:m;
    });paint();
  }
  async function poll(){
    const s=current();if(s.running || !allowed() || document.hidden || !liveUser() || !API.on() || !API.tok)return;s.running=true;
    let wait=30000;
    try{
      const force=Date.now()-s.lastFull>=30000,previous=s.versions,open=CUR.key?.startsWith('msg|') ? CUR.key.slice(4):'';receiptView(open);const epoch=s.receiptEpoch,query=[];
      if(s.version&&!force)query.push('since='+encodeURIComponent(s.version));if(open)query.push('peerId='+encodeURIComponent(open));
      const r=await API.req('GET','/me/communication/sync'+(query.length?'?'+query.join('&'):''));if(!same(s.scope))return;if(s.receiptEpoch!==epoch){wait=0;return;}
      const receiptChanged=receiptPolicy(r.receipts,open);
      for(const setting of r.settings || [])absorb(setting.peerId,setting);
      const dmChanged=!previous || previous.dm!==r.versions.dm;
      if(dmChanged || force){await dmThreads();if(!same(s.scope))return;await requests();if(!same(s.scope))return;}
      const needsRead=open&&canMarkRead(open)&&(CHAT_UNREAD[open]>0||(CHATS[open]||[]).some(m=>!m.me&&!m.read));
      if(open && s.context?.uid!==open && (dmChanged || force || needsRead || !LDM.full.has(open)))await dmConv(open);
      if(!same(s.scope))return;
      if(open && (force||dmChanged)){await refreshReferences(open,!dmChanged);if(!same(s.scope))return;}
      if(open&&r.receipts&&(receiptChanged||force)){await refreshReceipts(open);if(!same(s.scope))return;}
      if(!previous || previous.activity!==r.versions.activity || force){const loaded=await actLoad(true);if(!same(s.scope))return;if(loaded===false)throw Error('互动通知暂未同步完成');}
      if(!previous || previous.official!==r.versions.official || force){const loaded=await sysLoad(true);if(!same(s.scope))return;if(loaded===false)throw Error('官方通知暂未同步完成');}
      if(!same(s.scope))return;s.version=r.version;s.versions=r.versions;if(r.unread)s.unread=r.unread;if(force)s.lastFull=Date.now();s.failures=0;
      if(s.unread)LDM.unread=s.unread.dm;msgBadge();if(CUR.key?.startsWith('msg|'))dmPaint(open);controls();
      wait=open ? 4000:CUR.key?.startsWith('msg|') ? 10000:30000;
    }catch(e){if(same(s.scope)){s.failures++;wait=Math.min(60000,4000*2**Math.min(s.failures,4));if(CUR.key?.startsWith('msg|') && !s.versions){LDM.listState='error';dmPaint(CUR.key.slice(4));}}}
    finally{s.running=false;if(same(s.scope))schedule(Math.round(wait*(.95+Math.random()*.1)));}
  }
  async function start(){if(!allowed())return;clearInterval(LDM.timer);clearTimeout(LDM.timer);LDM.timer=0;await restoreComments();await poll();}
  const comm=globalThis.CZCommunication={get threads(){return current().threads;},contextFor(uid){return current().context?.uid===uid;},incomingRequest,absorb,controls,poll,start,refreshReferences,replyTarget,paintDmReply,canShowReceipt,refreshReceipts,canMarkRead,nudgeRead(uid){if(canMarkRead(uid))schedule(0);},
    threadPage(r,cursor){const s=current();s.next=r.next;if(!cursor && !r.next){const ids=new Set(r.items.map(t=>t.peer.id));for(const uid of Object.keys(s.threads))if(!ids.has(uid) && !incomingRequest(uid) && CUR.key!=='msg|'+uid && !CHATS[uid]?.some(m=>m.pend)){delete CHATS[uid];delete CHAT_UNREAD[uid];}}},
    activityToken(k,t){if(t)current().tokens[k]=t;},officialToken(t){if(t)current().tokens.official=t;},
    async saveComment(pid,c){try{const row={key:'comment|'+JSON.stringify([API.base,ME,c._client]),scope:'comment|'+JSON.stringify([API.base,ME]),pid,comment:{...c,sendState:'failed',_counted:false}};await drafts.put(row);return true;}catch(e){c.sendState='failed';c.sendError=e.message || '本机草稿未保存，请检查存储空间';cmtPaint(pid);return false;}},
    async replaceComment(pid,old,next){const row={key:'comment|'+JSON.stringify([API.base,ME,next._client]),scope:'comment|'+JSON.stringify([API.base,ME]),pid,comment:{...next,sendState:'failed',_counted:false}};await drafts.replace('comment|'+JSON.stringify([API.base,ME,old._client]),row);},
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
  const oldDrawCompose=drawCompose;drawCompose=function(...args){const result=oldDrawCompose(...args);enhance();return result;};
  const oldList=msgList;msgList=function(uid){const s=current(),html=oldList(uid);if(!liveUser())return html;return html.replace('<div class="m-list">',`<div class="comm-list-actions"><button class="pill sm lt" data-act="comm-requests">消息请求${s.unread?.requests ? ' · '+s.unread.requests:''}</button><button class="pill sm lt" data-act="comm-search">搜索聊天记录</button><button class="pill sm lt" data-act="comm-privacy">私信设置</button></div><div class="m-list">`)+(s.next ? '<button class="pill sm lt comm-more" data-act="comm-threads-more">加载更多会话</button>':'');};
  const oldBubble=bubble;bubble=function(m,uid){const html=oldBubble(m,uid);if(!dmLive(uid) || !m.id || m.pend || m.rc)return html;return html.replace(/<button class="bub-rc"[\s\S]*?<\/button>/,'').replace(/<\/div>$/,`<button class="comm-message-menu" data-act="comm-message-menu" data-uid="${esc(uid)}" data-id="${esc(m.id)}" aria-label="消息操作">⋯</button></div>`);};
  ACTIONS['comm-message-menu']=async b=>{const key=scope();if(globalThis.CZDmExpressions&&!await CZDmExpressions.prepare())return;if(!same(key)||b.isConnected===false)return;const uid=b.dataset.uid,m=(CHATS[uid] || []).find(m=>m.id===b.dataset.id);if(!dmLive(uid)||!m||m.rc||m.pend)return;sheet(`<h3>消息操作</h3>${globalThis.CZDmExpressions?.menu(m,uid)||''}<button class="pill lg" data-act="comm-reply" data-uid="${esc(uid)}" data-id="${esc(m.id)}"${current().threads[uid]?.canSend ? '' : ' disabled'}>引用回复</button>${m.me && Date.now()-m.ts<RC_MS ? `<button class="pill lt lg" data-act="msg-rc" data-u="${esc(uid)}" data-ts="${m.ts}">撤回消息</button>` : ''}${!m.me ? `<button class="pill lt lg" data-act="report" data-k="message" data-id="${esc(m.id)}">举报消息</button>`:''}`);};
  ACTIONS['comm-reply']=b=>{const uid=b.dataset.uid,m=(CHATS[uid] || []).find(m=>m.id===b.dataset.id),input=$('#cvIn');if(CUR.key!=='msg|'+uid||!input||!m||m.rc||m.pend||!current().threads[uid]?.canSend)return;input._dmReplyToId=m.id;inputDraftSave(input);closeSheet();paintDmReply();input.focus({preventScroll:true});};
  ACTIONS['comm-reply-cancel']=b=>cancelDmReply(b.dataset.id);
  const oldRecall=ACTIONS['msg-rc'];ACTIONS['msg-rc']=(b,e)=>{const uid=b.dataset.u;if(!dmLive(uid))return oldRecall(b,e);const m=(CHATS[uid] || []).find(m=>m.me && m.ts===+b.dataset.ts);if(!m||m.pend)return;const panel=b.closest?.('.sheet');return busy(b,async ok=>{const r=await API.req('POST',`/dm/messages/${encodeURIComponent(m.id)}/recall`);if(!ok())return;dmMerge(uid,[r]);refreshConv(uid);if(panel?.isConnected)closeSheet();if(CUR.key==='msg|'+uid)await refreshReferences(uid);paintDmReply();});};
  const oldSend=sendMsg;sendMsg=async function(uid,message){
    if(!dmLive(uid))return oldSend(uid,message);const key=scope();let c=current().threads[uid];if(!c){await dmConv(uid);if(!same(key))return false;c=current().threads[uid];}
    if(!c?.canSend || message.t!=='text' && !c.canSendMedia){toast(c?.state==='pending' || c?.localRequest ? '等待首条请求确认或对方接受后再发送':c?.state==='rejected' ? '对方暂不接收消息':'先发送一条文字请求','orange');return false;}
    const firstRequest=c.state==='none' && !c.canSendMedia;
    if(firstRequest){c.localRequest=true;c.canSend=false;controls();}
    try{const result=await oldSend(uid,message);if(!result && firstRequest){c.localRequest=false;c.canSend=true;controls();}if(result){if(message.replyToId && message.t!=='text')cancelDmReply(uid,message.replyToId);current().version=null;void poll();}return result;}
    catch(e){if(firstRequest){c.localRequest=false;c.canSend=true;controls();}throw e;}
  };
  const oldRemove=ACTIONS['dm-remove'];ACTIONS['dm-remove']=async b=>{await oldRemove(b);for(const [uid,c] of Object.entries(current().threads))if(c.localRequest && ![...DMOUT.rows.values()].some(row=>row.peer===uid && row.scope===dmScope())){c.localRequest=false;if(c.state==='none')c.canSend=true;}controls();};
  for(const action of ['accept','reject'])ACTIONS['comm-'+action]=b=>busy(b,async ok=>{const uid=b.dataset.id,r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/request/${action}`);if(!ok())return;absorb(uid,r);current().version=null;await poll();if($('#layer .comm-requests'))closeSheet();if(CUR.key==='msg|'+uid)rerender();toast(action==='accept' ? '已接受，可以开始聊天':'已拒绝这条请求');});
  ACTIONS['comm-threads-more']=b=>busy(b,async()=>{if(current().next)await dmThreads(current().next);dmPaint('');});
  ACTIONS['comm-privacy']=b=>busy(b,async ok=>{const r=await API.req('GET','/me/communication/settings');if(!ok())return;const s=current();if(typeof r.readReceipts==='boolean'&&r.readReceipts!==s.receiptDefault){s.receiptDefault=r.readReceipts;s.receiptEpoch++;s.receiptPolicy=null;if(!r.readReceipts)for(const uid of Object.keys(CHATS))redactReceipts(uid);if(CUR.key?.startsWith('msg|'))dmPaint(CUR.key.slice(4));}sheet(`<h3>私信设置</h3><div class="comm-dm-policy"><h4>谁能发起新私信</h4>${[['requests','允许文字请求','未互关的人可以发一条文字，接受后才可继续。'],['contacts','仅互关或已购联系','互相关注，或购买过你商品的人可以发起会话。'],['nobody','不接收新私信','已有的已接受会话仍可继续聊天。']].map(([v,title,detail])=>`<label><input type="radio" name="dmPolicy" value="${v}"${r.newDmPolicy===v ? ' checked':''}><span><b>${title}</b><small>${detail}</small></span></label>`).join('')}<p class="mut2">仅限制新的会话，已收到的请求仍由你决定是否接受。拉黑仍会禁止双方发送。</p>${typeof r.readReceipts==='boolean' ? `<div class="comm-receipt-setting"><label><input type="checkbox" name="dmReadReceipts"${r.readReceipts?' checked':''}><span><b>显示已读回执</b><small>关闭后，所有会话双方都只显示“已发送”，自己的未读数仍会清除。</small></span></label><p class="mut2">总开关关闭优先于会话设置；关闭期间和请求接受前的阅读不会在以后补发回执。</p></div>`:''}<button class="pill lg" data-act="comm-privacy-save">保存设置</button></div>`);});
  ACTIONS['comm-privacy-save']=b=>busy(b,async ok=>{const panel=b.closest('.sheet'),newDmPolicy=panel?.querySelector('input[name="dmPolicy"]:checked')?.value,check=panel?.querySelector('input[name="dmReadReceipts"]');if(!newDmPolicy)return;const r=await API.req('PATCH','/me/communication/settings',{newDmPolicy,...(check?{readReceipts:check.checked}:{})});if(!ok())return;const s=current();s.receiptDefault=r.readReceipts;s.receiptEpoch++;s.receiptPolicy=null;if(r.readReceipts===false)for(const uid of Object.keys(CHATS))redactReceipts(uid);s.version=null;closeSheet();if(CUR.key?.startsWith('msg|'))dmPaint(CUR.key.slice(4));toast('私信设置已保存');void poll();});
  ACTIONS['comm-requests']=b=>busy(b,async ok=>{await requests();if(!ok())return;drawRequests();});
  function drawRequests(){const s=current();sheet(`<h3>消息请求</h3><p class="mut2">陌生人只可先发一条文字请求。接受后才可继续沟通。</p><div class="comm-requests">${s.requests.map(t=>`<div class="comm-request"><a data-go="msg-${esc(t.peer.id)}">${av(t.peer.id)}<b>${esc(t.peer.name)}</b></a><p>${esc(t.last.body)}</p><div class="comm-actions"><button class="pill sm" data-act="comm-accept" data-id="${esc(t.peer.id)}">接受</button><button class="pill sm lt" data-act="comm-reject" data-id="${esc(t.peer.id)}">拒绝</button><button class="pill sm lt" data-act="report" data-k="message" data-id="${esc(t.last.id)}">举报</button></div></div>`).join('') || '<p class="mut">还没有消息请求</p>'}${s.requestNext ? '<button class="pill sm lt" data-act="comm-requests-more">加载更多</button>':''}</div>`);}
  ACTIONS['comm-requests-more']=b=>busy(b,async ok=>{const s=current(),r=await API.req('GET','/dm/requests?limit=50&cursor='+encodeURIComponent(s.requestNext));if(!ok())return;r.items.forEach(t=>apiUser(t.peer));s.requests.push(...r.items);s.requestNext=r.next;drawRequests();});
  const oldMore=ACTIONS['cv-more'];ACTIONS['cv-more']=b=>{if(!dmLive(b.dataset.id))return oldMore(b);const uid=b.dataset.id,c=current().threads[uid]||{};sheet(`<h3>${esc(uname(uid))}</h3><button class="pill lt lg" data-act="comm-setting" data-id="${esc(uid)}" data-key="pinned">${c.pinned ? '取消置顶':'置顶会话'}</button><button class="pill lt lg" data-act="comm-setting" data-id="${esc(uid)}" data-key="muted">${c.muted ? '关闭免打扰':'开启免打扰'}</button><p class="mut2">免打扰保留未读计数，关闭弹出提示和系统推送。</p>${typeof c.readReceipts==='boolean' ? `<button class="pill lt lg" data-act="comm-setting" data-id="${esc(uid)}" data-key="readReceipts">${c.readReceipts?'关闭本会话已读回执':'开启本会话已读回执'}</button><p class="mut2">只有双方总开关和本会话开关都开启才显示已读；关闭期间不补发。</p><button class="pill lt lg" data-act="comm-privacy">全部私信设置</button>`:''}${globalThis.CZDmExpressions?`<button class="pill lt lg" data-act="dm-edit-drafts" data-id="${esc(uid)}">本机编辑草稿</button>`:''}<button class="pill lt lg" data-act="cv-clear" data-id="${esc(uid)}">清空我的聊天记录</button><button class="pill lt lg" data-act="report" data-k="user" data-id="${esc(uid)}">举报用户</button><button class="pill lt lg" data-act="blk" data-id="${esc(uid)}">${STATE.blocks.has(uid) ? '解除拉黑':'拉黑'}</button>`);};
  ACTIONS['comm-setting']=b=>busy(b,async ok=>{const uid=b.dataset.id,key=b.dataset.key;if(!['pinned','muted','readReceipts'].includes(key))return;const r=await API.req('PATCH',`/dm/with/${encodeURIComponent(uid)}/settings`,{[key]:!current().threads[uid]?.[key]});if(!ok())return;absorb(uid,r);if(key==='readReceipts'){current().receiptEpoch++;current().receiptPolicy=null;redactReceipts(uid);}current().version=null;closeSheet();if(CUR.key==='msg|'+uid)dmPaint(uid);await poll();});
  const oldClear=ACTIONS['cv-cgo'];ACTIONS['cv-cgo']=b=>{if(!dmLive(b.dataset.id))return oldClear(b);return busy(b,async ok=>{const uid=b.dataset.id,r=await API.req('POST',`/dm/with/${encodeURIComponent(uid)}/clear`);if(!ok())return;absorb(uid,r);current().version=null;closeSheet();refreshConv(uid);await poll();toast('已清空你的聊天记录，对方记录不受影响');});};
  ACTIONS['dm-readall']=b=>busy(b,async ok=>{let cursor=null,items=[],seen=new Set();do{const r=await API.req('GET','/dm/threads?limit=50'+(cursor ? '&cursor='+encodeURIComponent(cursor):''));if(!ok())return;items.push(...r.items.filter(t=>t.unread>0).map(t=>({peerId:t.peer.id,through:t.readThrough})));cursor=r.next;if(cursor && seen.has(cursor))throw Error('会话分页未前进，请刷新后重试');seen.add(cursor);}while(cursor);for(let i=0;i<items.length;i+=100){if(!ok())return;await API.req('POST','/dm/read',{items:items.slice(i,i+100)});}if(!ok())return;current().version=null;await poll();if(ok())toast('已读范围已同步');});
  document.addEventListener('rendered',()=>{controls();if(liveUser() && API.on())schedule(0);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(LDM.timer);clearInterval(LDM.timer);LDM.timer=0;}else if(liveUser())schedule(0);});
  window.addEventListener('pagehide',()=>{clearTimeout(LDM.timer);clearInterval(LDM.timer);});
  // 其余扩展在下文注册，主页面的初始登录完成后仍会通过 dmStart 进入同一个调度器。

  function mentionText(text,mentions){let start=0,out='';for(const m of mentions || []){if(!Number.isInteger(m.start) || !Number.isInteger(m.end) || m.start<start || m.end>text.length || m.end<=m.start)continue;out+=esc(text.slice(start,m.start))+`<a class="comm-mention" data-go="user-${esc(m.userId)}">${esc(text.slice(m.start,m.end))}</a>`;start=m.end;}return out+esc(text.slice(start));}
  function validEditorMentions(text,mentions,labels=false){let end=0;const out=[];for(const m of Array.isArray(mentions)?mentions.slice(0,100):[]){if(out.length>=10)break;if(typeof m?.userId!=='string'||!m.userId||m.userId.length>160||!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.start<end||m.end<=m.start||m.end>text.length)continue;const label=text.slice(m.start,m.end);if(!label.startsWith('@')||label.length<2||labels&&m.label!==label)continue;out.push({userId:m.userId,start:m.start,end:m.end});end=m.end;}return out;}
  function readEditor(input){const data=editors.get(input);if(!data)return null;const next=input.value,old=data.text;if(next!==old){let left=0;while(left<old.length&&left<next.length&&old[left]===next[left])left++;let oldEnd=old.length,newEnd=next.length;while(oldEnd>left&&newEnd>left&&old[oldEnd-1]===next[newEnd-1]){oldEnd--;newEnd--;}const delta=newEnd-oldEnd;data.mentions=data.mentions.filter(m=>m.end<=left||m.start>=oldEnd).map(m=>m.start>=oldEnd?{...m,start:m.start+delta,end:m.end+delta}:m);data.text=next;}data.mentions=validEditorMentions(next,data.mentions);if(input.id==='cBody'&&UI.cp)UI.cp.mentions=data.mentions;return data;}
  function postMentions(text){const input=$('#cBody'),data=input && readEditor(input),source=input?.value || UI.cp?.body || '',mentions=data?.mentions || UI.cp?.mentions || [],offset=source.indexOf(text);return offset<0 ? []:mentions.filter(m=>m.start>=offset && m.end<=offset+text.length).map(m=>({userId:m.userId,start:m.start-offset,end:m.end-offset}));}
  function attachEditor(input){if(!input || editors.has(input) || !liveUser())return;const data={text:input.value,mentions:input.id==='cBody'?validEditorMentions(input.value,UI.cp?.mentions):validEditorMentions(input.value,input._draftMentions,true),start:0,end:0};editors.set(input,data);
    if(input.id==='cBody')globalThis.watchEditorSize?.(input,false);
    input.addEventListener('input',()=>{readEditor(input);});
    const b=document.createElement('button');b.type='button';b.className='pill sm lt comm-at';b.textContent='@';b.setAttribute('aria-label','提及用户');b.addEventListener('click',()=>openMention(input,data));
    const dock=input.parentElement?.querySelector('.cdock');if(dock){dock.append(b);if(typeof DK!=='undefined'&&DK.st?.t===input&&document.activeElement===input){const snap=dockSnap(input);dockEnd(DK.st);dockOn(input.parentElement,input,dock,snap);}}else input.before(b);
  }
  comm.attachEditor=attachEditor;
  // 草稿监听可能先于提及监听执行，因此读取时先同步范围；标签快照只存本机，不进入接口DTO。
  comm.editorDraft=input=>{const data=readEditor(input),mentions=data?.mentions||validEditorMentions(input.value,input._draftMentions,true);return{mentions:mentions.map(m=>({...m,label:input.value.slice(m.start,m.end)}))};};
  comm.clearEditorDraft=input=>{const data=editors.get(input);if(data){data.text=input.value;data.mentions=[];}};
  comm.bindCommentEditor=(input,c)=>{attachEditor(input);const data=input&&editors.get(input);if(data){data.text=input.value;data.mentions=validEditorMentions(input.value,c.mentions);}};
  comm.commentEditorMentions=input=>{const text=input.value.trim(),leading=input.value.length-input.value.trimStart().length;return(readEditor(input)?.mentions||[]).filter(m=>m.start>=leading&&m.end<=leading+text.length).map(m=>({userId:m.userId,start:m.start-leading,end:m.end-leading}));};
  function openMention(input,data){
    const draftKey=input._draftKey,host=input.closest?.('.sheet'),compose=UI.cp;
    // 列表读取可能重建输入框，选择器仍归属同一份未改文字的草稿；切帖子/账号或实际改文则失效。
    const resolveEditor=()=>{if(!same(key))return false;if(input.isConnected)return true;const next=document.getElementById(input.id);if(!next||next.value!==input.value||!(draftKey?next._draftKey===draftKey:input.id==='cBody'?UI.cp===compose:host&&next.closest('.sheet')===host))return false;attachEditor(next);const live=editors.get(next);if(!live)return false;const {start,end}=data;input=next;data=live;data.start=start;data.end=end;return true;};
    document.querySelector('.comm-picker')?.remove();data.start=input.selectionStart ?? input.value.length;data.end=input.selectionEnd ?? data.start;const key=scope(),box=document.createElement('div');box.className='comm-picker';box.setAttribute('role','dialog');box.setAttribute('aria-label','选择提及用户');box.innerHTML='<div class="comm-actions"><label for="commMentionQuery">提及用户</label><button class="pill sm lt" type="button" data-close>关闭</button></div><input class="inp" id="commMentionQuery" type="search" placeholder="搜索昵称或ID" autocomplete="off"><div class="comm-picker-results" role="status">输入昵称或ID查找用户</div>';document.body.append(box);const query=box.querySelector('input'),results=box.querySelector('[role="status"]');let timer,seq=0;box.querySelector('[data-close]').onclick=()=>{clearTimeout(timer);box.remove();if(resolveEditor())input.focus();};
    query.addEventListener('input',()=>{clearTimeout(timer);const q=query.value.trim(),run=++seq;if(!q){results.textContent='输入昵称或ID查找用户';return;}results.textContent='正在查找…';timer=setTimeout(async()=>{try{const r=await API.req('GET','/users?q='+encodeURIComponent(q)+'&limit=20');if(run!==seq || !same(key) || !box.isConnected)return;results.replaceChildren();for(const u of r.items){const b=document.createElement('button');b.type='button';b.className='comm-user';b.textContent=u.name+' · '+u.handle;b.onclick=()=>{if(!same(key))return;if(!resolveEditor()){box.remove();toast('编辑内容已变化，请重新选择提及用户','blue');return;}readEditor(input);if(data.mentions.length>=10){toast('每条内容最多提及10人','orange');return;}apiUser(u);const label='@'+u.name,before=input.value.slice(0,data.start),after=input.value.slice(data.end);input.value=before+label+' '+after;input.dispatchEvent(new Event('input',{bubbles:true}));data.mentions.push({userId:u.id,start:before.length,end:before.length+label.length});data.mentions.sort((a,b)=>a.start-b.start);data.text=input.value;if(input.id==='cBody' && UI.cp){UI.cp.mentions=data.mentions;cpAutosave();}box.remove();input.focus();input.setSelectionRange(before.length+label.length+1,before.length+label.length+1);if(input.id==='cmtIn')autoGrow(input);input._editorSize?.refresh(true);inputDraftSave(input);};results.append(b);}if(!r.items.length)results.textContent='没有匹配用户';}catch(e){if(run===seq && box.isConnected)results.textContent=e.message+'，请修改关键词重试';}},300);});query.addEventListener('keydown',e=>{if(e.key==='Escape')box.querySelector('[data-close]').click();});query.focus();
  }
  for(const name of ['cmt','rl-send']){const original=ACTIONS[name];ACTIONS[name]=function(b,e){const input=name==='cmt' ? $('#cmtIn'):$('#rlIn'),pid=name==='cmt' ? b.dataset.id:reelCur()?.id,p=POST(pid);if(p?.live && p.commentsClosed){toast('作者已关闭评论，草稿已保留','orange');return;}if(input && pid){const data=readEditor(input),text=input.value.trim(),leading=input.value.length-input.value.trimStart().length;commentMentions.set(pid,{text,mentions:(data?.mentions || []).filter(m=>m.start>=leading && m.end<=leading+text.length).map(m=>({...m,start:m.start-leading,end:m.end-leading}))});}return original(b,e);};}

  function searchRows(el,remote){if(el._remote?.query===remote.query)el._draw?.();}
  ACTIONS['comm-search']=()=>openSearch('msg');
  ACTIONS['comm-search-more']=b=>busy(b,async ok=>{
    const el=$('#srch'),remote=el?._remote,query=b.dataset.query,cursor=b.dataset.cursor;
    if(!el?.isConnected || !remote || remote.query!==query || remote.messageNext!==cursor)return;
    const r=await API.req('GET','/dm/search?q='+encodeURIComponent(query)+'&cursor='+encodeURIComponent(cursor));
    if(!ok() || $('#srch')!==el || !el.isConnected || el._remote!==remote || remote.messageNext!==cursor)return;
    remote.messages.push(...r.items);remote.messageNext=r.next;searchRows(el,remote);
  });
  ACTIONS['comm-jump-message']=b=>busy(b,async ok=>{const active=()=>ok()&&b.isConnected!==false,r=await API.req('GET',`/dm/messages/${encodeURIComponent(b.dataset.id || b.dataset.messageId)}/context`);if(!active())return;await dmRefs(r.items.map(dmMap));if(!active())return;const uid=r.peer.id;apiUser(r.peer);current().context={uid,after:r.after};LDM.full.add(uid);dmMerge(uid,r.items,true);LDM.before[uid]=r.before;closeSearch(false);closeSheet();go('msg-'+uid);LDM.sig[uid]=null;dmPaint(uid);requestAnimationFrame(()=>{const el=[...document.querySelectorAll('[data-dm]')].find(el=>el.dataset.dm==='msg-'+r.target);el?.scrollIntoView({block:'center'});el?.classList.add('flash');});});
  ACTIONS['comm-context-next']=b=>busy(b,async ok=>{const context=current().context,view=CUR.key,active=()=>ok()&&current().context===context&&CUR.key===view,r=await API.req('GET',`/dm/messages/${encodeURIComponent(b.dataset.id)}/context`);if(!active())return;await dmRefs(r.items.map(dmMap));if(!active())return;dmMerge(r.peer.id,r.items);current().context={uid:r.peer.id,after:r.after};LDM.sig[r.peer.id]=null;dmPaint(r.peer.id);});
  ACTIONS['comm-latest']=b=>busy(b,async ok=>{const uid=b.dataset.id;current().context=null;LDM.full.delete(uid);await dmConv(uid);if(!ok())return;LDM.sig[uid]=null;dmPaint(uid);const box=$('#cvB');if(box)box.scrollTop=box.scrollHeight;});

  async function discussion(id,patch){const p=POST(id);if(!p?.live || p.author!==ME)return;const key=scope(),r=await API.req('PATCH',`/posts/${encodeURIComponent(id)}/discussion`,{...patch,expectedVersion:p.discussionVersion || 0});if(!same(key))return;Object.assign(p,r);delete STATE.solved[id];cmtPaint(id);controls();}
  const oldSolve=ACTIONS.solve;ACTIONS.solve=b=>POST(b.dataset.id)?.live ? busy(b,()=>discussion(b.dataset.id,{solved:!POST(b.dataset.id).solved})):oldSolve(b);
  ACTIONS['comm-close-comments']=b=>busy(b,()=>discussion(b.dataset.id,{commentsClosed:!POST(b.dataset.id)?.commentsClosed}));
  ACTIONS['comm-pin-comment']=b=>busy(b,()=>discussion(b.dataset.id,{pinnedCommentId:POST(b.dataset.id)?.pinnedCommentId===b.dataset.cid ? null:b.dataset.cid}));
  const oldForNotice=cmtForNotice;
  const commentRefKey=(pid,id)=>JSON.stringify([pid,id]);
  function commentReference(pid,id){return current().commentReferences?.get(commentRefKey(pid,id));}
  function cacheCommentReference(pid,raw){const refs=current().commentReferences ||=new Map(),key=commentRefKey(pid,raw.id),prior=refs.get(key),c=cmtLikeHydrate(apiCmt(raw));if(prior?.parentId===c.parentId&&prior?.parentAvailable!==undefined)c.parentAvailable=prior.parentAvailable;refs.delete(key);refs.set(key,c);while(refs.size>512)refs.delete(refs.keys().next().value);return c;}
  comm.commentReference=commentReference;
  const fetchCommentContext=(pid,target,signal)=>API.req('GET',`/posts/${encodeURIComponent(pid)}/comments/context?target=${encodeURIComponent(target)}`,undefined,true,{signal});
  function validCommentContext(r,pid,target){const valid=c=>c?.postId===pid&&typeof c.id==='string'&&typeof c.body==='string'&&c.author?.id&&Number.isFinite(+new Date(c.createdAt));return r&&r.target===target&&Array.isArray(r.items)&&r.items.length<=101&&new Set(r.items.map(c=>c.id)).size===r.items.length&&r.items.some(c=>c.id===target)&&r.items.every(valid)&&(!r.parent||valid(r.parent))&&[r.before,r.after].every(id=>id===null||typeof id==='string');}
  // 通知补读与可见评论分开，既不重排正在阅读的列表，也不推进其分页游标。
  cmtForNotice=function(pid,id,force){
    if(!POST(pid)?.live)return oldForNotice(pid,id,force);const key=scope(),registry=current().commentFlights ||=new Map(),ref=commentRefKey(pid,id);if(registry.has(ref))return registry.get(ref);
    const task=Promise.resolve().then(()=>fetchCommentContext(pid,id)).then(r=>{if(!same(key))return null;if(!validCommentContext(r,pid,id))throw Error('评论定位结果不完整，请重试');if(r.parent)cacheCommentReference(pid,r.parent);const c=cacheCommentReference(pid,r.items.find(c=>c.id===id));if(c.parentId){c.parentAvailable=!!r.parent;const visible=cmtsOf(pid).find(v=>v.id===id);if(visible&&visible.parentAvailable!==c.parentAvailable){visible.parentAvailable=c.parentAvailable;if(commentVisible(pid))cmtPaint(pid);}}return c;}).catch(e=>{if([403,404].includes(e.status)){if(same(key))current().commentReferences?.delete(ref);return null;}throw e;}).finally(()=>{if(registry.get(ref)===task)registry.delete(ref);});registry.set(ref,task);return task;
  };
  const oldLoadComments=loadLiveCmts;
  function paintCommentContext(pid,preserve){
    const box=CUR.post===pid?$('#post .scroll'):RL.on&&reelCur()?.id===pid?$('.rl-cm-l',RL.el):null,top=box?.getBoundingClientRect().top,anchor=preserve&&box?[...box.querySelectorAll('[data-cmt-id]')].find(el=>{const r=el.getBoundingClientRect();return r.bottom>top&&r.top<top+box.clientHeight;}):null,id=anchor?.dataset.cmtId,offset=anchor?anchor.getBoundingClientRect().top-top:0;cmtPaint(pid);
    const next=CUR.post===pid?$('#post .scroll'):RL.on&&reelCur()?.id===pid?$('.rl-cm-l',RL.el):null,restored=id&&next?[...next.querySelectorAll('[data-cmt-id]')].find(el=>el.dataset.cmtId===id):null;if(restored)next.scrollTop+=restored.getBoundingClientRect().top-next.getBoundingClientRect().top-offset;
  }
  function loadCommentContext(pid,target,direction='replace'){
    let s=liveCmtState(pid);if(!s)return Promise.resolve(null);if(s.context&&s.task&&(direction!=='replace'||s.context.target===target))return s.task;
    if(direction==='replace'){
      s.controller?.abort();const prior=s.context,keep=prior?.target===target;if(!keep)COMMENTS[pid]=[];
      s=LIVE.cmts[pid]={scope:cmtScope(),status:'idle',loaded:keep&&s.loaded,next:null,task:null,controller:null,context:{target,before:keep?prior.before:null,after:keep?prior.after:null}};
    }
    const session=cmtScope(),controller=new AbortController(),active=()=>cmtScope()===session&&LIVE.cmts[pid]===s;
    s.status='pending';s.more=direction!=='replace';s.controller=controller;s.context.unavailable=false;
    const task=Promise.resolve().then(()=>fetchCommentContext(pid,target,controller.signal)).then(r=>{
      if(!active())return null;if(!validCommentContext(r,pid,target))throw Error('评论定位结果不完整，请重试');if(direction==='before'&&r.before===target||direction==='after'&&r.after===target)throw Error('评论分页没有前进，请重试');
      const rows=r.items.map(raw=>cacheCommentReference(pid,raw)),old=direction==='replace'?[]:COMMENTS[pid] || [],values=new Map([...old,...rows].map(c=>[c.id,c])),order=[...new Set((direction==='before'?[...rows,...old]:[...old,...rows]).map(c=>c.id))];COMMENTS[pid]=order.map(id=>values.get(id));
      if(r.parent)cacheCommentReference(pid,r.parent);const found=rows.find(c=>c.id===target);if(found?.parentId)found.parentAvailable=!!r.parent;const known=new Set(rows.map(c=>c.id));UI.newCmts[pid]=(UI.newCmts[pid] || []).filter(c=>!c.id||!known.has(c.id));
      if(direction==='replace'||direction==='before')s.context.before=r.before || null;if(direction==='replace'||direction==='after')s.context.after=r.after || null;
      s.context.retry=null;s.loaded=true;s.status='ready';paintCommentContext(pid,direction!=='replace');return COMMENTS[pid].find(c=>c.id===target) || null;
    }).catch(error=>{
      if(!active())return null;if(error.name==='AbortError'){s.status=s.loaded?'ready':'idle';return null;}
      if([401,403,404].includes(error.status)){COMMENTS[pid]=[];s.loaded=false;s.context.before=s.context.after=null;s.context.unavailable=true;}
      s.status='error';s.context.retry={target,direction};s.context.error=error.message || '评论读取失败';paintCommentContext(pid,direction!=='replace'&&!s.context.unavailable);return null;
    }).finally(()=>{if(active()&&s.task===task){s.task=null;s.controller=null;}});s.task=task;paintCommentContext(pid,direction!=='replace');return task;
  }
  loadLiveCmts=function(pid,more=false,force=false){
    const s=liveCmtState(pid),target=UI.commentJump?.p===pid&&UI.commentJump.id;
    if(target&&!more&&POST(pid)?.live)return loadCommentContext(pid,target);
    if(s?.context){if(s.task)return s.task;if(more)return s.context.after?loadCommentContext(pid,s.context.after,'after'):Promise.resolve(null);const retry=s.context.retry;return force?retry?loadCommentContext(pid,retry.target,retry.direction):loadCommentContext(pid,s.context.target):Promise.resolve(null);}
    return oldLoadComments(pid,more,force);
  };
  const oldJump=commentJumpReady;commentJumpReady=async function(pid){
    const jump=UI.commentJump;if(!jump||jump.p!==pid||!jump.id||!POST(pid)?.live)return oldJump(pid);if(jump.started)return;jump.started=true;const key=cmtScope();if(RL.on&&reelCur()?.id===pid)openReelCm();
    const c=await loadCommentContext(pid,jump.id);if(cmtScope()!==key||UI.commentJump!==jump||!commentVisible(pid))return;const s=liveCmtState(pid);if(s.status!=='ready'&&!s.context?.unavailable)return;
    UI.commentJump=null;UI.flashCmt=c?{p:pid,id:c.id,t:c.t,u:c.u}:null;if(!c)toast('这条评论已不可用，或当前无法查看','blue');cmtPaint(pid);
  };
  const contextControls=pid=>{const s=liveCmtState(pid),c=s?.context;if(!c)return '';const disabled=s.status==='pending'?' disabled':'';return `<div class="comm-comment-context" role="group" aria-label="评论上下文"><span>正在查看这条评论附近的内容</span><div class="comm-actions">${c.before?`<button class="pill sm lt" data-act="comm-comment-before" data-p="${esc(pid)}"${disabled}>更早评论</button>`:''}${c.after?`<button class="pill sm lt" data-act="comm-comment-after" data-p="${esc(pid)}"${disabled}>后续评论</button>`:''}${c.unavailable?`<button class="pill sm lt" data-act="comm-comment-retry" data-p="${esc(pid)}"${disabled}>重新定位</button>`:''}<button class="pill sm lt" data-act="comm-comment-all" data-p="${esc(pid)}">查看全部评论</button></div></div>`;};
  const oldCmtStatus=cmtStatusHtml;cmtStatusHtml=function(pid){const s=liveCmtState(pid),feedback=s?.context?.unavailable?'<div class="request-note" role="status">这条评论已删除或暂不可查看</div>':oldCmtStatus(pid);return (s?.context?contextControls(pid):'')+feedback;};
  const oldCmtMore=cmtMoreHtml;cmtMoreHtml=pid=>liveCmtState(pid)?.context?contextControls(pid):oldCmtMore(pid);
  for(const [act,direction]of [['comm-comment-before','before'],['comm-comment-after','after']])ACTIONS[act]=b=>{const pid=b.dataset.p,s=liveCmtState(pid),target=s?.context?.[direction];return target?loadCommentContext(pid,target,direction):Promise.resolve(null);};
  ACTIONS['comm-comment-retry']=b=>{const pid=b.dataset.p,s=liveCmtState(pid),target=s?.context?.target,key=cmtScope();if(!target)return Promise.resolve(null);return loadCommentContext(pid,target).then(c=>{if(c&&key===cmtScope()&&liveCmtState(pid)?.context?.target===target&&commentVisible(pid)){UI.flashCmt={p:pid,id:c.id,t:c.t,u:c.u};cmtPaint(pid);}return c;});};
  ACTIONS['comm-comment-all']=b=>{const pid=b.dataset.p,s=liveCmtState(pid);s?.controller?.abort();delete LIVE.cmts[pid];if(UI.commentJump?.p===pid)UI.commentJump=null;UI.flashCmt=null;commentRouteTarget(pid,null);const task=oldLoadComments(pid,false,true);cmtPaint(pid);return task;};

  comm.openActivity=async function(orig,b,e){const key=scope(),kind=b.dataset.v,count=NOTE_NEW[kind],reads=(NOTES[kind] || []).map(n=>[n,!!n.read]);orig(b,e);NOTE_NEW[kind]=count;reads.forEach(([n,read])=>n.read=read);msgBadge();const list=$('#layer .m-list');if(list){LACT.panel={k:kind,list,current:dmSession()};actPanelPaint();}
    try{await actLoad(true);if(!same(key))return;const token=current().tokens[kind];if(!token)throw Error('通知快照未读取成功，请重试');await API.req('POST','/me/activity/read',{kind,through:token});if(!same(key))return;current().version=null;await actLoad(true);await poll();}catch(err){if(same(key)){apiFail(err);actPanelPaint();}}
  };
  const oldAtMark=atMark;atMark=function(id){if(!liveUser() || !/^ac_/.test(id))return oldAtMark(id);if(AT_READ.has(id))return;const key=scope(),pending=current().activityReads ||= new Map();if(pending.has(id))return pending.get(id);const task=API.req('POST','/me/activity/read',{ids:[id]}).then(async()=>{if(!same(key))return;AT_READ.add(id);const item=(NOTES.at || []).find(n=>n.id===id);if(item)item.read=true;current().version=null;await actLoad(true);actPanelPaint();msgBadge();}).catch(e=>{if(same(key))apiFail(e);}).finally(()=>pending.delete(id));pending.set(id,task);return task;};
  ACTIONS['activity-read']=b=>busy(b,()=>atMark(b.dataset.id));
  ACTIONS['at-all']=b=>busy(b,async ok=>{if(!current().tokens.at){const loaded=await actLoad(true);if(!ok())return;if(loaded===false)throw Error('通知尚未读取成功，请重试');}if(!ok())return;const through=current().tokens.at;if(!through)throw Error('通知尚未读取成功，请重试');await API.req('POST','/me/activity/read',{kind:'at',through});if(!ok())return;current().version=null;await actLoad(true);if(ok())await poll();});
  comm.openOfficial=async function(orig,b,e){const key=scope(),old=(ADM.inbox[ME] || []).map(n=>[n,n.read]);orig(b,e);old.forEach(([n,read])=>n.read=read);msgBadge();try{LDM.sysMark=null;const loaded=await sysLoad();if(!same(key))return;const through=current().tokens.official;if(loaded===false || !through)throw Error('官方通知尚未读取成功，请重试');await API.req('POST','/notifications/read-all?through='+encodeURIComponent(through));if(!same(key))return;current().version=null;LDM.sysMark=null;await sysLoad();if(same(key))await poll();}catch(err){if(same(key))apiFail(err);}};

  let editing=null;
  function releaseEditVideo(editor){editor.videoJob?.abort();editor.videoJob=null;const host=editor.panel?.querySelector('#commVideoPreview');if(host)NATIVE_VIDEO.release(host);cpReleaseVideo(editor.video);editor.video=null;}
  function disposeEditing(editor){editor.closed=true;releaseEditVideo(editor);if(editing===editor)editing=null;}
  function paintEditVideo(editor){
    const host=editor.panel?.querySelector('#commVideoPreview');if(!host||editing!==editor||editor.closed)return;NATIVE_VIDEO.release(host);const video=editor.video,p=POST(editor.id);
    host.innerHTML=video ? `<p class="comm-video-choice">${esc(video.file.name)}</p>${video.loading ? '<p role="status">正在读取视频与封面…</p>':video.error ? `<p role="status">${esc(video.error)}</p><button class="pill sm lt" data-act="comm-video-retry">重新读取视频</button>`:nativeVideoHTML({id:'draft',title:'更换视频预览',vurl:video.url,poster:video.posterUrl,h:clamp(video.h/video.w,.3,3)})}<button class="pill sm lt" data-act="comm-video-cancel">取消更换，保留原视频</button>`:p?.nativeVideo ? nativeVideoHTML(p):'<p class="mut2">选中视频后将替换原媒体和封面；保存前可取消更换。</p>';
    NATIVE_VIDEO.mount(host);
  }
  async function selectEditVideo(editor,file){
    if(!file||editing!==editor||editor.closed||editor.busy||editor.scope!==scope())return;releaseEditVideo(editor);const video=editor.video={file,mime:CZVideo.mime(file),loading:true},controller=editor.videoJob=new AbortController();
    const current=()=>editing===editor&&!editor.closed&&editor.scope===scope()&&editor.video===video&&editor.panel?.isConnected&&!controller.signal.aborted;
    paintEditVideo(editor);try{if(!video.mime)throw Error('支持MP4、MOV、WebM视频');if(!file.size||file.size>500*1024*1024)throw Error('请选择不超过500MB的非空视频');const meta=await CZVideo.inspect(file,{signal:controller.signal});if(!current())return;Object.assign(video,meta,{loading:false,url:URL.createObjectURL(file)});if(meta.poster)video.posterUrl=URL.createObjectURL(meta.poster);}
    catch(e){if(!current())return;video.loading=false;video.error=e.message||'视频无法读取，请重试或换一个文件';}if(current())paintEditVideo(editor);
  }
  ACTIONS['comm-video-cancel']=()=>{const editor=editing;if(!editor||editor.busy)return;releaseEditVideo(editor);const input=editor.panel?.querySelector('#commVideo');if(input)input.value='';paintEditVideo(editor);};
  ACTIONS['comm-video-retry']=()=>{const editor=editing;if(editor?.video)return selectEditVideo(editor,editor.video.file);};
  const oldEdit=ACTIONS['post-edit'];ACTIONS['post-edit']=b=>{const p=POST(b.dataset.id);if(!p?.live)return oldEdit(b);if(p.author!==ME)return;if(p.serverStatus==='taken_down')return ACTIONS['comm-appeal'](b);
    const isVideo=p.serverType==='video'||p.nativeVideo||p.type==='video'&&!p.vis,editor=editing={id:p.id,scope:scope(),files:[],retained:(p.serverMedia || []).map(m=>m.key),isVideo,video:null};
    const media=isVideo ? '':(p.serverMedia || []).map((m,i)=>`<label><input type="checkbox" data-comm-retain="${esc(m.key)}" checked>保留${m.kind==='image' ? '图片':m.kind==='audio' ? '音频':'媒体'} ${i+1}</label>`).join('');
    sheet(`<h3>编辑帖子</h3><label class="ad-lab" for="peT">标题</label><input class="inp" id="peT" value="${esc(p.title)}" maxlength="60"><label class="ad-lab" for="peB">正文</label><textarea class="inp" id="peB" rows="6" maxlength="5000">${esc(p.rawBody || '')}</textarea>${media ? '<div class="comm-media-list">'+media+'</div>':''}${isVideo ? '<div class="comm-video-editor"><label class="ad-lab" for="commVideo">更换视频</label><input class="inp" id="commVideo" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"><div id="commVideoPreview"></div><p class="mut2">选择后替换原视频和封面，最多500MB。仅修改文字会保留媒体；更换视频可能需要复审。</p></div>':['image','audio'].includes(p.serverMedia?.[0]?.kind) ? `<label class="ad-lab" for="commMedia">追加或替换媒体</label><input class="inp" id="commMedia" type="file" ${p.serverMedia[0].kind==='image' ? 'accept="image/*" multiple':'accept="audio/*"'}><p class="mut2">替换时取消勾选原媒体，最多9个文件。图片和音频改动可能重新送审。</p>`:''}<p class="comm-editor-note">需要复审时，整帖暂时仅自己可见。保存失败会保留当前输入。</p><p class="comm-edit-status" data-edit-status role="status" hidden></p><button class="pill lg" data-act="post-esave" data-id="${esc(p.id)}">保存修改</button>`,d=>{editor.panel=d;attachEditor($('#peB',d));const data=editors.get($('#peB',d));if(data)data.mentions=[...(p.mentions || [])];$('#commMedia',d)?.addEventListener('change',e=>{if(editing===editor&&!editor.busy)editor.files=[...e.target.files].map(file=>({file,uploadId:null}));});$('#commVideo',d)?.addEventListener('change',e=>void selectEditVideo(editor,e.target.files?.[0]));if(isVideo)paintEditVideo(editor);return()=>disposeEditing(editor);});
  };
  const oldSave=ACTIONS['post-esave'];ACTIONS['post-esave']=b=>{const p=POST(b.dataset.id);if(!p?.live)return oldSave(b);return busy(b,async ok=>{
    const title=$('#peT')?.value.trim(),input=$('#peB'),text=input?.value || '';if(!title){toast('请填写标题','orange');return;}const editor=editing;if(!input || !editor || editor.busy || editor.closed || editor.id!==p.id || editor.scope!==scope())return;
    const video=editor.video,active=()=>ok() && editing===editor && !editor.closed && editor.video===video && $('#peB')===input && input.isConnected;
    if(video?.loading||video?.error){toast(video.loading?'视频正在读取，请稍候':'请重新读取视频或取消更换','orange');return;}
    const retained=editor.isVideo ? editor.retained:[...document.querySelectorAll('[data-comm-retain]:checked')].map(el=>el.dataset.commRetain),uploadIds=[],mentions=editors.get(input)?.mentions || [],body={title,body:text,mentions};
    if(retained.length+editor.files.length>9){toast('最多保留或上传9个文件','orange');return;}
    editor.busy=true;const message=text=>{const status=editor.panel?.querySelector('[data-edit-status]');if(status){status.textContent=text;status.hidden=!text;}},disabled=[...(editor.panel?.querySelectorAll('input,textarea,button:not(.x-close)')||[])].map(el=>[el,el.disabled]);disabled.forEach(([el])=>el.disabled=true);message('正在保存修改…');
    try{
      if(video){if(!video.uploadId)message('正在上传视频…');video.uploadId ||= (await liveUpload(video.file.type===video.mime?video.file:video.file.slice(0,video.file.size,video.mime),'post_video',undefined,{current:active})).id;if(!active())return;uploadIds.push(video.uploadId);if(video.poster){if(!video.posterUploadId)message('正在上传封面…');video.posterUploadId ||= (await liveUpload(new File([video.poster],'video-cover.jpg',{type:'image/jpeg'}),'post_image',undefined,{current:active})).id;if(!active())return;uploadIds.push(video.posterUploadId);}const style={...(p.serverStyle||{}),dur:video.duration,h:clamp(video.h/video.w,.3,3)};delete style.url;delete style.plat;Object.assign(body,{uploadIds,retainedMediaKeys:[],style});}
      else{for(const entry of editor.files){if(!active())return;entry.uploadId ||= (await liveUpload(entry.file,entry.file.type.startsWith('image/') ? 'post_image':'post_audio',undefined,{current:active})).id;if(!active())return;uploadIds.push(entry.uploadId);}if(uploadIds.length||JSON.stringify(retained)!==JSON.stringify(editor.retained || (p.serverMedia||[]).map(m=>m.key)))Object.assign(body,{uploadIds,retainedMediaKeys:retained});}
      if(!active())return;message('正在保存修改…');const raw=await API.req('PATCH',`/posts/${encodeURIComponent(p.id)}`,body);if(!active())return;Object.assign(p,apiPost(raw));closeSheet();if(editing===editor)editing=null;softRefresh();toast(p.review ? '修改已提交复审，通过前仅自己可见':'修改已保存');
    }catch(e){if(active())message((e.message||'保存未完成')+'\n输入和文件仍保留，可以重新保存。');throw e;}finally{editor.busy=false;disabled.forEach(([el,was])=>{if(el.isConnected)el.disabled=was;});}
  });};

  // 后续发布管理与通知操作均在当前账号完成服务器确认后才更新页面。
  const mePage=ROUTES.me;ROUTES.me=function(arg){const h=mePage(arg);return liveUser() && !arg ? h.replace(/(<div class="wrap[^>]*>)/,'$1<div class="comm-list-actions"><button class="pill sm lt" data-act="comm-publications">我的发布与审核</button></div>'):h;};
  let publicationPage=null;
  ACTIONS['comm-publications']=b=>busy(b,()=>publications('all'));
  async function publications(filter,cursor){const key=scope(),r=await API.req('GET','/me/posts?limit=20&status='+filter+(cursor ? '&cursor='+encodeURIComponent(cursor):''));if(!same(key))return;for(const raw of r.items){const p=apiPost(raw),old=POST(p.id);if(old)Object.assign(old,p);else POSTS.push(p);}publicationPage={filter,next:r.next,rows:cursor ? [...(publicationPage?.rows || []),...r.items]:r.items};drawPublications();}
  function drawPublications(){const s=publicationPage;sheet(`<h3>我的发布</h3><div class="comm-actions">${[['all','全部'],['published','已发布'],['review','审核中'],['taken_down','未通过 / 已下架']].map(([k,label])=>`<button class="pill sm ${s.filter===k ? '':'lt'}" data-act="comm-publication-filter" data-filter="${k}" aria-pressed="${s.filter===k}">${label}</button>`).join('')}</div><div class="comm-publications">${s.rows.map(p=>`<article class="comm-publication"><a data-go="post-${esc(p.id)}"><b>${esc(p.title)}</b></a><span class="mut2">${p.status==='review' ? '审核中':p.status==='taken_down' ? '未通过审核或已下架':'已发布 · '+(globalThis.CZPostAudience?.label(p.visibility===undefined?'public':p.visibility)||'范围待确认')}</span>${p.takedownReason ? `<p>${esc(p.takedownReason)}</p>`:''}<div class="comm-actions">${p.status==='taken_down' ? `<button class="pill sm lt" data-act="comm-appeal" data-id="${esc(p.id)}">申诉</button>`:`<button class="pill sm lt" data-act="post-edit" data-id="${esc(p.id)}">编辑</button>`}${globalThis.CZPostAudience?.action(p)||''}</div></article>`).join('') || '<p class="mut">当前分类没有发布记录</p>'}</div>${s.next ? '<button class="pill sm lt" data-act="comm-publications-more">加载更多</button>':''}`);}
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
