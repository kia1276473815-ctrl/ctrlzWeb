// 提取真实请求、搜索和信息流代码做故障验证；不访问真实账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => { const start = source.indexOf(a), end = source.indexOf(b,start+a.length); assert(start >= 0 && end > start,a); return source.slice(start,end); };
const tick = async () => { for (let i = 0; i < 18; i++) await Promise.resolve(); };
const defer = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const response = (status=200,value={ok:true}) => ({status,ok:status>=200 && status<300,headers:{get:()=>'application/json'},json:async()=>value});
function requests(fetch, extra={}){
  let loggedOut=0; const stored=new Map(),delays=[];
  const ctx=vm.createContext({console,Promise,Date,AbortController,TypeError,setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms);},clearTimeout,
    fetch,store:{get:k=>stored.get(k),set:(k,v)=>stored.set(k,v)},liveLoggedOut:()=>{loggedOut++;vm.runInContext('API.setTok(null)',ctx);},...extra});
  vm.runInContext(section('function requestTask(', 'API.init();'),ctx);
  vm.runInContext("API.base='https://fixture';API.tok={access:'old-access',refresh:'refresh'};",ctx);
  const api=vm.runInContext('API',ctx);return {ctx,api,delays,get loggedOut(){return loggedOut;}};
}
test('读取10秒、写入30秒默认期限，正常响应清理计时器',async()=>{
  const r=requests(async()=>response());await r.api.req('GET','/posts');await r.api.req('POST','/dm',{});
  assert.deepEqual(r.delays,[10000,30000]);
});
test('悬挂连接和悬挂JSON读取都按期限结束，不退出账号',async()=>{
  for (const bodyHang of [false,true]) { let signal;
    const r=requests(async(url,init)=>{signal=init.signal;return bodyHang?{...response(),json:()=>new Promise(()=>{})}:new Promise(()=>{});});
    await assert.rejects(r.api.req('GET','/posts',undefined,{timeoutMs:8}),e=>e.code==='timeout');
    assert.equal(signal.aborted,true);assert(r.api.tok);assert.equal(r.loggedOut,0);
  }
});
test('显式取消与断网分别报告，写请求网络失败只尝试一次',async()=>{
  let calls=0;const r=requests(async()=>{calls++;throw new TypeError('offline');});
  await assert.rejects(r.api.req('POST','/dm',{}),e=>e.code==='network');assert.equal(calls,1);assert.equal(r.loggedOut,0);
  const ctrl=new AbortController();ctrl.abort();await assert.rejects(r.api.req('GET','/posts',undefined,true,{signal:ctrl.signal}),e=>e.code==='cancel');assert.equal(calls,1);
});
test('401刷新遇到断网保留会话，不把连接错误变成登录失效',async()=>{
  let refresh=0;const r=requests(async(url)=>{if(url.endsWith('/auth/refresh')){refresh++;throw new TypeError('offline');}return response(401);});
  await assert.rejects(r.api.req('GET','/me'),e=>e.code==='network');assert.equal(refresh,1);assert(r.api.tok);assert.equal(r.loggedOut,0);
});
test('两个401共用刷新，取消一个调用不会中断另一调用的刷新',async()=>{
  const refresh=defer();let refreshes=0,refreshSignal;const ctrl=new AbortController();
  const r=requests(async(url,init)=>{if(url.endsWith('/auth/refresh')){refreshes++;refreshSignal=init.signal;return refresh.promise;}
    return init.headers.Authorization==='Bearer new-access'?response(200,{ok:true}):response(401);});
  const first=r.api.req('GET','/me',undefined,{signal:ctrl.signal}),second=r.api.req('GET','/posts');await tick();assert.equal(refreshes,1);
  ctrl.abort();await assert.rejects(first,e=>e.code==='cancel');assert.equal(refreshSignal.aborted,false);
  refresh.resolve(response(200,{accessToken:'new-access',refreshToken:'new-refresh'}));assert.deepEqual(JSON.parse(JSON.stringify(await second)),{ok:true});
  assert.equal(r.api.tok.access,'new-access');assert.equal(r.loggedOut,0);
});
test('刷新身份确实失效才退出；刷新成功后的第二个401也退出',async()=>{
  for(const succeeds of [false,true]){const r=requests(async url=>url.endsWith('/auth/refresh')&&succeeds?response(200,{accessToken:'new',refreshToken:'new-refresh'}):response(401));
    await assert.rejects(r.api.req('GET','/me'),e=>e.status===401);assert.equal(r.api.tok,null);assert.equal(r.loggedOut,1);
  }
});
test('切换账号时迟到刷新不能覆盖新令牌',async()=>{
  const wait=defer(),r=requests(async()=>wait.promise);const task=r.api.refresh();await tick();r.api.setTok({access:'other',refresh:'other-refresh'});
  wait.resolve(response(200,{accessToken:'stale',refreshToken:'stale-refresh'}));await assert.rejects(task,e=>e.code==='cancel');assert.equal(r.api.tok.access,'other');
});
test('账号切换后迟到401不刷新新账号、不以新身份重发旧写入',async()=>{
  const wait=defer(),calls=[];const r=requests(async(url,init)=>{calls.push([url,init.headers.Authorization]);return wait.promise;});
  const task=r.api.req('POST','/dm',{body:'旧账号消息'});await tick();r.api.setTok({access:'other',refresh:'other-refresh'});wait.resolve(response(401));
  await assert.rejects(task,e=>e.code==='cancel');assert.equal(calls.length,1);assert.equal(r.api.tok.access,'other');assert.equal(r.loggedOut,0);
});
test('上传三个阶段使用120秒期限，并透传调用方取消',async()=>{
  const calls=[];const r=requests(async(url,init)=>{calls.push([url,init]);return url.endsWith('/uploads')?response(200,{id:'u',uploadUrl:'https://upload',headers:{}}):response();});
  vm.runInContext(section('const PROD_MIME =','async function liveEnsureUpload('),r.ctx);const ctrl=new AbortController();
  await r.ctx.liveUpload({type:'image/png',size:4},'dm_image',undefined,{signal:ctrl.signal});assert.deepEqual(r.delays,[120000,120000,120000]);assert.equal(calls.length,3);
  assert.equal(calls[1][1].method,'PUT');assert(calls.every(([,init])=>init.signal));
});
test('后台请求断网保留后台会话，迟到401不清掉新后台账号',async()=>{
  const wait=defer(),r=requests(async()=>wait.promise);r.ctx.API=r.api;let dropped=0;
  vm.runInContext(section('const STAFF =','STAFF.load();'),r.ctx);const staff=vm.runInContext('STAFF',r.ctx);staff.tok='old-staff';staff.base=r.api.base;staff.drop=()=>dropped++;
  const old=staff.req('GET','/admin/me');await tick();staff.tok='new-staff';wait.resolve(response(401));await assert.rejects(old,e=>e.code==='cancel');assert.equal(dropped,0);
  r.ctx.fetch=async()=>{throw new TypeError('offline');};await assert.rejects(staff.req('GET','/admin/me'),e=>e.code==='network');assert.equal(staff.tok,'new-staff');assert.equal(dropped,0);
});
function feeds(){
  const pending=[],old={id:'old'},status={innerHTML:''};let patches=0;
  const ctx=vm.createContext({console,Promise,Map,Set,LIVE:{pend:{},feed:{status:'ready',seq:0}},POSTS:[old],ME:'me',CUR:{key:'home|',post:null},ACTIONS:{},
    API:{base:'fixture',on:()=>true,req:()=>{const wait=defer();pending.push(wait);return wait.promise;}},apiPost:x=>x,esc:String,
    $:sel=>sel==='#app .feed-state'?status:sel==='#app .mason'?{}:null,patchMoreList:()=>patches++,rerender:()=>patches++,apiFail(){}});
  vm.runInContext(section('function feedStatusHtml(){','async function liveMeExtras(){'),ctx);return {ctx,pending,old,status,get patches(){return patches;}};
}
test('刷新等待及失败保留已有作品和滚动容器，显示可重试状态',async()=>{
  const f=feeds(),task=f.ctx.liveFeed();assert.equal(f.ctx.POSTS[0],f.old);assert.match(f.status.innerHTML,/正在更新/);assert.equal(f.patches,0);
  f.pending[0].reject(new Error('读取超时，请重试'));await assert.rejects(task);assert.equal(f.ctx.POSTS[0],f.old);assert.equal(f.patches,0);assert.match(f.status.innerHTML,/feed-retry/);
  const retry=f.ctx.liveFeed();f.pending[1].resolve({items:[{id:'new'}],next:null});await retry;assert.equal(f.ctx.POSTS[0].id,'new');assert.equal(f.patches,1);assert.equal(f.status.innerHTML,'');
});
test('先到的新信息流优先，迟到旧请求与旧账号响应不回填',async()=>{
  const f=feeds(),a=f.ctx.liveFeed(),b=f.ctx.liveFeed();f.pending[1].resolve({items:[{id:'new'}]});await b;f.pending[0].resolve({items:[{id:'stale'}]});await a;assert.equal(f.ctx.POSTS[0].id,'new');
  const c=f.ctx.liveFeed();f.ctx.ME='other';f.pending[2].resolve({items:[{id:'private'}]});await c;assert.equal(f.ctx.POSTS[0].id,'new');
});
function searches(){
  const timers=new Map(),handlers={},pending=[],applied=[];let timer=0,draws=0;
  const el={dataset:{s:'all'},isConnected:true,_draw:()=>draws++,remove(){this.isConnected=false;}},q={value:'',addEventListener:(type,fn)=>handlers[type]=fn};
  const ctx=vm.createContext({Promise,AbortController,Map,Set,clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++timer,fn);return timer;},
    openSearch(){},$:sel=>sel==='#sq'?q:sel==='#srch'?el:sel==='#layer'?{firstElementChild:null}:null,API:{tok:{access:'test'},on:()=>true,req:(method,path,body,opts)=>{const wait=defer();pending.push({...wait,path,signal:opts.signal});return wait.promise;}},
    addPosts:items=>applied.push(...items),apiProduct:x=>applied.push(x),apiUser:x=>applied.push(x),LSRCH:new Set(),CUR:{post:null},RL:{on:false},document:{documentElement:{style:{}}}});
  vm.runInContext(section('{ const open0 = openSearch;','function closeSearch('),ctx);vm.runInContext(section('function closeSearch(','ACTIONS.sclose'),ctx);ctx.openSearch();
  const input=value=>{q.value=value;handlers.input();};const flush=()=>{const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn());};
  return {ctx,el,q,pending,applied,timers,input,flush,get draws(){return draws;}};
}
test('搜索换词立即取消旧请求，迟到结果不灌入；关闭搜索清掉防抖与连接',async()=>{
  const s=searches();s.input('old');assert(s.el._remote.pending);s.flush();await tick();assert.equal(s.pending.length,3);
  s.input('new');assert(s.pending.slice(0,3).every(x=>x.signal.aborted));s.pending.slice(0,3).forEach(x=>x.resolve({items:[{id:'old'}]}));await tick();assert.equal(s.applied.length,0);
  s.ctx.closeSearch();assert.equal(s.timers.size,0);assert.equal(s.el.isConnected,false);
});
test('搜索真实失败显示重试，重试完成后结束等待状态',async()=>{
  const s=searches();s.input('new');s.flush();await tick();s.pending[0].reject(new Error('网络不可用'));s.pending.slice(1).forEach(x=>x.resolve({items:[]}));await tick();
  assert.equal(s.el._remote.pending,false);assert.match(s.el._remote.error,/网络/);s.el._searchRetry();s.flush();await tick();s.pending.slice(3).forEach(x=>x.resolve({items:[]}));await tick();
  assert.equal(s.el._remote.pending,false);assert.equal(s.el._remote.error,null);
});
test('搜索Enter沿用中文输入法组字防护',()=>{
  const keydown=source.match(/q\.addEventListener\('keydown', e => \{ if \(e\.isComposing[\s\S]*?\n/)[0];let closes=0;
  const q={addEventListener:(name,fn)=>q.listener=fn,value:'中文'},ctx=vm.createContext({q,el:{},$$:()=>[{dataset:{sgo:'post-p'}}],sel:0,SHIST:{add(){}},closeSearch:()=>closes++,go(){},draw(){},ACTIONS:{}});
  vm.runInContext(source.split('\n').find(line=>line.startsWith('  const enter = row =>')),ctx);
  vm.runInContext(keydown,ctx);q.listener({key:'Enter',isComposing:true});q.listener({key:'Enter',keyCode:229});assert.equal(closes,0);q.listener({key:'Enter',isComposing:false,keyCode:13,preventDefault(){}});assert.equal(closes,1);
});
function polls(){
  let hidden=false,pollCount=0;const requests=[],listeners={};
  const ctx=vm.createContext({Promise,Set,Map,Date,JSON,ME:'me',STATE:{role:'user'},LDM:{timer:1},CUR:{key:'home|'},NOTES:{likes:[],fans:[],at:[]},NOTE_NEW:{at:0},AT_READ:new Set(),
    document:{get hidden(){return hidden;},addEventListener:(name,fn)=>listeners[name]=fn},ACTIONS:{},dmSession:()=>()=>ctx.ME==='me',dmPoll:async()=>pollCount++,
    API:{on:()=>true,tok:{access:'test'},req:async(method,path)=>{requests.push(path);return path.endsWith('/unread')?{likes:0,fans:0,at:0}:{items:[]};}},
    apiUser(){},dmRefs:async()=>{},noteSync(){},msgBadge(){},dmPaint(){},toast(){},esc:String});
  vm.runInContext(section('const LACT =','{ const after2 ='),ctx);
  const visibilityLine=source.split('\n').find(line=>line.startsWith("document.addEventListener('visibilitychange', () => { if (!document.hidden && LDM.timer)"));assert(visibilityLine);vm.runInContext(visibilityLine,ctx);
  return {ctx,requests,listeners,set hidden(value){hidden=value;},get polls(){return pollCount;}};
}
test('隐藏页私信和提醒均不请求，前台恢复合并为一次补读',async()=>{
  const p=polls();p.hidden=true;await p.ctx.dmPoll();await p.ctx.actLoad(true);assert.equal(p.polls,0);assert.equal(p.requests.length,0);
  vm.runInContext('LACT.tick=1',p.ctx);p.hidden=false;p.listeners.visibilitychange();await tick();assert.equal(p.polls,1);
  assert.equal(p.requests.filter(x=>x==='/me/activity/unread').length,1);assert.equal(p.requests.length,4);
});
test('私信等待读取期间变成隐藏页，不追加提醒请求',async()=>{
  const p=polls(),wait=defer();vm.runInContext('dmPollBefore = dmPoll',p.ctx);
  // 替换包装器捕获的原私信任务，实际包装器仍按当前源码执行。
  p.ctx.dmPoll=()=>wait.promise;vm.runInContext(section('{ const poll0 = dmPoll;', '{ const after2 ='),p.ctx);
  const task=p.ctx.dmPoll();p.hidden=true;wait.resolve();await task;assert.equal(p.requests.length,0);
});
test('提醒列表读取失败不提前确认未读摘要，下次轮询仍补读',async()=>{
  const p=polls();let failures=1;
  p.ctx.API.req=async(method,path)=>{p.requests.push(path);if(path.endsWith('/unread'))return {likes:1,fans:0,at:0};if(failures-- > 0)throw new Error('offline');return {items:[]};};
  await p.ctx.actLoad();assert.equal(vm.runInContext('LACT.sig',p.ctx),'');await p.ctx.actLoad();assert.equal(p.requests.filter(x=>x==='/me/activity/unread').length,2);assert.notEqual(vm.runInContext('LACT.sig',p.ctx),'');
});
