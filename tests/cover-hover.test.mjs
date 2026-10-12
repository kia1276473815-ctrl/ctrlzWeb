// 使用实际封面控制器和绘制代码，检验悬停预览的资源与手动音频隔离。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a,b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, `找不到实际源码：${a}`);
  return source.slice(start,end);
};

function realm(){
  const events = new Map(), windowEvents = new Map(), mediaQueries = new Map(), loops = new Set();
  const boxes = [], canvases = [], intersections = [], mutations = [], unobserved = [], drawings = [];
  let now = 1000, reduce = false;
  const register = (map,k,f) => { if (!map.has(k)) map.set(k,[]); map.get(k).push(f); };
  const query = text => {
    if (!mediaQueries.has(text)){
      const callbacks = [];
      mediaQueries.set(text,{matches:!text.includes('max-width') && !text.includes('reduced-motion'),
        addEventListener:(name,f)=>callbacks.push(f), change(value){ this.matches=value; callbacks.forEach(f=>f({matches:value})); }});
    }
    return mediaQueries.get(text);
  };
  const makeAnalysis = () => ({key:null,s:new Float32Array(64),raw:new Float32Array(64),prev:new Float32Array(64),
    lv:0,lo:0,mid:0,hi:0,kick:0,beat:false,bavg:.2,lastBeat:-9,lt:0,live:false});
  const canvas = () => {
    const g = {setTransform(){}};
    const cv = {className:'',parentElement:null,_vi:true,width:480,height:600,getContext:()=>g,
      get isConnected(){ return !!this.parentElement?.isConnected; },
      remove(){ const p=this.parentElement; if(p) p.canvas=null; this.parentElement=null; }};
    canvases.push(cv); return cv;
  };
  const box = (id,eligible=true) => {
    const b = {dataset:{qbox:'v:'+id},isConnected:true,eligible,canvas:null,children:[],
      contains(node){ return node===this || node?.parentElement===this; },
      matches:sel=>eligible && sel.includes('.vcard'),
      closest(sel){ return this.matches(sel)?this:null; },
      querySelector(sel){ return sel.startsWith('canvas')?this.canvas:sel==='img'?this.image:null; },
      prepend(cv){ this.canvas=cv; cv.parentElement=this; }};
    b.image = {parentElement:b,closest:()=>eligible?b:null,after:cv=>b.prepend(cv)};
    b.badge = {parentElement:b,closest:()=>eligible?b:null};
    boxes.push(b);return b;
  };
  class IntersectionObserver {
    constructor(callback){ this.callback=callback;this.targets=new Set();intersections.push(this); }
    observe(el){this.targets.add(el);} unobserve(el){this.targets.delete(el);}
    fire(entries){this.callback(entries);}
  }
  class MutationObserver {
    constructor(callback){this.callback=callback;this.connected=false;mutations.push(this);}
    observe(){this.connected=true;} disconnect(){this.connected=false;} fire(){if(this.connected)this.callback([]);}
  }
  const OBS = {set:new Set(),ro:{unobserve:cv=>unobserved.push(['ro',cv])},io:{unobserve:cv=>unobserved.push(['io',cv])}};
  const GEN = {on:false,owner:null,ver:7,pos:()=>12.4,stop(){throw new Error('悬停不可停止手动音频');}};
  const ctx = vm.createContext({console,Set,Map,Uint8Array,Float32Array,Math,IntersectionObserver,MutationObserver,
    matchMedia:query,MQ:{mob:query('(max-width:760px)'),rm:query('(prefers-reduced-motion:reduce)')},
    document:{hidden:false,body:{classList:{contains:()=>false}},addEventListener:(k,f)=>register(events,k,f),createElement:()=>canvas()},
    addEventListener:(k,f)=>register(windowEvents,k,f),performance:{now:()=>now},reduced:()=>reduce || query('(prefers-reduced-motion:reduce)').matches,
    GEN,AU:{an:null},OBS,makeAnalysis,IS_MOBILE:false,FREQ:new Uint8Array(512),WAVE:new Uint8Array(1024),
    band:()=>.3,visible:cv=>{OBS.set.add(cv);return cv._vi;},fitCanvas:()=>({w:480,h:600}),grainify(){},
    drawCover:(...args)=>drawings.push(args),loopAdd:f=>{loops.add(f);return ()=>loops.delete(f);},
    POST:id=>({id,title:'原可视化 '+id,vis:{tpl:'grid',pal:'pb'}}),P:()=>null,
    $:sel=>sel==='canvas.live'?canvases.find(cv=>cv.isConnected && cv.className==='live')||null:null,
    $$:sel=>sel==='[data-qbox]'?boxes.filter(b=>b.isConnected):sel==='canvas.live'?canvases.filter(cv=>cv.isConnected && cv.className==='live'):[]});
  vm.runInContext(section('let _liveOff = null;','/* 每类资源的演示声音 */'),ctx);
  const read = expression => vm.runInContext(expression,ctx);
  const dispatch = (name,event={},target=events) => (target.get(name)||[]).forEach(f=>f(event));
  const hover = (target,relatedTarget=null,extra={}) => dispatch('pointerover',{target,relatedTarget,pointerType:'mouse',buttons:0,...extra});
  return {ctx,read,box,GEN,OBS,canvases,intersections,mutations,loops,drawings,unobserved,mediaQueries,
    controller:read('COVER_HOVER'),dispatch,hover,window:name=>dispatch(name,{},windowEvents),
    frame(t){for(const f of [...loops])f(t);},setNow:value=>now=value,setReduced:value=>reduce=value};
}

