// 从当前流式播放器与试听入口提取真实代码，控制弱网事件顺序，不访问业务账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function realm(){
  const audios=[],requests=[],toasts=[],commits=[],events=[];
  const posts={a:{id:'a',live:true,aurl:'/a.wav',audioAt:Date.now(),adur:22,title:'A原声',author:'me',dur:'0:22'},b:{id:'b',live:true,aurl:'/b.wav',audioAt:Date.now(),adur:22,title:'B原声',author:'me',dur:'0:22'}};
  const products={x:{id:'x',live:true,pvAt:0,title:'X原声',en:'X',cat:'sample'}};
  class Audio {
    constructor(){this.readyState=0;this.duration=22;this._time=0;this.paused=true;this.seeking=false;this.listeners=new Map();this.writes=[];this.plays=[];audios.push(this);}
    get currentTime(){return this._time;}set currentTime(n){this._time=n;this.writes.push(n);}
    addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(fn);}
    removeEventListener(k,fn){this.listeners.get(k)?.delete(fn);}
    removeAttribute(k){delete this[k];}
    pause(){this.paused=true;this.onpause?.();}
    load(){this.readyState=0;this._time=0;this.paused=true;}
    play(){this.paused=false;const gate=deferred();this.plays.push(gate);return gate.promise;}
    metadata(){this.readyState=1;this.onloadedmetadata?.();[...this.listeners.get('loadedmetadata')||[]].forEach(fn=>fn());}
    playing(){this.readyState=4;this.paused=false;this.seeking=false;this.onplaying?.();}
  }
  const ctx=vm.createContext({console,Date,AbortController,Audio,setInterval:()=>1,clearInterval(){},
    document:{dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type;}},
    AU:{init:()=>true,an:{},ctx:{currentTime:10,createMediaElementSource:()=>({connect(){},disconnect(){}})}},
    POST:id=>posts[id],P:id=>products[id],USERS:{me:{name:'我'}},CATS:{sample:{c:'pink'}},TRACKS:{},postCls:()=> 'c-blue',$$:()=>[],
    toast:m=>toasts.push(m),apiFail:e=>toasts.push(e.message),go(){},
    apiPost:p=>{commits.push('post:'+p.id);return Object.assign(posts[p.id],p);},apiProduct:p=>{commits.push('product:'+p.id);return Object.assign(products[p.id],p);},
    API:{base:'',req(method,path,body,options){const gate=deferred();requests.push({method,path,options,...gate});return gate.promise;}}});
  vm.runInContext(section('const GEN = {','/* 离线渲染：'),ctx);
  vm.runInContext(section('const PEND = {id:null, n:0, ctrl:null};','/* 波形擦洗：'),ctx);
  vm.runInContext(section('let quickPlayNonce =','/* ================= 可视化模板库'),ctx);
  return {ctx,GEN:vm.runInContext('GEN',ctx),audios,requests,posts,products,toasts,commits,events};
}

test('浏览器禁止自动播放时取消加载并保留暂停进度，点击续播不误报失败或重签',async()=>{
  const e=realm();let recoveries=0;
  e.GEN.startMedia('post:a','/a.wav',{},22,9,async()=>{recoveries++;return '/fresh.wav';});const a=e.audios[0],lateError=a.onerror;
  a.plays[0].reject(Object.assign(new Error('需要先点击'),{name:'NotAllowedError'}));await tick();
  assert.equal(e.GEN.state,'paused');assert.equal(e.GEN.owner,'post:a');assert.equal(e.GEN.pos(),9);
  assert.equal(e.GEN.pending,false);assert.equal(e.GEN.media,null);assert.equal(a.src,undefined);
  assert.equal(recoveries,0);assert.deepEqual(e.toasts,[]);
  await e.ctx.toggleAudio('a');const resumed=e.audios[1];resumed.metadata();resumed.playing();resumed.plays[0].resolve();await tick();
  assert.equal(e.GEN.state,'playing');assert.equal(resumed.currentTime,9);assert.equal(e.GEN.pos(),9);
  await lateError(Object.assign(new Error('旧拒绝'),{name:'NotAllowedError'}));assert.equal(e.GEN.state,'playing');assert.deepEqual(e.toasts,[]);
});

test('签名恢复请求挂起期间的新跳转优先于恢复开始时的位置',async()=>{
  const e=realm(),gate=deferred();e.GEN.startMedia('post:a','/expired.wav',{},22,5,()=>gate.promise);const a=e.audios[0];a.metadata();a.playing();
  const recovering=a.onerror();e.GEN.seek(17);gate.resolve('/fresh.wav');await recovering;a.metadata();
  assert.equal(a.currentTime,17);assert.equal(e.GEN.pos(),17);assert.equal(a.src,'/fresh.wav');assert.equal(e.audios.length,1);
});

