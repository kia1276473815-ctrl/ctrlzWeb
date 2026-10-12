// 提取真实输入、评论与联系人函数；DOM、存储及接口隔离，不写实际账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0 && y>x,a);return source.slice(x,y);};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function field(value=''){return {value,tagName:'TEXTAREA',selectionStart:2,selectionEnd:3,isConnected:true,listeners:{},addEventListener(k,f){this.listeners[k]=f;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},focus(){},style:{}};}
function drafts(overrides={}){
  const stored=new Map(),ctx=vm.createContext({Map,Set,JSON,ME:'one',API:{on:()=>true,base:'https://one'},sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},document:{activeElement:null},ACTIONS:{},dockSnap:()=>null,autoGrow(){},DK:{st:null},dockEnd(){},dockOn(){},$:()=>null,...overrides});
  vm.runInContext(section('const INPUT_DRAFTS =','function dockSnap(t)'),ctx);return {ctx,stored};
}
test('私信切会话、同页重绘恢复原文与选区，账号/服务地址不混用',()=>{
  const {ctx}=drafts(),first=field('第一位朋友\n未发的第二行');ctx.inputDraftBind(first,'dm','a');first.listeners.input();
  const same=field();ctx.inputDraftBind(same,'dm','a');assert.equal(same.value,first.value);assert.equal(same.selectionStart,2);assert.equal(same.selectionEnd,3);
  for(const change of [()=>ctx.ME='two',()=>{ctx.ME='one';ctx.API.base='https://two';}]){change();const other=field();ctx.inputDraftBind(other,'dm','a');assert.equal(other.value,'');}
  ctx.API.base='https://one';const peer=field();ctx.inputDraftBind(peer,'dm','b');assert.equal(peer.value,'');
});
test('重新载入页面的sessionStorage草稿可恢复，存储不可用仍保留当前页面输入',()=>{
  const {ctx,stored}=drafts(),input=field('刷新也保留');ctx.inputDraftBind(input,'dm','a');input.listeners.input();
  const again=drafts({sessionStorage:{getItem:k=>stored.get(k)||null,setItem(){},removeItem(){}}}).ctx,restored=field();again.inputDraftBind(restored,'dm','a');assert.equal(restored.value,'刷新也保留');
  const blocked=drafts({sessionStorage:{getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}}}).ctx;
  const local=field('本页保留');blocked.inputDraftBind(local,'dm','a');local.listeners.input();const newInput=field();blocked.inputDraftBind(newInput,'dm','a');assert.equal(newInput.value,'本页保留');
});
test('旧输入发送成功不能清除同会话刚写的新草稿',()=>{
  const {ctx}=drafts(),old=field('旧消息');ctx.inputDraftBind(old,'dm','a');old.listeners.input();
  const next=field();ctx.inputDraftBind(next,'dm','a');next.value='新草稿';next.listeners.input();ctx.inputDraftClear(old,'旧消息');
  const restored=field();ctx.inputDraftBind(restored,'dm','a');assert.equal(restored.value,'新草稿');
});
function privateSend(){
  let active=field('待发送'),resolve,calls=0,action;const r=drafts({$:()=>active,dmLive:()=>true,speakOk:()=>true,wrapAct:(n,f)=>action=f,sendMsg:()=>{calls++;return new Promise(r=>resolve=r);}});
  r.ctx.inputDraftBind(active,'dm','peer');active.listeners.input();
  vm.runInContext(section("wrapAct('cv-send',async", "ACTIONS['dm-retry']"),r.ctx);
  return {...r,send:()=>action(()=>{}, {dataset:{id:'peer'}}),set active(v){active=v;},get active(){return active;},finish:v=>resolve(v),get calls(){return calls;}};
}
test('待发送内容本地保存失败保留输入和会话草稿',async()=>{
  const r=privateSend(),task=r.send();r.finish(false);await task;assert.equal(r.active.value,'待发送');const restored=field();r.ctx.inputDraftBind(restored,'dm','peer');assert.equal(restored.value,'待发送');
});
test('保存中重绘不允许重复发送，成功后同步清除重建输入',async()=>{
  const r=privateSend(),first=r.active,task=r.send();first.isConnected=false;const rebuilt=field();r.ctx.inputDraftBind(rebuilt,'dm','peer');r.active=rebuilt;await r.send();assert.equal(r.calls,1);
  r.finish(true);await task;assert.equal(rebuilt.value,'');const restored=field();r.ctx.inputDraftBind(restored,'dm','peer');assert.equal(restored.value,'');
});
test('保存中输入继续变更，成功只清理已保存的文字',async()=>{
  const r=privateSend(),task=r.send();r.active.value='另一条新草稿';r.active.listeners.input();r.finish(true);await task;assert.equal(r.active.value,'另一条新草稿');
  const restored=field();r.ctx.inputDraftBind(restored,'dm','peer');assert.equal(restored.value,'另一条新草稿');
});
function reels(){
  let input,p={id:'a'},sends=0;const box={classList:{add(){},remove(){}},setAttribute(){},set innerHTML(v){input=field();input.tagName='INPUT';}};
  const r=drafts({RL:{el:{classList:{add(){},remove(){}}},cm:false},reelCur:()=>p,cmtsOf:()=>[],reelCmList:()=>'',IC:{x:'',arrow:''},UI:{flashCmt:null},$:s=>s==='#rlIn'?input:s==='.cmt.flash'?null:box,ACTIONS:{'rl-send':()=>sends++},setTimeout(){}});
  vm.runInContext(section('function openReelCm(focus){','Object.assign(ACTIONS, {'),r.ctx);
  return {...r,open:()=>r.ctx.openReelCm(),get input(){return input;},set post(v){p=v;},get sends(){return sends;}};
}
test('视频流评论中文组字与keyCode229不发送，普通Enter只发送一次',()=>{
  const r=reels();r.open();const event={key:'Enter',preventDefault(){}};r.input.listeners.keydown({...event,isComposing:true});r.input.listeners.keydown({...event,keyCode:229});r.input.listeners.keydown({...event,shiftKey:true});assert.equal(r.sends,0);
  r.input.listeners.keydown(event);assert.equal(r.sends,1);
});
test('评论关闭、重开、当前页重绘与切帖子分别恢复原草稿',()=>{
  const r=reels();r.open();r.input.value='A的草稿';r.input.listeners.input();r.ctx.closeReelCm();r.open();assert.equal(r.input.value,'A的草稿');
  r.post={id:'b'};r.open();assert.equal(r.input.value,'');r.input.value='B的草稿';r.input.listeners.input();r.post={id:'a'};r.open();assert.equal(r.input.value,'A的草稿');
});
function comments(overrides={}){
  const posts={a:{id:'a',live:true,cmts:1},b:{id:'b',live:true,cmts:0}},c={u:'me',t:'失败文字'},paint=[];let active='a',alive=true,serial=0;
  const ctx=vm.createContext({Map,Set,crypto:{randomUUID:()=>String(++serial)},UI:{newCmts:{a:[c]}},ME:'me',liveUser:()=>true,accountSession:()=>()=>alive,myCmtInvalidate(){},POST:id=>posts[id],CUR:{post:null},RL:{on:true,cm:true},reelCur:()=>({id:active}),commentVisible:()=>false,commentRouteTarget(){},renderPost:id=>paint.push('post:'+id),openReelCm:()=>paint.push('reel:'+active),reelBar:()=>paint.push('bar:'+active),API:{req:async()=>{throw Error('offline');}},esc:v=>String(v),ACTIONS:{},sheet(){},$:()=>null,toast(){},speakOk:()=>true,closeSheet(){},...overrides});
  vm.runInContext(section('function cmtSendFeedback(pid,c){',"wrapAct('cmt',"),ctx);
  return {ctx,posts,c,paint,set active(v){active=v;},set alive(v){alive=v;}};
}
test('评论断网保留失败文字与操作，失败不算已发布，另一个帖子不重绘',async()=>{
  const r=comments();r.active='b';await r.ctx.liveCmtSent('a',0);assert.equal(r.ctx.UI.newCmts.a[0],r.c);assert.equal(r.c.t,'失败文字');assert.equal(r.c.sendState,'failed');assert.equal(r.posts.a.cmts,0);assert.deepEqual(r.paint,[]);
  const html=r.ctx.cmtSendFeedback('a',r.c);for(const text of ['未发送','重试','编辑','移除'])assert(html.includes(text));
});
test('评论并发重试只发一次，失败计数不叠加，成功后清理发送状态',async()=>{
  const r=comments();await r.ctx.liveCmtSent('a',0);let resolve,calls=0;r.ctx.API.req=()=>{calls++;return new Promise(v=>resolve=v);};
  const first=r.ctx.liveCmtSent('a',0,r.c);await r.ctx.liveCmtSent('a',0,r.c);assert.equal(calls,1);assert.equal(r.posts.a.cmts,1);
  resolve({id:'server-c',status:'published'});await first;assert.equal(r.c.id,'server-c');assert.equal(r.c.sendState,'');assert.equal(r.posts.a.cmts,1);
});
test('评论迟到响应与错误在切账号后不更新旧内容和当前页面',async()=>{
  for(const fail of [false,true]){let finish;const r=comments({API:{req:()=>new Promise((res,rej)=>finish=fail?rej:res)}});const task=r.ctx.liveCmtSent('a',0);r.paint.length=0;r.alive=false;finish(fail?Error('late'):{id:'late'});await task;assert.equal(r.c.id,undefined);assert.deepEqual(r.paint,[]);}
});
test('失败评论手动移除只删除对应条，其他评论保留',async()=>{
  const r=comments();await r.ctx.liveCmtSent('a',0);r.ctx.UI.newCmts.a.push({u:'me',t:'另一条'});r.ctx.ACTIONS['cmt-remove']({dataset:{p:'a',id:r.c._client}});assert.deepEqual(r.ctx.UI.newCmts.a.map(x=>x.t),['另一条']);
});
function contacts(){
  const input=field(),list={innerHTML:'',attrs:{},setAttribute(k,v){this.attrs[k]=v;}},dialog={isConnected:true},timers=new Map(),calls=[],pending=[];let action,cleanup,timer=0,alive=true;
  const ctx=vm.createContext({AbortController,IC:{search:''},accountSession:()=>()=>alive,API:{req:(m,p,b,au,o)=>{calls.push({path:p,signal:o.signal});return new Promise((res,rej)=>pending.push({res,rej}));}},wrapAct:(n,f)=>action=f,sheet:(h,f)=>{cleanup=f(dialog);},$:s=>s==='#ncQ'?input:list,setTimeout:(f)=>{timers.set(++timer,f);return timer;},clearTimeout:id=>timers.delete(id),apiUser(){},av:()=>'',esc:v=>String(v),ACTIONS:{}});
  vm.runInContext(section("wrapAct('new-chat', () => sheet",'/* —— 声音 / 可视化帖子'),ctx);action();
  return {ctx,input,list,dialog,calls,pending,close:()=>{dialog.isConnected=false;cleanup();},flush:()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(f=>f());},set alive(v){alive=v;}};
}
test('联系人搜索换词立即取消旧连接，防抖期间旧结果不显示',async()=>{
  const r=contacts();r.input.value='新词';r.input.listeners.input();assert.equal(r.calls[0].signal.aborted,true);r.pending[0].res({items:[{id:'old',name:'旧结果',rel:[]}]});await tick();assert(!r.list.innerHTML.includes('旧结果'));
  r.flush();assert(r.calls[1].path.includes('q='));r.pending[1].res({items:[]});await tick();assert(r.list.innerHTML.includes('新词'));assert.equal(r.list.attrs['aria-busy'],'false');
});
test('联系人失败就地重试，真实空结果结束等待状态',async()=>{
  const r=contacts();r.pending[0].rej(Error('offline'));await tick();assert(r.list.innerHTML.includes('重试'));assert.equal(r.list.attrs['aria-busy'],'false');
  r.ctx.ACTIONS['new-chat-retry']({closest:()=>r.dialog});r.pending[1].res({items:[]});await tick();assert(r.list.innerHTML.includes('还没有可以私信的人'));assert.equal(r.list.attrs['aria-busy'],'false');
});
test('关闭联系人面板取消连接与防抖，迟到失败不恢复弹层',async()=>{
  const r=contacts();r.input.value='旧搜索';r.input.listeners.input();r.close();r.flush();r.pending[0].rej(Error('late'));await tick();assert.equal(r.calls.length,1);assert.equal(r.dialog._contactsRetry,undefined);assert.equal(r.calls[0].signal.aborted,true);
});
