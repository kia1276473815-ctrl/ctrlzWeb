// 私信读取、分享补读与撤回入口执行真实页面函数；接口完全隔离，不写真实账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0 && y>x,a);return source.slice(x,y);};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const message=(id,extra={})=>({id,from:'peer',to:'me',kind:'text',body:id,createdAt:'2026-10-12T00:00:00Z',read:false,recalled:false,...extra});
const page=(items,extra={})=>({peer:{id:'peer'},items,blocked:{byMe:false,byThem:false},nextBefore:null,nextSince:'sync-1',hasMore:false,...extra});
function realm(overrides={}){
  const calls=[],products=new Map(),ctx=vm.createContext({console,Date,Map,Set,Promise,ME:'me',DELC:{},CHATS:{},CHAT_UNREAD:{peer:3},CUR:{key:'msg|peer'},document:{hidden:false},STATE:{role:'user'},LIVE:{u:new Set(['peer'])},POSTS:[],
    API:{on:()=>true,req:async(method,path)=>{calls.push({method,path});return page([]);}},coTxt:x=>x,apiUser(){},dmAcknowledge(){},dmOutboxReset(){},
    apiPost:p=>p,apiProduct:p=>{products.set(p.id,p);return p;},P:id=>products.get(id),POST:id=>ctx.POSTS.find(p=>p.id===id),...overrides});
  vm.runInContext(section('const LDM =','{ const body0 = convBody;'),ctx);return {ctx,calls,products};
}
test('A会话读取期间切到B，迟到GET不能POST已读或清掉A未读数',async()=>{
  let finish;const calls=[],r=realm({API:{on:()=>true,req:(method,path)=>{calls.push({method,path});return new Promise(res=>finish=res);}}});
  const task=r.ctx.dmConv('peer');r.ctx.CUR.key='msg|other';finish(page([message('unseen')]));await task;
  assert.equal(calls.length,1);assert.equal(r.ctx.CHAT_UNREAD.peer,3);assert.equal(r.ctx.CHATS.peer[0].read,false);
});
test('会话GET等待时隐藏页面，不发已读；返回前台再读取才确认',async()=>{
  let finish,gets=0;const calls=[],r=realm({API:{on:()=>true,req:(method,path)=>{calls.push({method,path});if(method==='POST')return Promise.resolve({ok:true});if(++gets===1)return new Promise(res=>finish=res);return Promise.resolve(page([]));}}});
  const task=r.ctx.dmConv('peer');r.ctx.document.hidden=true;finish(page([message('unseen')]));await task;
  assert.equal(calls.length,1);assert.equal(r.ctx.CHAT_UNREAD.peer,3);r.ctx.document.hidden=false;await r.ctx.dmConv('peer');
  assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(r.ctx.CHAT_UNREAD.peer,0);assert.equal(r.ctx.CHATS.peer[0].read,true);
});
test('当前可见会话等POST确认成功才清未读，不把发送中当成功',async()=>{
  let confirm;const r=realm({API:{on:()=>true,req:(method)=>method==='GET'?Promise.resolve(page([message('unseen')])):new Promise(res=>confirm=res)}});
  const task=r.ctx.dmConv('peer');await tick();assert.equal(r.ctx.CHAT_UNREAD.peer,3);assert.equal(r.ctx.CHATS.peer[0].read,false);
  confirm({ok:true});await task;assert.equal(r.ctx.CHAT_UNREAD.peer,0);assert.equal(r.ctx.CHATS.peer[0].read,true);
});
test('已读断网保留未读，空增量仍能重试确认',async()=>{
  let reads=0,gets=0;const r=realm({API:{on:()=>true,req:async(method)=>{if(method==='POST'){if(++reads===1)throw Error('offline');return {ok:true};}return page(gets++?[]:[message('unseen')]);}}});
  await assert.rejects(r.ctx.dmConv('peer'),/offline/);assert.equal(r.ctx.CHAT_UNREAD.peer,3);assert.equal(r.ctx.CHATS.peer[0].read,false);
  await r.ctx.dmConv('peer');assert.equal(reads,2);assert.equal(r.ctx.CHAT_UNREAD.peer,0);
});
test('服务器总未读来自更早历史，最近页已读也必须等明确确认',async()=>{
  let reads=0;const r=realm({API:{on:()=>true,req:async(method)=>{if(method==='POST'){reads++;return {ok:true};}return page([message('recent',{read:true})]);}}});
  await r.ctx.dmConv('peer');assert.equal(reads,1);assert.equal(r.ctx.CHAT_UNREAD.peer,0);
});
test('当前会话新消息的服务器未读数不会被thread轮询提前抹掉',async()=>{
  const r=realm({API:{on:()=>true,req:async()=>({items:[{peer:{id:'peer'},last:message('new'),unread:4}]})}});
  await r.ctx.dmThreads();assert.equal(r.ctx.CHAT_UNREAD.peer,4);assert.equal(r.ctx.CHATS.peer[0].read,false);
});
test('真实会话进入保留未读，原型模式仍按原交互清零',()=>{
  for(const live of [true,false]){
    const ctx=vm.createContext({ROUTES:{},STATE:{role:'user'},USERS:{peer:{id:'peer'}},ME:'me',CHATS:{},CHAT_UNREAD:{peer:4},API:{on:()=>live},CUR:{key:'home|'},onMount(){},onClean(){},document:{body:{classList:{toggle(){}}}},setTimeout(){},msgBadge(){},IC:{readAll:'',plus:''},conv:()=>'',msgList:()=>''});
    vm.runInContext(section('ROUTES.msg = arg => {','function sendMsg(uid, m){'),ctx);ctx.ROUTES.msg('peer');assert.equal(ctx.CHAT_UNREAD.peer,live?4:0);
  }
});
test('切账号后迟到会话读取不写缓存或已读状态',async()=>{
  let finish;const calls=[],r=realm({API:{on:()=>true,req:(method,path)=>{calls.push({method,path});return new Promise(res=>finish=res);}}});
  const task=r.ctx.dmConv('peer');r.ctx.ME='another';finish(page([message('private-old')]));await task;assert.equal(calls.length,1);assert.equal(r.ctx.CHATS.peer,undefined);assert.equal(r.ctx.CHAT_UNREAD.peer,3);
});
test('分享引用网络失败不负缓存，同批重复引用只尝试一次，下一次成功恢复',async()=>{
  let failed=true;const calls=[],r=realm({API:{on:()=>true,req:async(method,path)=>{calls.push(path);if(failed)throw Object.assign(Error('offline'),{code:'network'});return {id:'shared-post',title:'真实引用'};}}});
  const refs=[{t:'post',ref:'shared-post'},{t:'post',ref:'shared-post'}];await r.ctx.dmRefs(refs);assert.equal(calls.length,1);assert.equal(vm.runInContext("LDM.miss.has('shared-post')",r.ctx),false);
  failed=false;await r.ctx.dmRefs(refs);assert.equal(calls.length,2);assert.equal(r.ctx.POSTS.length,1);await r.ctx.dmRefs(refs);assert.equal(calls.length,2);
});
test('确实404的分享引用在会话内负缓存，取消/503/未知403保持可恢复',async()=>{
  for(const error of [{status:404,code:'not_found'},{code:'cancelled'},{status:503,code:'upstream'},{status:403,code:'forbidden'}]){
    let calls=0;const r=realm({API:{on:()=>true,req:async()=>{calls++;throw Object.assign(Error('fixture'),error);}}});const refs=[{t:'post',ref:'ref'}];await r.ctx.dmRefs(refs);await r.ctx.dmRefs(refs);assert.equal(calls,error.status===404?1:2);
  }
});
test('增量没有新消息时，之前临时失败的缓存分享仍会补取',async()=>{
  let gets=0,refCalls=0;const r=realm({CHAT_UNREAD:{peer:0},API:{on:()=>true,req:async(method,path)=>{
    if(path.startsWith('/posts/')){if(++refCalls===1)throw Object.assign(Error('timeout'),{code:'timeout'});return {id:'shared-post',title:'恢复后的帖子'};}
    return page(gets++?[]:[message('shared',{kind:'post',ref:'shared-post',read:true})]);
  }}});
  await r.ctx.dmConv('peer');assert.equal(r.ctx.POSTS.length,0);await r.ctx.dmConv('peer');assert.equal(refCalls,2);assert.equal(r.ctx.POSTS[0].id,'shared-post');
});
test('分享补读换账号后迟到结果不能写入新账号或负缓存',async()=>{
  for(const fail of [false,true]){let finish;const r=realm({API:{on:()=>true,req:()=>new Promise((res,rej)=>finish=fail?rej:res)}});const task=r.ctx.dmRefs([{t:'post',ref:'old-post'}]);r.ctx.ME='new';finish(fail?Object.assign(Error('gone'),{status:404}):{id:'old-post'});await task;assert.equal(r.ctx.POSTS.length,0);assert.equal(vm.runInContext('LDM.miss.size',r.ctx),0);}
});
test('本人已确认的文字/图片/帖子/商品分享两分钟内均有撤回入口',()=>{
  const ctx=vm.createContext({Date,RC_MS:120000,esc:String,POST:()=>null,P:()=>null,USERS:{},msgAv:()=>'',CO_BY:()=>null});vm.runInContext(section('function bubble(m, uid){','function convBody(uid){'),ctx);
  for(const t of ['text','img','post','prod']){const html=ctx.bubble({me:true,t,text:'x',ref:'ref',url:'/fixture.png',ts:Date.now()},'peer');assert(html.includes('data-act="msg-rc"'),t);}
});
test('合作记录、他人、待发送、已撤回或超过两分钟的消息不出现撤回入口',()=>{
  const ctx=vm.createContext({Date,RC_MS:120000,esc:String,POST:()=>null,P:()=>null,USERS:{},msgAv:()=>'',CO_BY:()=>null,uname:()=>''});vm.runInContext(section('function bubble(m, uid){','function convBody(uid){'),ctx);
  const base={me:true,t:'post',ref:'ref',text:'x',ts:Date.now()};for(const extra of [{t:'co'},{t:'cosys'},{me:false},{pend:true},{rc:true},{ts:Date.now()-120001}])assert(!ctx.bubble({...base,...extra},'peer').includes('data-act="msg-rc"'));
});