test('电脑悬停在图片与角标之间移动不重启，同一时刻仅预览一个封面',()=>{
  const r=realm(),a=r.box('a'),b=r.box('b');r.hover(a.image);
  assert.equal(r.controller.box,a);assert.equal(r.canvases.length,1);assert.equal(r.loops.size,1);
  const first=r.controller.frame(1000);r.dispatch('pointerout',{target:a.image,relatedTarget:a.badge});r.hover(a.badge,a.image);
  assert.equal(r.controller.box,a);assert.equal(r.canvases.length,1);assert.equal(r.controller.frame(1034),first);
  r.dispatch('pointerout',{target:a.badge,relatedTarget:b.image});r.hover(b.image,a.badge);
  assert.equal(r.controller.box,b);assert.equal(a.canvas,null);assert(b.canvas);assert.equal(r.loops.size,1);
  assert.notEqual(r.controller.frame(1068),first);
});

test('触控、按住鼠标拖动、普通封面和小屏不会自动预览',()=>{
  for(const mode of ['touch','pen','drag','ordinary','small','coarse','reels','reduced']){
    const r=realm(),a=r.box('a',mode!=='ordinary');
    if(mode==='small')r.ctx.MQ.mob.matches=true;
    if(mode==='coarse')r.mediaQueries.get('(hover:hover) and (pointer:fine)').matches=false;
    if(mode==='reels')r.ctx.document.body.classList.contains=()=>true;
    if(mode==='reduced')r.setReduced(true);
    r.hover(a.image,null,mode==='touch'||mode==='pen'?{pointerType:mode}:mode==='drag'?{buttons:1}:{});
    assert.equal(r.controller.box,null,mode);assert.equal(r.canvases.length,0,mode);assert.equal(r.loops.size,0,mode);
  }
});

test('悬停、移出和切换封面不会改动手动播放的音频与进度',()=>{
  const r=realm(),manual=r.box('manual'),hovered=r.box('hovered');
  r.GEN.on=true;r.GEN.owner='post:manual';const initial={owner:r.GEN.owner,version:r.GEN.ver,position:r.GEN.pos()};r.ctx.syncLive();
  const manualCanvas=manual.canvas;r.hover(hovered.image);r.frame(1000);
  assert.equal(manual.canvas,manualCanvas);assert.equal(r.drawings.length,2);
  assert.equal(r.drawings[0][5].preview,undefined);assert.equal(r.drawings[1][5].preview,true);
  r.dispatch('pointerout',{target:hovered.image,relatedTarget:null});
  assert.equal(hovered.canvas,null);assert.equal(manual.canvas,manualCanvas);assert.equal(r.loops.size,1);
  assert.deepEqual({owner:r.GEN.owner,version:r.GEN.ver,position:r.GEN.pos()},initial);
  r.GEN.on=false;r.ctx.syncLive();assert.equal(r.loops.size,0);
});

