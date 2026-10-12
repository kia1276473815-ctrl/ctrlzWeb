// 只从页面提取 thDisp/themeFx；模拟浏览器回调和 DOM，检验实际资源生命周期。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,`找不到实际源码：${a}`);return source.slice(start,end);};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const attrs=()=>{const data=new Map();return {setAttribute:(k,v)=>data.set(k,String(v)),getAttribute:k=>data.get(k)??null,removeAttribute:k=>data.delete(k)};};

function themeRealm(){
  const properties=new Map(),classes=new Set(),jobs=[],canvases=[],frames=[],timers=[],created=[],revoked=[],transitions=[],owners=[],errors=[];
  let dark=false;
  const root={style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)},
    classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)},animate:()=>({})};
  const canvas=()=>{
    const g={setTransform(){},clearRect(){},putImageData(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
    const cv={width:300,height:150,style:{},isConnected:false,getContext:()=>g,
      toBlob:callback=>jobs.push({canvas:cv,callback}),remove:()=>{cv.isConnected=false;}};
    canvases.push(cv);return cv;
  };
  const THX={gen:0,t:null,last:{},map:attrs(),dm:attrs(),svg:{querySelector:()=>attrs()}};
  const fx={dur:100,init:F=>owners.push(F),frame:F=>F.disp(()=>1,3)};
  const context=vm.createContext({Promise,console:{error:(...args)=>errors.push(args)},URL:{
    createObjectURL:blob=>{assert(blob);const u='blob:theme-test-'+(created.length+1);created.push(u);return u;},
    revokeObjectURL:u=>revoked.push(u)},THX,VT:{t:null},STATE:{settings:{rm:false}},THX_FX_M:{light:[fx],dark:[fx]},THX_FX:{light:[fx],dark:[fx]},
    innerWidth:32,innerHeight:24,devicePixelRatio:2,reduced:()=>false,isMob:()=>true,isDark:()=>dark,
    thFar:()=>40,performance:{now:()=>0},requestAnimationFrame:f=>{frames.push(f);return frames.length;},
    setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},
    thLensSvg:()=>{THX.map.setAttribute('href','data:flat');THX.dm.setAttribute('scale',0);},
    document:{documentElement:root,body:{appendChild:cv=>{cv.isConnected=true;}},createElement:name=>{assert.equal(name,'canvas');return canvas();},
      startViewTransition(fn){
        const ready=defer(),done=defer(),finished=defer();
        const t={ready:ready.promise,updateCallbackDone:done.promise,finished:finished.promise,
          skipTransition(){ready.reject(new DOMException('Transition skipped','AbortError'));},
          resolveReady:()=>ready.resolve(),finish:()=>finished.resolve()};
        fn();done.resolve();transitions.push(t);return t;
      }}});
  vm.runInContext(section('function thDisp(F, fn, max){','/* apply：真正切换外观'),context);
  vm.runInContext(section('function themeFx(apply, el){',"addEventListener('pointerdown', () => { if (THX.t)"),context);
  return {context,THX,root,properties,classes,jobs,canvases,frames,timers,created,revoked,transitions,owners,errors,
    async begin(){context.themeFx(()=>{dark=!dark;});const t=transitions.at(-1);t.resolveReady();await tick();assert.equal(errors.length,0);return {t,F:owners.at(-1)};},
    blob(index){const job=jobs[index];assert(job,`没有编码任务 ${index}`);job.callback({size:16});},
    async end(t){t.finish();await tick();},
    flushTimers(){while(timers.length)timers.shift().f();}};
}

