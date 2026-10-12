// 从真实实现提取函数验证本轮播放、触摸意图及按需资源生命周期；不连接业务账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), AudioResources = require('../scripts/audio-cache.js');
const source = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section = (a,b) => { const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end); };
const tick = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
const defer = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function events(){ const handlers=new Map();return {handlers,document:{hidden:false,
  addEventListener:(k,fn)=>{if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(fn);},
  removeEventListener:(k,fn)=>handlers.get(k)?.delete(fn),dispatchEvent:e=>handlers.get(e.type)?.forEach(fn=>fn(e))},
  emit:(k,data={})=>handlers.get(k)?.forEach(fn=>fn({type:k,...data}))}; }
function mediaRealm(){
  const bus=events(),audios=[],nodes=[],gates=[],toasts=[],posts={a:{id:'a',live:true,aurl:'/a.wav',audioAt:Date.now(),adur:22,title:'原声',author:'me',dur:'0:22'}};
  class Audio {
    constructor(){ this.readyState=0;this.duration=22;this.currentTime=0;this.paused=true;this.listeners={};audios.push(this); }
    addEventListener(k,fn){(this.listeners[k]||=[]).push(fn);}
    removeAttribute(k){delete this[k];}
    pause(){this.paused=true;this.onpause?.();}
    load(){this.readyState=0;}
    play(){this.paused=false;const gate=defer();gates.push(gate);return gate.promise;}
    metadata(){this.readyState=1;this.onloadedmetadata?.();this.listeners.loadedmetadata?.forEach(fn=>fn());}
    playing(){this.readyState=4;this.paused=false;this.onplaying?.();}
  }
  const ctx=vm.createContext({console,Date,AbortController,Audio,CustomEvent:class{constructor(type,data){this.type=type;this.detail=data?.detail;}},
    ...bus,document:bus.document,setInterval:()=>1,clearInterval(){},toast:m=>toasts.push(m),USERS:{me:{name:'我'}},POST:id=>posts[id],TRACKS:{},
    API:{base:'',req:async()=>posts.a},apiPost:x=>x,apiFail:m=>toasts.push(m),postCls:()=> 'c-blue',$$:()=>[],
    AU:{init:()=>true,an:{},ctx:{currentTime:10,createMediaElementSource(){const node={connect(){},disconnect(){this.disconnected=true;}};nodes.push(node);return node;}}}});
  vm.runInContext(section('const GEN = {','/* 离线渲染：'),ctx);
  const GEN=vm.runInContext('GEN',ctx);
  vm.runInContext(section('const PEND = {id:null, n:0, ctrl:null};','/* 波形擦洗：'),ctx);
  return {ctx,GEN,audios,nodes,gates,toasts,posts,...bus};
}

test('悬挂 play Promise 不伪装成已播放；加载可取消且迟到播放事件不抢播',async()=>{
  const e=mediaRealm();await e.ctx.toggleAudio('a');const a=e.audios[0];
  assert.equal(e.GEN.on,false);assert.equal(e.GEN.state,'loading');assert.equal(e.GEN.pending,true);
  const late=a.onplaying;await e.ctx.toggleAudio('a');assert.equal(e.GEN.state,'stopped');assert.equal(e.GEN.owner,null);
  assert.equal(e.nodes[0].disconnected,true);assert.equal(a.src,undefined);late();e.gates[0].resolve();await tick();
  assert.equal(e.GEN.on,false);assert.equal(e.toasts.length,0);
});

test('真实 playing、waiting、stalled 和重新 playing 分别同步播放及缓冲状态',async()=>{
  const e=mediaRealm();await e.ctx.toggleAudio('a');const a=e.audios[0];a.metadata();a.playing();
  assert.equal(e.GEN.state,'playing');assert.equal(e.GEN.on,true);assert.equal(e.GEN.pending,false);
  a.readyState=1;a.onwaiting();assert.equal(e.GEN.state,'buffering');assert.equal(e.GEN.on,false);assert.equal(e.GEN.pending,true);
  a.onstalled();assert.equal(e.GEN.state,'buffering');a.playing();assert.equal(e.GEN.on,true);
  a.readyState=4;a.onstalled();assert.equal(e.GEN.state,'playing','已缓冲数据仍可播放时仅网络stalled不显示加载');
});

