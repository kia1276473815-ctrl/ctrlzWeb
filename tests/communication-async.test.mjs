import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const commSource=fs.readFileSync(new URL('../scripts/communication.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const part=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x+a.length);assert(x>=0&&y>x);return s.slice(x,y);};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
  const calls=[],uploads=[],sent=[],inputs={peT:{value:'原帖子'},peB:{value:'原正文',isConnected:true}},post={id:'p',live:true};
  const ctx=vm.createContext({Map,Set,WeakMap,JSON,Date,API:{base:'https://qa.invalid',epoch:1,req:async(method,path,body)=>{calls.push({method,path,body,me:ctx.ME});return {ok:true};}},ME:'a',LIVE:{cfg:{}},liveUser:()=>true,DmOutboxStore:{create:()=>({})},DMOUT:{rows:new Map()},dmScope:()=>'',CHATS:{},CHAT_UNREAD:{},LDM:{full:new Set(),since:{},before:{},sig:{}},CUR:{key:'home'},controls(){},comm:{},poll:async()=>{},ACTIONS:{'post-esave'(){}},POST:()=>post,$:selector=>inputs[selector.slice(1)],document:{querySelectorAll:()=>[]},ADM:{inbox:{a:[]}},msgBadge(){},closeSheet(){},softRefresh(){},toast(){},apiFail(){},liveUpload:async file=>{uploads.push(file);return {id:'up_'+uploads.length};},apiPost:x=>x,sendMsg:async(uid,m)=>{sent.push({uid,m,me:ctx.ME});return true;},dmLive:()=>true,dmConv:async()=>{}});
  vm.runInContext(part(commSource,'  const scope=','  function controls(){'),ctx);
  return {ctx,calls,uploads,sent,inputs,state:()=>vm.runInContext('current()',ctx)};
}
const button={dataset:{id:'p'},isConnected:false,disabled:false,setAttribute(){}};
test('编辑上传等待中切换账号或重开编辑面板，不再上传其余文件或提交旧编辑',async()=>{
  for(const mode of ['account','panel']){
    const h=harness(),pending=deferred();h.ctx.liveUpload=async file=>{h.uploads.push(file);if(h.uploads.length===1)return pending.promise;return {id:'other'};};
    vm.runInContext('let editing={id:"p",scope:scope(),files:[{file:{type:"image/png"}},{file:{type:"image/png"}}]};'+part(commSource,"  const oldSave=ACTIONS['post-esave'];",'  // 后续发布管理'),h.ctx);
    const work=h.ctx.ACTIONS['post-esave']({...button,dataset:{id:'p'}});assert.equal(h.uploads.length,1);
    if(mode==='account')h.ctx.ME='b';else vm.runInContext('editing={id:"another",scope:scope(),files:[]}',h.ctx);
    pending.resolve({id:'first'});await work;assert.equal(h.uploads.length,1,mode);assert.equal(h.calls.length,0,mode);
  }
});
test('陌生会话预读期间切换账号，不把原输入交给新账号发送',async()=>{
  const h=harness(),pending=deferred();h.ctx.dmConv=()=>pending.promise;
  vm.runInContext(part(commSource,'  const oldSend=sendMsg;','  const oldRemove='),h.ctx);
  const work=h.ctx.sendMsg('peer',{t:'text',text:'旧账号草稿'});h.ctx.ME='b';h.state().threads.peer={state:'accepted',canSend:true,canSendMedia:true};pending.resolve();await work;assert.equal(h.sent.length,0);
});
test('官方通知或提及快照等待时切换账号，不标读新账号的通知',async()=>{
  for(const type of ['official','at']){
    const h=harness(),pending=deferred();h.ctx.sysLoad=()=>pending.promise;h.ctx.actLoad=()=>pending.promise;
    vm.runInContext(type==='official'?part(commSource,'  comm.openOfficial=','  let editing='):part(commSource,"  ACTIONS['at-all']=",'  comm.openOfficial='),h.ctx);
    const work=type==='official'?h.ctx.comm.openOfficial(()=>{},{}):h.ctx.ACTIONS['at-all']({...button});
    h.ctx.ME='b';h.state().tokens[type]='new-account-token';pending.resolve();await work;assert.equal(h.calls.length,0,type);
  }
});
test('全部已读分批请求之间换号，停止后续批次',async()=>{
  const h=harness();h.ctx.poll=async()=>{};h.ctx.API.req=async(method,path,body)=>{h.calls.push({method,path,body});if(method==='GET')return {items:Array.from({length:101},(_,i)=>({peer:{id:'u'+i},unread:1,readThrough:'cursor'})),next:null};h.ctx.ME='b';return {ok:true};};
  vm.runInContext(part(commSource,"  ACTIONS['dm-readall']=",'  document.addEventListener('),h.ctx);await h.ctx.ACTIONS['dm-readall']({...button});assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});
test('迟到会话页不把旧账号分页结果传入新账号扩展状态',async()=>{
  const h=harness(),pending=deferred(),pages=[];h.ctx.API.req=()=>pending.promise;h.ctx.dmSession=()=>{const me=h.ctx.ME;return()=>me===h.ctx.ME;};h.ctx.CZCommunication={threadPage:r=>pages.push(r)};
  vm.runInContext(part(html,'async function dmThreads(){','function dmMerge('),h.ctx);const work=h.ctx.dmThreads();h.ctx.ME='b';pending.resolve({items:[],next:'old-cursor'});await work;assert.equal(pages.length,0);
});

test('迟到官方通知页不把旧账号快照写进新账号，网络失败返回明确失败',async()=>{
  const h=harness(),pending=deferred(),tokens=[];h.ctx.dmSession=()=>{const me=h.ctx.ME;return()=>me===h.ctx.ME;};h.ctx.CZCommunication={officialToken:t=>tokens.push(t)};h.ctx.API.req=()=>pending.promise;
  vm.runInContext(part(html,'async function sysLoad(){','{ const poll0 = dmPoll;'),h.ctx);
  const work=h.ctx.sysLoad();h.ctx.ME='b';pending.resolve({items:[],unread:0,readToken:'old-private-token'});assert.equal(await work,false);assert.equal(tokens.length,0);
  h.ctx.API.req=async()=>{throw Error('offline');};assert.equal(await h.ctx.sysLoad(),false);
});

test('完整通知校对能更新未读数和首条ID均未变化的处理状态',async()=>{
  const h=harness();h.ctx.dmSession=()=>()=>true;h.ctx.LDM.sysMark=JSON.stringify(['n',1]);h.ctx.ADM.inbox.a=[{id:'n',read:false}];h.ctx.API.req=async(method,path)=>{h.calls.push(path);return {items:[{id:'n',title:'通知',body:'正文',read:false,createdAt:new Date().toISOString(),extra:{done:true}}],unread:1};};
  vm.runInContext(part(html,'async function sysLoad(){','{ const poll0 = dmPoll;'),h.ctx);assert.equal(await h.ctx.sysLoad(true),true);assert.deepEqual(h.calls,['/notifications?limit=50']);assert.equal(h.ctx.ADM.inbox.a[0].done,true);
});

test('聊天搜索翻页等待期间换词、重开搜索或重置游标，不混入迟到结果',async()=>{
  for(const mode of ['query','panel','cursor']){
    const h=harness(),pending=deferred(),old={query:'old',messages:[{id:'old'}],messageNext:'cursor'},panel={isConnected:true,_remote:old};let activePanel=panel,paints=0;
    h.ctx.$=()=>activePanel;h.ctx.searchRows=()=>paints++;h.ctx.API.req=()=>pending.promise;
    vm.runInContext(part(commSource,"  ACTIONS['comm-search-more']=","  ACTIONS['comm-jump-message']="),h.ctx);
    const work=h.ctx.ACTIONS['comm-search-more']({...button,dataset:{query:'old',cursor:'cursor'}});
    if(mode==='panel'){panel.isConnected=false;activePanel={isConnected:true,_remote:{query:'old',messages:[{id:'new'}],messageNext:'cursor'}};}
    else if(mode==='query')panel._remote={query:'new',messages:[{id:'new'}],messageNext:'new-cursor'};
    else old.messageNext='reset';
    pending.resolve({items:[{id:'late'}],next:'stale-next'});await work;
    assert(!old.messages.some(m=>m.id==='late'),mode);assert(!activePanel._remote.messages.some(m=>m.id==='late'),mode);assert.equal(paints,0,mode);
  }
});

test('聊天搜索翻页只接续当前查询的当前游标',async()=>{
  const h=harness(),remote={query:'same',messages:[{id:'first'}],messageNext:'one'},panel={isConnected:true,_remote:remote};let paints=0;
  h.ctx.$=()=>panel;h.ctx.searchRows=()=>paints++;h.ctx.API.req=async(method,path)=>{h.calls.push(path);return {items:[{id:'second'}],next:null};};
  vm.runInContext(part(commSource,"  ACTIONS['comm-search-more']=","  ACTIONS['comm-jump-message']="),h.ctx);
  await h.ctx.ACTIONS['comm-search-more']({...button,dataset:{query:'same',cursor:'obsolete'}});assert.equal(h.calls.length,0);
  await h.ctx.ACTIONS['comm-search-more']({...button,dataset:{query:'same',cursor:'one'}});assert.deepEqual(remote.messages.map(m=>m.id),['first','second']);assert.equal(remote.messageNext,null);assert.equal(paints,1);
});