test('旧主题的晚到 Blob 不创建 URL，也不覆盖新主题的贴图',async()=>{
  const r=themeRealm(),first=await r.begin();assert.equal(r.jobs.length,1);
  const second=await r.begin();assert.equal(r.jobs.length,2);
  r.blob(1);const current=r.THX.map.getAttribute('href'),scale=r.THX.dm.getAttribute('scale');
  assert.equal(r.created.length,1);assert.equal(second.F._url,current);
  r.blob(0);
  assert.equal(r.created.length,1);assert.equal(r.THX.map.getAttribute('href'),current);assert.equal(r.THX.dm.getAttribute('scale'),scale);
  const before=r.jobs.length;r.context.thDisp(first.F,()=>1,12);assert.equal(r.jobs.length,before,'旧owner不应再次编码');
  await r.end(first.t);assert.equal(r.THX.map.getAttribute('href'),current);assert.equal(r.THX.t,second.t);
  await r.end(second.t);assert.deepEqual(r.revoked,[current]);
});

test('结束释放最新 URL，已在队列里的 Blob 和绘制不能回填资源',async()=>{
  const r=themeRealm(),{t,F}=await r.begin();r.blob(0);const latest=F._url;
  r.context.thDisp(F,()=>2,4);assert.equal(r.jobs.length,2);
  await r.end(t);
  assert.equal(F.disposed,true);assert.equal(F._url,null);assert.deepEqual(r.revoked,[latest]);
  assert.notEqual(r.THX.map.getAttribute('href'),latest);assert.equal(r.THX.t,null);
  assert.equal(r.classes.has('thvt'),false);assert.equal(r.properties.size,0);
  const created=r.created.length,href=r.THX.map.getAttribute('href'),scale=r.THX.dm.getAttribute('scale');
  r.blob(1);assert.equal(F._busy,false);assert.equal(r.created.length,created);assert.equal(r.THX.map.getAttribute('href'),href);assert.equal(r.THX.dm.getAttribute('scale'),scale);
  const jobs=r.jobs.length,canvasCount=r.canvases.length;r.context.thDisp(F,()=>3,5);r.frames.forEach(f=>f(200));
  assert.equal(r.jobs.length,jobs);assert.equal(r.canvases.length,canvasCount);assert.equal(r.created.length,created);
});

test('旧主题结束只释放自己 URL，不清除新主题的映射与过渡 owner',async()=>{
  const r=themeRealm(),first=await r.begin();r.blob(0);const old=first.F._url;
  r.context.thDisp(first.F,()=>1,4);const late=r.jobs.length-1;
  const second=await r.begin();r.blob(r.jobs.length-1);const current=second.F._url,properties=[...r.properties],gen=r.THX.map.getAttribute('data-gen'),newCanvas=r.canvases.filter(cv=>cv.isConnected).at(-1);
  await r.end(first.t);
  assert.deepEqual(r.revoked,[old]);assert.equal(first.F.disposed,true);assert.equal(first.F._url,null);
  assert.equal(r.THX.map.getAttribute('href'),current);assert.equal(r.THX.map.getAttribute('data-gen'),gen);assert.equal(r.THX.t,second.t);assert.equal(r.classes.has('thvt'),true);
  assert.deepEqual([...r.properties],properties);assert.equal(newCanvas.isConnected,true);assert.equal(r.canvases[0].isConnected,false);
  r.blob(late);assert.equal(r.created.length,2);assert.equal(r.THX.map.getAttribute('href'),current);
  await r.end(second.t);assert.deepEqual(r.revoked,[old,current]);assert.equal(r.THX.t,null);
});

test('当前贴图的替换 URL 与最终 URL 都释放，map generation 失配时不提交',async()=>{
  const r=themeRealm(),{t,F}=await r.begin();r.blob(0);const old=F._url;
  r.context.thDisp(F,()=>1,4);r.blob(1);const latest=F._url;
  assert.notEqual(old,latest);assert.deepEqual(r.revoked,[]);
  r.context.thDisp(F,()=>1,5);assert.equal(r.jobs.length,3);
  r.THX.map.setAttribute('data-gen','different-owner');r.blob(2);
  assert.equal(r.created.length,2);assert.equal(r.THX.map.getAttribute('href'),latest);assert.equal(F._url,latest);
  r.THX.map.setAttribute('data-gen',String(r.THX.gen));await r.end(t);r.flushTimers();
  assert.deepEqual([...r.revoked].sort(),[old,latest].sort());assert.equal(new Set(r.revoked).size,2);
});