test('系统暂停媒体后重新点击也从原位置续播，不只设置currentTime而忘记开始',async()=>{
  const e=mediaRealm();await e.ctx.toggleAudio('a');const a=e.audios[0];a.metadata();a.playing();a.currentTime=9.5;a.pause();
  assert.equal(e.GEN.state,'paused');await e.ctx.toggleAudio('a');assert.equal(e.audios.length,2);e.audios[1].metadata();assert.equal(e.audios[1].currentTime,9.5);assert.equal(e.GEN.pending,true);
});

test('首页流式暂停保留轻量位置并释放媒体资源，续播从原位置恢复；停止后从零播',async()=>{
  const e=mediaRealm();await e.ctx.toggleAudio('a');const first=e.audios[0];first.metadata();first.playing();first.currentTime=12.75;
  await e.ctx.toggleAudio('a');assert.equal(e.GEN.state,'paused');assert.equal(e.GEN.pos(),12.75);assert.equal(e.GEN.media,null);
  assert.equal(first.src,undefined);assert.equal(e.nodes[0].disconnected,true);assert.equal(e.GEN.tr.buffer,null);
  await e.ctx.toggleAudio('a');assert.equal(e.GEN.pos(),12.75,'等待元数据时也保留可见进度');e.audios[1].metadata();assert.equal(e.audios[1].currentTime,12.75);
  e.GEN.stop();await e.ctx.toggleAudio('a');e.audios[2].metadata();assert.equal(e.audios[2].currentTime,0);
});

test('缓冲中再点可以取消；取消后的旧播放拒绝不会弹失败提示或恢复媒体',async()=>{
  const e=mediaRealm();await e.ctx.toggleAudio('a');const a=e.audios[0];a.metadata();a.playing();a.readyState=1;a.onwaiting();
  await e.ctx.toggleAudio('a');e.gates[0].reject(Error('迟到网络失败'));await tick();assert.equal(e.GEN.media,null);assert.equal(e.GEN.owner,null);assert.deepEqual(e.toasts,[]);
});

test('读取签名期间的取消透传给API，并使迟到地址失效',async()=>{
  const e=mediaRealm(),gate=defer();let signal;e.posts.a.audioAt=0;e.ctx.API.req=async(...args)=>{signal=args[3].signal;return gate.promise;};
  const pending=e.ctx.toggleAudio('a');assert.equal(signal.aborted,false);await e.ctx.toggleAudio('a');assert.equal(signal.aborted,true);
  gate.resolve(e.posts.a);await pending;assert.equal(e.audios.length,0);
});

test('离开详情或切换作品时取消在途签名读取，迟到旧详情不能停掉新同作品播放',async()=>{
  const e=mediaRealm(),gate=defer();e.ctx.RL={st:{p:e.posts.a},on:true};e.ctx.reelOwn=p=>'post:'+p.id;e.posts.a.audioAt=0;e.ctx.API.req=()=>gate.promise;
  vm.runInContext(section('function reelStop(){','async function reelPlay(){'),e.ctx);
  const pending=e.ctx.toggleAudio('a');e.ctx.reelStop();e.GEN.startMedia('post:a','/new.wav',{},22,3);const newMedia=e.GEN.media;
  gate.resolve(e.posts.a);await pending;assert.equal(e.GEN.media,newMedia);assert.equal(e.audios.length,1);assert.equal(vm.runInContext('PEND.id',e.ctx),null);
});