test('从续播起点跳到0秒后遇到签名过期，仍恢复0秒',async()=>{
  const e=realm();e.GEN.startMedia('post:a','/expired.wav',{},22,12,async()=>'/fresh.wav');const a=e.audios[0];a.metadata();a.playing();e.GEN.seek(0);
  await a.onerror();a.metadata();assert.equal(a.currentTime,0);assert.equal(e.GEN.pos(),0);
});

test('加载元数据期间连续跳转只应用最新目标一次，取消后移除等待监听',()=>{
  const e=realm();e.GEN.startMedia('post:a','/a.wav',{},22,0);const a=e.audios[0];e.GEN.seek(7);e.GEN.seek(19);
  assert.equal(a.listeners.get('loadedmetadata')?.size,1);a.metadata();assert.deepEqual(a.writes,[19]);
  assert.equal(a.listeners.get('loadedmetadata')?.size,0);
  e.GEN.startMedia('post:b','/b.wav',{},22,3);const b=e.audios[1];e.GEN.seek(11);e.GEN.stop();
  assert.equal(b.listeners.get('loadedmetadata')?.size,0);b.metadata();assert.deepEqual(b.writes,[]);
});

test('旧媒体 pause/stalled/metadata 回调不能改新媒体的等待位置或抛错',()=>{
  const e=realm();e.GEN.startMedia('post:a','/a.wav',{},22,0);const a=e.audios[0];a.metadata();a._time=8;
  const pause=a.onpause,stalled=a.onstalled,metadata=a.onloadedmetadata;
  e.GEN.startMedia('post:b','/b.wav',{},22,3);pause();assert.doesNotThrow(()=>stalled());metadata();
  assert.equal(e.GEN.pos(),3);assert.equal(e.GEN.owner,'post:b');assert.equal(e.GEN.state,'loading');
});

test('开始恢复后迟到的旧 play 成功不能把加载标成已播放',async()=>{
  const e=realm(),gate=deferred();e.GEN.startMedia('post:a','/expired.wav',{},22,5,()=>gate.promise);const a=e.audios[0];a.metadata();a.playing();
  const recovering=a.onerror();a.plays[0].resolve();await tick();assert.equal(e.GEN.state,'loading');assert.equal(e.GEN.on,false);
  gate.resolve('/fresh.wav');await recovering;assert.equal(e.GEN.state,'loading');a.metadata();a.playing();assert.equal(e.GEN.state,'playing');
});

test('play Promise 回调晚于未缓冲 seek/waiting，不覆盖真实缓冲状态',async()=>{
  const e=realm();e.GEN.startMedia('post:a','/a.wav',{},22);const a=e.audios[0];a.metadata();a.playing();
  a.plays[0].resolve();a.seeking=true;a.readyState=1;a.onwaiting();await tick();
  assert.equal(e.GEN.state,'buffering');assert.equal(e.GEN.on,false);assert.equal(e.GEN.pending,true);
});

test('媒体 seeking/seeked 同步缓冲状态，系统暂停后迟到 playing 不会重新亮暂停图标',()=>{
  const e=realm();e.GEN.startMedia('post:a','/a.wav',{},22);const a=e.audios[0];a.metadata();a.playing();
  assert.equal(typeof a.onseeking,'function');assert.equal(typeof a.onseeked,'function');
  a.seeking=true;a.readyState=1;a.onseeking();assert.equal(e.GEN.state,'buffering');
  a.seeking=false;a.readyState=4;a.onseeked();assert.equal(e.GEN.state,'playing');
  a.pause();a.onplaying();assert.equal(e.GEN.state,'paused');assert.equal(e.GEN.on,false);
});

test('在途签名恢复停止时AbortSignal取消；忽略取消的响应也不能提交元数据',async()=>{
  const e=realm();await e.ctx.toggleAudio('a');const a=e.audios[0];a.metadata();a.playing();const recovering=a.onerror();
  assert.equal(e.requests.length,1);assert.equal(e.requests[0].options?.signal?.aborted,false);
  e.GEN.stop();assert.equal(e.requests[0].options.signal.aborted,true);
  e.requests[0].resolve({...e.posts.a,aurl:'/late-expired.wav',adur:99});await recovering;
  assert.deepEqual(e.commits,[]);assert.equal(e.posts.a.aurl,'/a.wav');assert.equal(e.toasts.length,0);
});

