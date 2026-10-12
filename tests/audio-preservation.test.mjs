// 对实际音频函数验证原声源、缓存压力和异步续播；不修改真实业务数据。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), AudioResources = require('../scripts/audio-cache.js');
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => { const start=source.indexOf(a),end=source.indexOf(b,start+a.length); assert(start>=0 && end>start,a); return source.slice(start,end); };
const tick = async () => { for(let i=0;i<15;i++) await Promise.resolve(); };
const defer = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
function tracksRealm(){
  let time=10000, decodes=0; const sample=new Float32Array([.42,.31,-.2]);
  const original={length:7*1024*1024,numberOfChannels:1,duration:23,getChannelData:()=>sample};
  class Offline { async decodeAudioData(bytes){ decodes++; assert.equal(new Uint8Array(bytes)[0],42); return original; } }
  const ctx=vm.createContext({console,Float32Array,Promise,performance:{now:()=>time},navigator:{deviceMemory:4},AudioResources,
    window:{OfflineAudioContext:Offline},GEN:{tr:null},PEND:{id:null},AU:{},peaksOf:chs=>Float32Array.from(chs[0]),
    document:{addEventListener(){},dispatchEvent(){}},CustomEvent:class{},setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(section('const TRACKS = {};','/* 包络：'),ctx);
  vm.runInContext(section('function trackFromBuffer(key, buf','const fmtT ='),ctx);
  return {ctx,original,advance:()=>time+=3000,get decodes(){return decodes;}};
}

test('本地上传发布后 PCM 可淘汰，但重新播放必须从原 File 解码，不得替换成合成曲',async()=>{
  const env=tracksRealm(),file={arrayBuffer:async()=>Uint8Array.of(42).buffer}; env.ctx.file=file;
  await vm.runInContext("trackFromFile('post:local-upload',file)",env.ctx);
  env.advance(); vm.runInContext('trimTracks()',env.ctx);
  assert.equal(vm.runInContext("TRACKS['post:local-upload'].buffer",env.ctx),null);
  assert.equal(vm.runInContext("TRACKS['post:local-upload'].file",env.ctx),file);
  const first=vm.runInContext("renderTrack('post:local-upload',{bars:99,bpm:1})",env.ctx);
  const second=vm.runInContext("renderTrack('post:local-upload',{bars:99,bpm:1})",env.ctx);
  assert.equal(first,second,'淘汰后的重复点播共用一次原文件解码');
  const tr=await first; assert.equal(tr.buffer,env.original); assert.equal(tr.dur,23); assert.equal(env.decodes,2);
  assert.equal(tr.peaks[0],new Float32Array([.42])[0]);
});

test('超过128份元数据时保留本地上传原文件和已发布示例的原编曲来源',()=>{
  const env=tracksRealm(); env.ctx.file={arrayBuffer:async()=>Uint8Array.of(42).buffer};
  vm.runInContext(`TRACKS.original={file,buffer:null,used:0}; TRACKS.composed={localSource:true,buffer:null,used:0,spec:{bpm:88}};
    for(let i=0;i<140;i++) TRACKS['meta:'+i]={buffer:null,used:i+1}; trimTracks();`,env.ctx);
  assert.equal(vm.runInContext('TRACKS.original.file',env.ctx),env.ctx.file);
  assert.equal(vm.runInContext('TRACKS.composed.spec.bpm',env.ctx),88);
  assert.equal(vm.runInContext('Object.keys(TRACKS).length',env.ctx),128);
});

test('仅有 AudioBuffer 的原声源没有 File 可恢复时，不释放唯一的原音频',()=>{
  const env=tracksRealm(); env.ctx.original=env.original;
  vm.runInContext("trackFromBuffer('post:buffer-only',original)",env.ctx); env.advance();
  vm.runInContext('trimTracks()',env.ctx);
  assert.equal(vm.runInContext("TRACKS['post:buffer-only'].buffer",env.ctx),env.original);
});

test('合成曲缓存淘汰后仍按原 spec 重建，不采用帖子的默认编曲',async()=>{
  const env=tracksRealm(),starts=[]; const gain={setTargetAtTime(){},setValueAtTime(){},linearRampToValueAtTime(){}};
  class Offline {
    constructor(ch,length,sr){ this.length=length;this.sampleRate=sr;starts.push({ch,length,sr}); }
    startRendering(){return Promise.resolve({getChannelData:()=>new Float32Array(this.length)});}
    createBuffer(ch,length,sr){return {length,numberOfChannels:ch,sampleRate:sr,copyToChannel(){}};}
  }
  Object.assign(env.ctx,{window:{OfflineAudioContext:Offline},AU:{master:{gain},build(){},bus:()=>({gain}),send(){}},
    GEN:{p:{},chords:[],play(s,t){this.q.push({s,t});}}});
  vm.runInContext(`TRACKS['post:composed']={pr:null,buffer:null,localSource:true,spec:{bars:1,bpm:480,opts:{seed:5},arr:()=>({d:1,b:1,p:1})}}`,env.ctx);
  const tr=await vm.runInContext("renderTrack('post:composed',{bars:99,bpm:1})",env.ctx);
  assert.equal(tr.dur,.5);assert.equal(tr.bpm,480);assert.equal(tr.localSource,true);
  assert.equal(starts[0].length,Math.ceil(3*22050));assert.equal(tr.events.length,16);
});

function reelRealm(){
  const deferred=defer(),starts=[],toasts=[],states=[];const post={id:'old',live:false};
  const st={p:post,playing:false,pos:13.75},RL={st,on:true};
  const GEN={on:false,ver:4,owner:null,startTrack(...args){starts.push(args);this.on=true;},stop(){this.on=false;this.ver++;},pos:()=>13.75};
  const ctx=vm.createContext({console,GEN,RL,TRACKS:{'post:old':{buffer:null}},ensureTrack:()=>deferred.promise,$:()=>null,
    reelOwn:p=>'post:'+p.id,reelMeta:p=>({title:p.id}),reelPaused:b=>states.push(b),toast:m=>toasts.push(m),syncLive(){},toggleAudio(){}});
  vm.runInContext(section('async function reelToggle(){','// 波形上的点选'),ctx);
  return {ctx,RL,st,GEN,deferred,starts,toasts,states};
}

test('详情暂停后 PCM 已被清理，再点播放会恢复原曲并从暂停位置续播',async()=>{
  const env=reelRealm(),pending=env.ctx.reelToggle();assert.equal(env.st.loading,true);
  const tr={buffer:{original:true}};env.deferred.resolve(tr);await pending;
  assert.equal(env.starts.length,1);assert.equal(env.starts[0][1],tr);assert.equal(env.starts[0][3],13.75);assert.equal(env.st.loading,false);
});

test('详情续播加载中再点暂停，或已经离开详情，不会在加载完成后抢播',async()=>{
  for(const leave of [false,true]){
    const env=reelRealm(),pending=env.ctx.reelToggle();
    if(leave){env.RL.on=false;env.RL.st=null;}else await env.ctx.reelToggle();
    env.deferred.resolve({buffer:{}});await pending;assert.equal(env.starts.length,0);
  }
});

test('详情恢复期间已经播放别的声音，迟到缓冲不覆盖新播放',async()=>{
  const env=reelRealm(),pending=env.ctx.reelToggle();env.GEN.ver++;env.GEN.owner='q:new';env.GEN.on=true;
  env.deferred.resolve({buffer:{}});await pending;assert.equal(env.starts.length,0);assert.equal(env.GEN.owner,'q:new');
  assert.equal(env.st.playing,false);assert.equal(env.states.at(-1),true,'新播放已经在别处时详情恢复暂停图标');
});

function mediaRealm(){
  const media=[],toasts=[],nodes=[];
  class Audio {
    constructor(){this.readyState=1;this.duration=1800;this.currentTime=0;this.listeners={};media.push(this);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    removeAttribute(name){delete this[name];}
    pause(){this.paused=true;}
    load(){this.loads=(this.loads||0)+1;this.readyState=0;}
    play(){this.plays=(this.plays||0)+1;this.paused=false;this.readyState=4;return Promise.resolve();} // play 成功时已具备可继续播放的数据。
  }
  const GEN={on:false,ver:0,stop(){if(!this.on)return;this.ver++;this.on=false;this.tr=null;this.owner=null;},seek(){},pos(){return 0;},frac(){return 0;}};
  const ctx=vm.createContext({console,GEN,Audio,AbortController,clearInterval(){},toast:m=>toasts.push(m),AU:{init:()=>true,an:{},ctx:{createMediaElementSource(){const n={connect(){},disconnect(){this.disconnected=true;}};nodes.push(n);return n;}}},
    document:{dispatchEvent(){}},CustomEvent:class{}});
  vm.runInContext(section('{ const stop0 = GEN.stop, seek0 = GEN.seek, pos0 = GEN.pos;','/* 离线渲染：'),ctx);
  return {ctx,GEN,media,toasts,nodes};
}

test('流式音频签名失效后只刷新一次，同一播放器恢复原位置和声源，不重置进度',async()=>{
  const env=mediaRealm();let refresh=0;
  env.GEN.startMedia('post:a','/expired.wav',{},1800,0,async()=>{refresh++;return '/renewed.wav';});
  const a=env.media[0];a.currentTime=945.5;await a.onerror();
  assert.equal(refresh,1);assert.equal(env.GEN.owner,'post:a');assert.equal(env.GEN.media,a);assert.equal(a.src,'/renewed.wav');assert.equal(a.plays,2);
  a.readyState=1;a.onloadedmetadata();a.listeners.loadedmetadata();assert.equal(a.currentTime,945.5);assert.equal(env.toasts.length,0);
  await a.onerror();assert.equal(refresh,1);assert.equal(env.GEN.on,false);assert.equal(env.toasts.length,1);
});

test('签名刷新期间用户停止或换曲，刷新完成不会重新启动旧音频',async()=>{
  for(const switchTrack of [false,true]){
    const env=mediaRealm(),deferred=defer();env.GEN.startMedia('post:a','/expired.wav',{},120,0,()=>deferred.promise);
    const first=env.media[0],pending=first.onerror();env.GEN.stop();
    if(switchTrack)env.GEN.startMedia('post:b','/b.wav',{},60);
    deferred.resolve('/renewed.wav');await pending;assert.equal(first.plays,1);assert.equal(env.toasts.length,0);
    assert.equal(env.GEN.owner,switchTrack?'post:b':null);
  }
});

test('已刷新地址开始续播后，旧 play Promise 迟到失败不会停止新地址',async()=>{
  const env=mediaRealm(),deferred=defer();let rejected;
  const originalPlay=env.ctx.Audio.prototype.play;env.ctx.Audio.prototype.play=function(){if(!rejected){this.plays=1;return new Promise((_,reject)=>rejected=reject);}return originalPlay.call(this);};
  env.GEN.startMedia('post:a','/expired.wav',{},100,0,()=>deferred.promise);const a=env.media[0],pending=a.onerror();
  deferred.resolve('/fresh.wav');await pending;rejected(new Error('旧网络请求失败'));await tick();
  assert.equal(env.GEN.on,true);assert.equal(env.GEN.media,a);assert.equal(a.src,'/fresh.wav');assert.equal(env.toasts.length,0);
});

test('浏览器拒绝自动播放不会被误当成签名过期反复请求',async()=>{
  const env=mediaRealm();let refresh=0;env.GEN.startMedia('post:a','/a.wav',{},10,0,async()=>{refresh++;return '/again.wav';});
  await env.media[0].onerror({name:'NotAllowedError'});assert.equal(refresh,0);assert.equal(env.GEN.on,false);
});

test('真实可视化帖直接详情的播放按钮使用原帖子音频，不因没有 PCM 播示例曲',()=>{
  const calls=[],ctx=vm.createContext({POST:()=>({id:'visual',live:true}),GEN:{on:false,ver:0},toggleAudio:id=>calls.push(id)});
  vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
  ctx.toggleDemo('v:visual');assert.deepEqual(calls,['visual']);
});

test('本地可视化音频 PCM 已淘汰，详情按钮恢复原曲；加载中再点能取消',async()=>{
  for(const cancel of [false,true]){
    const deferred=defer(),starts=[],post={id:'visual',live:false,title:'原可视化',dur:'0:23',vis:{pal:'pb'}};
    const GEN={on:false,ver:0,startTrack:(...args)=>starts.push(args)},ctx=vm.createContext({console,GEN,POST:()=>post,P:()=>null,
      TRACKS:{'post:visual':{buffer:null,file:{original:true}}},ensureTrack:()=>deferred.promise,
      COVER_PALS:{pb:{a:'blue'}},CUR:{hash:'#home'},toast(){},document:{dispatchEvent(){}},CustomEvent:class{}});
    vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
    ctx.toggleDemo('v:visual');if(cancel)ctx.toggleDemo('v:visual');const original={buffer:{original:true}};
    deferred.resolve(original);await tick();assert.equal(starts.length,cancel?0:1);
    if(!cancel){assert.equal(starts[0][1],original);assert.equal(starts[0][0],'q:v:visual');assert.equal(starts[0][2].sub,'音频可视化 · 0:23');}
  }
});

test('旧签名重新获取期间保留原加载反馈，取消和完成都移除 loading',async()=>{
  for(const cancel of [false,true]){
    const deferred=defer(),classes=new Set(),button={classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)}},calls=[];
    const post={id:'old',live:true,aurl:'/old.wav',audioAt:0,title:'旧声音',author:'me'},ctx=vm.createContext({console,Date,AbortController,
      GEN:{on:false,ver:0,startMedia:(...args)=>calls.push(args)},AU:{init:()=>true},POST:()=>post,USERS:{me:{name:'我'}},TRACKS:{},
      API:{base:'',req:()=>deferred.promise},apiPost:x=>x,apiFail(){},postCls:()=> 'c-blue',$$:()=>[button],document:{dispatchEvent(){}},CustomEvent:class{}});
    vm.runInContext(section('const PEND = {id:null, n:0, ctrl:null};','/* 波形擦洗：'),ctx);
    const pending=ctx.toggleAudio('old');assert.equal(classes.has('ld'),true);
    if(cancel)await ctx.toggleAudio('old');deferred.resolve({...post,aurl:'/new.wav'});await pending;
    assert.equal(classes.has('ld'),false);assert.equal(calls.length,cancel?0:1);
    if(!cancel)assert.equal(typeof calls[0][5],'function','流式失败时能刷新签名');
  }
});
