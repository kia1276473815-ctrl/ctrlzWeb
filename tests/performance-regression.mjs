// 从实际页面提取函数，验证资源生命周期和异步竞态；不复制被测实现。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(import.meta.url);
const AudioResources = require('../scripts/audio-cache.js');
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => {
  const start = source.indexOf(a), end = source.indexOf(b,start+a.length);
  assert(start >= 0 && end > start, `找不到实际函数 ${a}`); return source.slice(start,end);
};
const realm = data => vm.createContext({console, Date, Map, Set, URL, Promise, AbortController, clearInterval(){},
  document:{dispatchEvent(){}},CustomEvent:class{constructor(type){this.type=type;}}, ...data});
const tick = async () => { for (let i=0; i<24; i++) await Promise.resolve(); };
const json = value => JSON.parse(JSON.stringify(value));

test('移动过场提前取消接住 ready，旧完成任务不能清除新过场', async () => {
  const root={dataset:{}}, transitions=[], timers=new Map(), errors=[];
  const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
  const ctx=realm({document:{documentElement:root,startViewTransition(fn){
    const ready=defer(),finished=defer(),update=defer();
    const t={ready:ready.promise,finished:finished.promise,updateCallbackDone:update.promise,
      skipTransition(){ready.reject(new DOMException('Transition skipped','AbortError'));},finish(){finished.resolve();}};
    fn();update.resolve();transitions.push(t);return t;
  }},console:{error:(...v)=>errors.push(v)},addEventListener(){},reduced:()=>false,isMob:()=>true,
    setTimeout:f=>{const id=timers.size+1;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(section('const VT = {t: null};','/* ================= 深浅色切换的过场'),ctx);
  let updates=0;ctx.update=()=>updates++;
  vm.runInContext("pageSwap('tab',update);VT.t.skipTransition();pageSwap('tab',update);",ctx);
  transitions[0].finish();await tick();
  assert.equal(root.dataset.vt,'tab');assert.equal(vm.runInContext('VT.t',ctx),transitions[1]);
  transitions[1].skipTransition();transitions[1].finish();await tick();
  await new Promise(r=>setImmediate(r));
  assert.equal(updates,2);assert.equal(root.dataset.vt,undefined);assert.equal(vm.runInContext('VT.t',ctx),null);
  assert.equal(timers.size,0);assert.equal(errors.length,0);
});

test('主题更新异常有报告，拒绝的完成任务仍释放特效状态', async () => {
  const props=new Map(),classes=new Set(),errors=[];
  const root={style:{removeProperty:k=>props.delete(k),setProperty:(k,v)=>props.set(k,v)},
    classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}};
  const THX={gen:0,t:null,map:{setAttribute(){},removeAttribute(){}},last:{}};
  const ctx=realm({document:{documentElement:root,startViewTransition(fn){let error;try{fn();}catch(e){error=e;}
    return {ready:Promise.reject(error),updateCallbackDone:Promise.reject(error),finished:Promise.reject(error)};}},
    console:{error:(...v)=>errors.push(v)},STATE:{settings:{rm:false}},VT:{t:null},THX,reduced:()=>false,isDark:()=>false,isMob:()=>true,
    innerWidth:411,innerHeight:866,thLensSvg(){}});
  vm.runInContext(section('function themeFx(apply, el){',"addEventListener('pointerdown', () => { if (THX.t)"),ctx);
  ctx.fail=()=>{throw Error('actual update failure');};ctx.themeFx(ctx.fail);
  await tick();await new Promise(r=>setImmediate(r));
  assert.equal(errors.length,1);assert.equal(errors[0][0],'主题更新失败');
  assert.equal(THX.t,null);assert.equal(classes.has('thvt'),false);assert.equal(props.size,0);
});

test('页面末尾没有脚本写入残留，内联 JS 可解析', () => {
  assert.equal(source.slice(source.indexOf('</html>') + '</html>'.length).trim(), '');
  for (const [,script] of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
});

test('按需经典脚本能独立注册原有后台/试听入口与协议正文', () => {
  const ctx=realm({window:{}});
  for (const name of ['views-admin-v1.js','views-audio-v1.js','docs-v1.js']) {
    const script=fs.readFileSync(new URL('../scripts/' + name,import.meta.url),'utf8');
    vm.runInContext(script,ctx,{filename:name});
  }
  assert.equal(Object.keys(ctx.window.CtrlzViews.admin).length,19);
  assert.deepEqual(Object.keys(ctx.window.CtrlzViews.audio),['pvSample','pvPreset','pvVideo']);
  assert(ctx.window.CtrlzDocBodies.terms); assert(ctx.window.CtrlzDocBodies.privacy);
});

test('路由脚本加载器能初始化，合并并发加载，失败后可重试', async () => {
  const scripts=[],nodes=[]; let refreshes=0;
  const ctx=realm({window:{},document:{createElement:()=>({remove(){this.removed=true;}}),head:{appendChild:s=>scripts.push(s)}},
    requestAnimationFrame:f=>{refreshes++;return 1;},rerender(){},$:()=>null,$$:()=>nodes,docHTML:id=>`loaded:${id}`});
  vm.runInContext(section('const BUNDLES =','const UI ='),ctx);
  const first=ctx.loadBundle('audio'),second=ctx.loadBundle('audio');
  assert.equal(first,second); assert.equal(scripts.length,1); scripts[0].onerror(); await assert.rejects(first);
  assert.equal(scripts[0].removed,true);
  const retry=ctx.loadBundle('audio'); assert.equal(scripts.length,2); scripts[1].onload(); await retry;
  assert.equal(vm.runInContext('BUNDLES.audio.ready',ctx),true);
  assert.equal(refreshes,0,'离开该页面后不重绘当前路由');
  nodes.push({dataset:{docBody:'terms'}}); const docs=ctx.loadBundle('docs'); scripts[2].onload(); await docs;
  assert.equal(nodes[0].outerHTML,'loaded:terms');
});

test('TRACKS 淘汰按对象身份保护草稿、播放和加载；别名不会释放被保护的缓冲', () => {
  let time=10000;
  const ctx = realm({navigator:{deviceMemory:4}, performance:{now:() => time}, AudioResources, GEN:{tr:null}, PEND:{id:null},
    setTimeout:() => 1, clearTimeout(){}, document:{addEventListener(){}, dispatchEvent(){}}, CustomEvent:class{}});
  vm.runInContext(section('const TRACKS = {};','function renderTrack(key, spec)'),ctx);
  vm.runInContext(`
    const demo = {buffer:{length:6*1024*1024,numberOfChannels:1},used:1,pr:Promise.resolve(),peaks:[1]};
    TRACKS['cp-demo'] = TRACKS['post:draft'] = demo;
    TRACKS.old = {buffer:{length:2*1024*1024,numberOfChannels:1},used:2,pr:Promise.resolve(),peaks:[1]};
    trimTracks();
  `,ctx);
  assert.equal(vm.runInContext("!!TRACKS['post:draft'].buffer",ctx),true,'草稿别名必须整体保护');
  assert.equal(vm.runInContext('!!TRACKS.old.buffer',ctx),false,'未保护的旧缓冲应释放');
  vm.runInContext(`
    delete TRACKS['cp-demo']; delete TRACKS['post:draft'];
    const playing = {buffer:{length:6*1024*1024,numberOfChannels:1},used:1,pr:Promise.resolve(),peaks:[1]};
    TRACKS.playing = playing; GEN.tr = playing;
    TRACKS.old2 = {buffer:{length:2*1024*1024,numberOfChannels:1},used:2,pr:Promise.resolve(),peaks:[1]}; trimTracks();
  `,ctx);
  assert.equal(vm.runInContext('!!TRACKS.playing.buffer',ctx),true);
  assert.equal(vm.runInContext('!!TRACKS.old2.buffer',ctx),false);
  vm.runInContext(`GEN.tr = null; trimTracks();`,ctx);
  assert.equal(vm.runInContext('TRACKS.playing.peaks[0]',ctx),1,'淘汰 PCM 仍保留轻量波形');
  vm.runInContext("TRACKS.failed=null;",ctx);
  assert.doesNotThrow(() => vm.runInContext('trimTracks()',ctx),'失败返回 null 不能破坏下次资源清理');
});

test('流式 GEN 能 seek、停止并释放媒体节点，旧播放失败不会停止新播放', async () => {
  const media=[], events=[], toasts=[], nodes=[];
  class AudioMock {
    constructor(){ this.readyState=0; this.currentTime=0; this.duration=NaN; this.listeners={}; this.paused=false; this.loaded=0; media.push(this); }
    addEventListener(n,f){ this.listeners[n]=f; }
    pause(){ this.paused=true; }
    removeAttribute(n){ delete this[n]; }
    load(){ this.loaded++; }
    play(){ return new Promise((resolve,reject) => { this.resolve=resolve; this.reject=reject; }); }
  }
  const GEN={ver:0,on:false, stop(){ if (!this.on) return; this.ver++; this.on=false; this.owner=null; this.tr=null; }, seek(){}, pos(){return 0;}, frac(){return 0;}};
  const ctx=realm({GEN,Audio:AudioMock, AU:{init:()=>true,an:{},ctx:{createMediaElementSource(a){ const n={a,connect(){},disconnect(){this.disconnected=true;}}; nodes.push(n); return n; }}},
    toast:(...a)=>toasts.push(a), document:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(n){this.type=n;}}});
  vm.runInContext(section('{ const stop0 = GEN.stop, seek0 = GEN.seek, pos0 = GEN.pos;','/* 离线渲染：'),ctx);
  GEN.startMedia('first','/one.wav',{},20,4); const first=media[0];
  first.duration=20; first.readyState=1; first.onloadedmetadata(); first.listeners.loadedmetadata();
  assert.equal(first.currentTime,4); assert.equal(GEN.tr.dur,20);
  GEN.seek(999); assert.equal(first.currentTime,19.99);
  GEN.startMedia('second','/two.wav',{},30); first.reject(new Error('旧请求取消')); await tick();
  assert.equal(GEN.owner,'second'); assert.equal(toasts.length,0); assert.equal(first.paused,true); assert.equal(nodes[0].disconnected,true);
  GEN.stop(); assert.equal(GEN.media,null); assert.equal(nodes[1].disconnected,true); assert.equal(media[1].src,undefined);
  media[1].reject(new Error('停止播放')); await tick(); assert.equal(toasts.length,0);
});

test('快速试听按最后一次点击播放，同一项加载时再点可以取消', async () => {
  const calls=[], requests={};
  const products={a:{id:'a',live:true,pvAt:0,title:'A',en:'A',cat:'sample'},b:{id:'b',live:true,pvAt:0,title:'B',en:'B',cat:'sample'}};
  const GEN={ver:0,on:false,owner:null,stop(){this.ver++;this.on=false;this.owner=null;},startMedia(owner,url){this.ver++;this.on=true;this.owner=owner;calls.push([owner,url]);}};
  const ctx=realm({GEN,P:id=>products[id], CATS:{sample:{c:'pink'}}, apiProduct:p=>Object.assign(products[p.id],p),
    API:{req:(method,path)=>new Promise(resolve=>{requests[path]=resolve;})}, go(){}, apiFail(){}});
  vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
  ctx.toggleDemo('a'); ctx.toggleDemo('b');
  requests['/products/a']({...products.a,demoUrl:'/a.wav',pvAt:1}); await tick();
  requests['/products/b']({...products.b,demoUrl:'/b.wav',pvAt:1}); await tick();
  assert.deepEqual(calls,[['q:b','/b.wav']],'较早请求先返回时仍只能播最后点击的 B');
  GEN.stop(); calls.length=0; products.a.pvAt=0;
  ctx.toggleDemo('a'); ctx.toggleDemo('a'); requests['/products/a']({...products.a,demoUrl:'/a.wav',pvAt:1}); await tick();
  assert.equal(calls.length,0,'第二次点正在加载的试听应取消');
});

test('快速试听签名超过三小时后重新读商品详情', async () => {
  const requests=[], calls=[];
  const product={id:'a',live:true,pvAt:Date.now()-3*3600e3-1,title:'A',en:'A',cat:'sample',demoUrl:'/expired.wav'};
  const ctx=realm({GEN:{ver:0,startMedia:(...a)=>calls.push(a)},P:()=>product,CATS:{sample:{c:'pink'}},apiProduct:p=>Object.assign(product,p),
    API:{req:async(method,path)=>{requests.push(path);return {...product,pvAt:Date.now(),demoUrl:'/fresh.wav'};}},go(){},apiFail(){}});
  vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
  ctx.toggleDemo('a'); await tick();
  assert.equal(requests.length,1); assert.equal(calls[0]?.[1],'/fresh.wav');
});

const postPlaybackRealm = overrides => {
  const calls=[], posts={a:{id:'a',live:true,aurl:'/old.wav',audioAt:0,adur:12.5,dur:'0:12',title:'A',author:'me'}};
  const GEN={ver:0,on:false,owner:null,stop(){this.ver++;this.on=false;this.owner=null;},
    startMedia(owner,url,meta,dur,at){this.ver++;this.on=true;this.owner=owner;calls.push({owner,url,dur,at});},seek(){}};
  const ctx=realm({GEN,AU:{init:()=>true},POST:id=>posts[id],TRACKS:{},USERS:{me:{name:'Me'}},postCls:()=> 'c-pink',
    API:{base:'https://api.test',req:async()=>({...posts.a,aurl:'/fresh.wav'})},apiPost:x=>x,apiFail:e=>{throw e;},toast(){},
    ensureTrack(){throw new Error('真实音频不能为播放解码为整段 PCM');},$$:()=>[],...overrides});
  vm.runInContext(section('const PEND = {id:null, n:0, ctrl:null};','/* 波形擦洗：'),ctx);
  return {ctx,calls,posts,GEN};
};

test('真实帖子使用流式播放与元数据时长，缓存的签名不额外拉详情或解码 PCM', async () => {
  const {ctx,calls,posts}=postPlaybackRealm({API:{base:'https://api.test',req(){throw new Error('新签名无需请求');}}});
  posts.a.audioAt=Date.now(); await ctx.toggleAudio('a',4);
  assert.deepEqual(calls,[{owner:'post:a',url:'https://api.test/old.wav',dur:12.5,at:4}]);
});

test('真实帖子签名在十五分钟 TTL 到期前会重读详情', async () => {
  let requests=0; const {ctx,calls,posts}=postPlaybackRealm({API:{base:'https://api.test',req:async()=>{requests++;return {...posts.a,aurl:'/fresh.wav'};}}});
  posts.a.audioAt=Date.now()-13*60e3; await ctx.toggleAudio('a');
  assert.equal(requests,1); assert.equal(calls[0].url,'https://api.test/fresh.wav');
});

test('真实帖子加载过期签名期间切换试听，旧响应不会抢播', async () => {
  let resolve; const {ctx,calls,posts,GEN}=postPlaybackRealm({API:{base:'https://api.test',req:()=>new Promise(r=>resolve=r)}});
  const pending=ctx.toggleAudio('a'); GEN.startMedia('q:product','/preview.wav',{},0,0);
  resolve({...posts.a,aurl:'/fresh.wav'}); await pending;
  assert.equal(GEN.owner,'q:product'); assert.equal(calls.length,1);
});

test('真实帖子同一项签名加载时再点可以取消，不发重复请求或播放', async () => {
  const resolvers=[]; const {ctx,calls,posts}=postPlaybackRealm({API:{base:'https://api.test',req:()=>new Promise(r=>resolvers.push(r))}});
  const first=ctx.toggleAudio('a'),second=ctx.toggleAudio('a');
  resolvers.forEach(r=>r({...posts.a,aurl:'/fresh.wav'})); await Promise.all([first,second]);
  assert.equal(resolvers.length,1); assert.equal(calls.length,0);
});

test('真实帖子已有峰值不排队，缺峰值的旧帖子保留按需分析入口', () => {
  let pumps=0; const posts={withMeta:{id:'withMeta',live:true},legacy:{id:'legacy',live:true}};
  const ctx=realm({POST:id=>posts[id],POSTS:Object.values(posts),TRACKS:{'post:withMeta':{peaks:new Float32Array([0,1])}},performance:{now:()=>10000},pumpTracks:()=>pumps++});
  vm.runInContext(section('const TQ = []; let tBusy = false;','/* 离线渲染一首'),ctx);
  ctx.queueTrack('withMeta'); ctx.queueTrack('legacy');
  assert.equal(pumps,1); assert.deepEqual(json(vm.runInContext('TQ',ctx)),['legacy']);
});

const posterPlaybackRealm = (fetch,decode) => {
  class AudioBufferMock { constructor(){ this.length=100;this.numberOfChannels=1; } }
  class OfflineMock { decodeAudioData(){ return decode ? decode() : Promise.resolve(new AudioBufferMock()); } }
  const ctx=realm({AudioResources,AudioBuffer:AudioBufferMock,window:{OfflineAudioContext:OfflineMock},API:{base:'https://api.test'},navigator:{deviceMemory:4},
    location:{href:'https://ctrlz.test/'},document:{baseURI:'https://ctrlz.test/'},fetch});
  vm.runInContext(section('const PSB =','const psRate ='),ctx); return ctx;
};

test('海报采样断网后能重新加载，不永久缓存失败', async () => {
  let requests=0; const ctx=posterPlaybackRealm(async()=>{ if (++requests===1) throw new Error('断网'); return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}; });
  assert.equal(await ctx.psmpLoad('/hero.wav'),null);
  const retry=await ctx.psmpLoad('/hero.wav'); assert(retry instanceof ctx.AudioBuffer); assert.equal(requests,2);
});

test('海报采样网络等待不占解码锁，多个已下载采样仍只同时解码一份PCM', async () => {
  const calls=[];let release,releaseDecode,active=0,peak=0,decoded=0;
  const decodeGate=new Promise(resolve=>releaseDecode=resolve);
  const ctx=posterPlaybackRealm(async url=>{
    calls.push(url); if (url.endsWith('/a.wav')) await new Promise(r=>release=r);
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};
  },async()=>{decoded++;peak=Math.max(peak,++active);await decodeGate;active--;return new ctx.AudioBuffer();});
  const first=ctx.psmpLoad('/a.wav'),second=ctx.psmpLoad('/b.wav'); await tick(); const started=calls.length;
  assert.equal(started,2);assert.equal(decoded,1,'第二份已下载采样能越过第一份网络等待');
  release();await tick();assert.equal(decoded,1,'第二份仍在解码时其它已下载采样必须等待');releaseDecode();
  const buffers=await Promise.all([first,second]);assert.equal(calls.length,2);assert.equal(decoded,2);assert.equal(peak,1);assert(buffers.every(b=>b instanceof ctx.AudioBuffer));
});

