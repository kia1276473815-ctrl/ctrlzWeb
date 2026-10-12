// 从实际页面提取旧帖峰值链；只分析测试 PCM，不连接真实账号或音频。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require = createRequire(import.meta.url);
const AudioResources = require('../scripts/audio-cache.js');
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => {
  const start=source.indexOf(a), end=source.indexOf(b,start+a.length);
  assert(start>=0 && end>start,a); return source.slice(start,end);
};
const tick = async () => { for(let i=0;i<24;i++) await Promise.resolve(); };
const defer = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const rawPost = (id,extra={}) => ({id,type:'audio',author:{id:'author'},title:id,body:'真实音频',tags:[],likeCount:0,commentCount:0,
  createdAt:'2026-10-10T00:00:00Z',status:'public',style:{dur:2,cover:'wave'},media:[{kind:'audio',url:`/${id}.wav`,...extra}]});
const pcm = () => {
  const data=Float32Array.from({length:240*16},(_,i)=>.02 + (Math.floor(i/16)%12)/12*.96);
  return {duration:7.25,length:data.length,numberOfChannels:1,getChannelData:()=>data};
};
function setup(options={}){
  const posts={},requests=[],rates=[],warnings=[],events=[]; let decodes=0,pumps=0,time=10000;
  class OfflineMock {
    constructor(channels,length,rate){ rates.push(rate); }
    decodeAudioData(bytes,resolve,reject){ decodes++; const p=Promise.resolve().then(()=>options.decode ? options.decode(bytes) : pcm()); p.then(resolve,reject); return p; }
  }
  const handlers={};const ctx=vm.createContext({console:{warn:(...a)=>warnings.push(a)},Date,Map,Set,URL,Promise,AudioResources,AbortController,
    navigator:{deviceMemory:4},performance:{now:()=>time},window:{OfflineAudioContext:OfflineMock},
    GEN:{tr:null},PEND:{id:null},setTimeout:()=>1,clearTimeout(){},CustomEvent:class{constructor(type,data){this.type=type;this.detail=data?.detail;}},
    document:{addEventListener:(k,fn)=>(handlers[k]||=new Set()).add(fn),removeEventListener:(k,fn)=>handlers[k]?.delete(fn),dispatchEvent:e=>{events.push(e);handlers[e.type]?.forEach(fn=>fn(e));}},
    POST:id=>posts[id],POSTS:[],pumpTracks:()=>pumps++,
    renderTrack:()=>Promise.resolve(null),apiUser:()=>{},STATE:{liked:new Set()},hash:()=>1,ago:()=>'',
    COVER_TPLS:{wave:{}},COVER_PALS:{pb:{}},VIS:{},BODY:{},COMMENTS:{},LIVE:{pend:{}},
    API:{base:'https://api.test',req:async (...args)=>{requests.push(args); if(options.api) return options.api(...args); throw Error('unexpected detail refresh');}},
    fetch:async url=>{requests.push(['fetch',url]); if(options.fetch) return options.fetch(url); return {ok:true,arrayBuffer:async()=>new ArrayBuffer(32)};},
  });
  vm.runInContext(section('const TRACKS = {};','function renderTrack(key, spec)'),ctx);
  vm.runInContext(section('function peaksOf(chs, N, BINS=240)','/* 用户上传的真实音频'),ctx);
  vm.runInContext(section('const fmtT =','const FREQ ='),ctx);
  vm.runInContext(section('function apiPost(p){','const apiCmt ='),ctx);
  vm.runInContext(section('{ const rt0 = renderTrack;','/* —— 启动 / 登录后 —— */'),ctx);
  vm.runInContext(section('const TQ = []; let tBusy = false;','/* 离线渲染一首'),ctx);
  const add = (id,extra) => { const post=ctx.apiPost(rawPost(id,extra)); posts[id]=post;ctx.POSTS.push(post);return post; };
  const track = id=>vm.runInContext(`TRACKS['post:${id}']`,ctx);
  return {ctx,posts,requests,rates,warnings,events,add,track,setTime:t=>time=t,get decodes(){return decodes;},get pumps(){return pumps;}};
}