test('正在播放同一封面时移出鼠标保留手动画布，不退回静态封面',()=>{
  const r=realm(),a=r.box('a');r.hover(a.image);const cv=a.canvas;
  r.GEN.on=true;r.GEN.owner='post:a';r.ctx.syncLive();r.controller.stop();
  assert.equal(a.canvas,cv);assert.equal(r.loops.size,1);r.frame(1000);assert.equal(r.drawings[0][5].preview,undefined);
});

test('移开鼠标立即释放画布、尺寸观察和共享绘制循环',()=>{
  const r=realm(),a=r.box('a');r.hover(a.image);const cv=a.canvas;r.frame(1000);assert(r.OBS.set.has(cv));
  r.dispatch('pointerout',{target:a.image,relatedTarget:null});
  assert.equal(r.controller.box,null);assert.equal(a.canvas,null);assert.equal(r.OBS.set.has(cv),false);assert.equal(r.loops.size,0);
  assert.deepEqual(r.unobserved.map(v=>v[0]).sort(),['io','ro']);
  assert.equal(r.intersections[0].targets.size,0);assert.equal(r.mutations[0].connected,false);
});

test('失焦、隐藏、路由切换、按下以及设备或减少动效设置变化均停止悬停',()=>{
  for(const exit of ['blur','pagehide','hashchange','hidden','pointerdown','small','coarse','reduced-motion','setting']){
    const r=realm(),a=r.box('a');r.hover(a.image);
    if(['blur','pagehide','hashchange'].includes(exit))r.window(exit);
    else if(exit==='hidden'){r.ctx.document.hidden=true;r.dispatch('visibilitychange');}
    else if(exit==='pointerdown')r.dispatch('pointerdown');
    else if(exit==='small')r.ctx.MQ.mob.change(true);
    else if(exit==='coarse')r.mediaQueries.get('(hover:hover) and (pointer:fine)').change(false);
    else if(exit==='reduced-motion')r.ctx.MQ.rm.change(true);
    else {r.setReduced(true);r.dispatch('rendered');}
    assert.equal(r.controller.box,null,exit);assert.equal(a.canvas,null,exit);assert.equal(r.loops.size,0,exit);
  }
});

test('封面离屏停止；局部删除立即解除画布强引用，不等下次重绘',()=>{
  for(const reason of ['offscreen','removed']){
    const r=realm(),a=r.box('a');r.hover(a.image);r.frame(1000);const cv=a.canvas;
    if(reason==='offscreen')r.intersections[0].fire([{target:a,isIntersecting:false}]);
    else {a.isConnected=false;r.mutations[0].fire();}
    assert.equal(r.controller.box,null,reason);assert.equal(r.loops.size,0,reason);assert.equal(r.OBS.set.has(cv),false,reason);
    assert.equal(r.mutations[0].connected,false,reason);
  }
});

test('新追加的卡片通过委托事件即可预览；离开的旧封面不会延迟重新启动',()=>{
  const r=realm(),a=r.box('a');r.hover(a.image);r.controller.stop();r.frame(2000);assert.equal(r.controller.box,null);
  const b=r.box('b');r.hover(b.image);r.frame(2100);assert.equal(r.controller.box,b);assert.equal(r.drawings.length,1);
  a.isConnected=false;r.dispatch('rendered');assert.equal(r.controller.box,b,'删除另一张卡不会取消当前封面');
});

test('无声预览信号随时间变化，以30帧节流且不覆盖真音频数组',()=>{
  const r=realm(),a=r.box('a');r.ctx.FREQ.fill(11);r.ctx.WAVE.fill(128);r.hover(a.image);
  const first=r.controller.frame(1000),freq=Array.from(first.freq),wave=Array.from(first.wave);
  assert.equal(first.preview,true);assert.notEqual(first.freq,r.ctx.FREQ);assert.notEqual(first.wave,r.ctx.WAVE);
  assert.equal(r.controller.frame(1010),null);assert.equal(r.controller.frame(1020),null);
  const later=r.controller.frame(1034);assert.equal(first,later);assert.notDeepEqual(Array.from(later.freq),freq);assert.notDeepEqual(Array.from(later.wave),wave);
  assert(r.ctx.FREQ.every(v=>v===11));assert(r.ctx.WAVE.every(v=>v===128));
});