test('CTRL 清理删除节点的页面闭包，同时保留已移动且仍在 DOM 的控件', () => {
  let observe, live=[]; const microtasks=[];
  const ctx=realm({MutationObserver:class{constructor(fn){observe=fn;}observe(){}}, document:{body:{}}, queueMicrotask:f=>microtasks.push(f), $$:()=>live});
  vm.runInContext(section('const CTRL = {}; let _cid = 0;','function slider('),ctx);
  vm.runInContext("CTRL.dead={}; CTRL.moved={};",ctx);
  live=[{dataset:{rng:'moved'}}];
  observe([{removedNodes:[{nodeType:1,matches:()=>true}]}]); observe([{removedNodes:[{nodeType:1,matches:()=>true}]}]);
  assert.equal(microtasks.length,1); microtasks[0]();
  assert.deepEqual(vm.runInContext('Object.keys(CTRL)',ctx).join(','),'moved');
});

test('moreLoad 正常走局部补页，导航改变时旧响应不重画当前页', async () => {
  let resolve, patches=0, renders=0; const requests=[];
  const ctx=realm({CUR:{key:'home|'},UI:{homeTab:'rec',shop:{cat:'all'},userTab:'works'},STATE:{settings:{pers:true},follows:new Set(),blocks:new Set()},
    LIVE:{next:'cursor1'},LSHOP:{},MORE:{busy:{}},API:{req:(method,path)=>{requests.push(path);return new Promise(r=>resolve=r);}},
    addPosts(){},patchMoreList:()=>{patches++;return true;},rerender:()=>renders++,apiFail(){},$:()=>null});
  vm.runInContext(section('const moreState = () =>','function patchMoreList('),ctx);
  vm.runInContext(section('async function moreLoad(k){','ACTIONS.more ='),ctx);
  const first=ctx.moreLoad('home'); ctx.CUR.key='shop|'; resolve({items:[],next:'cursor2'}); await first;
  assert.equal(patches,0); assert.equal(renders,0); assert.equal(ctx.MORE.busy.home,false);
  ctx.CUR.key='home|'; const second=ctx.moreLoad('home'); resolve({items:[],next:null}); await second;
  assert.equal(patches,1); assert.equal(renders,0); assert(requests[1].includes('cursor=cursor2'));
});

