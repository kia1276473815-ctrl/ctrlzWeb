// 提取当前音频入口，验证字体让路事件与待播标记的真实异步生命周期。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function realm(){
  let ctx;const trace=[],events=[],media=[],requests=[],starts=[],failures=[],navigations=[],buttons=new Map();
  const products={a:{id:'a',live:true,pvAt:0,title:'A',en:'A',cat:'sample'},b:{id:'b',live:true,pvAt:0,title:'B',en:'B',cat:'sample'}};
  const posts={p:{id:'p',live:true,aurl:'/p.wav',audioAt:Date.now(),adur:22,title:'帖子原声',author:'me',dur:'0:22'},
    local:{id:'local',live:false,title:'本地原声',author:'me',dur:'0:22',vis:{pal:'blue'}},other:{id:'other',live:false,title:'另一首',author:'me',dur:'0:22'}};
  const GEN={on:false,ver:0,pending:false,state:'stopped',owner:null,stop(){},seek(){},pos:()=>0,frac:()=>0,
    startTrack(owner,tr,meta,at){this.ver++;this.owner=owner;this.tr=tr;this.on=true;this.pending=false;this.state='playing';starts.push({owner,tr,at});document.dispatchEvent({type:'gen'});}};
  const pending=()=>vm.runInContext('PEND.id',ctx),quick=()=>vm.runInContext('quickPlayPending',ctx);
  const document={dispatchEvent(e){trace.push(e.type);events.push({type:e.type,pending:pending(),quick:quick(),position:GEN.pos()});}};
  class Audio {constructor(){trace.push('new-media');this.currentTime=0;this.readyState=0;this.duration=22;this.listeners={};media.push(this);}
    set src(url){trace.push('media-src');requests.push({url});this.url=url;}get src(){return this.url;}
    addEventListener(k,fn){(this.listeners[k]||=[]).push(fn);}removeAttribute(k){if(k==='src')delete this.url;}
    pause(){this.onpause?.();}load(){this.readyState=0;}play(){trace.push('media-play');return new Promise(()=>{});}
    metadata(){this.readyState=1;this.onloadedmetadata?.();this.listeners.loadedmetadata?.forEach(fn=>fn());}}
  const apiCalls=[];
  ctx=vm.createContext({console,Date,AbortController,GEN,Audio,document,CustomEvent:class{constructor(type){this.type=type;}},clearInterval(){},
    AU:{init:()=>true,an:{},ctx:{createMediaElementSource:()=>({connect(){},disconnect(){}})}},toast:m=>failures.push(m),apiFail:e=>failures.push(e.message),
    P:id=>products[id],POST:id=>posts[id],USERS:{me:{name:'我'}},CATS:{sample:{c:'pink'}},COVER_PALS:{blue:{a:'blue'}},CUR:{hash:'#home'},
    TRACKS:{'post:local':{buffer:null,file:{original:true}}},postCls:()=> 'c-blue',apiPost:x=>x,apiProduct:p=>Object.assign(products[p.id],p),go:p=>navigations.push(p),
    API:{base:'',req(method,path,_body,options){trace.push('signature-request');const gate=deferred();apiCalls.push({method,path,options,...gate});return gate.promise;}},
    ensureTrack(){throw Error('测试必须显式提供原声源');},
    $$:selector=>{const id=/data-id="([^"]+)"/.exec(selector)?.[1];if(!id)return [];if(!buttons.has(id)){const classes=new Set();buttons.set(id,{classes,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)}});}return [buttons.get(id)];}});
  vm.runInContext(section('{ const stop0 = GEN.stop, seek0 = GEN.seek, pos0 = GEN.pos;','/* 离线渲染：'),ctx);
  vm.runInContext(section('const PEND = {id:null, n:0, ctrl:null};','/* 波形擦洗：'),ctx);
  vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
  return {ctx,GEN,posts,products,trace,events,media,requests,starts,failures,navigations,buttons,apiCalls,pending,quick};
}

