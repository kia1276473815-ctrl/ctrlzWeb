// 冷加载的真实试听音不能在手指松开、滑走或离页后晚到发声；用实际绑定与播放函数。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bundle=fs.readFileSync(new URL('../scripts/views-audio-v1.js',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(){
  const deferred=defer(),mounts=[],cleans=[],starts=[],prefetches=[],events={};let currentKey;
  const element=(key)=>({dataset:{k:String(key)},classList:{add(){},remove(){},toggle(){}},closest(){return this;}});
  const keys=Array.from({length:13},(_,i)=>element(i));currentKey=keys[0];
  const xy={addEventListener(){},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
  const knob={style:{}},cv={getContext:()=>({})},kb={listeners:{},addEventListener(k,f){this.listeners[k]=f;},contains:()=>true,setPointerCapture(){}};
  const gain={setValueAtTime(){},linearRampToValueAtTime(){}},parameter={value:0},audio={currentTime:7,
    createBufferSource(){const node={playbackRate:{value:0},connect(){},start(t){starts.push({t,rate:this.playbackRate.value});},stop(){}};return node;},
    createGain:()=>({gain,connect(){}}),createBiquadFilter:()=>({frequency:{value:0},Q:{value:0},connect(){}})};
  const ctx=vm.createContext({console,Map,Set,Promise,window:{},AU:{init:()=>true,ctx:audio,bus:()=>({}),send(){}},
    pvGet:()=>deferred.promise,pvFetch:url=>{prefetches.push(url);return Promise.resolve(new ArrayBuffer(0));},
    ACTIONS:{},performance:{now:()=>1000},onMount:f=>mounts.push(f),onClean:f=>cleans.push(f),loopAdd:()=>()=>{},
    $:sel=>sel==='#xy'?xy:sel==='.knob'?knob:sel==='canvas'?cv:sel==='#kb'?kb:sel==='#synName'?{textContent:''}:keys[Number(sel.match(/data-k="(\d+)"/)?.[1])||0],
    $$:()=>[],document:{addEventListener:(name,f)=>events[name]=f,removeEventListener:(name,f)=>{if(events[name]===f)delete events[name];},elementFromPoint:()=>currentKey},
    slider:()=>'',lastId:()=>0,esc:String,IC:{play:''},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),CUR:{post:null},
    reduced:()=>true,setTimeout:()=>1,requestAnimationFrame:()=>1,rngSet(){}});
  vm.runInContext(section('async function pvBuf(url, bus','const pvDemo ='),ctx);
  vm.runInContext(bundle,ctx);
  const p={cut:.85,res:.1,atk:.005,rel:.35,det:0,spc:.25,wav:'saw'},pr={id:'real',en:'REAL',presets:[['1 原音',{...p},'/one.wav'],['2 次音',{...p},'/two.wav']]};
  ctx.window.CtrlzViews.audio.pvPreset(pr);mounts.forEach(f=>f({}));
  const keyEvent=key=>({key,target:{closest:()=>null},preventDefault(){}});
  const pointer=()=>({pointerId:1,clientX:0,clientY:0,preventDefault(){}});
  return {ctx,deferred,prefetches,starts,events,kb,keyEvent,pointer,release:()=>deferred.resolve({original:true}),setKey:i=>currentKey=keys[i],clean:()=>cleans.forEach(f=>f())};
}

test('试听页只预取当前选中的音色，切换时预取新音色而不下载整包',()=>{
  const env=setup();assert.deepEqual(env.prefetches,['/one.wav']);env.ctx.ACTIONS.preset({dataset:{i:'1'}});
  assert.deepEqual(env.prefetches,['/one.wav','/two.wav']);
});

test('键盘首触冷加载完成后真实样本发声，仍按原音高变调',async()=>{
  const env=setup();env.events.keydown(env.keyEvent('K'));assert.equal(env.starts.length,0);env.release();await tick();
  assert.equal(env.starts.length,1);assert.equal(env.starts[0].rate,2,'C5 相对于 C4 为2倍播放率');
});

test('电脑键盘冷样本未加载前已经松键，迟到解码不再启动该音符',async()=>{
  const env=setup();env.events.keydown(env.keyEvent('A'));env.events.keyup(env.keyEvent('A'));env.release();await tick();assert.equal(env.starts.length,0);
});

test('触屏键盘松手或 pointercancel 后，晚到的 sample 不发声',async()=>{
  for(const end of ['pointerup','pointercancel']){const env=setup();env.kb.listeners.pointerdown(env.pointer());env.kb.listeners[end](env.pointer());env.release();await tick();assert.equal(env.starts.length,0);}
});

test('触屏滑奏只保留仍按住的最新音符，滑走的冷音不会一起堆到后来发声',async()=>{
  const env=setup();env.kb.listeners.pointerdown(env.pointer());env.setKey(7);env.kb.listeners.pointermove(env.pointer());env.release();await tick();
  assert.equal(env.starts.length,1);assert.equal(env.starts[0].rate,Math.pow(2,7/12));
});

test('离开预设页后取消冷样本，且移除电脑键盘监听',async()=>{
  const env=setup();env.events.keydown(env.keyEvent('A'));env.clean();env.release();await tick();assert.equal(env.starts.length,0);assert.equal(env.events.keydown,undefined);assert.equal(env.events.keyup,undefined);
});

test('切换音色后，旧音色等待的样本不抢播',async()=>{
  const env=setup();env.events.keydown(env.keyEvent('A'));env.ctx.ACTIONS.preset({dataset:{i:'1'}});env.release();await tick();assert.equal(env.starts.length,1,'只保留切换音色的试听');
});

test('冷加载的听一句先等 sample 就绪再安排8个音，原170ms节奏不被压成和弦',async()=>{
  const env=setup(),pending=env.ctx.ACTIONS.phrase();assert.equal(env.starts.length,0);env.release();await pending;await tick();
  assert.equal(env.starts.length,8);for(let i=1;i<8;i++)assert(Math.abs(env.starts[i].t-env.starts[i-1].t-.17)<1e-8);
});

test('冷加载的听一句在离页后不会重新响起',async()=>{
  const env=setup(),pending=env.ctx.ACTIONS.phrase();env.clean();env.release();await pending;await tick();assert.equal(env.starts.length,0);
});

test('pad 下载完成前已经离页，迟到 sample 不再启动',async()=>{
  const deferred=defer(),starts=[],ctx=vm.createContext({console,pvGet:()=>deferred.promise,AU:{ctx:{createBufferSource:()=>({connect(){},start:()=>starts.push(1)})}}});
  vm.runInContext(section('async function pvBuf(url, bus','async function pvNote('),ctx);const intent={cancelled:false},pending=ctx.pvBuf('/pad.wav',{},intent);
  intent.cancelled=true;deferred.resolve({original:true});await pending;assert.equal(starts.length,0);
});