const dmRealm = overrides => {
  const ctx=realm({ME:'me',DELC:{},CHATS:{},CHAT_UNREAD:{},CUR:{key:'msg|peer'},API:{on:()=>true},STATE:{role:'user'},LIVE:{u:new Set(['peer'])},
    apiUser(){},coTxt:x=>x,dmAcknowledge(){},dmOutboxReset(){},...overrides});
  vm.runInContext(section('const LDM =','{ const body0 = convBody;'),ctx);
  return ctx;
};
const message=(id,extra={})=>({id,from:'peer',to:'me',kind:'text',body:id,createdAt:'2026-10-11T12:00:00.000Z',read:true,recalled:false,...extra});
const dmSending = (ctx,send) => {
  ctx.USERS ||= {};
  let sequence=0;const rows=new Map();ctx.DmOutboxStore={create:()=>({put:async r=>rows.set(r.key,{...r}),remove:async k=>rows.delete(k),list:async()=>[...rows.values()],replace:async(k,r)=>{rows.delete(k);rows.set(r.key,r);}})};
  ctx.crypto={randomUUID:()=>`fixture-client-${++sequence}`};ctx.AbortController=AbortController;ctx.AbortSignal=AbortSignal;
  ctx.wrapAct=()=>{};ctx.ACTIONS={};ctx.apiFail=()=>{};ctx.toast=()=>{};ctx.API.base='https://fixture.test';
  vm.runInContext(section('/* 私信待发送库：','wrapAct(\'msg-rc\''),ctx);ctx.liveDmSend=send;return rows;
};