test('同条帖子取消后重试，旧签名响应不能覆盖最新音频地址和声纹',async()=>{
  const e=realm();e.posts.a.audioAt=0;const old=e.ctx.toggleAudio('a');await e.ctx.toggleAudio('a');const fresh=e.ctx.toggleAudio('a');
  e.requests[1].resolve({...e.posts.a,aurl:'/fresh.wav',audioAt:Date.now(),peaks:[.9]});await fresh;
  e.requests[0].resolve({...e.posts.a,aurl:'/old.wav',audioAt:0,peaks:[.1]});await old;
  assert.equal(e.posts.a.aurl,'/fresh.wav');assert.deepEqual(e.posts.a.peaks,[.9]);assert.deepEqual(e.commits,['post:a']);assert.equal(e.GEN.media.src,'/fresh.wav');
});

test('同商品取消后重试，旧商品响应不提交过期试听地址',async()=>{
  const e=realm();e.ctx.toggleDemo('x');e.ctx.toggleDemo('x');e.ctx.toggleDemo('x');
  e.requests[1].resolve({...e.products.x,pvAt:Date.now(),demoUrl:'/fresh-product.wav'});await tick();
  e.requests[0].resolve({...e.products.x,pvAt:0,demoUrl:'/old-product.wav'});await tick();
  assert.equal(e.products.x.demoUrl,'/fresh-product.wav');assert.deepEqual(e.commits,['product:x']);assert.equal(e.GEN.media.src,'/fresh-product.wav');
});

test('商品签名恢复被另一首替换后，迟到响应不改旧商品元数据',async()=>{
  const e=realm();Object.assign(e.products.x,{pvAt:Date.now(),demoUrl:'/product.wav'});e.ctx.toggleDemo('x');const a=e.audios[0];a.metadata();a.playing();
  const recovering=a.onerror();await e.ctx.toggleAudio('b');const current=e.GEN.media;
  e.requests[0].resolve({...e.products.x,pvAt:Date.now(),demoUrl:'/late-product.wav'});await recovering;
  assert.equal(e.products.x.demoUrl,'/product.wav');assert.deepEqual(e.commits,[]);assert.equal(e.GEN.media,current);assert.equal(e.GEN.owner,'post:b');
});

test('旧签名请求失败晚于别处播放时不展示与当前播放无关的错误',async()=>{
  const e=realm();e.posts.a.audioAt=0;const old=e.ctx.toggleAudio('a');e.GEN.startMedia('q:new','/new.wav',{},22);
  e.requests[0].reject(Error('旧地址断网'));await old;assert.deepEqual(e.toasts,[]);assert.equal(e.GEN.owner,'q:new');
  e.ctx.toggleDemo('x');e.GEN.startMedia('q:next','/next.wav',{},22);e.requests[1].reject(Error('旧商品断网'));await tick();
  assert.deepEqual(e.toasts,[]);assert.equal(e.GEN.owner,'q:next');
});

test('帖子与商品的签名均挂起时，以最后一次入口为准并取消较早请求',async()=>{
  for(const productLast of [true,false]){
    const e=realm();e.posts.a.audioAt=0;let earlier,later;
    if(productLast){earlier=e.ctx.toggleAudio('a');e.ctx.toggleDemo('x');}
    else {e.ctx.toggleDemo('x');later=e.ctx.toggleAudio('a');}
    e.requests[0].resolve(productLast?{...e.posts.a,aurl:'/stale.wav',audioAt:Date.now()}:{...e.products.x,demoUrl:'/stale.wav',pvAt:Date.now()});
    await tick();assert.equal(e.audios.length,0);assert.deepEqual(e.commits,[]);
    assert.equal(e.requests[0].options?.signal?.aborted,true,'另一个入口应立即让旧读取失效');
    e.requests[1].resolve(productLast?{...e.products.x,demoUrl:'/current.wav',pvAt:Date.now()}:{...e.posts.a,aurl:'/current.wav',audioAt:Date.now()});
    await Promise.all([earlier,later]);await tick();
    assert.equal(e.audios.length,1);assert.equal(e.GEN.owner,productLast?'q:x':'post:a');assert.equal(e.GEN.media.src,'/current.wav');
  }
});

test('商品加载期间再次点击会中止签名GET，同一live可视化入口仍能取消已有PEND',async()=>{
  const e=realm();e.ctx.toggleDemo('x');e.ctx.toggleDemo('x');assert.equal(e.requests[0].options?.signal?.aborted,true);
  e.posts.a.audioAt=0;const waiting=e.ctx.toggleAudio('a');e.ctx.toggleDemo('v:a');
  assert.equal(e.requests.length,2,'同作品的可视化入口应取消，不重新发起签名');assert.equal(e.requests[1].options.signal.aborted,true);
  e.requests[0].resolve({...e.products.x,demoUrl:'/late.wav'});e.requests[1].resolve({...e.posts.a,aurl:'/late.wav'});await waiting;await tick();
  assert.equal(e.audios.length,0);assert.deepEqual(e.commits,[]);
});
