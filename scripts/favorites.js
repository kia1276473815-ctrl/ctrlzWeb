/* 收藏按页读取，成员状态按已显示ID校对；不把“前500项之外”当成未收藏。 */
(function(){
  'use strict';
  const scope=()=>JSON.stringify([API.base,API.epoch,ME]),key=r=>r.kind+':'+r.id;
  const blank=()=>({rows:[],cursor:null,next:null,back:[],status:'idle',error:'',request:0,stamp:0});
  const fresh=()=>({scope:scope(),revision:0,read:0,countRead:0,known:new Map(),pending:new Map(),mutating:new Set(),counts:null,countAt:0,legacy:null,mode:'new',pool:{active:0,queue:[]},views:{profile:{post:blank(),product:blank()},picker:{post:blank(),product:blank()}},picker:null});
  let state=fresh(),scheduled=false,legacyRequest=null,painting=false,waveHost=null,cleanWaves=null;
  const current=()=>{if(state.scope!==scope()){state=fresh();STATE.favs=new Set();}return state;};
  const valid=s=>liveUser()&&current()===s&&s.scope===scope();
  const kindOf=id=>P(id)&&!POST(id)?'product':'post';
  const viewing=()=>CUR.key==='me|favs'||CUR.key==='me|'&&UI.meTab==='favs';
  const sub=()=>UI.favSub==='prod'?'product':'post';
  function refs(){const rows=[...document.querySelectorAll('[data-act="fav"][data-id]')].map(b=>({kind:kindOf(b.dataset.id),id:b.dataset.id,b}));const p=typeof RL!=='undefined'&&RL.on&&typeof reelCur==='function'?reelCur():null;if(p)for(const b of document.querySelectorAll('[data-act="rl-fav"]'))rows.push({kind:'post',id:p.id,b});return rows;}
  function lock(b,on){if(!b)return;if(on&&!b._favChecking){b._favChecking={disabled:b.disabled,busy:b.getAttribute('aria-busy')};b.disabled=true;b.setAttribute('aria-busy','true');}else if(!on&&b._favChecking){b.disabled=b._favChecking.disabled;const old=b._favChecking.busy;old===null?b.removeAttribute('aria-busy'):b.setAttribute('aria-busy',old);delete b._favChecking;}}
  function buttons(){const s=current();for(const r of refs()){lock(r.b,s.mutating.has(key(r))||s.mode==='new'&&(!s.known.has(key(r))||s.pending.has(key(r))));r.b.setAttribute('aria-pressed',String(STATE.favs.has(r.id)));r.b.setAttribute('aria-label',STATE.favs.has(r.id)?'取消收藏':'收藏');}const pickerCount=document.querySelector('.pk-tabs button:nth-child(2) i');if(pickerCount)pickerCount.textContent=total()??'…';const count=$('#app [data-act="me-tab"][data-v="favs"] i');if(count)count.textContent=total()??'…';}
  function total(){const s=current();if(s.mode==='legacy'&&s.legacy){const count=s.legacy.posts.length+s.legacy.products.length;return s.legacy.limited||count>=500?'≥'+count:count;}return s.counts?s.counts.posts+s.counts.products:null;}
  function setKnown(s,r,on,seq=++s.read){if((s.known.get(key(r))?.seq||0)>seq)return;s.known.set(key(r),{saved:on,at:Date.now(),seq});on?STATE.favs.add(r.id):STATE.favs.delete(r.id);}
  function paintRefs(list){painting=true;try{for(const r of list)syncInteraction('fav',r.id);}finally{painting=false;}buttons();}
  async function legacy(s){
    if(!valid(s))return;
    if(legacyRequest?.s===s)return legacyRequest.promise;
    const revision=s.revision,promise=(async()=>{const r=await API.req('GET','/me/favs');if(!valid(s)||revision!==s.revision)return;s.mode='legacy';s.legacy={...r,limited:r.posts.length+r.products.length>=500};s.counts=null;for(const id of r.posts)setKnown(s,{kind:'post',id},true);for(const id of r.products)setKnown(s,{kind:'product',id},true);})();legacyRequest={s,promise};try{await promise;}finally{if(legacyRequest?.promise===promise)legacyRequest=null;}
  }
  function limited(s,run){return new Promise((resolve,reject)=>{s.pool.queue.push({run,resolve,reject});const pump=()=>{while(s.pool.active<2&&s.pool.queue.length){const job=s.pool.queue.shift();s.pool.active++;Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{s.pool.active--;pump();});}};pump();});}
  async function hydrate(list,force=false){
    if(!liveUser())return;const s=current();if(s.mode==='legacy')return;
    const unique=[...new Map(list.filter(r=>r.id).map(r=>[key(r),{kind:r.kind,id:r.id}])).values()],waiting=[],owned=[];
    for(const r of unique){const k=key(r),pending=s.pending.get(k);if(pending){waiting.push(pending);continue;}if(s.mutating.has(k))continue;if(force||!s.known.has(k)||Date.now()-s.known.get(k).at>15000)owned.push(r);}
    if(!owned.length&&(!force&&s.countAt&&Date.now()-s.countAt<15000||s.countRequest)){await Promise.all(waiting);return;}
    const revision=s.revision,seq=++s.read,batches=[];for(let i=0;i<owned.length;i+=100)batches.push(owned.slice(i,i+100));if(!batches.length)batches.push([]);
    for(const batch of batches){const request=Promise.resolve().then(async()=>{try{const r=await limited(s,()=>!valid(s)?null:API.req('POST','/me/favs/status',{posts:batch.filter(r=>r.kind==='post').map(r=>r.id),products:batch.filter(r=>r.kind==='product').map(r=>r.id)}));if(!valid(s)||s.revision!==revision)return;const saved=new Set([...r.posts.map(id=>'post:'+id),...r.products.map(id=>'product:'+id)]);for(const ref of batch)setKnown(s,ref,saved.has(key(ref)),seq);if(seq>=s.countRead){s.counts=r.counts;s.countAt=Date.now();s.countRead=seq;}paintRefs(batch);}
      catch(e){if(valid(s)&&e.status===404){await legacy(s);return;}throw e;}
      finally{for(const r of batch)if(s.pending.get(key(r))===request)s.pending.delete(key(r));if(s.countRequest===request)s.countRequest=null;if(valid(s))buttons();}});
      for(const r of batch)s.pending.set(key(r),request);s.countRequest=request;waiting.push(request);
    }
    buttons();await Promise.all(waiting);if(valid(s))buttons();
  }
  function redraw(context){const s=current();if(!valid(s))return;if(context==='profile'&&viewing()){const host=$('#app .mtb');if(host){const focus=document.activeElement?.dataset?.act,html=render('profile',sub());if(waveHost!==host){cleanWaves?.();waveHost=host;onClean(()=>{if(waveHost===host){cleanWaves?.();cleanWaves=null;waveHost=null;}});}cleanWaves?.();host.innerHTML=html;cleanWaves=waveLoop([...host.querySelectorAll('canvas[data-wave]')]);if(focus)host.querySelector(`[data-act="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});rollNums(host);fitText(host);syncLive();document.dispatchEvent(new Event('rendered'));}}if(context==='picker'&&s.picker?.host?.isConnected){s.picker.host.innerHTML=render('picker',s.picker.kind,s.picker.uid);}}
  async function load(context,kind,move='retry'){
    if(!liveUser())return;const s=current(),v=s.views[context][kind];if(v.status==='pending')return;
    let cursor=move==='retry'&&v.status==='error'&&v.attempt?v.attempt.cursor:v.cursor,back=[...(move==='retry'&&v.status==='error'&&v.attempt?v.attempt.back:v.back)];if(move==='next'){if(!v.next)return;back.push(cursor);cursor=v.next;}else if(move==='previous'){if(!back.length)return;cursor=back.pop();}else if(move==='refresh'){cursor=null;back=[];}
    const scrollAfter=['next','previous','refresh'].includes(move)||cursor!==v.cursor;const revision=s.revision,seq=++s.read,id=++v.request;v.attempt={cursor,back};v.status='pending';v.error='';redraw(context);
    try{
      let rows,next,counts;
      if(s.mode==='legacy'){if(!s.legacy)await legacy(s);if(!valid(s))return;const list=s.legacy[kind==='post'?'posts':'products'],offset=cursor?Number(cursor):0;rows=list.slice(offset,offset+40).map(id=>({kind,id,available:true}));next=offset+40<list.length?String(offset+40):null;counts={posts:s.legacy.posts.length,products:s.legacy.products.length};}
      else{try{const r=await API.req('GET',`/me/favs/page?kind=${kind}&limit=40${cursor?'&cursor='+encodeURIComponent(cursor):''}`);rows=r.items;next=r.next;counts=r.counts;}catch(e){if(e.status!==404)throw e;await legacy(s);if(!valid(s))return;v.status='idle';return load(context,kind,'refresh');}}
      if(!valid(s)||v.request!==id)return;if(s.revision!==revision)throw Error('收藏已更新，请重新读取当前页');
      for(const r of rows)setKnown(s,r,true,seq);const resolve=rows.filter(r=>r.available).map(r=>({t:r.kind==='post'?'post':'prod',ref:r.id})),outcomes=await dmRefs(resolve,true);
      if(!valid(s)||v.request!==id)return;if(s.revision!==revision)throw Error('收藏已更新，请重新读取当前页');
      v.rows=rows.map(r=>({...r,state:!r.available?'unavailable':outcomes?.get((r.kind==='post'?'post':'prod')+':'+r.id)==='available'?'available':outcomes?.get((r.kind==='post'?'post':'prod')+':'+r.id)==='unavailable'?'unavailable':'retry'}));v.cursor=cursor;v.back=back;v.next=next;v.status='ready';v.stamp=Date.now();if(s.mode==='new'&&seq>=s.countRead){s.counts=counts;s.countRead=seq;s.countAt=Date.now();}paintRefs(rows);
    }catch(e){if(valid(s)&&v.request===id){v.status='error';v.error=e.message||'收藏暂时读不到，请重试';}}
    finally{if(valid(s)&&v.request===id){redraw(context);buttons();if(v.status==='ready'&&scrollAfter){if(context==='profile'&&viewing()){const el=$('#app .mtb .mfs');if(el)scrollTo({top:Math.max(0,scrollY+el.getBoundingClientRect().top-($('#hd')?.getBoundingClientRect().height||0)-12),behavior:'instant'});}else if(context==='picker'&&s.picker?.host?.isConnected)s.picker.host.scrollTop=0;}}}
  }
  function render(context,kind,uid=''){
    const s=current(),v=s.views[context][kind],busy=v.status==='pending',picker=context==='picker';
    const seg=`<div class="seg mfs">${[['post','帖子'],['product','商品']].map(([k,label])=>`<button data-act="favs-kind" data-context="${context}" data-kind="${k}" class="${kind===k?'on':''}" aria-pressed="${kind===k}">${label}${s.counts?' '+s.counts[k==='post'?'posts':'products']:''}</button>`).join('')}</div>`;
    const entries=v.rows.filter(r=>s.known.get(key(r))?.saved!==false),body=entries.map((r,i)=>{const entity=r.kind==='post'?POST(r.id):P(r.id);if(r.state==='available'&&entity)return picker?`<button class="pk-it" data-act="cv-share" data-uid="${esc(uid)}" data-k="${r.kind==='post'?'post':'prod'}" data-id="${esc(r.id)}">${r.kind==='post'?miniThumb(entity):`<img src="${cover(entity.cover,hash(entity.id)%50,160,160)}" alt="">`}<span>${esc(entity.title)}</span></button>`:r.kind==='post'?postCard(entity,i,entries.filter(r=>r.state==='available').map(r=>POST(r.id)).filter(Boolean)):sleeve(entity);
      return `<div class="fav-unavailable"><b>${r.state==='retry'?'暂时未能读取这条内容':'内容已删除或暂不可访问'}</b><p>${r.state==='retry'?'你的收藏仍保留，可以重新读取。':'收藏记录仍保留，可在内容恢复后查看。'}</p><div class="comm-actions">${r.state==='retry'?`<button class="pill sm lt" data-act="favs-retry" data-context="${context}" data-kind="${kind}">重新读取</button>`:''}<button class="pill sm lt" data-act="favs-remove" data-kind="${r.kind}" data-id="${esc(r.id)}"${s.mutating.has(key(r))?' disabled':''}>移除收藏</button></div></div>`;}).join('');
    return `${seg}<div class="fav-toolbar"><span>${s.mode==='legacy'?'暂时只能读取最近的收藏；较早记录请稍后重试。':'按收藏时间排序 · 第'+(v.back.length+1)+'页'}</span><button class="pill sm lt" data-act="favs-refresh" data-context="${context}" data-kind="${kind}"${busy?' disabled':''}>刷新收藏</button></div>${body?`<div class="${picker?'pk-g':kind==='post'?'mason':'grid-p'} fav-page-items">${body}</div>`:v.status==='ready'?'<div class="empty"><span>这一页没有收藏内容</span></div>':''}${busy?'<p class="fav-status" role="status">正在读取收藏…</p>':''}${v.status==='error'?`<div class="fav-status" role="status"><span>${esc(v.error)}</span><button class="pill sm lt" data-act="favs-retry" data-context="${context}" data-kind="${kind}">重试</button></div>`:''}<div class="fav-pagination"><button class="pill sm lt" data-act="favs-previous" data-context="${context}" data-kind="${kind}"${busy||!v.back.length?' disabled':''}>较新收藏</button><button class="pill sm lt" data-act="favs-next" data-context="${context}" data-kind="${kind}"${busy||!v.next?' disabled':''}>更早收藏</button></div>`;
  }
  async function mutate(ref,desired,button){
    const s=current(),k=key(ref);if(s.mutating.has(k))return;
    if(s.mode==='new'&&!s.known.has(k)){try{await hydrate([ref]);}catch(e){if(valid(s))apiFail(e);}return;}
    const before=STATE.favs.has(ref.id);if(before===desired)return;s.revision++;s.mutating.add(k);s.known.set(k,{saved:desired,at:Date.now(),seq:++s.read});desired?STATE.favs.add(ref.id):STATE.favs.delete(ref.id);if(s.counts)s.counts[ref.kind==='post'?'posts':'products']=Math.max(0,s.counts[ref.kind==='post'?'posts':'products']+(desired?1:-1));syncInteraction('fav',ref.id);buttons();lock(button,true);
    try{await API.req(desired?'PUT':'DELETE',`/me/favs/${ref.kind}/${encodeURIComponent(ref.id)}`);if(!valid(s))return;if(s.mode==='legacy'&&s.legacy){const name=ref.kind==='post'?'posts':'products',list=s.legacy[name];if(desired&&!list.includes(ref.id))list.unshift(ref.id);else if(!desired)s.legacy[name]=list.filter(id=>id!==ref.id);}if(!desired)for(const views of Object.values(s.views))for(const view of Object.values(views))view.rows=view.rows.filter(r=>key(r)!==k);if(desired)toast('已收藏');}
    catch(e){if(valid(s)){s.known.set(k,{saved:before,at:Date.now(),seq:++s.read});before?STATE.favs.add(ref.id):STATE.favs.delete(ref.id);if(s.counts)s.counts[ref.kind==='post'?'posts':'products']=Math.max(0,s.counts[ref.kind==='post'?'posts':'products']+(before?1:-1));apiFail(e);}}
    finally{if(valid(s)){s.revision++;s.mutating.delete(k);s.countAt=0;syncInteraction('fav',ref.id);redraw('profile');redraw('picker');buttons();void hydrate([]).catch(()=>{});}lock(button,false);}
  }
  const oldFav=ACTIONS.fav,oldReelFav=ACTIONS['rl-fav'];ACTIONS.fav=(b,e)=>!liveUser()?oldFav(b,e):mutate({kind:kindOf(b.dataset.id),id:b.dataset.id},!STATE.favs.has(b.dataset.id),b);ACTIONS['rl-fav']=(b,e)=>{if(!liveUser())return oldReelFav(b,e);const p=reelCur();if(p)return mutate({kind:'post',id:p.id},!STATE.favs.has(p.id),b);};
  for(const [act,move]of [['next','next'],['previous','previous'],['retry','retry'],['refresh','refresh']])ACTIONS['favs-'+act]=b=>{if(move==='refresh'&&current().mode==='legacy'){current().mode='new';current().legacy=null;}return load(b.dataset.context,b.dataset.kind,move);};
  ACTIONS['favs-remove']=b=>mutate({kind:b.dataset.kind,id:b.dataset.id},false,b);
  ACTIONS['favs-kind']=b=>{const context=b.dataset.context,kind=b.dataset.kind;if(context==='profile')UI.favSub=kind==='post'?'post':'prod';else if(current().picker)current().picker.kind=kind;redraw(context);const v=current().views[context][kind];if(v.status==='idle')void load(context,kind);};
  const oldPicker=ACTIONS['cv-pick'];ACTIONS['cv-pick']=b=>{oldPicker(b);if(!liveUser())return;const host=document.querySelector('.pk-pages .pk-pane:nth-child(2)');if(!host)return;current().picker={host,uid:b.dataset.id,kind:'post'};host.innerHTML=render('picker','post',b.dataset.id);void load('picker','post','refresh');};
  const oldPatch=patchBookmarks;patchBookmarks=function(){if(painting)return;if(liveUser()&&viewing()){redraw('profile');return;}return oldPatch();};
  function schedule(){if(!liveUser())return;buttons();if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(!liveUser())return;void hydrate(refs()).catch(()=>{});});}
  const oldPostRender=renderPost;renderPost=function(...args){const result=oldPostRender(...args);schedule();return result;};
  const oldReelBar=reelBar;let reelKey='';reelBar=function(...args){const result=oldReelBar(...args),next=scope()+'|'+(reelCur()?.id||'');if(next!==reelKey){reelKey=next;schedule();}return result;};
  globalThis.CZFavorites={total,profile(){const kind=sub(),v=current().views.profile[kind];onMount(()=>{if(v.status==='idle'||v.status==='ready'&&Date.now()-v.stamp>30000)void load('profile',kind);});return render('profile',kind);},boot:async()=>{try{await hydrate(refs());if(viewing()){const v=current().views.profile[sub()];if(v.status!=='pending')await load('profile',sub());}}catch{}},hydrate};
  LIVE.favEpoch=(LIVE.favEpoch||0)+1;
  document.addEventListener('rendered',schedule);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&liveUser())void CZFavorites.boot();});window.addEventListener('focus',()=>{if(liveUser())void CZFavorites.boot();});
  schedule();
})();
