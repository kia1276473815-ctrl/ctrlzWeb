/* 正在读的推荐窗口与待查看的新推荐分开；后台只复核，不重排已展开列表。 */
(function(){
 'use strict';
 const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role,STATE.settings.pers!==false]),viewer=()=>liveUser()?ME:null,enabled=()=>API.on()&&LIVE.cfg?.recommendationWindow?.version===1&&LIVE.cfg.recommendationWindow.resolve===true&&LIVE.cfg.recommendationWindow.guest===true&&LIVE.cfg.recommendationWindow.latest===true&&LIVE.cfg.recommendationWindow.page===true&&LIVE.cfg.recommendationWindow.cursor==='signed-v1';
 const viewing=()=>enabled()&&CUR.key==='home|'&&!CUR.post&&(UI.homeTab||'rec')==='rec',revision=()=>JSON.stringify([LIVE.blockRevision||0,LIVE.relationshipRevision||0,LIVE.recommendationPreferenceRevision||0]);
 let owner=null,painting=false,observed=null;
 const fresh=()=>({key:scope(),ids:[],raw:new Map(),loaded:false,next:null,seen:new Set(),expired:false,update:false,preferenceChanged:false,headSignature:'',status:'idle',error:'',failedMode:'check',seq:0,task:null,controller:null,ticket:null,stamp:0,compat:{seq:0,status:'pending',error:null}});
 function dispose(s){s?.controller?.abort();io?.disconnect();observed=null;}
 function current(){if(!owner||owner.key!==scope()){dispose(owner);owner=fresh();}return owner;}
 const valid=s=>enabled()&&owner===s&&s.key===scope();
 function validPost(p){return p&&typeof p.id==='string'&&p.id.length>0&&typeof p.title==='string'&&typeof p.body==='string'&&typeof p.author?.id==='string'&&typeof p.author.name==='string'&&p.visibility==='public'&&p.status==='published'&&Number.isFinite(Date.parse(p.createdAt));}
 function validate(r,ids){
  if(!r||!Array.isArray(r.items)||r.items.length>(ids?100:50)||!r.items.every(validPost)||new Set(r.items.map(p=>p.id)).size!==r.items.length)throw Error('推荐作品返回不完整，请重试');
  if(!ids){if(r.scope?.version!==1||r.scope.userId!==viewer()||r.scope.personalized!==(STATE.settings.pers!==false))throw Error('推荐身份或排序偏好尚未确认，请重试');if(!(r.next===null||typeof r.next==='string'&&r.next.startsWith('rcp1_')&&r.next.length<=2048)||!r.items.length&&r.next)throw Error('推荐分页返回不完整，请重试');return r;}
  if(r.scope?.version!==1||r.scope.userId!==viewer()||!Array.isArray(r.missing)||!Array.isArray(r.retry))throw Error('作品可见性尚未确认，请重试');
  const all=[...r.items.map(p=>p.id),...r.missing,...r.retry];if(all.some(id=>!ids.includes(id))||new Set(all).size!==all.length||all.length!==ids.length)throw Error('作品状态返回不完整，请重试');return r;
 }
 const fingerprint=p=>JSON.stringify([p.title,p.body,p.tags,p.style,p.author,p.likeCount,p.commentCount,p.liked,p.edited,p.visibilityVersion,p.commentsClosed,p.discussionVersion,(p.media||[]).map(({url,...m})=>m)]);
 function publish(s,items=[],missing=[]){
  if(!valid(s))return;const removed=new Set(missing),kept=new Set(s.ids),changed=new Set();for(const id of s.raw.keys())if(!kept.has(id))s.raw.delete(id);
  for(const raw of items){if(!kept.has(raw.id))continue;if(s.raw.has(raw.id)&&fingerprint(s.raw.get(raw.id))!==fingerprint(raw))changed.add(raw.id);s.raw.set(raw.id,raw);const old=POST(raw.id),p=apiPost(raw);if(old)Object.assign(old,p);else POSTS.push(p);}
  const rec=s.ids.map(id=>POST(id)).filter(Boolean),got=new Set(rec.map(p=>p.id)),pend=Object.values(LIVE.pend||{}).filter(p=>p.author===ME&&!got.has(p.id)),pendIds=new Set(pend.map(p=>p.id));rec.forEach(p=>delete p.folOnly);
  const others=POSTS.filter(p=>!got.has(p.id)&&!pendIds.has(p.id)&&!removed.has(p.id));others.forEach(p=>p.folOnly=true);POSTS.splice(0,POSTS.length,...pend,...rec,...others);for(const id of removed)if(typeof BODY!=='undefined'&&CUR.post!==id)delete BODY[id];
  LIVE.next=s.expired?null:s.next;LIVE.feed=s.compat;s.compat.status=s.loaded?'ready':s.status==='error'?'error':'pending';s.compat.error=s.error;paint(s,changed);
 }
 function statusHtml(s){const checking=s.task&&s.failedMode!=='more',error=s.error&&s.failedMode!=='more';return `<div class="recommendation-tools"><button class="pill sm lt" data-act="${error?'recommendation-retry':'recommendation-latest'}"${s.task?' disabled':''}>${error?'重试读取推荐':s.update?'查看最新推荐':'刷新推荐'}</button>${checking?`<span role="status">${s.loaded?'正在检查推荐更新…':'正在读取推荐作品…'}</span>`:error?`<span role="status">${esc(s.error)}</span>`:s.update?`<span role="status">${s.preferenceChanged?'推荐设置':'推荐'}有更新，当前阅读位置已保留</span>`:''}</div>`;}
 function footerHtml(s){if(!s.loaded)return '';if(s.expired)return `<p role="status">${s.preferenceChanged?'推荐设置':'这批推荐'}已更新，已读内容仍保留</p><button class="pill lt" data-act="recommendation-latest">刷新后继续浏览</button>`;if(s.error&&s.failedMode==='more')return `<p role="status">${esc(s.error)}</p><button class="pill lt" data-act="recommendation-more">重试加载更多</button>`;return s.next?`<button class="pill lt" data-act="recommendation-more"${s.task?' disabled':''}>${s.task?'正在加载…':'加载更多推荐'}</button>`:s.ids.length?'<p>已读完这批推荐</p>':'';}
 function controls(s){if(!viewing()||!valid(s))return;const area=document.querySelector('#app .hfeed');if(!s.loaded){area?.querySelector(':scope > .empty')?.remove();if(s.status==='error')for(const n of area?.querySelectorAll('.sk-list')||[])n.remove();}const status=document.querySelector('#app .feed-state');if(status&&status.innerHTML!==statusHtml(s))status.innerHTML=statusHtml(s);let footer=document.querySelector('#app .feed-more');const html=footerHtml(s);if(!footer&&html){footer=document.createElement('div');footer.className='wrap feed-more';document.querySelector('#app .page')?.append(footer);}if(footer){footer.classList.add('recommendation-footer');if(footer.innerHTML!==html)footer.innerHTML=html;if(!html)footer.remove();}if(io&&footer?.isConnected&&observed!==footer){io.disconnect();observed=footer;io.observe(footer);}}
 function paint(s,changed=new Set(),latest=false){
  if(painting||!viewing()||!valid(s))return;painting=true;const anchor=[...document.querySelectorAll('#app .hfeed .mason > [data-flip]')].find(n=>n.getBoundingClientRect().bottom>Math.max(0,document.querySelector('#hd')?.getBoundingClientRect().bottom||0)),id=anchor?.dataset.flip,top=anchor?.getBoundingClientRect().top;
  try{if(s.loaded)for(const n of document.querySelectorAll('#app .hfeed .sk-list'))n.remove();patchMoreList('home',changed);const area=document.querySelector('#app .hfeed');if(s.loaded&&!s.ids.length&&area&&!area.querySelector('.mason,.empty'))area.insertAdjacentHTML('beforeend','<div class="empty"><div class="x">空</div><span>还没有人发东西，来发第一条吧</span><button class="pill" data-act="compose">发布</button></div>');controls(s);const node=id&&[...document.querySelectorAll('#app .hfeed .mason > [data-flip]')].find(n=>n.dataset.flip===id);if(latest)scrollTo(0,0);else if(node){const delta=node.getBoundingClientRect().top-top;if(Math.abs(delta)>.5)scrollBy(0,delta);}}finally{painting=false;}
 }
 function load(mode='check'){
  if(!enabled())return Promise.resolve(false);const s=current();if(s.task){if(s.ticket===revision()&&LIVE.feed===s.compat&&s.compat.seq===s.seq)return s.task;s.seq++;s.controller?.abort();s.task=null;}
  if(mode==='more'&&(!s.loaded||!s.next||s.expired))return Promise.resolve(false);
  const cursor=mode==='more'?s.next:null,replace=mode==='replace'||!s.loaded,seq=++s.seq,ticket=s.ticket=revision(),controller=s.controller=new AbortController(),priorIds=replace||cursor?[]:[...s.ids];s.compat.seq=seq;LIVE.feed=s.compat;s.status='pending';s.error='';s.failedMode=mode;s.compat.status=s.loaded?'refreshing':'pending';s.compat.error=null;
  const active=()=>valid(s)&&s.seq===seq&&s.compat.seq===seq&&LIVE.feed===s.compat&&revision()===ticket;
  const recheck=async()=>{const resolved=[],missing=[],retry=[];for(let i=0;i<priorIds.length;i+=100){const ids=priorIds.slice(i,i+100),r=await API.req('POST','/posts/recommendations/resolve',{ids},true,{signal:controller.signal});if(!active())return null;validate(r,ids);resolved.push(...r.items);missing.push(...r.missing);retry.push(...r.retry);}return{resolved,missing,retry};};
  const task=Promise.resolve().then(async()=>{
   const response=await API.req('GET','/posts/recommendations/page?limit='+(cursor?30:50)+(STATE.settings.pers===false?'&order=latest':'')+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,true,{signal:controller.signal});if(!active())return false;
   if(response?.scope?.version===1&&response.scope.userId===viewer()&&typeof response.scope.personalized==='boolean'&&response.scope.personalized!==(STATE.settings.pers!==false)&&liveUser()){
    // Reconcile only through the authenticated /me contract. An old head cannot
    // write a new mode or cache its body before that separate confirmation.
    const me=await API.req('GET','/me',undefined,true,{signal:controller.signal});if(!active())return false;if(me?.id!==ME||typeof me.personalized!=='boolean')throw Error('推荐偏好尚未确认，请重试');
    if(me.personalized!==(STATE.settings.pers!==false)){if(s.loaded&&mode!=='replace'){const checked=await recheck();if(!checked||!active())return false;const missing=new Set(checked.missing);s.ids=s.ids.filter(id=>!missing.has(id));s.preferenceChanged=true;s.expired=true;s.update=true;s.status='ready';publish(s,checked.resolved,checked.missing);if(checked.retry.length)throw Error('部分作品暂未读到最新，已有内容已保留，请重试检查');return true;}liveMe(me);const key=scope(),next=current();LIVE.feed=next.compat;return load().then(ok=>{if(ok&&key===scope()&&viewing()&&typeof rerender==='function')rerender();return ok;});}
    throw Error('推荐偏好刚刚更新，请重新读取');
   }
   const head=validate(response);
   if(cursor&&head.next&&(head.next===cursor||s.seen.has(head.next)))throw Object.assign(Error('推荐分页没有前进，请刷新后继续'),{code:'bad_cursor'});
   const checked=await recheck();if(!checked||!active())return false;const{resolved,missing,retry}=checked;
   if(cursor){s.ids=[...new Set([...s.ids,...head.items.map(p=>p.id)])];s.next=head.next;s.seen.add(cursor);publish(s,head.items);}
   else if(replace){s.ids=head.items.map(p=>p.id);s.next=head.next;s.seen.clear();s.expired=false;s.update=false;s.preferenceChanged=false;s.headSignature=JSON.stringify(s.ids);s.loaded=true;publish(s,head.items);if(mode==='replace')paint(s,new Set(),true);}
   else{const absent=new Set(missing);s.ids=s.ids.filter(id=>!absent.has(id));const signature=JSON.stringify(head.items.filter(p=>!absent.has(p.id)).map(p=>p.id));s.update=signature!==s.headSignature;publish(s,resolved,missing);if(retry.length){s.error='部分作品暂未读到最新，已有内容已保留，请重试检查';s.status='error';throw Error(s.error);}}
   s.loaded=true;s.status='ready';s.stamp=Date.now();folReset();return true;
  }).catch(e=>{if(active()&&e.name!=='AbortError'){s.status='error';s.error=e.message||'推荐作品读取失败，请重试';if(cursor&&['feed_expired','bad_cursor'].includes(e.code))s.expired=true;if([401,403].includes(e.status)){const missing=[...s.ids];s.ids=[];s.next=null;s.loaded=false;publish(s,[],missing);}else publish(s);throw e;}return false;}).finally(()=>{if(valid(s)&&s.task===task){s.task=null;s.controller=null;if(s.status==='pending')s.status=s.loaded?'ready':'idle';s.compat.status=s.loaded?'ready':s.status==='error'?'error':'pending';s.compat.error=s.error;controls(s);}});
  s.task=task;controls(s);return task;
 }
 const oldLoad=liveFeed,oldStatus=feedStatusHtml,oldSync=syncFeedState,oldMore=ACTIONS.more;
 liveFeed=function(){return enabled()?load():oldLoad();};feedStatusHtml=function(){return enabled()?statusHtml(current()):oldStatus();};syncFeedState=function(){if(enabled()){controls(current());return;}return oldSync();};
 ACTIONS.more=function(b,e){return enabled()&&b.dataset.v==='home'&&(UI.homeTab||'rec')==='rec'?load('more').catch(()=>{}):oldMore(b,e);};
 ACTIONS['recommendation-latest']=()=>load('replace').catch(()=>{});ACTIONS['recommendation-more']=()=>load('more').catch(()=>{});ACTIONS['recommendation-retry']=()=>load(current().failedMode).catch(()=>{});ACTIONS['feed-retry']=()=>enabled()?load(current().failedMode).catch(()=>{}):oldLoad().catch(apiFail);
 const io=typeof IntersectionObserver==='function'?new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)&&viewing()){const s=current();if(s.loaded&&s.next&&!s.task&&!s.expired&&!s.error)void load('more').catch(()=>{});}},{rootMargin:'600px 0px'}):null;
 document.addEventListener('rendered',()=>{if(painting)return;if(!viewing()){io?.disconnect();observed=null;return;}const s=current();controls(s);if(s.status==='idle'&&!s.task)void load().catch(()=>{});});
 function reset(){dispose(owner);if(owner)owner.seq++;owner=null;}const resetCredentials=API.credentialReset;API.credentialReset=function(...args){reset();return resetCredentials?.apply(this,args);};
 const preferenceAction=ACTIONS.pers;if(preferenceAction)ACTIONS.pers=function(...args){LIVE.recommendationPreferenceRevision=(LIVE.recommendationPreferenceRevision||0)+1;return preferenceAction.apply(this,args);};
 globalThis.CZRecommendations={enabled,load,reset,get state(){return current();}};
})();