function drawingRealm(){
  const calls=[],errors=[],ctx=vm.createContext({console:{error:(...args)=>errors.push(args)},Math,Float32Array,Uint8Array,
    FREQ:new Uint8Array(512).fill(70),WAVE:new Uint8Array(1024).fill(145),
    clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),hash:()=>17,rng:()=>()=>.45,
    COVER_PALS:{pb:{a:'pink',b:'blue',bg:'#ffffee'}},INK:{pink:'#f38',blue:'#34f'}});
  vm.runInContext(section('function makeAnalysis(){','const sp ='),ctx);
  ctx.VIS={orbit:{d:(g,w,h,c)=>calls.push({c,analysis:vm.runInContext('AN',ctx)})}};
  vm.runInContext(section('function drawTpl(g, w, h, look, t, L){','/* ================= 路由'),ctx);
  const g={fillRect(){},globalAlpha:1},look={tpl:'orbit',pal:'pb',txt:'原封面'};
  return {ctx,calls,errors,g,look,read:e=>vm.runInContext(e,ctx),snapshot:()=>JSON.parse(vm.runInContext('JSON.stringify(AN)',ctx))};
}

test('悬停绘制使用独立分析、频谱和波形，前后手动音频的平滑与鼓点完全一致',()=>{
  const r=drawingRealm(),control=drawingRealm();
  r.ctx.drawTpl(r.g,480,600,r.look,1000,{});control.ctx.drawTpl(control.g,480,600,control.look,1000,{});
  const original=r.read('AN'),before=r.snapshot(),preview={preview:true,analysis:r.ctx.makeAnalysis(),
    freq:new Uint8Array(512).fill(230),wave:new Uint8Array(1024).fill(195)};
  for(const t of [1100,1134,1168])r.ctx.drawTpl(r.g,480,600,r.look,t,preview);
  assert.equal(r.read('AN'),original);assert.deepEqual(r.snapshot(),before);
  assert(preview.analysis.lv>0);assert.equal(r.calls[1].analysis,preview.analysis);
  assert.equal(r.calls[1].c.live,true);assert.equal(r.calls[1].c.freq,preview.freq);assert.equal(r.calls[1].c.wave,preview.wave);
  assert.equal(r.calls[0].c.freq,r.ctx.FREQ);assert.equal(r.calls[0].c.wave,r.ctx.WAVE);
  r.ctx.drawTpl(r.g,480,600,r.look,1200,{});control.ctx.drawTpl(control.g,480,600,control.look,1200,{});
  assert.deepEqual(r.snapshot(),control.snapshot(),'预览帧不改变下一帧真音频分析结果');
  assert(r.ctx.FREQ.every(v=>v===70));assert(r.ctx.WAVE.every(v=>v===145));assert.equal(r.errors.length,0);
});

test('画布或模板绘制异常仍还原音频分析 owner，下一帧能继续正常绘制',()=>{
  for(const failure of ['canvas','template']){
    const r=drawingRealm(),original=r.read('AN'),before=r.snapshot(),preview={preview:true,analysis:r.ctx.makeAnalysis(),
      freq:new Uint8Array(512).fill(190),wave:new Uint8Array(1024).fill(180)};
    if(failure==='canvas'){
      assert.throws(()=>r.ctx.drawTpl({fillRect(){throw new Error('canvas failed');}},480,600,r.look,1000,preview),/canvas failed/);
    }else{
      r.ctx.VIS.orbit.d=()=>{throw new Error('template failed');};r.ctx.drawTpl(r.g,480,600,r.look,1000,preview);assert.equal(r.errors.length,1);
      r.ctx.VIS.orbit.d=()=>{};
    }
    assert.equal(r.read('AN'),original,failure);assert.deepEqual(r.snapshot(),before,failure);
    assert.doesNotThrow(()=>r.ctx.drawTpl(r.g,480,600,r.look,1100,{}));assert.equal(r.read('AN'),original);
  }
});