test('DM 增量按 ID 合并，更新旧消息的撤回状态并保留历史与待发送消息', async () => {
  const requests=[], responses=[{peer:{id:'peer'},items:[message('new'),message('old',{recalled:true})],blocked:{byMe:false,byThem:false},nextSince:'delta2',hasMore:false}];
  const ctx=dmRealm({API:{on:()=>true,req:async(method,path)=>{requests.push([method,path]);return responses.shift();}},
    CHATS:{peer:[{id:'history',ts:0,read:true},{id:'old',ts:1,read:true},{id:'tmp',ts:2,me:true,pend:true}]}});
  vm.runInContext("LDM.full.add('peer'); LDM.since.peer='delta1'; LDM.before.peer='history-cursor';",ctx);
  const a=ctx.dmConv('peer'),b=ctx.dmConv('peer'); assert.equal(a,b,'同时请求同一会话只发一次'); await a;
  assert.equal(requests.length,1); assert(requests[0][1].endsWith('&since=delta1'));
  assert.deepEqual(json(ctx.CHATS.peer.map(m=>m.id)),['history','new','old','tmp']);
  assert.equal(ctx.CHATS.peer.find(m=>m.id==='old').rc,true);
  assert.equal(vm.runInContext('LDM.since.peer',ctx),'delta2'); assert.equal(vm.runInContext('LDM.before.peer',ctx),'history-cursor');
});

