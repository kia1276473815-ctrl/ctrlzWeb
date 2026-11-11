/* 官方通知：沿用现有通知和申诉面板，分页、读取与标读分别确认。 */
(function(){
  'use strict';
  const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]);
  const fresh=()=>({scope:scope(),rows:[],loaded:false,status:'idle',error:'',next:null,bridge:null,seen:new Set(),invalid:false,unread:undefined,token:null,mark:null,headTask:null,headController:null,headSeq:0,moreTask:null,moreController:null,moreError:'',generation:0,readTask:null,readStatus:'idle',readError:'',intent:null,panel:null,panelEpoch:0,started:false,search:null});
  let owner=null;
  const valid=s=>owner===s&&s.scope===scope()&&liveUser()&&API.on();
  function current(){if(!owner||owner.scope!==scope()){dispose(owner);owner=fresh();}return owner;}
  const panelCurrent=s=>valid(s)&&s.panel?.isConnected&&s.panel===document.querySelector('#layer [data-official-inbox]')&&s.panelEpoch===(closeSheet.epoch||0);
  const searchable=()=>typeof LIVE!=='undefined'&&LIVE.cfg?.officialSearch?.version===1&&LIVE.cfg.officialSearch.cursor==='signed-v1'&&['title','body'].every(k=>LIVE.cfg.officialSearch.fields?.includes(k));
  function stopSearch(s){s?.search?.controller?.abort();if(s)s.search=null;}
  function dispose(s){if(!s)return;stopSearch(s);s.headController?.abort();s.moreController?.abort();if(s.panel?.isConnected&&s.panel===document.querySelector('#layer [data-official-inbox]'))closeSheet({instant:true});}
  function validate(r){
    if(!r||!Array.isArray(r.items)||r.items.length>50||!Number.isSafeInteger(r.unread)||r.unread<0||typeof r.readToken!=='string'||!r.readToken||!(r.next===null||typeof r.next==='string'&&r.next.startsWith('n_')&&r.next.length<2048))throw Error('通知读取结果不完整，请重新读取');
    const ids=new Set();for(const n of r.items){if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id)||typeof n.title!=='string'||typeof n.body!=='string'||typeof n.read!=='boolean'||!Number.isFinite(Date.parse(n.createdAt))||!n.extra||typeof n.extra!=='object'||Array.isArray(n.extra))throw Error('通知读取结果不完整，请重新读取');ids.add(n.id);}
    if(!r.items.length&&r.next)throw Error('通知分页没有前进，请重新读取');return r;
  }
  function adapt(raw,old){return{...raw.extra,id:raw.id,title:raw.title,text:raw.body,ts:Date.parse(raw.createdAt),read:raw.read||!!old?.read,...(old?.done?{done:true}:{})};}
  function unique(rows){const ids=new Set();return rows.filter(n=>!ids.has(n.id)&&ids.add(n.id));}
  function search(query,more=false){
    const s=current();if(!searchable()||!panelCurrent(s))return Promise.resolve(false);
    query=String(query??'').trim().normalize('NFC');if(!query){clearSearch();return Promise.resolve(true);}
    if(query.length>80||query.includes('\0'))return Promise.resolve(false);
    let v=s.search;if(!v||v.query!==query){stopSearch(s);v=s.search={query,rows:[],count:null,next:null,seen:new Set(),loaded:false,invalid:false,status:'idle',error:'',task:null,controller:null};}
    if(v.task)return v.task;if(more&&(!v.next||v.invalid))return Promise.resolve(false);
    const cursor=more?v.next:null,controller=v.controller=new AbortController();v.status='pending';v.error='';
    const active=()=>panelCurrent(s)&&s.search===v;
    const task=Promise.resolve().then(()=>{if(!active())return null;return API.req('GET','/notifications/search?q='+encodeURIComponent(query)+'&limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,true,{signal:controller.signal});}).then(r=>{
      if(!active())return false;
      if(!r||r.scope?.version!==1||r.scope.userId!==ME||r.scope.query!==query||!Number.isSafeInteger(r.count)||r.count<0||!Array.isArray(r.items)||r.items.length>20||r.count<r.items.length||!(r.next===null||typeof r.next==='string'&&r.next.startsWith('ons1_')&&r.next.length<=2048))throw Error('通知搜索结果不完整，请重试');
      validate({...r,readToken:'search-only',unread:0,next:null});
      if(r.next&&(r.next===cursor||v.seen.has(r.next))||!r.items.length&&r.next)throw Object.assign(Error('搜索分页已失效，请重新搜索'),{code:'bad_cursor'});
      const old=new Map(v.rows.map(n=>[n.id,n])),incoming=r.items.map(n=>adapt(n,old.get(n.id)));
      const merged=new Map((more?v.rows:[]).map(n=>[n.id,n]));incoming.forEach(n=>merged.set(n.id,n));v.rows=[...merged.values()];v.next=r.next;v.count=r.count;v.loaded=true;v.invalid=false;v.status='ready';if(cursor)v.seen.add(cursor);else v.seen.clear();return true;
    }).catch(error=>{if(active()&&error.name!=='AbortError'){v.status='error';v.error=error.message||'通知搜索失败，请重试';v.failedMore=!!cursor;if(error.code==='bad_cursor')v.invalid=true;if([401,403].includes(error.status)){v.rows=[];v.count=null;v.next=null;v.loaded=false;}return false;}}).finally(()=>{if(s.search===v&&v.task===task){v.task=null;v.controller=null;if(active())paint(s);}});
    v.task=task;paint(s);return task;
  }
  function clearSearch(){const s=current();stopSearch(s);const input=s.panel?.querySelector('[data-official-query]');if(input)input.value='';paint(s);}
  // Reuse unchanged rows, including their focused action, during background polling.
  function patchRows(list,rows,empty){
    const html=rows.map(row).join('')||empty;
    if(typeof document.createElement!=='function'){if(list.innerHTML!==html)list.innerHTML=html;return;}
    const template=document.createElement('template');template.innerHTML=html;const known=new Map([...list.children].filter(n=>n.dataset.noticeId).map(n=>[n.dataset.noticeId,n]));let position=list.firstChild;
    for(const fresh of [...template.content.childNodes]){const old=fresh.nodeType===1&&known.get(fresh.dataset.noticeId),node=old||fresh;if(old){old.className=fresh.className;if(old.innerHTML!==fresh.innerHTML)old.innerHTML=fresh.innerHTML;known.delete(fresh.dataset.noticeId);}if(node!==position)list.insertBefore(node,position);position=node.nextSibling;}
    while(position){const next=position.nextSibling;position.remove();position=next;}
  }
  function setHtml(node,html){if(node.innerHTML!==html)node.innerHTML=html;}
  function publish(s){if(!valid(s))return;ADM.inbox[ME]=s.rows;msgBadge();if(CUR.key?.startsWith('msg|')){LDM.side='';dmPaint(CUR.key.slice(4));}paint(s);}
  function applyHead(s,r,reset){
    validate(r);const old=s.rows,byId=new Map(old.map(n=>[n.id,n])),rows=r.items.map(n=>adapt(n,byId.get(n.id))),overlap=rows.some(n=>byId.has(n.id)),invalid=s.invalid&&!reset;
    s.generation++;s.moreController?.abort();s.moreTask=null;s.moreController=null;if(!invalid)s.moreError='';
    if(reset||!s.loaded||!overlap&&!r.next){s.rows=rows;s.next=r.next;s.bridge=null;s.seen.clear();}
    else{if(!overlap){s.bridge={ids:new Set(old.map(n=>n.id)),next:s.next,bridge:s.bridge};s.next=r.next;s.seen.clear();}s.rows=unique([...rows,...old]);}
    s.loaded=true;s.invalid=invalid;s.unread=r.unread;s.token=r.readToken;s.mark=JSON.stringify([r.items[0]?.id,r.unread]);s.status='ready';s.error='';LDM.sysMark=s.mark;globalThis.CZCommunication?.officialToken(s.token);publish(s);
  }
  function load(force=false,reset=false){
    if(!liveUser()||!API.on())return Promise.resolve(false);const s=current();if(s.headTask)return s.headTask;
    const seq=++s.headSeq,controller=s.headController=new AbortController();s.started=true;s.status='pending';s.error='';paint(s);
    const active=()=>valid(s)&&seq===s.headSeq;
    const task=Promise.resolve().then(async()=>{
      if(s.loaded&&s.mark&&!force&&!reset){const head=validate(await API.req('GET','/notifications?limit=1',undefined,true,{signal:controller.signal}));if(!active())return false;if(JSON.stringify([head.items[0]?.id,head.unread])===s.mark){s.status='ready';paint(s);return true;}}
      const r=await API.req('GET','/notifications?limit=50',undefined,true,{signal:controller.signal});if(!active())return false;applyHead(s,r,reset);return true;
    }).catch(error=>{if(active()&&error.name!=='AbortError'){s.status='error';s.error=error.message||'通知读取失败';paint(s);}return false;}).finally(()=>{if(valid(s)&&s.headTask===task){s.headTask=null;s.headController=null;paint(s);}});s.headTask=task;paint(s);return task;
  }
  function more(){
    const s=current();if(!valid(s)||!s.loaded||!s.next||s.invalid||s.headTask)return Promise.resolve(false);if(s.moreTask)return s.moreTask;
    const cursor=s.next,generation=s.generation,controller=s.moreController=new AbortController();s.moreError='';
    const active=()=>valid(s)&&generation===s.generation&&s.moreTask===task;
    const task=Promise.resolve().then(()=>API.req('GET','/notifications?limit=50&cursor='+encodeURIComponent(cursor),undefined,true,{signal:controller.signal})).then(raw=>{
      if(!active())return false;const r=validate(raw);if(r.next&&(r.next===cursor||s.seen.has(r.next)))throw Object.assign(Error('通知分页已失效，请从最新重新读取'),{code:'bad_cursor'});
      const old=new Map(s.rows.map(n=>[n.id,n])),incoming=r.items.map(n=>adapt(n,old.get(n.id))),anchor=cursor.startsWith('n_')?cursor.slice(2):'',index=s.rows.findIndex(n=>n.id===anchor);
      if(index<0)throw Object.assign(Error('通知分页已失效，请从最新重新读取'),{code:'bad_cursor'});
      s.rows=unique([...s.rows.slice(0,index+1),...incoming,...s.rows.slice(index+1)]);s.seen.add(cursor);
      if(s.bridge&&incoming.some(n=>s.bridge.ids.has(n.id))){s.next=s.bridge.next;s.bridge=s.bridge.bridge;}else s.next=r.next;
      publish(s);return true;
    }).catch(error=>{if(active()&&error.name!=='AbortError'){s.moreError=error.message||'较早通知读取失败';if(error.code==='bad_cursor'){s.invalid=true;}paint(s);}return false;}).finally(()=>{if(valid(s)&&s.moreTask===task){s.moreTask=null;s.moreController=null;paint(s);}});s.moreTask=task;paint(s);return task;
  }
  async function mark(intent){
    const s=current();if(!valid(s)||!intent?.token)return false;if(s.readTask)return s.readTask;
    s.intent=intent;s.readStatus='pending';s.readError='';
    const task=Promise.resolve().then(()=>API.req('POST','/notifications/read-all?through='+encodeURIComponent(intent.token))).then(async r=>{
      if(!valid(s))return false;if(r?.ok!==true)throw Error('服务端未确认已读结果');
      s.headSeq++;s.headController?.abort();s.headTask=null;s.headController=null;s.readStatus='confirmed';s.readError='';paint(s);
      const loaded=await load(true);if(!valid(s))return false;if(loaded){s.readStatus='done';s.intent=null;}else{s.readError='已读操作已确认，通知刷新失败；可以只重试读取';}return true;
    }).catch(error=>{if(valid(s)){s.readStatus='error';s.readError=error.message||'标为已读未完成';}return false;}).finally(()=>{if(valid(s)&&s.readTask===task){s.readTask=null;paint(s);}});s.readTask=task;paint(s);return task;
  }
  function row(n){return `<article class="sysm${n.read?'':' new'}" data-notice-id="${esc(n.id)}"><b>${esc(n.title)}</b><p>${esc(n.text)}</p>${n.act==='counter'&&!n.done&&typeof n.rp==='string'?`<button class="pill sm lt" data-act="counter" data-id="${esc(n.rp)}">我没有侵权，提交反通知</button>`:''}${n.act==='wallet'?'<a class="pill sm lt" href="#me-wallet">查看代金券</a>':''}<time>${fmtDay(n.ts)} ${fmtDT(n.ts).slice(6)}</time></article>`;}
  function feedback(s){
    const messages=[];if(s.status==='pending')messages.push('正在读取通知…');if(s.error)messages.push(s.error);if(s.moreError)messages.push(s.moreError);if(s.readStatus==='pending')messages.push('正在标为已读…');if(s.readError)messages.push(s.readError);if(s.readStatus==='confirmed'&&!s.readError)messages.push('已读操作已确认，正在刷新通知…');
    return messages.map(x=>`<p>${esc(x)}</p>`).join('')+(s.readStatus==='error'&&s.intent?'<button class="pill sm lt" data-act="official-read-retry">重试这次标读</button>':'')+(s.status==='error'||s.readStatus==='confirmed'&&s.readError?'<button class="pill sm lt" data-act="official-load-retry">重试读取通知</button>':'');
  }
  function paint(s){
    if(!panelCurrent(s))return;const panel=s.panel,list=panel.querySelector('[data-official-list]'),toolbar=panel.querySelector('[data-official-toolbar]'),status=panel.querySelector('[data-official-status]'),footer=panel.querySelector('[data-official-footer]');
    const v=s.search,focused=panel.contains(document.activeElement)?document.activeElement?.dataset?.act:null,top=list.scrollTop,anchor=[...list.children].find(e=>e.dataset.noticeId&&e.offsetTop>=top),id=anchor?.dataset.noticeId,offset=anchor?anchor.offsetTop-top:0;
    const empty=v?`<div class="rnone">${v.loaded?'没有找到匹配的通知':v.status==='error'?'搜索尚未完成，请重试':'正在搜索通知…'}</div>`:!s.loaded?`<p class="mut">${s.status==='error'?'通知尚未读到，请重试':'正在读取通知…'}</p>`:'<div class="rnone">还没有通知</div>';
    patchRows(list,v?v.rows:s.rows,empty);list.setAttribute('aria-busy',String(v?v.status==='pending':s.status==='pending'||!!s.moreTask));
    const restored=id&&[...list.children].find(e=>e.dataset.noticeId===id);list.scrollTop=restored?restored.offsetTop-offset:top;
    setHtml(toolbar,v?v.loaded?`<button class="pill sm lt" data-act="official-search-refresh"${v.task?' disabled':''}>刷新搜索结果</button>`:'':`<button class="pill sm lt" data-act="official-refresh"${s.headTask?' disabled':''}>刷新到最新</button>${s.token&&s.unread>0?`<button class="pill sm lt" data-act="official-read-current"${s.readTask?' disabled':''}>将当前通知标为已读</button>`:''}`);
    setHtml(status,v?`${v.count!==null?`<p>找到 ${v.count} 条通知 · ${esc(v.query)}</p>`:''}${v.status==='pending'&&v.loaded?'<p>正在搜索通知…</p>':''}${v.error?`<p>${esc(v.error)}</p><button class="pill sm lt" data-act="official-search-retry">${v.invalid?'重新搜索':'重试搜索'}</button>`:''}`:feedback(s));
    setHtml(footer,v?v.next&&!v.invalid?`<button class="pill sm lt" data-act="official-search-more"${v.task?' disabled':''}>${v.task?'正在搜索…':'更多匹配通知'}</button>`:v.loaded&&v.rows.length&&!v.invalid?'<p class="mut">已显示全部匹配通知</p>':'':s.invalid?'<button class="pill sm lt" data-act="official-refresh">从最新重新读取</button>':s.next?`<button class="pill sm lt" data-act="official-more"${s.moreTask||s.headTask?' disabled':''}>${s.moreTask?'正在加载…':s.moreError?'重试加载较早通知':'加载较早通知'}</button>`:s.loaded&&s.rows.length?'<p class="mut">已显示全部通知</p>':'');
    if(focused&&!panel.contains(document.activeElement)){const button=[...panel.querySelectorAll('button')].find(e=>e.dataset.act===focused);button?.focus({preventScroll:true});}
  }
  async function open(orig,b,e){
    if(!liveUser()||!API.on())return orig(b,e);const s=current();stopSearch(s);
    const form=searchable()?'<div class="official-search"><label class="sr-only" for="officialQuery">搜索官方通知</label><input class="inp" id="officialQuery" data-official-query type="search" maxlength="80" placeholder="搜索通知标题或正文" autocomplete="off"><button class="pill sm" data-act="official-search">搜索</button><button class="pill sm lt" data-act="official-search-clear">清除</button></div>':'';
    sheet('<section class="official-inbox" data-official-inbox><h3>CTRL Z 官方</h3><p class="mut official-intro">审核结果、处罚、结算和平台通知。对处理有异议可以直接回复申诉。</p>'+form+'<div class="official-toolbar" data-official-toolbar></div><div class="official-status" data-official-status role="status" aria-live="polite"></div><div class="sysbox" data-official-list role="region" aria-label="官方通知列表" tabindex="0"></div><div class="official-footer" data-official-footer></div><label class="ad-lab" for="sysR">回复 / 申诉</label><textarea class="inp" id="sysR" placeholder="说明情况，客服会在 1 个工作日内处理"></textarea><button class="pill" data-act="sys-reply">发送</button></section>',()=>()=>stopSearch(s));
    s.panel=document.querySelector('#layer [data-official-inbox]');s.panelEpoch=closeSheet.epoch||0;const input=s.panel?.querySelector('[data-official-query]');let composing=false;input?.addEventListener('compositionstart',()=>composing=true);input?.addEventListener('compositionend',()=>composing=false);input?.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.isComposing&&ev.keyCode!==229&&!composing){ev.preventDefault();void search(input.value);}});input?.addEventListener('search',()=>{if(!input.value)clearSearch();});paint(s);const loaded=await load(true);if(!loaded||!panelCurrent(s)||s.search)return;await mark({token:s.token});
  }
  async function retryLoad(){const s=current(),ok=await load(true);if(valid(s)&&ok&&s.readStatus==='confirmed'){s.readStatus='done';s.readError='';s.intent=null;paint(s);}return ok;}
  ACTIONS['official-more']=()=>more();ACTIONS['official-refresh']=()=>load(true,true);ACTIONS['official-load-retry']=()=>retryLoad();
  ACTIONS['official-read-current']=()=>{const s=current();return s.token?mark({token:s.token}):Promise.resolve(false);};ACTIONS['official-read-retry']=()=>mark(current().intent);
  ACTIONS['official-search']=()=>search(current().panel?.querySelector('[data-official-query]')?.value);ACTIONS['official-search-clear']=clearSearch;
  ACTIONS['official-search-more']=()=>search(current().search?.query,true);ACTIONS['official-search-retry']=()=>{const v=current().search;return v?search(v.query,!v.invalid&&v.failedMore):undefined;};ACTIONS['official-search-refresh']=()=>{const s=current(),q=s.search?.query;stopSearch(s);return q?search(q):undefined;};
  globalThis.CZOfficial={open,load,more,mark,search,clearSearch,get state(){return current();},unread(){return liveUser()&&API.on()?current().unread:undefined;},acceptLegacy(r,key){const s=current();if(!valid(s)||key!==s.scope||s.started)return false;try{applyHead(s,r,false);return true;}catch{return false;}}};
  function reset(){dispose(owner);if(typeof SHEET_GHOSTS!=='undefined')for(const g of SHEET_GHOSTS)if(g.querySelector('[data-official-inbox]')){g.remove();SHEET_GHOSTS.delete(g);}owner=null;}
  const prior=API.credentialReset;API.credentialReset=function(...args){reset();return prior?.apply(this,args);};if(typeof dmReset==='function'){const priorDm=dmReset;dmReset=function(...args){reset();return priorDm.apply(this,args);};}
})();
