// 服务器已有峰值应在首帧完整显示；本地新计算波形仍保留原有生长和进度交互。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end){
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start); return source.slice(a, b);
}
function drawing({born = 0, now = 10} = {}){
  const bars = [], lines = [], tr = {peaks:Float32Array.from([.2,1,.45,.75]),born};
  let style;
  const canvas = {dataset:{wave:'real'},getContext:() => ({clearRect(){},beginPath(){},
    set fillStyle(value){style = value;},
    roundRect:(x,y,w,h) => bars.push({x,y,w,h,color:style}),
    fill(){},fillRect:(x,y,w,h) => lines.push({x,y,w,h,color:style})})};
  const ctx = vm.createContext({TRACKS:{'post:real':tr},performance:{now:() => now},
    fitCanvas:() => ({w:400,h:80,dpr:1}),INK:{ink:'#141418'},POST:() => ({live:true})});
  vm.runInContext(section('function drawTrackWave(cv, prog=0, opts={})', 'function drawWave('), ctx);
  return {ctx,canvas,bars,lines,tr};
}

test('现成峰值在页面首个 10ms 帧完整显示，不将 born0 当新波形动画起点', () => {
  const early = drawing({now:10}), settled = drawing({now:1000});
  early.ctx.drawTrackWave(early.canvas,0,{bars:4}); settled.ctx.drawTrackWave(settled.canvas,0,{bars:4});
  assert.deepEqual(early.bars,settled.bars);
  assert.equal(early.bars[1].h,80*.94);
  assert(new Set(early.bars.map(b => b.h)).size > 1);
});

test('本地刚算出的真实波形保留生长动画，进度和悬停色与竖线不变', () => {
  const fresh = drawing({born:1000,now:1100}), complete = drawing({born:1000,now:1600});
  fresh.canvas._hov = complete.canvas._hov = .7;
  fresh.ctx.drawTrackWave(fresh.canvas,.25,{bars:4}); complete.ctx.drawTrackWave(complete.canvas,.25,{bars:4});
  assert(fresh.bars[1].h < complete.bars[1].h);
  assert.deepEqual(fresh.bars.map(b => b.color),['#141418','rgba(20,20,24,.55)','rgba(20,20,24,.55)','rgba(20,20,24,.3)']);
  assert.deepEqual(fresh.lines,[{x:279,y:0,w:2,h:80,color:'rgba(20,20,24,.55)'}]);
});

test('现成峰值首帧画一次，空闲和同长度峰值替换仍按需绘制', () => {
  const observers = [], tr = {peaks:Float32Array.from([.2,1,.45]),born:0}, canvas = {dataset:{wave:'real'},isConnected:true,_sz:{width:320,height:80}};
  let loops = 0,draws = 0, time = 10;const handlers={};
  const ctx = vm.createContext({TRACKS:{'post:real':tr},performance:{now:() => time},
    IntersectionObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},
    loopAdd:() => {loops++;return () => loops--;},$$:() => [],queueTrack(){},waveProg:() => 0,isDark:() => false,
    document:{addEventListener:(k,fn)=>handlers[k]=fn,removeEventListener:(k)=>delete handlers[k]},
    drawTrackWave:() => draws++,POST:() => ({live:true,dur:'0:22'}),GEN:{},fmtT:String});
  vm.runInContext(section('function waveLoop(cvs){', 'function mountWaves('),ctx);
  const clean=ctx.waveLoop([canvas]);
  observers[0].fn([{target:canvas,isIntersecting:true}]);observers[1].fn([{target:canvas,isIntersecting:true}]);
  time=11;assert.equal(draws,1);assert.equal(loops,0);
  tr.peaks=Float32Array.from([1,.3,.55]);handlers.track({type:'track',detail:'post:real'});assert.equal(draws,2);assert.equal(loops,0);clean();
});

const tick = async () => { for(let i=0;i<16;i++) await Promise.resolve(); };
function scheduler(){
  const posts = {}, canvases = [], started = [], idle = new Map(), timers = new Map(), microtasks = [], pending = new Map(), handlers = {};
  let nextId = 1, now = 10000, active = 0, peak = 0;
  const ctx = vm.createContext({console,Promise,Map,Set,performance:{now:() => now},GEN:{},waveProg:()=>0,isDark:()=>false,drawTrackWave(){},fmtT:String,
    POST:id => posts[id],POSTS:[],TRACKS:{},$$:() => canvases,
    queueMicrotask:fn => microtasks.push(fn),
    setTimeout:fn => {const id=nextId++;timers.set(id,fn);return id;},clearTimeout:id => timers.delete(id),
    window:{requestIdleCallback:fn => {const id=nextId++;idle.set(id,fn);return id;},cancelIdleCallback:id => idle.delete(id)},
    document:{hidden:false,addEventListener:(event,fn) => {handlers[event]=fn;}},
    addEventListener:(event,fn) => {handlers[event]=fn;},
    ensureTrack:id => {started.push(id);active++;peak=Math.max(active,peak);
      return new Promise(resolve => pending.set(id,() => {active--;resolve({peaks:[.2,1]});}));}});
  vm.runInContext(section('const TQ = []; let tBusy = false;', 'const waveProg ='),ctx);
  const add = (id,{live=true,visible=true,near=true,connected=true,peaks} = {}) => {
    const post=posts[id]={id,live};ctx.POSTS.push(post);
    const cv={dataset:{wave:id},_near:near,_vis:visible,isConnected:connected};canvases.push(cv);
    if(peaks)ctx.TRACKS['post:'+id]={peaks};return cv;
  };
  const flushMicrotasks = () => {for(let i=0;microtasks.length && i<20;i++)microtasks.shift()();};
  const runIdle = () => {const entry=idle.entries().next().value;assert(entry,'expected queued idle callback');idle.delete(entry[0]);entry[1]({didTimeout:false,timeRemaining:()=>50});};
  return {ctx,add,started,idle,timers,microtasks,flushMicrotasks,runIdle,
    setTime:t => now=t,event:type => handlers[type]?.(),complete:id => {assert(pending.has(id));pending.get(id)();pending.delete(id);},
    get peak(){return peak;}};
}