test('DM 在别的页收到新消息后仍保留加载历史与增量游标', async () => {
  const ctx=dmRealm({CUR:{key:'shop|'},CHATS:{peer:[{id:'history',ts:0,read:true},{id:'old',ts:1,read:true}]},
    API:{on:()=>true,req:async()=>({items:[{peer:{id:'peer'},last:message('new'),unread:1}]})}});
  vm.runInContext("LDM.full.add('peer');LDM.last.peer='old';LDM.since.peer='delta1';LDM.before.peer='history-cursor';",ctx);
  await ctx.dmThreads();
  assert.equal(vm.runInContext("LDM.full.has('peer')",ctx),true);
  assert(ctx.CHATS.peer.some(m=>m.id==='history')); assert(ctx.CHATS.peer.some(m=>m.id==='new'));
  assert.equal(vm.runInContext('LDM.since.peer',ctx),'delta1');
});

test('DM 已读请求断网后即使下一次增量为空也能重试', async () => {
  let polls=0,reads=0;
  const ctx=dmRealm({API:{on:()=>true,req:async(method,path)=>{
    if(method==='POST'){if(++reads===1)throw new Error('已读断网');return {ok:true};}
    return {peer:{id:'peer'},items:polls++ ? [] : [message('unread',{read:false})],blocked:{byMe:false,byThem:false},nextBefore:null,nextSince:'cursor',hasMore:false};
  }}});
  // 调用方可以选择提示或静默重试，但不能推进游标后永久丢掉 read 操作。
  await ctx.dmConv('peer').catch(()=>{}); await ctx.dmConv('peer');
  assert.equal(reads,2); assert.equal(ctx.CHAT_UNREAD.peer,0);
});