test('新帖 audioMeta 直接画原峰值，列表排队和重复打开不下载或解码', async()=>{
  const env=setup(),peaks=[.05,.8,.2,1];env.add('meta',{audioMeta:{duration:12.5,peaks}});
  env.ctx.queueTrack('meta');const first=await env.ctx.renderTrack('post:meta',{}),second=await env.ctx.renderTrack('post:meta',{});
  assert.equal(first,second);assert.deepEqual(Array.from(first.peaks),peaks.map(x=>Math.fround(x)));
  assert.equal(first.dur,12.5);assert.equal(env.requests.length,0);assert.equal(env.decodes,0);assert.equal(env.pumps,0);
});

test('旧帖生成 240 个真实 RMS 峰值，画布恢复不同高度，分析后不保留 PCM', async()=>{
  const env=setup();env.add('legacy');const tr=await env.ctx.renderTrack('post:legacy',{});
  assert.equal(tr.peaks.length,240);assert.equal(Math.max(...tr.peaks),1);assert(tr.peaks[0]<tr.peaks[11]);
  assert.equal(tr.buffer,null);assert.equal(AudioResources.pcmBytes(tr.buffer),0);assert.equal(tr.sourceBytes,32);
  assert.equal(tr.pending,false);assert.equal(tr.dur,7.25);assert.equal(env.posts.legacy.dur,'0:07');assert.deepEqual(env.rates,[22050]);
  env.setTime(11000);const heights=[];
  env.ctx.fitCanvas=()=>({w:720,h:52,dpr:1});env.ctx.INK={ink:'#111'};
  const canvas={dataset:{wave:'legacy'},getContext:()=>({clearRect(){},beginPath(){},roundRect:(x,y,w,h)=>heights.push(h),fill(){}})};
  vm.runInContext(section('function drawTrackWave(cv, prog=0, opts={})','function drawWave('),env.ctx);
  env.ctx.drawTrackWave(canvas,0,{bars:72});assert(new Set(heights.map(h=>h.toFixed(3))).size>3,'真正峰值必须恢复原有条高变化');
});

test('旧帖并发打开共用同一任务，重进首页和 reel 复用轻量峰值', async()=>{
  const gate=defer();const env=setup({fetch:async()=>{await gate.promise;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});env.add('legacy');
  const first=env.ctx.renderTrack('post:legacy',{}),second=env.ctx.renderTrack('post:legacy',{});
  assert.equal(first,second);await tick();assert.equal(env.requests.filter(x=>x[0]==='fetch').length,1);assert.equal(env.track('legacy').pending,true);
  gate.resolve();const tr=await first;assert.equal(await env.ctx.renderTrack('post:legacy',{}),tr);
  env.ctx.queueTrack('legacy');assert.equal(env.pumps,0);assert.equal(env.decodes,1);assert.equal(tr.buffer,null);
});

test('一个旧帖网络挂住不占解码锁，其它旧帖下载完成后仍保持单路解码', async()=>{
  const gate=defer();let fetched=0,active=0,peak=0;
  const env=setup({fetch:async()=>{fetched++;if(fetched===1)await gate.promise;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};},
    decode:async()=>{active++;peak=Math.max(peak,active);await tick();active--;return pcm();}});
  env.add('a');env.add('b');const a=env.ctx.renderTrack('post:a',{}),b=env.ctx.renderTrack('post:b',{});
  await tick();assert.equal(fetched,2);assert.equal(env.decodes,1);gate.resolve();await Promise.all([a,b]);
  assert.equal(fetched,2);assert.equal(peak,1);assert.equal(env.track('a').buffer,null);assert.equal(env.track('b').buffer,null);
});

