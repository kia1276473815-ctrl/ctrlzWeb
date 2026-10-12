// 提取真实详情与手势实现，覆盖弱网加载期间跨页面、缓冲外擦洗及迟到事件。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);};
function reelRealm(state='playing'){
  const handlers=new Map(),calls=[],classes=new Set(),post={id:'a',live:true,title:'原声',author:'me',dur:'0:22'};
  const visual={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)}};
  const GEN={owner:state==='signature'?null:'post:a',state:state==='signature'?'stopped':state,on:state==='playing',pending:state==='loading',ver:2,
    tr:{dur:22},media:state==='playing'||state==='loading'?{original:true}:null,position:9.25,pos(){return this.position;},
    stop(){this.owner=null;this.media=null;this.on=this.pending=false;this.state='stopped';this.ver++;}};
  const RL={on:true,i:0,list:[post],st:null,el:{}},PEND={id:state==='signature'?'a':null,n:1,ctrl:null};
  const document={addEventListener:(k,fn)=>handlers.set(k,fn),dispatchEvent:e=>handlers.get(e.type)?.(e)};
  const ctx=vm.createContext({console,RL,GEN,PEND,document,CustomEvent:class{constructor(type){this.type=type;}},TRACKS:{},USERS:{me:{name:'我'}},
    postCls:()=> 'c-blue',reelCur:()=>post,queueTrack(){},$:()=>visual,$$:()=>[],syncLive(){},toast(){},AU:{init:()=>true},
    toggleAudio:async(...args)=>calls.push(args),reelOwn:p=>'post:'+p.id,reelMeta:p=>({title:p.title}),reelPaused:on=>visual.classList.toggle('paused',on)});
  vm.runInContext(section('function reelStop(){','function heartAt('),ctx);
  return {ctx,GEN,RL,PEND,calls,classes,emit:type=>document.dispatchEvent({type})};
}
test('首页已在播放的同一条音频进入详情，复用媒体与当前位置，不从零重启',async()=>{
  const e=reelRealm(),media=e.GEN.media;await e.ctx.reelPlay();
  assert.deepEqual(e.calls,[]);assert.equal(e.GEN.media,media);assert.equal(e.GEN.position,9.25);
  assert.equal(e.RL.st.playing,true);assert.equal(e.RL.st.pos,9.25);assert.equal(e.classes.has('ld'),false);
});
test('首页暂停的同一条进入详情仍暂停并保存进度，继续按钮从该位置播放',async()=>{
  const e=reelRealm('paused');await e.ctx.reelPlay();assert.deepEqual(e.calls,[]);
  assert.equal(e.RL.st.playing,false);assert.equal(e.RL.st.pos,9.25);assert.equal(e.classes.has('paused'),true);
  await e.ctx.reelToggle();assert.deepEqual(e.calls,[['a',9.25]]);
});
test('首页签名或媒体加载中进入详情，不重复签名，加载结束及取消正确同步',async()=>{
  for(const state of ['signature','loading']){
    const e=reelRealm(state);await e.ctx.reelPlay();assert.deepEqual(e.calls,[]);assert.equal(e.RL.st.loading,true);assert.equal(e.classes.has('ld'),true);
    e.PEND.id=null;e.GEN.owner='post:a';e.GEN.pending=false;e.GEN.on=true;e.GEN.state='playing';e.emit('gen');
    assert.equal(e.RL.st.loading,false);assert.equal(e.RL.st.playing,true);assert.equal(e.classes.has('ld'),false);
    e.GEN.owner=null;e.GEN.on=false;e.GEN.state='stopped';e.PEND.id='a';e.emit('audio-priority-change');assert.equal(e.RL.st.loading,true);
    e.PEND.id=null;e.emit('audio-priority-change');assert.equal(e.RL.st.loading,false);assert.equal(e.RL.st.playing,false);
  }
});
test('媒体被系统暂停后详情同步最新位置，继续播放不会使用更早的st.pos',async()=>{
  const e=reelRealm();await e.ctx.reelPlay();e.GEN.state='paused';e.GEN.on=false;e.GEN.position=17.5;e.emit('gen');
  assert.equal(e.RL.st.pos,17.5);await e.ctx.reelToggle();assert.deepEqual(e.calls,[['a',17.5]]);
});
test('旧详情取消加载的异步收尾不移除新详情的加载反馈或暂停新音频',async()=>{
  const e=reelRealm('loading');await e.ctx.reelPlay();let resolve;e.ctx.toggleAudio=()=>new Promise(r=>resolve=r);
  const waiting=e.ctx.reelToggle();e.RL.st={p:{id:'b',live:true},loading:true,playing:false};e.classes.add('ld');e.classes.delete('paused');
  resolve();await waiting;assert.equal(e.classes.has('ld'),true);assert.equal(e.classes.has('paused'),false);
});
function scrubRealm({end=5}={}){
  const handlers=new Map(),calls=[],seeks=[],classes=new Set(),tip={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},style:{}},cv={dataset:{wave:'a'},isConnected:true,
    getBoundingClientRect:()=>({left:0,top:0,width:100}),setPointerCapture(){},_waveWake(){}};
  const GEN={owner:'post:a',on:true,tr:{dur:20},pos:()=>2,media:{buffered:{length:1,start:()=>0,end:()=>end}},seek:at=>seeks.push(at)};
  const ctx=vm.createContext({GEN,TRACKS:{'post:a':{dur:20}},performance:{now:()=>1000},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),fmtT:String,
    $:()=>tip,document:{addEventListener:(k,fn)=>handlers.set(k,fn)},toggleAudio:(...args)=>calls.push(args),POST:()=>({adur:20})});
  vm.runInContext(section('/* 波形擦洗：','/* 动效工具：'),ctx);
  const pointer=(type,x,y=0)=>handlers.get(type)?.({type,clientX:x,clientY:y,pointerId:7,pointerType:'mouse',button:0,target:{closest:()=>cv},preventDefault(){}});
  return {cv,GEN,calls,seeks,pointer};
}
test('缓冲外连续擦洗仍即时显示预览，松手只提交最终目标，避免逐次网络跳转',()=>{
  const e=scrubRealm();e.pointer('pointerdown',10);for(const x of [40,60,80])e.pointer('pointermove',x);
  assert.equal(e.cv._scrub,.8);assert.deepEqual(e.seeks,[]);e.pointer('pointerup',80);assert.deepEqual(e.calls,[['a',16]]);
});
test('缓冲内保持实时擦洗；取消恢复起点，已移除画布的迟到事件不启动音频',()=>{
  const e=scrubRealm({end:20});e.pointer('pointerdown',10);e.pointer('pointermove',40);assert.deepEqual(e.seeks,[8]);
  e.pointer('pointercancel',40);assert.deepEqual(e.seeks,[8,2]);assert.deepEqual(e.calls,[]);
  const removed=scrubRealm({end:20});removed.pointer('pointerdown',10);removed.cv.isConnected=false;removed.pointer('pointermove',70);removed.pointer('pointerup',70);
  assert.deepEqual(removed.calls,[]);assert.deepEqual(removed.seeks,[]);
});
function gestureRealm(){
  const handlers=new Map(),timers=[],toggled=[],liked=[],moved=[],track={style:{}},view={isConnected:true,clientHeight:600,addEventListener:(k,fn)=>handlers.set(k,fn),setPointerCapture(){}};
  const RL={on:true,i:1,list:[{}, {}, {}],st:{p:{id:'a'}},el:null,cm:false,lock:0};const el={getBoundingClientRect:()=>({left:0,top:0})};RL.el=el;
  const ctx=vm.createContext({RL,$:s=>s==='.rl-view'?view:track,performance:{now:()=>1000},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    reelToggle:()=>toggled.push(RL.st.p.id),goReel:i=>moved.push(i),heartAt(){},fxShapes(){},reelLike:()=>liked.push(RL.st.p.id)});
  vm.runInContext(section('function bindReelGestures(el){',"document.addEventListener('keydown', e => {\n  if (!RL.on"),ctx);ctx.bindReelGestures(el);
  const pointer=(type,x,y,pointerId=7)=>handlers.get(type)?.({type,clientX:x,clientY:y,pointerId,button:0,target:{closest:()=>null},preventDefault(){},stopPropagation(){}});
  return {RL,view,track,timers,toggled,liked,moved,pointer};
}
test('旧详情单击的迟到计时器不能暂停或取消新详情音频',()=>{
  const e=gestureRealm();e.pointer('pointerdown',20,50);e.pointer('pointerup',20,50);assert.equal(e.timers.length,1);
  e.RL.st={p:{id:'b'}};e.timers[0]();assert.deepEqual(e.toggled,[]);
});
test('同一详情字体更新只重绘封面，已完成单击仍作用于保留的播放实例',()=>{
  const e=gestureRealm();e.pointer('pointerdown',20,50);e.pointer('pointerup',20,50);e.view.isConnected=false;
  e.timers[0]();assert.deepEqual(e.toggled,['a']);
});
test('不同详情的两次单击不会误作双击点赞；同一详情双击保留点赞且不再触发暂停',()=>{
  const e=gestureRealm();e.pointer('pointerdown',20,50);e.pointer('pointerup',20,50);e.RL.st={p:{id:'b'}};
  e.pointer('pointerdown',20,50);e.pointer('pointerup',20,50);e.timers.forEach(fn=>fn());assert.deepEqual(e.liked,[]);assert.deepEqual(e.toggled,['b']);
  const same=gestureRealm();for(let i=0;i<2;i++){same.pointer('pointerdown',20,50);same.pointer('pointerup',20,50);}same.timers.forEach(fn=>fn());
  assert.deepEqual(same.liked,['a']);assert.deepEqual(same.toggled,[]);
});
test('详情纵向拖动的pointercancel只复位，第二根手指不能改变第一根手指意图',()=>{
  const e=gestureRealm();e.pointer('pointerdown',20,500);e.pointer('pointermove',20,100);e.pointer('pointercancel',20,100);
  assert(e.moved.every(i=>i===1));
  const multi=gestureRealm();multi.pointer('pointerdown',20,500);multi.pointer('pointermove',20,100,8);multi.pointer('pointerup',20,100,8);
  assert.deepEqual(multi.moved,[]);assert.deepEqual(multi.toggled,[]);
});
test('封面按住期间详情已切换或旧view被移除，迟到抬手不再切条或播放',()=>{
  for(const detach of [false,true]){
    const e=gestureRealm();e.pointer('pointerdown',20,500);e.pointer('pointermove',20,100);
    if(detach)e.view.isConnected=false;else{e.RL.i=2;e.RL.st={p:{id:'b'}};}
    e.pointer('pointerup',20,100);assert.deepEqual(e.moved,[]);assert.deepEqual(e.toggled,[]);
  }
});
