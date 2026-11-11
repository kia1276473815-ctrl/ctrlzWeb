/* 关注和粉丝：只从当前服务确认关系，搜索和翻页保持原面板与阅读位置。 */
(function(){
  'use strict';
  const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]),normalize=q=>String(q||'').trim().normalize('NFC');
  const followEpochs=new Map();let owner=null,countDepth=0,countSeq=0,countController=null;
  const valid=s=>!!s&&owner===s&&!s.closed&&s.scope===scope()&&API.on();
  const panelCurrent=s=>valid(s)&&s.panel?.isConnected&&s.panel===document.querySelector('#layer [data-relationship-list]')&&(closeSheet.epoch||0)===s.panelEpoch;
  const pendingFollow=id=>followEpochs.has(id)&&typeof INTERACTIONS!=='undefined'&&INTERACTIONS.has(ME+':follow:'+id);
  const bumped=id=>followEpochs.set(id,(followEpochs.get(id)||0)+1);
  function withOwnFollowingTotal(fn){
    if(countDepth||!API.on()||!liveUser()||typeof USERS==='undefined'||!Number.isFinite(USERS[ME]?.follow))return fn();
    const u=USERS[ME],total=u.follow;countDepth++;u.follow=total-STATE.follows.size;try{return fn();}finally{u.follow=total;countDepth--;}
  }
  function paintOwnFollowingTotal(){
    if(!API.on()||!liveUser()||typeof USERS==='undefined'||!Number.isSafeInteger(USERS[ME]?.follow))return;
    const total=USERS[ME].follow;for(const button of document.querySelectorAll('#app [data-act="me-list"][data-v="follow"]')){
      if(button.dataset.id&&button.dataset.id!==ME)continue;const old=button.querySelector('b');if(!old||old.dataset.roll===String(total))continue;
      const next=old.cloneNode(false);next.dataset.roll=String(total);next.textContent=total.toLocaleString('zh-CN');old.replaceWith(next);
    }
  }
  async function refreshOwnFollowingTotal(){
    if(!API.on()||!liveUser()||typeof USERS==='undefined'||!USERS[ME])return false;
    const prefix=ME+':follow:',pending=()=>typeof INTERACTIONS!=='undefined'&&[...INTERACTIONS.keys()].some(k=>k.startsWith(prefix));if(pending())return false;
    const key=scope(),uid=ME,seq=++countSeq,revision=LIVE.relationshipRevision||0,controller=new AbortController();countController?.abort();countController=controller;
    try{const profile=await API.req('GET','/users/'+encodeURIComponent(uid),undefined,true,{signal:controller.signal});if(scope()!==key||seq!==countSeq||(LIVE.relationshipRevision||0)!==revision||pending()||profile?.id!==uid||!Number.isSafeInteger(profile.following)||profile.following<0)return false;USERS[uid].follow=profile.following;paintOwnFollowingTotal();return true;}
    catch{return false;}finally{if(countController===controller)countController=null;}
  }
  function cancel(s){if(!s)return;clearTimeout(s.timer);s.timer=0;s.seq++;s.controller?.abort();s.controller=null;s.task=null;}
  function dispose(s){if(!s)return;cancel(s);s.capController?.abort();s.closed=true;if(s.panel?.isConnected&&s.panel===document.querySelector('#layer [data-relationship-list]'))closeSheet({instant:true});}
  function expectedViewer(){return liveUser()?ME:null;}
  function validatePage(s,r,query){
    if(!r||!Array.isArray(r.items)||r.items.length>50||!(r.next===null||typeof r.next==='string'&&r.next.length<=2048)||r.next==='')throw Error('列表读取结果不完整，请重试');
    const ids=new Set();for(const u of r.items){if(!u||typeof u.id!=='string'||!u.id||ids.has(u.id)||typeof u.name!=='string'||typeof u.handle!=='string'||typeof u.bio!=='string')throw Error('列表读取结果不完整，请重试');ids.add(u.id);}
    if(!r.items.length&&r.next)throw Object.assign(Error('分页没有前进，请刷新列表'),{code:'bad_cursor'});
    if(s.capable){const c=r.scope;if(c?.version!==1||c.ownerId!==s.uid||c.kind!==s.kind||c.query!==query||c.viewerId!==expectedViewer()||r.items.some(u=>typeof u.isFollowing!=='boolean'))throw Error('搜索或关系状态尚未确认，请刷新后重试');}
    return r;
  }
  function pagePath(s,cursor){return '/users/'+encodeURIComponent(s.uid)+'/'+s.kind+'?limit=50'+(s.query?'&q='+encodeURIComponent(s.query):'')+(cursor?'&cursor='+encodeURIComponent(cursor):'');}
  function applyRows(s,rows,ticket,blockChanged){
    return rows.map(raw=>{
      apiUser(raw);const changed=(followEpochs.get(raw.id)||0)!==(ticket.get(raw.id)||0)||pendingFollow(raw.id),ownMembership=liveUser()&&s.uid===ME&&s.kind==='following';
      let known=!blockChanged&&(s.capable||ownMembership);
      if(liveUser()&&known&&!changed&&!STATE.blocks.has(raw.id)){const on=s.capable?raw.isFollowing:true;on?STATE.follows.add(raw.id):STATE.follows.delete(raw.id);}
      if(changed)known=true;return{...raw,_followKnown:known};
    });
  }
  function load(s,more=false){
    if(!valid(s)||!s.capReady)return Promise.resolve(false);if(s.task)return s.task;if(more&&(!s.next||s.invalid))return Promise.resolve(false);
    const seq=++s.seq,cursor=more?s.next:null,query=s.query,path=pagePath(s,cursor),controller=s.controller=new AbortController(),ticket=new Map(followEpochs);let blockRevision=LIVE.blockRevision||0,blockChanged=false;s.mode=more?'more':'head';s.status='pending';s.error='';s.moreError='';
    const active=()=>valid(s)&&s.seq===seq&&s.query===query;
    const task=Promise.resolve().then(async()=>{
      if(!active())return false;let r=await API.req('GET',path,undefined,liveUser(),{signal:controller.signal});if(!active())return false;
      if((LIVE.blockRevision||0)!==blockRevision){blockRevision=LIVE.blockRevision||0;r=await API.req('GET',path,undefined,liveUser(),{signal:controller.signal});if(!active())return false;blockChanged=(LIVE.blockRevision||0)!==blockRevision;}
      validatePage(s,r,query);if(more&&r.next&&(r.next===cursor||s.seen.has(r.next)))throw Object.assign(Error('列表分页已失效，请刷新列表'),{code:'bad_cursor'});
      const incoming=applyRows(s,r.items,ticket,blockChanged);if(more){const byId=new Map(s.rows.map(u=>[u.id,u]));incoming.forEach(u=>byId.set(u.id,u));s.rows=[...byId.values()];s.seen.add(cursor);}else{s.rows=incoming;s.seen.clear();s.invalid=false;}
      s.next=r.next;s.loaded=true;s.status='ready';s.hintWarning=blockChanged?'关系状态正在更新，请刷新后操作':'';paint(s,!more);return true;
    }).catch(error=>{if(active()&&error.name!=='AbortError'){s.status='error';if(more){s.moreError=error.message||'较早记录读取失败';if(error.code==='bad_cursor')s.invalid=true;}else s.error=error.message||'列表读取失败';paint(s);}return false;}).finally(()=>{if(valid(s)&&s.task===task){s.task=null;s.controller=null;paint(s);}});s.task=task;paint(s);return task;
  }
  function init(s){
    if(!valid(s))return Promise.resolve(false);if(s.capTask)return s.capTask;const controller=s.capController=new AbortController();s.mode='head';s.status='pending';s.error='';s.capReady=false;
    const task=Promise.resolve().then(()=>valid(s)?API.req('GET','/config',undefined,false,{signal:controller.signal}):null).then(cfg=>{
      if(!valid(s))return false;const cap=cfg?.relationLists;s.capable=cap?.version===1&&Array.isArray(cap.searchFields)&&cap.searchFields.includes('name')&&cap.searchFields.includes('handle');s.capReady=true;
      if(s.query&&!s.capable)throw Error('暂时无法在此查找，可清空搜索后浏览列表');return load(s);
    }).catch(error=>{if(valid(s)&&error.name!=='AbortError'){s.status='error';s.error=error.message||'列表暂时读不到';paint(s);}return false;}).finally(()=>{if(valid(s)&&s.capTask===task){s.capTask=null;s.capController=null;paint(s);}});s.capTask=task;paint(s);return task;
  }
  function setQuery(s,value,immediate=false){
    if(!valid(s))return;const query=normalize(value);if(query===s.query)return;cancel(s);s.query=query;s.rows=[];s.next=null;s.seen.clear();s.invalid=false;s.loaded=false;s.error='';s.moreError='';s.hintWarning='';s.mode='head';s.status='pending';paint(s,true);if(!s.capReady){if(!s.capTask)void init(s);return;}
    const run=()=>{s.timer=0;if(valid(s)){if(query&&!s.capable){s.status='error';s.error='暂时无法在此查找，可清空搜索后浏览列表';paint(s);}else void load(s);}};if(immediate)run();else s.timer=setTimeout(run,220);
  }
  function row(s,u){
    const self=liveUser()&&u.id===ME,on=liveUser()&&STATE.follows.has(u.id),action=self?'<span class="tag k">我</span>':u._followKnown&&!STATE.blocks.has(u.id)&&STATE.role!=='admin'?`<button class="pill sm ${on?'lt':''}" data-act="follow" data-id="${esc(u.id)}" data-follow-on="已关注" data-follow-off="关注" aria-pressed="${on}">${on?'已关注':'关注'}</button>`:`<a class="pill sm lt" href="#user-${esc(u.id)}">查看主页</a>`;
    return `<div class="mrow relation-person" role="listitem" data-relation-id="${esc(u.id)}"><a href="#user-${esc(u.id)}" aria-label="查看${esc(u.name)}的主页">${av(u.id,'md')}</a><a class="mt" href="#user-${esc(u.id)}"><b>${esc(u.name)}</b><span>@${esc(u.handle)}</span>${u.bio?`<span>${esc(u.bio)}</span>`:''}</a>${action}</div>`;
  }
  function paint(s,resetScroll=false){
    if(!panelCurrent(s))return;const panel=s.panel,list=panel.querySelector('[data-rel-list]'),status=panel.querySelector('[data-rel-status]'),footer=panel.querySelector('[data-rel-footer]'),input=panel.querySelector('[data-rel-query]'),refresh=panel.querySelector('[data-act="relations-refresh"]'),clear=panel.querySelector('[data-act="relations-clear"]'),top=list.scrollTop,anchor=[...list.children].find(e=>e.dataset.relationId&&e.offsetTop>=top),id=anchor?.dataset.relationId,offset=anchor?anchor.offsetTop-top:0,focused=panel.contains(document.activeElement)?document.activeElement?.dataset?.act:null;
    input.disabled=!s.capReady||!s.capable;clear.disabled=!input.value;refresh.disabled=!!s.capTask||!!s.task&&s.mode==='head';
    const messages=[];if(s.status==='pending')messages.push(s.mode==='more'?'正在加载较早记录…':s.query?'正在查找…':'正在读取列表…');if(s.error)messages.push(s.error);if(s.moreError)messages.push(s.moreError);if(s.hintWarning)messages.push(s.hintWarning);if(s.capReady&&!s.capable)messages.push('列表可以继续浏览；暂不支持在此查找。');
    status.innerHTML=messages.map(x=>`<p>${esc(x)}</p>`).join('')+(s.error?'<button class="pill sm lt" data-act="relations-retry">重试读取</button>':'');
    list.innerHTML=s.rows.map(u=>row(s,u)).join('')||(!s.loaded?`<p class="mut">${s.status==='error'?'列表尚未读到，请重试':'正在读取…'}</p>`:`<p class="mut">${s.query?'没有找到匹配的人，可换个昵称或公开账号':'还没有'+(s.kind==='followers'?'粉丝':'关注的人')}</p>`);list.setAttribute('aria-busy',String(!!s.task||!!s.capTask||!!s.timer));
    const restored=id&&[...list.children].find(e=>e.dataset.relationId===id);list.scrollTop=resetScroll?0:restored?restored.offsetTop-offset:top;
    footer.innerHTML=`${s.loaded?`<span class="relation-count">已载入 ${s.rows.length}${s.next?'+':''} 人</span>`:''}${s.invalid?'<button class="pill sm lt" data-act="relations-refresh">刷新列表</button>':s.next?`<button class="pill sm lt" data-act="relations-more"${s.task||s.capTask||!s.capReady?' disabled':''}>${s.task&&s.mode==='more'?'正在加载…':s.moreError?'重试加载较早记录':'加载更多'}</button>`:''}`;
    if(focused&&!panel.contains(document.activeElement))[...panel.querySelectorAll('button')].find(e=>e.dataset.act===focused)?.focus({preventScroll:true});
  }
  function open(uid,k){
    dispose(owner);const s=owner={uid,kind:k==='fans'?'followers':'following',scope:scope(),rows:[],query:'',loaded:false,status:'idle',error:'',moreError:'',hintWarning:'',next:null,seen:new Set(),invalid:false,seq:0,mode:'head',task:null,controller:null,capTask:null,capController:null,capReady:false,capable:false,timer:0,panel:null,panelEpoch:0,closed:false};
    sheet(`<section class="relationship-sheet" data-relationship-list><h3>${uid===ME&&liveUser()?'我的':esc(uname(uid))+'的'}${s.kind==='followers'?'粉丝':'关注'}</h3><div class="rsearch relationship-search">${IC.search}<input class="inp" data-rel-query type="search" maxlength="40" autocomplete="off" aria-label="搜索昵称或公开账号" placeholder="搜索昵称或公开账号" disabled><button class="pill sm lt" data-act="relations-clear" aria-label="清空搜索" disabled>${IC.x}</button></div><div class="relationship-toolbar"><button class="pill sm lt" data-act="relations-refresh">刷新列表</button></div><div class="relationship-status" data-rel-status role="status" aria-live="polite"></div><div class="m-list relationship-list" data-rel-list role="list" aria-label="${s.kind==='followers'?'粉丝':'关注'}列表" tabindex="0"></div><div class="relationship-footer" data-rel-footer></div></section>`,panel=>{
      s.panel=panel.querySelector('[data-relationship-list]');const input=s.panel.querySelector('[data-rel-query]');let composing=false;input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;setQuery(s,input.value);});input.addEventListener('input',e=>{if(!composing&&!e.isComposing)setQuery(s,input.value);});return()=>{s.closed=true;cancel(s);s.capController?.abort();};
    });s.panelEpoch=closeSheet.epoch||0;return init(s);
  }
  ACTIONS['relations-clear']=()=>{const s=owner;if(!panelCurrent(s))return;const input=s.panel.querySelector('[data-rel-query]');input.value='';setQuery(s,'',true);input.focus();};
  ACTIONS['relations-more']=()=>owner?load(owner,true):Promise.resolve(false);
  ACTIONS['relations-retry']=()=>owner?(owner.capReady?load(owner):init(owner)):Promise.resolve(false);
  ACTIONS['relations-refresh']=()=>{const s=owner;if(!s||!valid(s)||s.capTask||s.task&&s.mode==='head')return s?.task;cancel(s);s.error='';s.moreError='';return init(s).then(ok=>{if(ok&&valid(s))void refreshOwnFollowingTotal();return ok;});};
  if(typeof ROUTES!=='undefined'&&typeof ROUTES.me==='function'){const previous=ROUTES.me;ROUTES.me=function(...args){return withOwnFollowingTotal(()=>previous.apply(this,args));};}
  if(typeof syncInteraction==='function'){const previous=syncInteraction;syncInteraction=function(kind,...args){return kind==='follow'?withOwnFollowingTotal(()=>previous.call(this,kind,...args)):previous.call(this,kind,...args);};}
  if(typeof sendInteraction==='function'){const previous=sendInteraction;sendInteraction=async function(kind,id,...args){if(kind!=='follow')return previous.call(this,kind,id,...args);const key=scope();bumped(id);try{return await previous.call(this,kind,id,...args);}finally{if(scope()===key){bumped(id);if(owner)paint(owner);void refreshOwnFollowingTotal();}}};}
  function reset(){dispose(owner);countSeq++;countController?.abort();countController=null;if(typeof SHEET_GHOSTS!=='undefined')for(const g of SHEET_GHOSTS)if(g.querySelector('[data-relationship-list]')){g.remove();SHEET_GHOSTS.delete(g);}owner=null;followEpochs.clear();}
  const oldReset=API.credentialReset;API.credentialReset=function(...args){reset();return oldReset?.apply(this,args);};if(typeof dmReset==='function'){const oldDm=dmReset;dmReset=function(...args){reset();return oldDm.apply(this,args);};}
  globalThis.CZRelations={open,get state(){return owner;}};paintOwnFollowingTotal();
})();