test('DM 轮询先收到发送回显时，POST 返回后不会出现重复消息', async () => {
  let sent;
  const ctx=dmRealm({sendMsg(){},canSpeak:()=>true,blocked:()=>false,refreshConv(){},
    liveDmSend:()=>new Promise(resolve=>sent=resolve)});
  dmSending(ctx,()=>new Promise(resolve=>sent=resolve));
  await ctx.sendMsg('peer',{t:'text',text:'发送中'});await tick();
  const echo=message('sent',{from:'me',to:'peer',body:'发送中',clientMessageId:ctx.CHATS.peer.find(m=>m.pend).clientMessageId});
  ctx.dmMerge('peer',[echo]); sent(echo); await tick();
  assert.equal(ctx.CHATS.peer.filter(m=>m.id==='sent').length,1,'发送和同步共用消息 ID 去重');
  assert.equal(ctx.CHATS.peer.filter(m=>m.pend).length,0);
});

test('DM 加载历史保留滚动锚点和同步游标，并合并历史而非覆盖当前消息', async () => {
  const requests=[], button={dataset:{id:'peer'},isConnected:true}, box={scrollHeight:1000,scrollTop:5,isConnected:true}; let reply;
  const ctx=dmRealm({ACTIONS:{},CHATS:{peer:[{id:'current',ts:100,me:true,read:true}]},$:()=>box,apiFail:e=>{throw e;},
    API:{on:()=>true,req:(method,path)=>{requests.push(path);return new Promise(resolve=>reply=resolve);}},
    dmPaint:()=>{box.scrollHeight=1500;}});
  vm.runInContext(section("ACTIONS['dm-older'] = async", "document.addEventListener('rendered', () => { const b = $('#cvB');"),ctx);
  vm.runInContext("LDM.before.peer='oldest';LDM.since.peer='sync-revision';",ctx);
  const task=ctx.ACTIONS['dm-older'](button); await tick();
  await ctx.ACTIONS['dm-older'](button); assert.equal(requests.length,1,'同一会话历史请求只发一次');
  reply({items:[message('history',{createdAt:'2020-01-01T00:00:00Z'})],nextBefore:null}); await task;
  assert.equal(box.scrollTop,505); assert.equal(vm.runInContext('LDM.since.peer',ctx),'sync-revision');
  assert.deepEqual(json(ctx.CHATS.peer.map(m=>m.id)).sort(),['current','history']);
  assert.equal(vm.runInContext("LDM.history.has('peer')",ctx),false);
});