test('轻量详情缺峰值且旧地址403时再刷新一次，并发请求共用读取与解码', async()=>{
  let fetched=0,details=0;const env=setup({fetch:async()=>++fetched===1 ? {ok:false,status:403} : {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)},
    api:async()=>rawPost('legacy',{url:++details===1 ? '/legacy.wav' : '/fresh.wav'})});env.add('legacy');
  const first=env.ctx.renderTrack('post:legacy',{}),second=env.ctx.renderTrack('post:legacy',{});assert.equal(first,second);const tr=await first;
  assert(tr.peaks.length);assert.equal(env.decodes,1);assert.equal(env.requests.filter(x=>x[0]==='GET').length,2);
  assert.deepEqual(env.requests.filter(x=>x[0]==='fetch').map(x=>x[1]),['https://api.test/legacy.wav','https://api.test/fresh.wav']);
});

test('签名到期前先刷新详情；刷新补回 audioMeta 后无需下载整份音频', async()=>{
  const env=setup({api:async()=>rawPost('legacy',{url:'/fresh.wav',audioMeta:{duration:17,peaks:[.1,1,.3]}})});env.add('legacy');
  env.posts.legacy.audioAt=Date.now()-13*60e3;const tr=await env.ctx.renderTrack('post:legacy',{});
  assert.equal(env.requests.length,1);assert.equal(env.requests[0][0],'GET');assert.equal(env.decodes,0);assert.equal(tr.peaks.length,3);assert.equal(tr.dur,17);assert.equal(tr.pending,false);
});

test('冷启动旧帖缺峰值时优先读刚回填的详情，并发首页与reel不下载音频', async()=>{
  const gate=defer(),env=setup({api:async()=>{await gate.promise;return rawPost('legacy',{audioMeta:{duration:22,peaks:[.1,.8,.3,1]}});}});
  env.add('legacy');const first=env.ctx.renderTrack('post:legacy',{}),second=env.ctx.renderTrack('post:legacy',{});
  assert.equal(first,second);await tick();assert.equal(env.requests.length,1);assert.equal(env.requests[0][0],'GET');
  assert.equal(env.decodes,0);assert.deepEqual(env.rates,[]);gate.resolve();const tr=await first;
  assert.equal(tr,env.track('legacy'));assert.deepEqual(Array.from(tr.peaks),[.1,.8,.3,1].map(Math.fround));
  assert.equal(tr.born,0);assert.equal(tr.buffer,null);assert.equal(tr.dur,22);assert.equal(tr.pending,false);
  assert.equal(env.requests.length,1);assert.equal(env.decodes,0);assert.deepEqual(env.rates,[]);
});

test('轻量详情读取失败仍用有效原地址生成真实波形', async()=>{
  const env=setup({api:async()=>{throw Error('detail temporarily offline');}});env.add('legacy');
  const original=env.posts.legacy.aurl,tr=await env.ctx.renderTrack('post:legacy',{});
  assert.equal(env.requests.filter(x=>x[0]==='GET').length,1);
  assert.deepEqual(env.requests.filter(x=>x[0]==='fetch').map(x=>x[1]),['https://api.test'+original]);
  assert.equal(env.posts.legacy.aurl,original);assert.equal(tr.peaks.length,240);assert.equal(env.decodes,1);
  assert.equal(tr.buffer,null);assert.equal(tr.pending,false);assert.equal(env.warnings.length,0);
});

test('签名刷新已读取详情时复用该GET，缺元数据只解码一次', async()=>{
  const env=setup({api:async()=>rawPost('legacy',{url:'/fresh.wav'})});env.add('legacy');
  env.posts.legacy.audioAt=Date.now()-13*60e3;
  const first=env.ctx.renderTrack('post:legacy',{}),second=env.ctx.renderTrack('post:legacy',{});assert.equal(first,second);
  const tr=await first;assert.equal(env.requests.filter(x=>x[0]==='GET').length,1);
  assert.deepEqual(env.requests.filter(x=>x[0]==='fetch').map(x=>x[1]),['https://api.test/fresh.wav']);
  assert.equal(env.decodes,1);assert.equal(tr.peaks.length,240);assert.equal(tr.buffer,null);
});