test('帖子签名 GET 挂起之前同步发出音频意图，取消后旧地址不创建媒体',async()=>{
  const e=realm();e.posts.p.audioAt=0;const waiting=e.ctx.toggleAudio('p');
  assert(e.trace.indexOf('audio-intent')<e.trace.indexOf('signature-request'));assert.equal(e.pending(),'p');
  assert.equal(e.events.find(x=>x.type==='audio-priority-change').pending,'p');
  await e.ctx.toggleAudio('p');assert.equal(e.pending(),null);assert.equal(e.apiCalls[0].options.signal.aborted,true);
  assert.equal(e.events.at(-1).type,'audio-priority-change');assert.equal(e.events.at(-1).pending,null);
  e.apiCalls[0].resolve(e.posts.p);await waiting;assert.equal(e.media.length,0);assert.equal(e.GEN.owner,null);
});

test('等待商品签名时换成帖子，旧成功响应清自身待播标记而不抢播',async()=>{
  const e=realm();e.ctx.toggleDemo('a');assert.equal(e.quick(),'a');
  assert(e.trace.indexOf('audio-intent')<e.trace.indexOf('signature-request'));
  await e.ctx.toggleAudio('p');const current=e.GEN.media;
  e.apiCalls[0].resolve({...e.products.a,demoUrl:'/old-product.wav',pvAt:Date.now()});await tick();
  assert.equal(e.quick(),null);assert.equal(e.GEN.owner,'post:p');assert.equal(e.GEN.media,current);assert.equal(e.media.length,1);
  assert(e.events.some(x=>x.type==='audio-priority-change'&&x.quick===null));
});

test('先前商品 finally 不清后来商品的待播标记，只播放最后一次点击',async()=>{
  const e=realm();e.ctx.toggleDemo('a');e.ctx.toggleDemo('b');
  e.apiCalls[0].resolve({...e.products.a,demoUrl:'/a.wav',pvAt:Date.now()});await tick();assert.equal(e.quick(),'b');assert.equal(e.media.length,0);
  e.apiCalls[1].resolve({...e.products.b,demoUrl:'/b.wav',pvAt:Date.now()});await tick();
  assert.equal(e.quick(),null);assert.equal(e.GEN.owner,'q:b');assert.equal(e.media[0].src,'/b.wav');
});

test('同商品取消后立即重试，旧同ID请求 finally 也不能清新请求',async()=>{
  const e=realm();e.ctx.toggleDemo('a');e.ctx.toggleDemo('a');assert.equal(e.quick(),null);
  assert.equal(e.events.at(-1).type,'audio-priority-change');e.ctx.toggleDemo('a');
  e.apiCalls[0].resolve({...e.products.a,demoUrl:'/stale.wav',pvAt:Date.now()});await tick();assert.equal(e.quick(),'a');assert.equal(e.media.length,0);
  e.apiCalls[1].resolve({...e.products.a,demoUrl:'/current.wav',pvAt:Date.now()});await tick();
  assert.equal(e.quick(),null);assert.equal(e.media.length,1);assert.equal(e.media[0].src,'/current.wav');
});

test('商品签名失败或成功却没有试听地址，结束标记都唤醒字体调度',async()=>{
  const e=realm();e.ctx.toggleDemo('a');e.apiCalls[0].reject(Error('断网'));await tick();
  assert.equal(e.quick(),null);assert.deepEqual(e.failures,['断网']);assert.equal(e.events.at(-1).type,'audio-priority-change');
  e.ctx.toggleDemo('a');e.apiCalls[1].resolve({...e.products.a,pvAt:Date.now()});await tick();
  assert.equal(e.quick(),null);assert.deepEqual(e.navigations,['item-a']);assert.equal(e.media.length,0);
});

test('本地可视化等待原PCM时换播放，版本失效也清待播且不启动旧原声',async()=>{
  const e=realm(),gate=deferred();e.ctx.ensureTrack=()=>gate.promise;e.ctx.toggleDemo('v:local');assert.equal(e.quick(),'v:local');
  await e.ctx.toggleAudio('p');gate.resolve({buffer:{original:true}});await tick();
  assert.equal(e.quick(),null);assert.equal(e.starts.length,0);assert.equal(e.GEN.owner,'post:p');
});