test('DM 切换账号后旧会话请求不会将旧消息回写到新账号', async () => {
  let reply;
  const ctx=dmRealm({ME:'old-account',API:{on:()=>true,tok:'old-token',req:()=>new Promise(resolve=>reply=resolve)}});
  const task=ctx.dmConv('peer');
  ctx.ME='new-account'; ctx.API.tok='new-token'; ctx.CHATS={};ctx.CHAT_UNREAD={};
  vm.runInContext('LDM.full.clear(); LDM.last={};',ctx);
  reply({peer:{id:'peer'},items:[message('private-old',{to:'old-account'})],blocked:{byMe:false,byThem:false},nextBefore:null,nextSince:'old-cursor',hasMore:false});
  await task;
  assert.equal(ctx.CHATS.peer,undefined,'旧请求不能回写到新账号');
  assert.equal(vm.runInContext('LDM.since.peer',ctx),undefined,'旧请求不能写入旧同步游标');
});

test('DM 同账号 access token 自动刷新不会丢弃已发送结果并留下永久 pending', async () => {
  let ctx;
  const echo=message('sent-after-refresh',{from:'me',to:'peer'});
  ctx=dmRealm({API:{on:()=>true,tok:{access:'expired'}},sendMsg(){},canSpeak:()=>true,blocked:()=>false,refreshConv(){},
    liveDmSend:async()=>{ctx.API.tok={access:'fresh'};return echo;}});
  dmSending(ctx,async()=>{ctx.API.tok={access:'fresh'};return echo;});
  await ctx.sendMsg('peer',{t:'text',text:'自动刷新后发送'});await tick();
  assert.equal(ctx.CHATS.peer.filter(m=>m.pend).length,0);
  assert.equal(ctx.CHATS.peer.filter(m=>m.id==='sent-after-refresh').length,1);
});

function interactionRealm(){
  const calls=[],syncs=[],failures=[],post={id:'post',likes:7};let active=0,peak=0;
  const ctx=realm({ME:'me',liveUser:()=>true,STATE:{liked:new Set(),favs:new Set(),follows:new Set()},USERS:{},POST:id=>id==='post'?post:null,
    syncInteraction:(...a)=>syncs.push(a),apiFail:e=>failures.push(e.message)});
  vm.runInContext(section('const ACCOUNT_PAGES =','const accountMoreBox ='),ctx);
  vm.runInContext(section('const INTERACTIONS =',"wrapAct('like',"),ctx);
  const perform=()=>{peak=Math.max(peak,++active);return new Promise((resolve,reject)=>calls.push({
    resolve(value={likeCount:8}){active--;resolve(value);},reject(message='网络失败'){active--;reject(Error(message));}}));};
  const action=now=>{const was=ctx.STATE.liked.has('post');now?ctx.STATE.liked.add('post'):ctx.STATE.liked.delete('post');return ctx.sendInteraction('like','post',was,now,perform);};
  return {ctx,calls,syncs,failures,post,action,peak:()=>peak};
}

test('快速点赞切换按同账户实体串行发送，最多一个在途请求且按最后确认状态释放队列',async()=>{
  const r=interactionRealm(),jobs=[r.action(true),r.action(false),r.action(true)];await tick();assert.equal(r.calls.length,1);
  r.calls[0].resolve({likeCount:8});await tick();assert.equal(r.calls.length,2);
  r.calls[1].resolve({likeCount:7});await tick();assert.equal(r.calls.length,3);
  r.calls[2].resolve({likeCount:8});await Promise.all(jobs);
  assert.equal(r.peak(),1);assert.equal(r.ctx.STATE.liked.has('post'),true);assert.equal(r.post.likes,7);
  assert.equal(r.syncs.length,3);assert.equal(vm.runInContext('INTERACTIONS.size',r.ctx),0);assert.equal(r.failures.length,0);
});

test('连续两次失败回到confirmed，旧请求失败不会覆盖后续乐观状态',async()=>{
  const two=interactionRealm(),jobs=[two.action(true),two.action(false)];await tick();
  two.calls[0].reject('首次失败');await tick();two.calls[1].reject('第二次失败');await Promise.all(jobs);
  assert.equal(two.ctx.STATE.liked.has('post'),false,'不能用第二次切换前的未确认true回滚');assert.deepEqual(two.failures,['第二次失败']);
  const newer=interactionRealm(),newJobs=[newer.action(true),newer.action(false),newer.action(true)];await tick();
  newer.calls[0].reject('已被后续动作覆盖的失败');await tick();
  assert.equal(newer.ctx.STATE.liked.has('post'),true);assert.equal(newer.failures.length,0);
  newer.calls[1].resolve({likeCount:7});await tick();newer.calls[2].reject('最新失败');await Promise.all(newJobs);
  assert.equal(newer.ctx.STATE.liked.has('post'),false,'最新失败回到最近成功的false');assert.deepEqual(newer.failures,['最新失败']);
});