function gestureRealm(){
  const bus=events(),calls=[],seeks=[],captures=[],cv={dataset:{wave:'a'},_waveWake(){},getBoundingClientRect:()=>({left:0,top:0,width:100}),setPointerCapture:i=>captures.push(i)};
  const tooltip={classList:{add(){},remove(){}},style:{}},GEN={on:true,owner:'post:a',tr:{dur:20},pos:()=>7,seek:at=>seeks.push(at)};
  const ctx=vm.createContext({console,...bus,document:bus.document,GEN,TRACKS:{'post:a':{dur:20}},POST:()=>({adur:20}),
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),performance:{now:()=>200},fmtT:String,$:()=>tooltip,toggleAudio:(...args)=>calls.push(args)});
  vm.runInContext(section('/* 波形擦洗：全站委托，一处实现 */','/* 动效工具：'),ctx);
  const pointer=(type,x,y,extra={})=>bus.emit(type,{pointerId:1,pointerType:'touch',button:0,clientX:x,clientY:y,target:{closest:()=>cv},preventDefault(){},...extra});
  return {ctx,cv,GEN,calls,seeks,captures,pointer,key:key=>bus.emit('keydown',{key,target:{closest:()=>cv},preventDefault(){},stopPropagation(){}})};
}

test('从波形纵滑超过10px不捕获、不擦洗、不跳进度，浏览器cancel也不启动播放',()=>{
  const e=gestureRealm();e.pointer('pointerdown',20,30);e.pointer('pointermove',22,44);e.pointer('pointercancel',22,50);
  assert.deepEqual(e.seeks,[]);assert.deepEqual(e.calls,[]);assert.deepEqual(e.captures,[]);assert.equal(e.cv._scrub,null);
});

test('触摸不足10px仍按点击跳转；超过阈值且横向1.2倍才进入实时擦洗',()=>{
  const tap=gestureRealm();tap.pointer('pointerdown',20,30);tap.pointer('pointermove',25,34);assert.equal(tap.seeks.length,0);tap.pointer('pointerup',25,34);
  assert.deepEqual(tap.calls,[['a',5]]);
  const drag=gestureRealm();drag.pointer('pointerdown',20,30);drag.pointer('pointermove',35,35);assert.deepEqual(drag.captures,[1]);assert.deepEqual(drag.seeks,[7]);
  drag.pointer('pointerup',35,35);assert.deepEqual(drag.calls,[['a',7]]);
});

test('垂直意图建立后横移不抢回擦洗；横向擦洗取消会恢复手势前位置',()=>{
  const vertical=gestureRealm();vertical.pointer('pointerdown',20,30);vertical.pointer('pointermove',22,45);vertical.pointer('pointermove',80,45);vertical.pointer('pointerup',80,45);
  assert.deepEqual(vertical.calls,[]);assert.deepEqual(vertical.seeks,[]);
  const canceled=gestureRealm();canceled.pointer('pointerdown',20,30);canceled.pointer('pointermove',70,32);canceled.pointer('pointercancel',70,32);
  assert.deepEqual(canceled.seeks,[14,7]);assert.deepEqual(canceled.calls,[]);
});

test('声纹Home/End和箭头按实际秒数夹紧；End不会被循环取模送回开头',()=>{
  const e=gestureRealm();e.key('Home');e.key('End');e.key('ArrowRight');e.key('ArrowLeft');
  assert.deepEqual(e.calls,[['a',0],['a',19.99],['a',12],['a',2]]);
  e.GEN.pos=()=>19.5;e.key('ArrowRight');assert.equal(e.calls.at(-1)[1],19.99);
});