test('浏览器没有离线上下文仍可取得服务器波形，不以音频能力阻断轻量读取', async()=>{
  const env=setup({api:async()=>rawPost('legacy',{audioMeta:{duration:8,peaks:[.2,1,.6]}})});env.add('legacy');
  delete env.ctx.window.OfflineAudioContext;const tr=await env.ctx.renderTrack('post:legacy',{});
  assert.equal(env.requests.length,1);assert.equal(env.requests[0][0],'GET');assert.equal(env.decodes,0);
  assert.equal(tr.peaks.length,3);assert.equal(tr.pending,false);assert.equal(env.warnings.length,0);
});

test('后台不支持原编码音频的声纹回填时，保留浏览器解码原文件的回退', async()=>{
  const env=setup({api:async()=>rawPost('legacy',{url:'/original.mp3'})});env.add('legacy',{url:'/original.mp3'});
  const tr=await env.ctx.renderTrack('post:legacy',{});
  assert.equal(env.requests.filter(x=>x[0]==='GET').length,1);
  assert.deepEqual(env.requests.filter(x=>x[0]==='fetch').map(x=>x[1]),['https://api.test/original.mp3']);
  assert.equal(tr.peaks.length,240);assert.equal(env.decodes,1);assert.equal(tr.buffer,null);assert.equal(env.posts.legacy.dur,'0:07');
});

test('无离线解码能力且详情仍缺元数据时释放pending，稍后元数据仍能恢复原波形', async()=>{
  const env=setup({api:async()=>rawPost('legacy')});env.add('legacy');delete env.ctx.window.OfflineAudioContext;
  assert.equal(await env.ctx.renderTrack('post:legacy',{}),null);assert.equal(env.requests.length,1);
  assert.equal(env.track('legacy').pending,false);assert.equal(env.track('legacy').pr,null);assert.equal(env.posts.legacy.aurl,'/legacy.wav');
  env.ctx.apiPost(rawPost('legacy',{audioMeta:{duration:10,peaks:[.1,1,.3]}}));
  const tr=await env.ctx.renderTrack('post:legacy',{});assert.equal(tr.peaks.length,3);assert.equal(tr.dur,10);assert.equal(env.requests.length,1);
});

test('分析失败释放 pending，保留播放地址，稍后重进能真正重试', async()=>{
  let fail=true;const env=setup({fetch:async()=>{if(fail)throw Error('offline');return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};},api:async()=>rawPost('legacy')});env.add('legacy');
  assert.equal(await env.ctx.renderTrack('post:legacy',{}),null);assert.equal(env.track('legacy').pending,false);assert.equal(env.track('legacy').pr,null);
  assert.equal(env.posts.legacy.aurl,'/legacy.wav');fail=false;env.ctx.queueTrack('legacy');assert.equal(env.pumps,1);
  const tr=await env.ctx.renderTrack('post:legacy',{});assert.equal(tr.peaks.length,240);assert.equal(tr.buffer,null);assert.equal(env.decodes,1);
});

test('旧任务失败时保留已回填的 metadata，不删掉新峰值', async()=>{
  const gate=defer();let fetched=0;const env=setup({fetch:async()=>{if(++fetched===1)throw Error('expired');return gate.promise;},api:async()=>rawPost('legacy')});env.add('legacy');
  const pending=env.ctx.renderTrack('post:legacy',{});await tick();assert.equal(fetched,2);
  env.ctx.apiPost(rawPost('legacy',{audioMeta:{duration:19,peaks:[.1,1,.4]}}));const peaks=env.track('legacy').peaks;gate.reject(Error('offline'));
  const tr=await pending;assert.equal(tr,env.track('legacy'));assert.equal(tr.peaks,peaks);assert.equal(tr.dur,19);assert.equal(tr.pending,false);assert.equal(env.decodes,0);assert.equal(env.warnings.length,0);
});