test('可见真实帖子在滚动期间立即读取轻量波形，不等待空闲或停手500ms', async () => {
  const s=scheduler();s.add('visible');s.event('wheel');s.ctx.queueTrack('visible');s.flushMicrotasks();await tick();
  assert.deepEqual(s.started,['visible']);assert.equal(s.idle.size,0);assert.equal(s.timers.size,0);
});

test('可见真实帖子越过待执行的示例空闲任务，后台分析仍保持单路', async () => {
  const s=scheduler();s.add('demo',{live:false});s.add('real');
  s.ctx.queueTrack('demo');assert.equal(s.idle.size,1);
  s.ctx.queueTrack('real');s.flushMicrotasks();await tick();assert.deepEqual(s.started,['real']);
  assert.equal(s.idle.size,0);s.complete('real');await tick();
  s.runIdle();await tick();assert.deepEqual(s.started,['real','demo']);assert.equal(s.peak,1);
});

test('已开始的分析不会并行，可见真实帖子比近屏但不可见帖子先读取', async () => {
  const s=scheduler();s.add('active');s.add('near',{visible:false});s.add('visible');
  s.ctx.queueTrack('active');s.flushMicrotasks();await tick();s.ctx.queueTrack('near');s.ctx.queueTrack('visible');s.flushMicrotasks();await tick();
  assert.deepEqual(s.started,['active']);s.complete('active');await tick();s.flushMicrotasks();
  assert.deepEqual(s.started,['active','visible']);s.complete('visible');await tick();
  assert.deepEqual(s.started,['active','visible']);s.runIdle();await tick();assert.deepEqual(s.started,['active','visible','near']);
  assert.equal(s.peak,1);
});

test('页面隐藏和已移除/远处卡片不启动分析，重新显示后队列继续', async () => {
  const s=scheduler();s.add('gone',{connected:false});s.add('far',{near:false});s.add('visible');
  s.ctx.document.hidden=true;s.ctx.queueTrack('gone');s.ctx.queueTrack('far');s.ctx.queueTrack('visible');
  s.flushMicrotasks();await tick();while(s.idle.size){s.runIdle();await tick();}assert.deepEqual(s.started,[]);
  s.ctx.document.hidden=false;s.event('visibilitychange');s.flushMicrotasks();
  await tick();while(s.idle.size && !s.started.length){s.runIdle();await tick();}s.flushMicrotasks();await tick();assert.deepEqual(s.started,['visible']);
});

test('已有轻量峰值不排队；近屏预取和示例合成继续等待滚动结束及空闲', async () => {
  const s=scheduler();s.add('cached',{peaks:[.2,1]});s.add('near',{visible:false});s.add('demo',{live:false});
  s.ctx.queueTrack('cached');assert.equal(s.idle.size+s.microtasks.length+s.timers.size,0);
  s.event('touchmove');s.ctx.queueTrack('near');s.ctx.queueTrack('demo');s.flushMicrotasks();await tick();assert.deepEqual(s.started,[]);
  s.runIdle();await tick();assert.deepEqual(s.started,[]);assert(s.timers.size>0);
  s.setTime(10501);const entry=s.timers.entries().next().value;s.timers.delete(entry[0]);entry[1]();
  if(s.idle.size)s.runIdle();s.flushMicrotasks();await tick();assert.deepEqual(s.started,['near']);
});

for (const order of ['near-first','seen-first']){
  test(`可见性观察者 ${order} 到达都将现有预取升级为立即读取`, async () => {
    const s=scheduler(),observers=[],canvas=s.add('real',{visible:false,near:false});
    s.ctx.IntersectionObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}};
    s.ctx.loopAdd=() => () => {};
    vm.runInContext(section('function waveLoop(cvs){', 'function mountWaves('),s.ctx);
    const clean=s.ctx.waveLoop([canvas]),entry=[{target:canvas,isIntersecting:true}];
    if(order==='near-first'){observers[0].fn(entry);assert.equal(s.idle.size,1);observers[1].fn(entry);}
    else {observers[1].fn(entry);assert.equal(s.idle.size,1);observers[0].fn(entry);}
    await tick();assert.deepEqual(s.started,['real']);assert.equal(s.idle.size,0);clean();
    assert.equal(canvas._near,false);
  });
}

test('取消的旧空闲回调即使已到达事件队列也不能启动第二个分析', async () => {
  const s=scheduler();s.add('demo',{live:false});s.add('real');s.ctx.queueTrack('demo');
  const oldCallback=s.idle.values().next().value;
  s.ctx.queueTrack('real');await tick();oldCallback({didTimeout:true,timeRemaining:()=>0});await tick();
  assert.deepEqual(s.started,['real']);assert.equal(s.peak,1);
  s.complete('real');await tick();s.runIdle();await tick();assert.deepEqual(s.started,['real','demo']);assert.equal(s.peak,1);
});