test('切换账户后旧interaction成功和失败均不回写，新账户同实体有独立队列',async()=>{
  for(const outcome of ['resolve','reject']){
    const r=interactionRealm(),jobs=[r.action(true),r.action(false)];await tick();
    r.ctx.ME='another';r.ctx.STATE.liked=new Set(['post']);vm.runInContext('ACCOUNT_PAGES.epoch++',r.ctx);
    r.calls[0][outcome](outcome==='resolve'?{likeCount:99}:'旧账号失败');await Promise.all(jobs);
    assert.equal(r.calls.length,1,'旧账户尚未开始的请求不再发送');assert.equal(r.post.likes,7);assert.equal(r.syncs.length,0);
    assert.equal(r.failures.length,0);assert.equal(r.ctx.STATE.liked.has('post'),true);
    const fresh=r.action(false);await tick();assert.equal(r.calls.length,2);r.calls[1].resolve({likeCount:7});await fresh;
    assert.equal(r.ctx.STATE.liked.has('post'),false);assert.equal(r.syncs.length,1);assert.equal(vm.runInContext('INTERACTIONS.size',r.ctx),0);
  }
});

test('MORPH 移除 DOM 时解除 ResizeObserver，移动节点仍保留订阅', () => {
  let mutation; const observed=new Set(), released=[];
  const ctx=realm({performance:{now:()=>100},reduced:()=>false,addEventListener(){},document:{body:{querySelectorAll:()=>[]}},
    ResizeObserver:class{observe(e){observed.add(e);}unobserve(e){observed.delete(e);released.push(e);}},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}});
  vm.runInContext(section('const MORPH = (() => {','// 软重绘包一层'),ctx);
  const child={isConnected:true,matches:()=>true,querySelectorAll:()=>[]}, root={nodeType:1,isConnected:true,matches:()=>false,querySelectorAll:()=>[child]};
  mutation([{type:'childList',addedNodes:[root],removedNodes:[],target:{}}]); assert(observed.has(child));
  mutation([{type:'childList',addedNodes:[],removedNodes:[root],target:{}}]); assert(observed.has(child),'移到另一个 DOM 父级不能解除');
  root.isConnected=false;child.isConnected=false;
  mutation([{type:'childList',addedNodes:[],removedNodes:[root],target:{}}]); assert.equal(observed.size,0);assert.equal(released.length,1);
});

test('MORPH 尺寸通知不写样式；合并到下一帧保留弹性，动画结束和删除不留回调', () => {
  let resize,mutation,nextFrame=0;const frames=new Map(),animations=[],released=[],body={querySelectorAll:()=>[]};
  const ctx=realm({performance:{now:()=>5000},reduced:()=>false,addEventListener(){},document:{body,fonts:{status:'loaded'}},LG:{scan(){}},
    requestAnimationFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    ResizeObserver:class{constructor(fn){resize=fn;}observe(){}unobserve(el){released.push(el);}},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}}});
  vm.runInContext(section('const MORPH = (() => {','// 软重绘包一层'),ctx);
  const style={overflow:'visible',whiteSpace:'normal',boxSizing:'content-box'},el={nodeType:1,isConnected:true,style,offsetWidth:200,parentElement:body,matches:()=>true,querySelectorAll:()=>[],
    animate(keyframes,options){const animation={cancel(){this.oncancel?.();}};animations.push({keyframes:json(keyframes),options:json(options),animation});return animation;}};
  const measure=w=>resize([{target:el,borderBoxSize:[{inlineSize:w}]}]);
  measure(100);assert.equal(frames.size,0);measure(150);measure(200);
  assert.equal(frames.size,1);assert.equal(animations.length,0);assert.equal(style.overflow,'visible');
  const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());
  assert.equal(animations.length,1);assert.deepEqual(animations[0].keyframes,[{width:'100px'},{width:'200px'}]);
  assert.deepEqual(animations[0].options,{duration:300,easing:'cubic-bezier(.3,1.3,.5,1)'});
  measure(180);assert.equal(frames.size,0);animations[0].animation.onfinish();measure(200);
  assert.equal(el._grow,null);assert.equal(frames.size,0);assert.deepEqual(style,{overflow:'visible',whiteSpace:'normal',boxSizing:'content-box'});
  measure(250);assert.equal(frames.size,1);el.isConnected=false;
  mutation([{type:'childList',addedNodes:[],removedNodes:[el],target:body}]);
  assert.equal(frames.size,0);assert.equal(released.length,1);assert.equal(animations.length,1);
});
