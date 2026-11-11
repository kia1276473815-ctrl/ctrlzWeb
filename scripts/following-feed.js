/* 关注流保留已展开窗口，刷新复核现有作品，分页和关系变化分别隔离。 */
(function(){
 'use strict';
 const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]),enabled=()=>API.on()&&liveUser()&&LIVE.cfg?.followingFeed?.version===1&&LIVE.cfg.followingFeed.cursor==='signed-v1'&&LIVE.cfg.followingFeed.resolve===true;
 const viewing=()=>enabled()&&CUR.key==='home|'&&!CUR.post&&(UI.homeTab||'rec')==='fol',revision=()=>JSON.stringify([LIVE.relationshipRevision||0,LIVE.blockRevision||0,[...(LIVE.folOff||[])]]);
 let owner=null,painting=false,timer=null,observed=null;
 const fresh=()=>({key:scope(),ids:[],raw:new Map(),loaded:false,next:null,bridge:null,seen:new Set(),invalid:false,seq:0,task:null,controller:null,status:'idle',error:'',failedMore:false,stamp:0});
 function dispose(s){s?.controller?.abort();if(timer)clearTimeout(timer);timer=null;io?.disconnect();observed=null;}
 function current(){if(!owner||owner.key!==scope()){dispose(owner);owner=fresh();}return owner;}
 const valid=s=>enabled()&&owner===s&&s.key===scope();
 function validate(r,resolveIds){
  if(!r||r.scope?.version!==1||r.scope.userId!==ME||!Array.isArray(r.items)||r.items.length>(resolveIds?100:30)||r.items.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.author?.id!=='string'||typeof p.author.name!=='string'||typeof p.title!=='string'||typeof p.body!=='string'||p.status!=='published'||!['public','followers'].includes(p.visibility)||!Number.isFinite(Date.parse(p.createdAt)))||new Set(r.items.map(p=>p.id)).size!==r.items.length)throw Error('关注作品返回不完整，请重试');
  if(resolveIds){const missing=r.missing;if(!Array.isArray(missing)||new Set(missing).size!==missing.length||missing.some(id=>!resolveIds.includes(id))||r.items.some(p=>!resolveIds.includes(p.id))||new Set([...missing,...r.items.map(p=>p.id)]).size!==resolveIds.length||missing.some(id=>r.items.some(p=>p.id===id)))throw Error('作品状态尚未确认，请重试');}
  else if(!(r.next===null||typeof r.next==='string'&&r.next.startsWith('flp1_')&&r.next.length<=2048)||!r.items.length&&r.next)throw Error('关注分页返回不完整，请重试');
  return r;
 }
 const fingerprint=p=>JSON.stringify([p.title,p.body,p.tags,p.style,p.author,p.likeCount,p.commentCount,p.liked,p.edited,p.visibility,p.visibilityVersion,p.commentsClosed,p.discussionVersion,(p.media||[]).map(({url,...m})=>m)]);
 function publish(s,incoming=[]){
  if(!valid(s))return;const kept=new Set(s.ids);for(const id of s.raw.keys())if(!kept.has(id)){s.raw.delete(id);const i=POSTS.findIndex(p=>p.id===id&&p.folOnly);if(i>=0)POSTS.splice(i,1);if(typeof BODY!=='undefined')delete BODY[id];}const changed=new Set();for(const raw of incoming){if(s.raw.has(raw.id)&&fingerprint(s.raw.get(raw.id))!==fingerprint(raw))changed.add(raw.id);s.raw.set(raw.id,raw);const old=POST(raw.id),p=apiPost(raw);if(old){Object.assign(old,p);}else{p.folOnly=true;POSTS.push(p);}}
  LIVE.fol=[...s.ids];LIVE.folMe=ME;LIVE.fnext=s.invalid?null:s.next;LIVE.folErr=!s.loaded?s.error:null;LIVE.folBusy=s.task&&!s.failedMore?s.seq:0;paint(s,changed);
 }
 function statusHtml(s){const error=s.error&&!s.failedMore;return `<div class="following-tools"><button class="pill sm lt" data-act="${error?'following-retry':'following-refresh'}"${s.task?' disabled':''}>${error?'重试读取关注':'刷新关注'}</button>${s.status==='pending'?`<span role="status">${s.loaded?'正在更新关注作品…':'正在读取关注作品…'}</span>`:''}${error?`<span role="status">${esc(s.error)}</span>`:''}</div>`;}
 function footerHtml(s){if(!s.loaded)return '';if(s.invalid)return '<p role="status">分页已失效，已加载作品仍保留</p><button class="pill sm lt" data-act="following-reload">重新加载关注流</button>';if(s.failedMore&&s.error)return `<p role="status">${esc(s.error)}</p><button class="pill sm lt" data-act="following-more">重试加载更多</button>`;return s.next?`<button class="pill lt" data-act="following-more"${s.task?' disabled':''}>${s.task?'正在加载…':'加载更多关注作品'}</button>`:s.ids.length?'<p>已读完当前关注作品</p>':'';}
 function controls(s){if(!viewing()||!valid(s))return;if(!s.loaded){document.querySelector('#app .hfeed > .empty')?.remove();if(s.status==='error')for(const n of document.querySelectorAll('#app .hfeed .sk-list'))n.remove();}const status=document.querySelector('#app .fol-state');if(status){const html=statusHtml(s);if(status.innerHTML!==html)status.innerHTML=html;}let footer=document.querySelector('#app .feed-more');const html=footerHtml(s);if(!footer&&html){footer=document.createElement('div');footer.className='wrap feed-more';document.querySelector('#app .page')?.append(footer);}if(footer){footer.dataset.followingFooter='';footer.classList.add('following-footer');if(footer.innerHTML!==html)footer.innerHTML=html;if(!html)footer.remove();}if(io&&footer?.isConnected&&observed!==footer){io.disconnect();observed=footer;io.observe(footer);}}
 function paint(s,changed=new Set()){
  if(painting||!viewing()||!valid(s))return;painting=true;
  const nodes=[...document.querySelectorAll('#app .hfeed .mason > [data-flip]')],anchor=nodes.find(n=>n.getBoundingClientRect().bottom>Math.max(0,document.querySelector('#hd')?.getBoundingClientRect().bottom||0)),id=anchor?.dataset.flip,top=anchor?.getBoundingClientRect().top;
  try{if(s.loaded)for(const n of document.querySelectorAll('#app .hfeed .sk-list'))n.remove();patchMoreList('home',changed);const area=document.querySelector('#app .hfeed');if(!s.loaded&&s.status==='error')area?.querySelector('.empty')?.remove();if(s.loaded&&!s.ids.length&&area&&!area.querySelector('.mason,.empty'))area.insertAdjacentHTML('beforeend','<div class="empty"><div class="x">空</div><span>关注的人还没有发东西</span></div>');controls(s);const node=id&&[...document.querySelectorAll('#app .hfeed .mason > [data-flip]')].find(n=>n.dataset.flip===id);if(node){const delta=node.getBoundingClientRect().top-top;if(Math.abs(delta)>.5)scrollBy(0,delta);}}finally{painting=false;}
 }
 function load(more=false,reset=false){
  if(!enabled())return Promise.resolve(false);const s=current();if(s.task)return s.task;if(more&&(!s.loaded||!s.next||s.invalid))return Promise.resolve(false);
  const cursor=more?s.next:null,seq=++s.seq,ticket=revision(),controller=s.controller=new AbortController(),ids=more||!s.loaded||reset?[]:[...s.ids];s.status='pending';s.error='';s.failedMore=more;
  const active=()=>valid(s)&&s.seq===seq&&revision()===ticket;
  const task=Promise.resolve().then(async()=>{
   const head=validate(await API.req('GET','/posts/following/page?limit=30'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,true,{signal:controller.signal}));if(!active())return false;
   const resolved=[];for(let i=0;i<ids.length;i+=100){const batch=ids.slice(i,i+100);const r=await API.req('POST','/posts/following/resolve',{ids:batch},true,{signal:controller.signal});if(!active())return false;resolved.push(...validate(r,batch).items);}
   if(!active())return false;if(head.next&&(head.next===cursor||more&&s.seen.has(head.next)))throw Object.assign(Error('关注分页已失效，请重新加载'),{code:'bad_cursor'});
   // The later resolve is authoritative for old IDs, including a now-missing
   // first-page item. Never restore its earlier body from the head response.
   const rechecked=new Map(resolved.map(p=>[p.id,p])),requested=new Set(ids),latest=head.items.filter(p=>!requested.has(p.id)||rechecked.has(p.id)).map(p=>rechecked.get(p.id)||p),freshIds=latest.map(p=>p.id),oldIds=s.ids;
   if(more){const gap=s.bridge?oldIds.findIndex(id=>s.bridge.ids.has(id)):-1;
    s.ids=[...new Set(gap<0?[...oldIds,...freshIds]:[...oldIds.slice(0,gap),...freshIds,...oldIds.slice(gap)])];s.seen.add(cursor);if(s.bridge&&freshIds.some(id=>s.bridge.ids.has(id))){s.next=s.bridge.next;s.bridge=s.bridge.bridge;}else s.next=head.next;
   }else if(reset||!s.loaded){s.ids=freshIds;s.next=head.next;s.bridge=null;s.seen.clear();s.invalid=false;}
   else{const allowed=new Set(resolved.map(p=>p.id)),kept=oldIds.filter(id=>allowed.has(id)),overlap=freshIds.some(id=>kept.includes(id));if(!overlap){s.bridge=kept.length&&head.next?{ids:new Set(kept),next:s.next,bridge:s.bridge}:null;s.next=head.next;s.seen.clear();}s.ids=[...new Set([...freshIds,...kept])];}
   s.loaded=true;s.status='ready';s.error='';s.failedMore=false;s.stamp=Date.now();publish(s,[...latest,...resolved]);return true;
  }).catch(e=>{if(active()&&e.name!=='AbortError'){s.status='error';s.error=e.message||'关注作品读取失败，请重试';if(e.code==='bad_cursor')s.invalid=true;if([401,403].includes(e.status)){s.ids=[];s.next=null;s.loaded=false;}publish(s);}return false;}).finally(()=>{if(valid(s)&&s.task===task){s.task=null;s.controller=null;LIVE.folBusy=0;if(s.status==='pending'){s.status=s.loaded?'ready':'error';s.error=s.loaded?'':'关注关系已更新，请重新读取';}paint(s);}});
  s.task=task;LIVE.folBusy=seq;paint(s);return task;
 }
 function reset(){dispose(owner);if(owner)owner.seq++;owner=null;}
 const priorLoad=liveFol,priorReset=folReset,priorStatus=folStatusHtml,priorMore=ACTIONS.more;
 liveFol=function(){return enabled()?load():priorLoad();};folStatusHtml=function(){return enabled()?statusHtml(current()):priorStatus();};
 folReset=function(){if(!enabled())return priorReset();const s=current();s.seq++;s.controller?.abort();s.task=null;s.controller=null;s.status=s.loaded?'ready':'idle';LIVE.folSeq=(LIVE.folSeq||0)+1;LIVE.folBusy=0;if(viewing()){clearTimeout(timer);timer=setTimeout(()=>{timer=null;if(valid(s))void load();},0);}else{s.stamp=0;}};
 ACTIONS.more=function(b,e){return enabled()&&b.dataset.v==='home'&&(UI.homeTab||'rec')==='fol'?load(true):priorMore(b,e);};
 ACTIONS['following-refresh']=()=>load();ACTIONS['following-retry']=()=>load();ACTIONS['following-more']=()=>load(true);ACTIONS['following-reload']=()=>load(false,true);ACTIONS['fol-retry']=()=>enabled()?load():priorLoad();
 const io=typeof IntersectionObserver==='function'?new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting)&&viewing()){const s=current();if(s.loaded&&s.next&&!s.task&&!s.invalid&&!s.error)void load(true);}},{rootMargin:'600px 0px'}):null;
 document.addEventListener('rendered',()=>{if(painting)return;if(!viewing()){io?.disconnect();observed=null;return;}const s=current();controls(s);if(!s.task&&(s.status==='idle'||s.status==='ready'&&s.stamp===0))void load();});
 const credentialReset=API.credentialReset;API.credentialReset=function(...args){reset();return credentialReset?.apply(this,args);};
 globalThis.CZFollowing={enabled,load,reset,get state(){return current();}};
})();