function wavesRealm(){
  const bus=events(),observers=[],resize=[],loops=new Set(),canvases=[],drawn=[],tracks={},posts={},labels={};let time=1000;
  class IntersectionObserver {constructor(fn){this.fn=fn;this.targets=new Set();observers.push(this);}observe(cv){this.targets.add(cv);}unobserve(cv){this.targets.delete(cv);}disconnect(){this.targets.clear();}}
  class ResizeObserver extends IntersectionObserver {constructor(fn){super(fn);observers.pop();resize.push(this);}}
  const GEN={on:false,owner:null,tr:null,pos:()=>0,frac:()=>0};
  const ctx=vm.createContext({console,...bus,document:bus.document,Set,Map,TRACKS:tracks,POST:id=>posts[id],GEN,performance:{now:()=>time},IntersectionObserver,ResizeObserver,
    $$:s=>s==='canvas[data-wave]'?canvases:labels[/data-wt="([^"]+)"/.exec(s)?.[1]]||[],loopAdd:fn=>{loops.add(fn);return ()=>loops.delete(fn);},queueTrack(){},drawTrackWave:cv=>drawn.push(cv),waveProg:()=>GEN.owner==='post:a'?GEN.frac():0,fmtT:String,isDark:()=>false});
  vm.runInContext(section('function waveLoop(cvs){','function mountWaves('),ctx);
  const add=(id,{born=0}={})=>{ const attributes={},cv={dataset:{wave:id},isConnected:true,_sz:{width:360,height:70},setAttribute:(k,v)=>attributes[k]=v};canvases.push(cv);
    tracks['post:'+id]={dur:20,peaks:[.2,1,.4],born};posts[id]={id,dur:'0:20',adur:20};return {cv,attributes,clean:ctx.waveLoop([cv])}; };
  const show=cv=>{observers[0].fn([{target:cv,isIntersecting:true}]);observers[1].fn([{target:cv,isIntersecting:true}]);};
  return {ctx,GEN,tracks,posts,labels,canvases,drawn,observers,resize,loops,add,show,...bus,frame:()=>[...loops].forEach(fn=>fn()),time:n=>time=n};
}

test('首页时间节点仍连接时新增同作品详情，新的时间文字立即同步暂停位置',()=>{
  const e=wavesRealm(),home={isConnected:true,textContent:'0:20'};e.labels.a=[home];const a=e.add('a');e.show(a.cv);
  const detail={isConnected:true,textContent:'0:20'};e.labels.a=[home,detail];const b=e.add('a');e.show(b.cv);
  e.GEN.owner='post:a';e.GEN.tr=e.tracks['post:a'];e.GEN.pos=()=>9.5;e.GEN.frac=()=>.475;e.emit('gen');
  assert.equal(home.textContent,'9.5 / 0:20');assert.equal(detail.textContent,home.textContent);a.clean();b.clean();
});

test('静止波形零持续回调；播放/生长期间才启动，暂停、离屏和隐藏立即停止',()=>{
  const e=wavesRealm(),a=e.add('a');e.show(a.cv);assert.equal(e.drawn.length,1);assert.equal(e.loops.size,0);
  e.GEN.owner='post:a';e.GEN.tr=e.tracks['post:a'];e.GEN.on=true;e.emit('gen');assert.equal(e.loops.size,1);
  e.GEN.on=false;e.emit('gen');assert.equal(e.loops.size,0);
  e.tracks['post:a'].born=1000;e.emit('track',{detail:'post:a'});assert.equal(e.loops.size,1);e.time(1600);e.frame();assert.equal(e.loops.size,0);
  e.GEN.on=true;e.emit('gen');e.observers[1].fn([{target:a.cv,isIntersecting:false}]);assert.equal(e.loops.size,0);
  e.show(a.cv);assert.equal(e.loops.size,1);e.document.hidden=true;e.emit('visibilitychange');assert.equal(e.loops.size,0);a.clean();
});

test('分页复用单组观察者和事件监听，局部删除及清理解除画布引用且空组不登记资源',()=>{
  const e=wavesRealm(),a=e.add('a'),b=e.add('b');assert.equal(e.observers.length,2);assert.equal(e.resize.length,1);
  assert.equal([...e.handlers.values()].reduce((n,set)=>n+set.size,0),6);
  e.ctx.waveLoop([])();assert.equal(e.observers.length,2);
  a.cv.isConnected=false;e.emit('rendered');assert.equal(e.observers[0].targets.has(a.cv),false);assert.equal(a.cv._waveWake,undefined);
  a.clean();b.clean();assert.equal([...e.handlers.values()].reduce((n,set)=>n+set.size,0),0);assert.equal(e.loops.size,0);
  assert.equal(vm.runInContext('waveLoop.runtime',e.ctx),null);
});

test('DOM自动清理后的迟到旧cleanup不能清除下一页新运行器',()=>{
  const e=wavesRealm(),a=e.add('a');a.cv.isConnected=false;e.emit('rendered');assert.equal(vm.runInContext('waveLoop.runtime',e.ctx),null);
  const b=e.add('b'),current=vm.runInContext('waveLoop.runtime',e.ctx);a.clean();assert.equal(vm.runInContext('waveLoop.runtime',e.ctx),current);b.clean();
});

test('ARIA展示实际秒数而非默认50，时间只按秒更新，主题与尺寸变化即时重画',()=>{
  const e=wavesRealm(),a=e.add('a');e.show(a.cv);e.GEN.owner='post:a';e.GEN.tr=e.tracks['post:a'];e.GEN.pos=()=>12.8;e.GEN.frac=()=>.64;e.emit('gen');
  assert.equal(a.attributes['aria-valuemin'],'0');assert.equal(a.attributes['aria-valuemax'],'20');assert.equal(a.attributes['aria-valuenow'],'12');assert.equal(a.attributes['aria-valuetext'],'12.8 / 20');
  const aria=a.cv._aria;e.GEN.pos=()=>12.95;e.emit('gentime');assert.equal(a.cv._aria,aria);
  const count=e.drawn.length;e.ctx.isDark=()=>true;e.emit('theme');assert.equal(e.drawn.length,count+1);
  e.resize[0].fn([{target:a.cv,contentRect:{width:400,height:80}}]);assert.equal(e.drawn.length,count+2);a.clean();
});

test('离开最后一个近屏消费者会取消旧声纹网络，另一个消费者存在时继续复用',()=>{
  const e=wavesRealm(),a=e.add('a'),b=e.add('a');let canceled=0;e.tracks['post:a'].cancelWave=()=>canceled++;e.show(a.cv);e.show(b.cv);
  a.clean();assert.equal(canceled,0);b.clean();assert.equal(canceled,1);
});

test('挂住旧音频网络不阻塞手动样本解码；响应体阶段也能超时并中止网络',async()=>{
  const controller=new AbortController(),gate=defer();let signal;
  const download=AudioResources.readBytes(async(_url,opts)=>{signal=opts.signal;return {ok:true,arrayBuffer:()=>gate.promise};},'/legacy.wav',{signal:controller.signal,timeoutMs:15});
  const manual=await AudioResources.runDecode(async()=>({sample:true}),{priority:2});assert.equal(manual.sample,true);
  await assert.rejects(download,{name:'TimeoutError'});assert.equal(signal.aborted,true);gate.resolve(new ArrayBuffer(1));
});

test('解码优先级保留单路，手动试听先于排队后台任务，已取消后台任务不再分配PCM',async()=>{
  const gate=defer(),started=[],controller=new AbortController();const active=AudioResources.runDecode(()=>gate.promise);
  const canceled=AudioResources.runDecode(()=>{started.push('canceled');},{priority:0,signal:controller.signal});const rejection=assert.rejects(canceled,{name:'AbortError'});
  const background=AudioResources.runDecode(()=>started.push('background'),{priority:0});const manual=AudioResources.runDecode(()=>started.push('manual'),{priority:2});
  controller.abort();gate.resolve();await Promise.all([active,background,manual,rejection]);assert.deepEqual(started,['manual','background']);
});
