// 通知分页与整类标读：执行真实前端函数，所有 GET/POST 都在 VM 中模拟，不改真实通知。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(a,b)=>{const x=source.indexOf(a),y=source.indexOf(b,x+a.length);assert(x>=0&&y>x,a);return source.slice(x,y);};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const row=(i,read=false)=>({id:'ac_'+String(i).padStart(3,'0'),kind:'reply',actor:{id:'actor_'+i,name:'作者'+i},commentId:'c_'+i,body:'通知'+i,post:null,read,createdAt:new Date(1791763200000+i*1000).toISOString()});
const rows=(high,low,read=false)=>Array.from({length:high-low+1},(_,i)=>row(high-i,read));
function harness(){
  const requests=[],attrs=new Map(),toasts=[],motions=[];let originalCalls=0;let ctx;
  const all={isConnected:true,disabled:false,innerHTML:'全部已读',dataset:{act:'at-all'},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),focus(){}};
  const list={isConnected:true,innerHTML:'',dataset:{},contains:()=>false,querySelectorAll:()=>[]},panel={isConnected:true,scrollTop:222,querySelector:sel=>sel.includes('at-all')?all:sel.includes('m-list')?list:null};list.closest=()=>panel;
  const note={likes:0,fans:0};Object.defineProperty(note,'at',{enumerable:true,configurable:true,get:()=>ctx.NOTES.at.filter(n=>!ctx.AT_READ.has(n.id)).length,set(){}});
  ctx=vm.createContext({Map,Set,JSON,Promise,Date,AbortController,encodeURIComponent,
    API:{base:'https://isolated.invalid',epoch:1,tok:{access:'fake'},on:()=>true,req(method,path,body,auth,options){const r={...defer(),method,path,body,auth,options};requests.push(r);return r.promise;}},
    ME:'fixture_reader',LDM:{epoch:1},STATE:{role:'user',clikes:new Set(),follows:new Set()},NOTES:{likes:[],fans:[],at:[]},NOTE_NEW:note,AT_READ:new Set(),USERS:{},COMMENTS:{},CUR:{key:'home|'},UI:{},
    document:{hidden:false,activeElement:null},$:sel=>sel.includes('at-all')?all:sel.includes('m-list')?list:sel.includes('.sheet')?panel:null,$$:()=>[],
    ACTIONS:{note(){},'at-all':()=>originalCalls++},liveUser:()=>ctx.API.on()&&ctx.STATE.role==='user',dmRefs:async()=>{},dmPoll:async()=>{},liveAfterLogin:async()=>{},
    cmtNoticeLikes:async()=>{},atMark:id=>ctx.AT_READ.add(id),atUnread:()=>ctx.NOTES.at.filter(n=>!ctx.AT_READ.has(n.id)).length,
    apiUser:u=>ctx.USERS[u.id]={...u},POST:()=>null,postHref:p=>'post-'+p.id,esc:v=>String(v??''),ago:()=> '刚刚',av:id=>'<i>'+id+'</i>',miniThumb:()=>'<i></i>',IC:{readAll:'',heartF:'♥',heart:'♡'},
    fxPop:(...args)=>motions.push(args.slice(1)),msgBadge(){},noteSync(){},toast:(...args)=>toasts.push(args),reduced:()=>true,testList:list,
  });
  vm.runInContext(source.split('\n').find(line=>line.startsWith('const dmSession =')),ctx);
  vm.runInContext(part('function atMark(id){','function noteSync(){'),ctx);
  vm.runInContext(source.split('\n').find(line=>line.startsWith('function wrapAct(')),ctx);
  vm.runInContext(part('/* ================= 互动提醒（连着后端时）','/* ================= 数据备份'),ctx);
  vm.runInContext('LACT.panel={k:"at",list:testList,current:dmSession()};',ctx);
  const read=s=>vm.runInContext(s,ctx),page=k=>read('actPage('+JSON.stringify(k)+')');
  const head=async(atRows=rows(60,31),next='a_cursor_31',unread=60,others={})=>{
    const start=requests.length,task=ctx.actLoad(true);await tick();requests[start].resolve({likes:0,fans:0,at:unread});await tick();
    for(const r of requests.slice(start+1)){const k=new URL('https://fixture'+r.path).searchParams.get('kind');r.resolve(k==='at'?{items:atRows,next}:others[k]||{items:[],next:null});}
    await task;return task;
  };
  return{ctx,requests,attrs,all,list,panel,toasts,motions,read,page,head,get originalCalls(){return originalCalls;}};
}
test('通知第二页采用编码游标，重复点击共用请求，按稳定ID去重倒序并保留面板位置',async()=>{
  const h=harness();await h.head(rows(60,31),'a_cursor/+?');const p=h.ctx.ACTIONS['activity-more']({dataset:{v:'at'}}),same=h.ctx.ACTIONS['activity-more']({dataset:{v:'at'}});
  assert.equal(p,same);await tick();const request=h.requests[4];assert.equal(request.method,'GET');assert.match(request.path,/cursor=a_cursor%2F%2B%3F/);assert.equal(request.body,undefined);assert.equal(request.options.signal.aborted,false);assert.match(h.list.innerHTML,/加载中/);
  request.resolve({items:[{...row(31),body:'重复ID的最新正文'},...rows(30,2)],next:null});await p;
  assert.equal(h.ctx.NOTES.at.length,59);assert.equal(new Set(h.ctx.NOTES.at.map(n=>n.id)).size,59);assert.equal(h.ctx.NOTES.at[0].id,'ac_060');assert.equal(h.ctx.NOTES.at.at(-1).id,'ac_002');assert.equal(h.ctx.NOTES.at.find(n=>n.id==='ac_031').text,'重复ID的最新正文');
  assert.equal(h.page('at').next,null);assert.equal(h.page('at').expanded,true);assert.equal(h.panel.scrollTop,222);assert.equal(h.ctx.NOTE_NEW.at,60);
});
for(const kind of ['likes','fans'])test(`${kind}拥有独立下一页、真实演员和稳定通知ID`,async()=>{
  const h=harness(),first={...row(8),kind:kind==='fans'?'follow':'like'};await h.head(rows(10,1),'a_at',10,{[kind]:{items:[first],next:'a_'+kind}});
  const task=h.ctx.actMore(kind);await tick();const r=h.requests[4];assert.match(r.path,new RegExp('kind='+kind));r.resolve({items:[{...row(7),kind:first.kind}],next:null});await task;
  assert.deepEqual(Array.from(h.ctx.NOTES[kind],n=>n.id),['ac_008','ac_007']);assert.equal(h.page(kind).next,null);assert.equal(h.page('at').next,'a_at');assert(h.ctx.USERS.actor_7);
});
test('后台刷新新首屏覆盖同ID字段且保留已经展开的旧页和末尾游标',async()=>{
  const h=harness();await h.head(rows(40,11),'a_11',40);const more=h.ctx.actMore('at');await tick();h.requests[4].resolve({items:rows(10,1),next:null});await more;
  await h.head([{...row(41),body:'新通知'}, {...row(40),body:'首屏更新'},...rows(39,12)],'a_new_head',41);
  assert.equal(h.ctx.NOTES.at.length,41);assert.equal(h.ctx.NOTES.at.at(-1).id,'ac_001');assert.equal(h.ctx.NOTES.at.find(n=>n.id==='ac_040').text,'首屏更新');assert.equal(h.page('at').next,null);assert.equal(h.page('at').expanded,true);
});
test('读取更多的同时刷新首屏，保留两次请求间的旧首屏尾部，避免中间通知消失',async()=>{
  const h=harness();await h.head();const older=h.ctx.actMore('at');await tick();const head=h.ctx.actLoad(true);await tick();
  h.requests[5].resolve({likes:0,fans:0,at:65});await tick();h.requests.slice(6).forEach(r=>r.resolve(r.path.includes('kind=at')?{items:rows(65,36),next:'a_new'}:{items:[],next:null}));await head;
  assert.equal(h.page('at').next,'a_cursor_31');h.requests[4].resolve({items:rows(30,1),next:null});await older;
  assert.equal(h.ctx.NOTES.at.length,65);assert.deepEqual(Array.from(h.ctx.NOTES.at,n=>n.id),Array.from({length:65},(_,i)=>row(65-i).id));
});
test('更多通知失败保留已读列表和游标，局部重试成功才追加',async()=>{
  const h=harness();await h.head();const work=h.ctx.actMore('at');await tick();h.requests[4].reject(Object.assign(Error('断网'),{code:'network'}));await work;
  assert.equal(h.ctx.NOTES.at.length,30);assert.equal(h.page('at').next,'a_cursor_31');assert.match(h.list.innerHTML,/读取失败/);assert.match(h.list.innerHTML,/data-act="activity-more"/);assert.equal(h.panel.scrollTop,222);
  const retry=h.ctx.actMore('at');await tick();assert.equal(h.requests[5].path,h.requests[4].path);h.requests[5].resolve({items:rows(30,21),next:'a_21'});await retry;
  assert.equal(h.ctx.NOTES.at.length,40);assert.equal(h.page('at').next,'a_21');assert.equal(h.page('at').more,'idle');assert.doesNotMatch(h.list.innerHTML,/读取失败/);
});
test('相同响应游标不会循环，显式刷新后才能恢复分页',async()=>{
  const h=harness();await h.head();const work=h.ctx.actMore('at');await tick();h.requests[4].resolve({items:[],next:'a_cursor_31'});await work;
  assert.equal(h.page('at').invalid,true);assert.equal(h.page('at').next,null);assert.match(h.list.innerHTML,/刷新通知/);const count=h.requests.length;await h.ctx.actMore('at');assert.equal(h.requests.length,count);
  await h.head(rows(60,31),'a_repaired');assert.equal(h.page('at').invalid,false);assert.equal(h.page('at').next,'a_repaired');assert.equal(h.page('at').seen.size,0);
});
test('较长的A→B→A游标循环同样停止，不反复读取旧页',async()=>{
  const h=harness();await h.head();const one=h.ctx.actMore('at');await tick();h.requests[4].resolve({items:rows(30,21),next:'a_loop_B'});await one;
  const two=h.ctx.actMore('at');await tick();h.requests[5].resolve({items:rows(20,11),next:'a_cursor_31'});await two;
  assert.equal(h.page('at').invalid,true);assert.equal(h.page('at').next,null);assert.equal(h.ctx.NOTES.at.length,40);const count=h.requests.length;await h.ctx.actMore('at');assert.equal(h.requests.length,count);
});
test('失效游标使用刷新入口，不继续向同一个失效锚点重试',async()=>{
  const h=harness();await h.head();const work=h.ctx.actMore('at');await tick();h.requests[4].reject(Object.assign(Error('锚点失效'),{status:400,code:'bad_cursor'}));await work;
  assert.equal(h.page('at').invalid,true);assert.equal(h.page('at').next,null);assert.match(h.list.innerHTML,/刷新通知/);assert.equal(h.ctx.NOTES.at.length,30);
});
test('全部已读只发送一次整类POST，服务器确认前不清未读，确认后包含未加载的通知',async()=>{
  const h=harness();await h.head(rows(60,31),null,45);const work=h.ctx.ACTIONS['at-all'](h.all);void h.ctx.ACTIONS['at-all'](h.all);await tick();
  const writes=h.requests.filter(r=>r.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].path,'/me/activity/read');assert.deepEqual(JSON.parse(JSON.stringify(writes[0].body)),{kind:'at'});
  assert.equal(h.originalCalls,0);assert.equal(h.ctx.NOTE_NEW.at,45);assert.equal(h.ctx.AT_READ.size,0);assert.equal(h.all.disabled,true);assert.equal(h.attrs.get('aria-busy'),'true');
  writes[0].resolve({ok:true});await work;assert.equal(h.ctx.NOTE_NEW.at,0);assert.equal(h.ctx.AT_READ.size,30);assert(h.ctx.NOTES.at.every(n=>n.read));assert.equal(h.read('LACT.bulk'),null);assert.equal(h.all.disabled,true);assert.deepEqual(h.motions.at(-1),['fx-jelly',500]);assert.equal(h.requests.filter(r=>r.body?.ids).length,0);
});
test('首屏全部已读但更旧页有未读时，header仍支持整类全部已读',async()=>{
  const h=harness();await h.head(rows(60,31,true),'a_cursor_31',15);assert.equal(h.ctx.atUnread(),0);assert.equal(h.ctx.NOTE_NEW.at,15);assert.equal(h.all.disabled,false);
});
test('读完最后一条首屏未读后，尚未加载的旧未读仍可通过header全部清除',async()=>{
  const h=harness();await h.head([...rows(60,32,true),row(31)],'a_cursor_31',16);h.ctx.atMark('ac_031');
  assert.equal(h.ctx.atUnread(),0);assert.equal(h.ctx.NOTE_NEW.at,15);assert.equal(h.all.disabled,false);assert.deepEqual(JSON.parse(JSON.stringify(h.requests[4].body)),{ids:['ac_031']});h.requests[4].resolve({ok:true});await tick();
});
test('整类标读失败保留未读并显示重试，重复发送受控',async()=>{
  const h=harness();await h.head();const first=h.ctx.ACTIONS['at-all'](h.all);h.requests[4].reject(Object.assign(Error('断网'),{code:'network'}));await first;
  assert.equal(h.ctx.NOTE_NEW.at,60);assert.equal(h.ctx.AT_READ.size,0);assert.equal(h.all.disabled,false);assert.match(h.list.innerHTML,/全部已读失败/);assert.match(h.list.innerHTML,/data-act="at-all"/);
  const retry=h.ctx.ACTIONS['at-all'](h.all);void h.ctx.ACTIONS['at-all'](h.all);assert.equal(h.requests.length,6);h.requests[5].resolve({ok:true});await retry;assert.equal(h.ctx.NOTE_NEW.at,0);assert.doesNotMatch(h.list.innerHTML,/全部已读失败/);assert.equal(h.originalCalls,0);
});
test('全部已读之后迟到的首屏和旧分页GET不会复活未读或留下加载状态',async()=>{
  const h=harness();await h.head();const head=h.ctx.actLoad(true);await tick();const older=h.ctx.actMore('at');await tick();const all=h.ctx.ACTIONS['at-all'](h.all);await tick();
  assert.equal(h.requests[6].method,'POST');h.requests[6].resolve({ok:true});await all;
  h.requests[4].resolve({likes:0,fans:0,at:60});h.requests[5].resolve({items:rows(30,1),next:null});await head;await older;
  assert.equal(h.ctx.NOTE_NEW.at,0);assert.equal(h.ctx.NOTES.at.length,30);assert.equal(h.ctx.AT_READ.size,30);assert.equal(h.page('at').more,'idle');assert.equal(h.read('LACT.status'),'ready');assert.equal(h.requests.length,7);
});
test('账号切换清掉展开页、游标和发送状态，旧分页/标读回包不写入新账号',async()=>{
  const h=harness();await h.head();const old=h.ctx.actMore('at');await tick();const bulk=h.ctx.ACTIONS['at-all'](h.all);await tick();const signal=h.requests[4].options.signal;
  h.ctx.ME='other_fixture';h.ctx.LDM.epoch++;h.ctx.NOTES.at=[];h.ctx.AT_READ.clear();h.list.isConnected=h.all.isConnected=false;
  await h.ctx.liveAfterLogin();await tick();assert.equal(signal.aborted,true);assert.equal(h.read('LACT.bulk'),null);assert.equal(h.page('at').expanded,false);assert.equal(h.page('at').next,null);
  h.requests[4].resolve({items:rows(30,1),next:null});h.requests[5].resolve({ok:true});await old;await bulk;assert.equal(h.ctx.NOTES.at.length,0);assert.equal(h.ctx.AT_READ.size,0);
  const start=6;h.requests[start].resolve({likes:0,fans:0,at:0});await tick();h.requests.slice(start+1).forEach(r=>r.resolve({items:[],next:null}));await tick();assert.equal(h.ctx.NOTE_NEW.at,0);assert.equal(h.ctx.NOTES.at.length,0);
});
test('服务器总数不会破坏纯原型的按条未读getter',()=>{
  const h=harness();h.ctx.NOTES.at=[{id:'demo_1'},{id:'demo_2'}];h.ctx.actSetAt(70);assert.equal(h.ctx.NOTE_NEW.at,70);
  h.ctx.API.on=()=>false;assert.equal(h.ctx.NOTE_NEW.at,2);h.ctx.AT_READ.add('demo_1');assert.equal(h.ctx.NOTE_NEW.at,1);
});