test('本地帖子原PCM完成时版本已改变，PEND与loading仍清理并通知',async()=>{
  const e=realm(),gate=deferred();e.ctx.ensureTrack=()=>gate.promise;const waiting=e.ctx.toggleAudio('local');
  assert.equal(e.pending(),'local');e.products.a.pvAt=Date.now();e.products.a.demoUrl='/product.wav';e.ctx.toggleDemo('a');gate.resolve({buffer:{original:true}});await waiting;
  assert.equal(e.pending(),null);assert.equal(e.starts.length,0);assert.equal(e.buttons.get('local').classes.has('ld'),false);
  assert(e.events.some(x=>x.type==='audio-priority-change'&&x.pending===null));assert.equal(e.GEN.owner,'q:a');
});

test('本地原声等待取消或解码失败都释放PEND，取消的迟到完成不会播放',async()=>{
  const e=realm(),gate=deferred();e.ctx.ensureTrack=()=>gate.promise;const waiting=e.ctx.toggleAudio('local');
  await e.ctx.toggleAudio('local');gate.resolve({buffer:{original:true}});await waiting;assert.equal(e.pending(),null);assert.equal(e.starts.length,0);
  e.ctx.ensureTrack=()=>Promise.reject(Error('解码失败'));await e.ctx.toggleAudio('local');
  assert.equal(e.pending(),null);assert.equal(e.buttons.get('local').classes.has('ld'),false);assert.equal(e.failures.length,1);
});

test('较早本地原声 finally 不清后来等待的PEND，原始PCM与续播位置仍交给最后意图',async()=>{
  const e=realm(),a=deferred(),b=deferred();e.ctx.ensureTrack=id=>id==='local'?a.promise:b.promise;
  const earlier=e.ctx.toggleAudio('local'),latest=e.ctx.toggleAudio('other',7.25);a.resolve({buffer:{a:true}});await earlier;
  assert.equal(e.pending(),'other');const original={buffer:{b:true}};b.resolve(original);await latest;
  assert.equal(e.pending(),null);assert.equal(e.starts.length,1);assert.equal(e.starts[0].owner,'post:other');assert.equal(e.starts[0].tr,original);assert.equal(e.starts[0].at,7.25);
});

test('直接流式入口及签名恢复均先发意图，再发起媒体或恢复请求，原位置保留',async()=>{
  const e=realm(),gate=deferred();e.GEN.startMedia('post:p','/expired.wav',{},22,5.5,()=>{e.trace.push('recover-request');return gate.promise;});
  assert(e.trace.indexOf('audio-intent')<e.trace.indexOf('media-src'));const a=e.media[0];a.metadata();e.trace.length=0;
  const recovering=a.onerror();assert(e.trace.indexOf('audio-intent')<e.trace.indexOf('recover-request'));
  gate.resolve('/fresh.wav');await recovering;a.metadata();assert.equal(e.media.length,1);assert.equal(a.src,'/fresh.wav');assert.equal(a.currentTime,5.5);
});

test('流式seek在更新真实currentTime后发优先级变化，暂停后续播意图仍保留位置',async()=>{
  const e=realm();await e.ctx.toggleAudio('p');const a=e.media[0];a.metadata();a.readyState=4;a.onplaying();e.GEN.seek(12.75);
  assert.equal(e.events.at(-1).type,'audio-priority-change');assert.equal(e.events.at(-1).position,12.75);
  await e.ctx.toggleAudio('p');assert.equal(e.GEN.pos(),12.75);e.trace.length=0;await e.ctx.toggleAudio('p');
  assert(e.trace.indexOf('audio-intent')<e.trace.indexOf('media-src'));e.media[1].metadata();assert.equal(e.media[1].currentTime,12.75);
});