test('等待单路资源队列时已补回 metadata，开始工作后跳过签名刷新和下载',async()=>{
  const gate=defer(),blocker=AudioResources.runDecode(()=>gate.promise),env=setup();env.add('legacy');env.posts.legacy.audioAt=Date.now()-13*60e3;
  const pending=env.ctx.renderTrack('post:legacy',{});env.ctx.apiPost(rawPost('legacy',{audioMeta:{duration:9,peaks:[.2,1,.4]}}));
  gate.resolve();await blocker;const tr=await pending;assert.equal(tr.peaks.length,3);assert.equal(tr.dur,9);assert.equal(env.requests.length,0);assert.equal(env.decodes,0);assert.equal(tr.pending,false);
});

test('替换同长度元数据峰值触发一次事件重绘，静止时不登记持续循环',()=>{
  const env=setup();env.add('legacy',{audioMeta:{duration:7,peaks:[.1,1,.2]}});let loops=0,draws=0;
  const observers=[];env.ctx.IntersectionObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}};
  env.ctx.loopAdd=()=>{loops++;return ()=>loops--;};env.ctx.$$=()=>[];env.ctx.waveProg=()=>0;env.ctx.isDark=()=>false;env.ctx.drawTrackWave=()=>draws++;
  vm.runInContext(section('function waveLoop(cvs){','function mountWaves('),env.ctx);
  const canvas={dataset:{wave:'legacy'},isConnected:true,_sz:{width:360,height:52}};const clean=env.ctx.waveLoop([canvas]);
  observers[0].fn([{target:canvas,isIntersecting:true}]);observers[1].fn([{target:canvas,isIntersecting:true}]);assert.equal(draws,1);assert.equal(loops,0);
  env.ctx.apiPost(rawPost('legacy',{audioMeta:{duration:7,peaks:[1,.1,.8]}}));env.ctx.document.dispatchEvent({type:'track',detail:'post:legacy'});assert.equal(draws,2);assert.equal(loops,0);clean();
});

test('128 个轻量峰值条目按使用时间淘汰，不删刚恢复的旧帖',async()=>{
  const env=setup();env.add('legacy');
  vm.runInContext("TRACKS['post:legacy']={dur:0,peaks:null,buffer:null,born:0,used:0};for(let i=0;i<128;i++)TRACKS['old:'+i]={buffer:null,peaks:[1],used:i+1};",env.ctx);
  const tr=await env.ctx.renderTrack('post:legacy',{});assert.equal(env.track('legacy'),tr);assert.equal(vm.runInContext('Object.keys(TRACKS).length',env.ctx),128);
  assert.equal(vm.runInContext("TRACKS['old:0']",env.ctx),undefined);assert.equal(tr.peaks.length,240);
});

test('真实旧帖沿用 near 和页面可见性筛选，远处和后台不分析',async()=>{
  const env=setup(),jobs=[];env.add('far');env.add('legacy');
  const canvas={dataset:{wave:'legacy'},isConnected:true,_near:true};env.ctx.$$=()=>[canvas];env.ctx.ensureTrack=id=>env.ctx.renderTrack('post:'+id,{});
  env.ctx.addEventListener=()=>{};env.ctx.window.requestIdleCallback=fn=>jobs.push(fn);env.ctx.document.hidden=true;
  vm.runInContext(section('let LAST_MOVE = 0;','const waveProg ='),env.ctx);
  env.ctx.queueTrack('far');env.ctx.queueTrack('legacy');jobs.shift()();await tick();assert.equal(env.requests.length,0);
  env.ctx.document.hidden=false;env.ctx.pumpTracks();jobs.shift()();jobs.shift()();await tick();await env.track('legacy').pr;
  assert.equal(env.requests.filter(x=>x[0]==='fetch').length,1);assert.equal(env.track('far'),undefined);assert.equal(env.track('legacy').peaks.length,240);
});
