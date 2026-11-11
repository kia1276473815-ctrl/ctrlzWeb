/* THESIS: 用户在原帖不可见时仍能管理本人留下的互动。
   OWN-WORLD: 延续个人页鸿蒙字体、纸面色、细分隔线与44px操作控件。
   STORY: 在评论或赞过页签找到记录，查看当前可读内容，明确撤回与重试。
   FIRST VIEWPORT: 原有名片和页签不变，记录正文在左、本人管理动作在右；窄屏动作换行。
   FORM: 既有个人页的列表扩展；无新视觉世界或概念抽签。
   FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
(function(){
 'use strict';
 const kinds=['post-likes','comment-likes','comments'],labels={'post-likes':'帖子','comment-likes':'评论',comments:'我的评论'};
 const scope=()=>JSON.stringify([API.base,API.epoch,ME,STATE.role]),enabled=()=>liveUser()&&LIVE.cfg?.interactionManagement?.version===1&&kinds.every(k=>LIVE.cfg.interactionManagement.kinds?.includes(k));
 let owner=null;
 const searchable=()=>enabled()&&LIVE.cfg?.interactionSearch?.version===1&&LIVE.cfg.interactionSearch.cursor==='signed-v1'&&kinds.every(k=>LIVE.cfg.interactionSearch.kinds?.includes(k))&&['title','comment'].every(f=>LIVE.cfg.interactionSearch.fields?.includes(f));
 const view=(query='')=>({query,rows:[],count:null,next:null,back:[],seen:new Set(),cursor:null,status:'idle',loaded:false,error:'',invalid:false,task:null,controller:null,revision:0,stamp:0});
 const pageFor=(s,kind)=>searchable()&&s.searches[kind]||s.views[kind];
 function current(){const key=scope();if(owner?.key!==key){if(owner)for(const v of [...Object.values(owner.views),...Object.values(owner.searches)])v.controller?.abort();owner={key,kind:'post-likes',views:Object.fromEntries(kinds.map(k=>[k,view()])),searches:{},drafts:{},operations:new Map()};}return owner;}
 const valid=s=>enabled()&&current()===s,selected=()=>UI.meTab==='cmts'?'comments':current().kind,viewing=()=>enabled()&&/^me\|(?:works|cmts|likes|favs|hist|collab)?$/.test(CUR.key||'')&&['cmts','likes'].includes(UI.meTab);
 function html(kind){
  const s=current(),v=pageFor(s,kind),busy=v.status==='pending',ops=[...s.operations.values()].filter(o=>o.kind===kind&&!v.rows.some(r=>r.id===o.id));
  const label=kind==='post-likes'?'搜索赞过的帖子标题':kind==='comment-likes'?'搜索赞过的评论':'搜索我的评论',search=searchable()?`<div class="mi-search" data-mi-kind="${kind}"><label class="sr-only" for="miQuery">${label}</label><input id="miQuery" data-mi-query="${kind}" type="search" maxlength="80" autocomplete="off" placeholder="${label}" value="${esc(s.drafts[kind]||'')}"><button class="pill sm" data-act="mi-search" data-kind="${kind}">搜索</button><button class="pill sm lt" data-act="mi-clear" data-kind="${kind}">清除</button></div>`:'';
  const tabs=kind==='comments'?'':`<div class="seg mi-kinds" aria-label="点赞记录分类">${['post-likes','comment-likes'].map(k=>`<button class="${kind===k?'on':''}" data-act="mi-kind" data-kind="${k}" aria-pressed="${kind===k}">${labels[k]}</button>`).join('')}</div>`;
  const operation=o=>`<div class="mi-result" role="status"><span>${o.pending?'正在确认操作…':esc(o.error)}</span>${o.pending?'':`<button class="pill sm lt" data-act="mi-remove" data-kind="${o.kind}" data-id="${esc(o.id)}">重试确认</button>`}</div>`;
  const rows=v.rows.map(r=>{
   const op=s.operations.get(kind+'|'+r.id),own=kind==='comments',title=own?r.comment.body:r.available?(kind==='post-likes'?r.post.title:r.comment.body):'内容当前不可查看',context=r.available?(own||kind==='comment-likes'?r.post.title:'帖子 · '+r.post.author.name):'原帖当前不可查看',status=own?({review:' · 审核中',taken_down:' · 已下架'}[r.comment.status]||''):'';
   return `<article class="mi-row" data-mi-id="${esc(r.id)}"><div class="mi-copy"><p>${esc(title)}</p><span>${esc(context)} · ${esc(ago(+new Date(r.createdAt)))}${status}</span>${!r.available?'<span>你仍可管理自己留下的记录</span>':''}</div><div class="mi-actions">${r.available?`<button class="pill sm lt" data-act="mi-open" data-kind="${kind}" data-id="${esc(r.id)}">查看</button>`:''}<button class="pill sm lt" data-act="${own?'mi-delete-ask':'mi-remove'}" data-kind="${kind}" data-id="${esc(r.id)}"${op?.pending?' disabled':''}>${op?.pending?'正在确认…':op?'重试确认':own?'删除':'取消赞'}</button></div>${op&&!op.pending?`<p class="mi-result" role="status">${esc(op.error)}</p>`:''}</article>`;
  }).join('');
  return `${tabs}${search}<div class="mi-toolbar"><span>${v.query?'“'+esc(v.query)+'” · ':''}${v.count===null?'本人记录':`共 ${v.count} 条${v.query?'匹配':'本人'}记录`}</span><button class="pill sm lt" data-act="mi-refresh" data-kind="${kind}"${busy?' disabled':''}>刷新</button></div>${ops.map(operation).join('')}<div class="mi-list" aria-busy="${busy}">${rows}</div>${!rows&&v.status==='ready'?`<div class="empty"><span>${v.query?'没有找到符合条件的记录':kind==='comments'?'还没有留下评论':'还没有这类点赞记录'}</span></div>`:''}${busy||v.status==='idle'?`<p class="mi-result" role="status">${v.query?'正在搜索互动记录…':'正在读取互动记录…'}</p>`:''}${v.status==='error'?`<div class="mi-result" role="status"><span>${esc(v.error)}</span><button class="pill sm lt" data-act="mi-retry" data-kind="${kind}">${v.invalid?'重新搜索':'重试'}</button></div>`:''}<div class="mi-pagination"><button class="pill sm lt" data-act="mi-previous" data-kind="${kind}"${busy||v.invalid||!v.back.length?' disabled':''}>较新记录</button><button class="pill sm lt" data-act="mi-next" data-kind="${kind}"${busy||v.invalid||!v.next?' disabled':''}>更早记录</button></div>`;
 }
 function paint(){if(!viewing())return;const host=document.querySelector('#app .mep .mtb');if(!host)return;const focus=host.contains(document.activeElement)?document.activeElement:null,active=focus?.dataset,top=scrollY,markup=html(selected());
  if(document.createElement&&host.replaceChildren){const temp=document.createElement('template');temp.innerHTML=markup;const oldSearch=host.querySelector('.mi-search'),nextSearch=temp.content.querySelector('.mi-search');if(oldSearch&&nextSearch&&oldSearch.dataset.miKind===nextSearch.dataset.miKind)nextSearch.replaceWith(oldSearch);const rows=new Map([...host.querySelectorAll('[data-mi-id]')].map(el=>[el.dataset.miId,el]));for(const fresh of temp.content.querySelectorAll('[data-mi-id]')){const old=rows.get(fresh.dataset.miId);if(old?.outerHTML===fresh.outerHTML)fresh.replaceWith(old);}host.replaceChildren(temp.content);}else host.innerHTML=markup;
  if(focus?.isConnected)focus.focus?.({preventScroll:true});else if(active)[...host.querySelectorAll('button')].find(b=>b.dataset.act===active.act&&b.dataset.kind===active.kind&&b.dataset.id===active.id)?.focus({preventScroll:true});if(scrollY!==top)scrollTo(0,top);const count=document.querySelector('#app [data-act="me-tab"][data-v="cmts"] i');if(count)count.textContent=current().views.comments.count??'…';}
 function validPage(r,kind){
  return r&&Array.isArray(r.items)&&r.items.length<=20&&Number.isSafeInteger(r.count)&&r.count>=0&&(r.next===null||typeof r.next==='string'&&r.next.length<=1024)&&r.items.every(x=>x&&x.kind===kind&&typeof x.id==='string'&&x.id.length>0&&x.id.length<=64&&typeof x.createdAt==='string'&&Number.isFinite(+new Date(x.createdAt))&&typeof x.available==='boolean'&&(x.available?x.post&&typeof x.post.id==='string'&&typeof x.post.title==='string'&&typeof x.post.author?.name==='string':x.post===null)&&(kind==='comments'?x.comment&&x.comment.id===x.id&&typeof x.comment.body==='string'&&['published','review','taken_down'].includes(x.comment.status):kind==='comment-likes'&&x.available?x.comment&&typeof x.comment.body==='string':x.comment===null));
 }
 async function load(kind,move='refresh'){
  if(!enabled()||!kinds.includes(kind))return;const s=current(),v=pageFor(s,kind);if(v.task)return v.task;
  const direction=move==='retry'&&!v.invalid?(v.failedMove||'refresh'):move,cursor=move==='retry'&&!v.invalid?v.failedCursor:move==='next'?v.next:move==='previous'?v.back.at(-1):null;if((move==='next'||move==='previous')&&v.invalid||move==='next'&&!cursor||move==='previous'&&!v.back.length)return;
  const revision=v.revision,controller=new AbortController();v.status='pending';v.error='';v.controller=controller;paint();
  const task=(async()=>{try{
   const r=await API.req('GET',`/me/interactions/${kind}${v.query?'/search':''}?limit=20${v.query?'&q='+encodeURIComponent(v.query):''}${cursor?'&cursor='+encodeURIComponent(cursor):''}`,undefined,true,{signal:controller.signal});if(!valid(s)||pageFor(s,kind)!==v||v.revision!==revision)return;if(!validPage(r,kind)||new Set(r.items.map(x=>x.id)).size!==r.items.length||v.query&&(r.scope?.version!==1||r.scope.userId!==ME||r.scope.kind!==kind||r.scope.query!==v.query||r.count<r.items.length||r.next!==null&&!/^mis1_/.test(r.next)))throw Error('记录返回不完整，请重试');
   if(cursor&&r.next&&(r.next===cursor||direction==='next'&&v.seen.has(r.next))){v.invalid=true;throw Error('互动搜索分页已失效，请重新搜索');}
   if(direction==='next')v.back.push(v.cursor);else if(direction==='previous')v.back.pop();else v.back=[];
   if(direction==='next'&&cursor)v.seen.add(cursor);else v.seen.clear();v.rows=r.items;v.count=r.count;v.next=r.next;v.cursor=cursor||null;v.status='ready';v.loaded=true;v.invalid=false;v.stamp=Date.now();
  }catch(e){if(valid(s)&&pageFor(s,kind)===v&&v.revision===revision){v.status=e.name==='AbortError'||e.code==='cancel'?(v.loaded?'ready':'idle'):'error';v.failedCursor=cursor;v.failedMove=direction;if(e.code==='bad_cursor')v.invalid=true;v.error=v.invalid?'互动搜索分页已失效，请重新搜索':v.loaded?'记录更新失败，已有记录已保留，请重试':'互动记录读取失败，请重试';}}
  finally{if(v.task===task){v.task=null;v.controller=null;if(valid(s)){if(v.status==='pending')v.status=v.loaded?'ready':'error';paint();}}}})();v.task=task;return task;
 }
 function record(kind,id){return pageFor(current(),kind)?.rows.find(r=>r.id===id);}
 async function remove(kind,id){
  if(!enabled()||!kinds.includes(kind))return;const s=current(),key=kind+'|'+id;if(s.operations.get(key)?.pending)return;const v=pageFor(s,kind),row=record(kind,id);if(!row&&!s.operations.has(key))return;
  for(const page of [s.views[kind],s.searches[kind]].filter(Boolean)){page.revision++;page.controller?.abort();}const op={kind,id,pending:true,error:''};s.operations.set(key,op);paint();
  try{
   const prior=kind==='post-likes'?(typeof INTERACTIONS!=='undefined'?INTERACTIONS.get(ME+':like:'+id):null):kind==='comment-likes'?(typeof CMT_LIKES!=='undefined'?CMT_LIKES.get(cmtScope()+'|'+id):null):null;await prior?.tail.catch(()=>{});if(!valid(s))return;
   const r=await API.req('DELETE',`/me/interactions/${kind}/${encodeURIComponent(id)}`);if(!valid(s))return;if(r?.ok!==true)throw Error('结果未确认');
   for(const page of [s.views[kind],s.searches[kind]].filter(Boolean)){const contained=page.rows.some(r=>r.id===id);page.rows=page.rows.filter(r=>r.id!==id);if(contained&&page.count!==null)page.count=Math.max(0,page.count-1);page.revision++;}s.operations.delete(key);
   if(kind==='post-likes'){STATE.liked.delete(id);syncInteraction('like',id);}
   if(kind==='comment-likes'){for(const list of Object.values(COMMENTS))if(Array.isArray(list))for(const c of list)if(c.id===id){if(c.liked)c.likes=Math.max(0,c.likes-1);c.liked=false;}}
   if(kind==='comments'){for(const data of [COMMENTS,UI.newCmts||{}])for(const [pid,list]of Object.entries(data))if(Array.isArray(list)){data[pid]=list.filter(c=>c.id!==id);}if(typeof myCmtInvalidate==='function')myCmtInvalidate();}
   toast(kind==='comments'?'已删除自己的评论':'已取消赞');
  }catch(e){if(valid(s)){op.pending=false;op.error='操作结果待确认，重试会确认同一条记录';}}
  finally{if(valid(s)){op.pending=false;paint();}}
 }
 ACTIONS['mi-remove']=b=>remove(b.dataset.kind,b.dataset.id);
 ACTIONS['mi-delete-ask']=b=>{const {kind,id}=b.dataset,s=current(),row=record(kind,id);if(!row)return;if(s.operations.has(kind+'|'+id))return remove(kind,id);const confirm=s.confirm={id,row,route:location.hash,closed:false};sheet(`<h3>删除这条评论？</h3><p class="mi-confirm-copy">只删除你留下的这条评论，删除后无法恢复。</p><div class="mi-actions"><button class="pill lt" data-act="mi-keep">保留</button><button class="pill" data-act="mi-delete-confirm" data-kind="comments" data-id="${esc(id)}">删除评论</button></div>`,host=>{confirm.host=host;return()=>{confirm.closed=true;if(s.confirm===confirm)s.confirm=null;};});};
 ACTIONS['mi-keep']=()=>closeSheet();
 ACTIONS['mi-delete-confirm']=b=>{const s=current(),id=b.dataset.id,confirm=s.confirm;if(!valid(s)||confirm?.id!==id||confirm.closed||confirm.host?.isConnected===false||location.hash!==confirm.route||record('comments',id)!==confirm.row)return;closeSheet();return remove('comments',id);};
 ACTIONS['mi-kind']=b=>{const kind=b.dataset.kind;if(!['post-likes','comment-likes'].includes(kind)||!enabled())return;current().kind=kind;paint();if(pageFor(current(),kind).status==='idle')return load(kind);};
 function search(kind,text){if(!searchable()||!kinds.includes(kind))return Promise.resolve();const s=current(),query=String(text).trim().normalize('NFC');if(query.length>80||query.includes('\0')){toast('搜索内容请控制在80个字以内','orange');return Promise.resolve();}s.drafts[kind]=String(text);const old=s.searches[kind];if(old?.query===query)return load(kind);if(old){old.revision++;old.controller?.abort();}if(query)s.searches[kind]=view(query);else delete s.searches[kind];paint();return load(kind);}
 ACTIONS['mi-search']=b=>search(b.dataset.kind,document.querySelector('#miQuery')?.value||'');
 ACTIONS['mi-clear']=b=>{const input=document.querySelector('#miQuery');if(input)input.value='';return search(b.dataset.kind,'');};
 const composing=new WeakSet();document.addEventListener('compositionstart',e=>{if(e.target?.dataset?.miQuery)composing.add(e.target);});document.addEventListener('compositionend',e=>composing.delete(e.target));
 document.addEventListener('input',e=>{const kind=e.target?.dataset?.miQuery;if(kind&&viewing())current().drafts[kind]=e.target.value;});
 document.addEventListener('keydown',e=>{const kind=e.target?.dataset?.miQuery;if(kind&&viewing()&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&!composing.has(e.target)){e.preventDefault();void search(kind,e.target.value);}});
 document.addEventListener('search',e=>{const kind=e.target?.dataset?.miQuery;if(kind&&viewing()&&!e.target.value)void search(kind,'');});
 for(const [name,move]of [['refresh','refresh'],['retry','retry'],['next','next'],['previous','previous']])ACTIONS['mi-'+name]=b=>load(b.dataset.kind,move);
 ACTIONS['mi-open']=async b=>{const s=current(),kind=b.dataset.kind,row=record(kind,b.dataset.id),route=location.hash;if(!row?.available)return;const ok=await CZPostAccess.check(row.post.id);if(!valid(s)||location.hash!==route||record(kind,row.id)!==row)return;if(!ok){if(!POST(row.post.id)){row.available=false;row.post=null;if(kind!=='comments')row.comment=null;paint();}return;}const p=POST(row.post.id);if(p)go(postHref(p)+(kind==='post-likes'?'':'?comment='+encodeURIComponent(row.id)));};
 for(const name of['like','rl-like','clike','rl-clike','at-like']){const old=ACTIONS[name];if(!old)continue;ACTIONS[name]=function(b,e){const kind=['like','rl-like'].includes(name)?'post-likes':'comment-likes',id=kind==='post-likes'?(b.dataset.id||reelCur()?.id):b.dataset.cid;if(enabled()&&current().operations.has(kind+'|'+id)){toast('请先确认这条记录的取消结果','orange');return;}return old(b,e);};}
 // Native reel double-tap and comment-reference actions also call these functions directly.
 if(typeof reelLike==='function'){const old=reelLike;reelLike=function(...args){if(enabled()&&current().operations.has('post-likes|'+reelCur()?.id)){toast('请先确认这条记录的取消结果','orange');return;}return old(...args);};}
 if(typeof cmtLikeToggle==='function'){const old=cmtLikeToggle;cmtLikeToggle=function(b,...args){if(enabled()&&current().operations.has('comment-likes|'+b.dataset.cid)){toast('请先确认这条记录的取消结果','orange');return;}return old(b,...args);};}
 function foreground(){if(document.hidden||!viewing())return;const kind=selected();if(!pageFor(current(),kind).task)return load(kind);}
 globalThis.CZMyInteractions={enabled,count:()=>enabled()?current().views.comments.count:null,profile(tab){const kind=tab==='cmts'?'comments':current().kind,v=pageFor(current(),kind);onMount(()=>{if(v.status==='idle'||v.status==='ready'&&Date.now()-v.stamp>15000)void load(kind);});return html(kind);},load,search,remove,refresh:foreground};
 const oldPatch=patchMyComments;patchMyComments=function(){if(enabled()){paint();return;}return oldPatch();};
 document.addEventListener('visibilitychange',foreground);window.addEventListener('focus',foreground);
})();
