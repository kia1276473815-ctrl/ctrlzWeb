// 运行时性能：用正式逻辑验证封面缓存、陀螺仪按需监听、视频暂停跳帧、静止画布、配图懒加载、私信轻轮询和首屏并行。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),AudioResources=require('../scripts/audio-cache.js');
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const bundle=fs.readFileSync(new URL('../scripts/views-audio-v1.js',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('封面缓存能放下一页商城：按长度计费，60 张顺序访问第二轮全部命中；字体就绪只清写了字的封面',()=>{
  const ctx=vm.createContext({AudioResources,navigator:{deviceMemory:8}});
  vm.runInContext(section('// 一页商城（60 件）','const COVER_PAL ='),ctx);
  const covers=vm.runInContext('COVERS',ctx),url='x'.repeat(135000);let misses=0;
  const read=key=>{if(covers.has(key))return covers.get(key);misses++;covers.set(key,url,url.length);};
  for(let round=0;round<2;round++)for(let i=0;i<60;i++)read('Lorbitpb'+i+'480x480');
  assert.equal(misses,60,'第二轮不再重画');
  covers.set('crt3x480x480',url,url.length);covers.set('type3x480x480',url,url.length);covers.set('wave3x480x480',url,url.length);
  vm.runInContext('coverFontDrop()',ctx);assert.deepEqual([...covers.values.keys()],['wave3x480x480']);
  assert.equal(source.includes('url.length*2'),false,'base64 是单字节字符串，不再按两倍记账');
});

test('liveShop 判断哪些卡变了不生成封面',()=>{
  const live=section('async function liveShop(){',"ACTIONS['shop-retry']");
  assert.match(live,/before\.get\(p\.id\) !== sleeveSig\(p\)/);assert.equal(/[^.]\bsleeve\(/.test(live),false);
  const ctx=vm.createContext({USERS:{u:{id:'u',name:'n'}},CATS:{sample:{c:'pink'}},STATE:{owned:new Set()},COVER_PALS:{},INK:{pink:'#f'},IC:{play:''},esc:String,av:()=>'',hash:()=>1,draws:0});
  ctx.cover=()=>{ctx.draws++;return 'data:'};vm.runInContext(section('function sleeve(pr){','/* 声音帖：每条帖子'),ctx);
  const pr={id:'p',seller:'u',cat:'sample',cover:{tpl:'a'},title:'t',en:'e',price:1},sig=vm.runInContext('sleeveSig',ctx);
  assert.notEqual(sig(pr),sig({...pr,price:2}));assert.notEqual(sig(pr),sig({...pr,cover:{tpl:'b'}}));assert.equal(ctx.draws,0);
  assert.match(ctx.sleeve(pr),/src="data:"/);assert.equal(ctx.draws,1);
});

function gravity({asked=false}={}){
  const orient=asked ? function(){} : undefined,listeners=new Map(),timers=[],ctx=vm.createContext({Math,window:{DeviceOrientationEvent:orient},DeviceOrientationEvent:orient,screen:{},IS_MOBILE:true,
    addEventListener:(k,f)=>{(listeners.get(k)||listeners.set(k,new Set()).get(k)).add(f);},removeEventListener:(k,f)=>listeners.get(k)?.delete(f),
    setTimeout:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimeout:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},
    performance:{now:()=>ctx.now},now:1000});
  vm.runInContext(section('const GRAV = {','const VIS = {};'),ctx);
  const on=()=>listeners.get('deviceorientation')?.size||0,fire=(at=ctx.now+2000)=>{ctx.now=at;timers.splice(0).forEach(t=>t.fn());};
  return {ctx,on,fire,grav:()=>vm.runInContext('GRAV',ctx),listeners};
}
test('安卓启动时不开传感器；物理画面续约期间才挂监听，停 1.5 秒后摘掉，保留最后方向',()=>{
  const g=gravity({asked:true});assert.equal(g.grav().asked,true,'启动时记下可用');assert.equal(g.on(),0);
  g.ctx.gravTick(true);assert.equal(g.on(),1);
  [...g.listeners.get('deviceorientation')][0]({beta:30,gamma:10});const {tx,ty}=g.grav();assert.equal(g.grav().on,true);
  g.ctx.now=1500;g.ctx.gravTick(true);g.fire(2550);assert.equal(g.on(),1,'还在续约不摘');g.fire(3050);assert.equal(g.on(),0);
  assert.equal(g.grav().on,true);assert.equal(g.grav().tx,tx);assert.equal(g.grav().ty,ty);
  g.ctx.gravTick(true);assert.equal(g.on(),1,'重新使用直接挂回，不再询问');
});
test('分类卡计数：有卡在看就一直开，最后一个走后摘掉；iOS 未授权时不挂监听、不提前请求授权',()=>{
  const g=gravity();g.ctx.gravNeed();assert.equal(g.on(),0,'还没授权');g.ctx.gravDone();
  assert.equal(g.grav().physT,undefined,'分类卡不算物理画面，不会让下一次点击弹授权');
  g.ctx.gravNeed();g.ctx.gravOn();assert.equal(g.on(),1,'授权后有使用方立刻挂上');g.ctx.gravNeed();g.ctx.gravDone();g.fire();assert.equal(g.on(),1);
  g.ctx.gravDone();g.fire();assert.equal(g.on(),0);
});
test('catRub：卡片出屏幕摘监听，重绘掉立刻断开，不等下一次传感器事件',()=>{
  const body=section('let rubGone = null;',"document.addEventListener('rendered', catRub);");
  const listeners=new Set(),ios=[],svg={isConnected:true,classList:{add(){}},firstChild:null,appendChild(){},getBoundingClientRect:()=>({})},card={classList:{contains:()=>false},addEventListener(){}};
  const ctx=vm.createContext({$:(s)=>s==='svg.sh'?svg:card,RUB:{host(){},light(){}},IS_MOBILE:true,GRAV:{on:true,tx:.5,ty:.5},aims:0,reduced:()=>true,
    document:{createElementNS:()=>({setAttribute(){}})},Math,gravNeed(){ctx.need++;},gravDone(){ctx.need--;},need:0,requestAnimationFrame:()=>1,
    addEventListener:(k,f)=>listeners.add(f),removeEventListener:(k,f)=>listeners.delete(f),
    IntersectionObserver:class{constructor(fn){this.fn=fn;ios.push(this);}observe(){}disconnect(){this.off=true;}}});
  vm.runInContext(body,ctx);ctx.catRub();assert.equal(listeners.size,0,'没进屏幕不挂');
  ios[0].fn([{isIntersecting:true}]);assert.equal(listeners.size,1);assert.equal(ctx.need,1);
  ios[0].fn([{isIntersecting:false}]);assert.equal(listeners.size,0);assert.equal(ctx.need,0);
  ios[0].fn([{isIntersecting:true}]);svg.isConnected=false;card._rub=true;ctx.catRub();assert.equal(listeners.size,0);assert.equal(ctx.need,0);assert.equal(ios[0].off,true);
});

function video(st){
  let draws=0,reads=0,pastes=[],dark=false,frames=0;const g={getImageData(){reads++;return {};},putImageData(){},drawImage(...a){pastes.push(a.slice(1));}};
  const ctx=vm.createContext({document:{createElement:()=>({width:0,height:0,getContext:()=>({})})},visible:()=>true,fitCanvas:()=>({w:100,h:50,dpr:1}),IS_MOBILE:false,STATE:{settings:{rm:false}},isDark:()=>dark,Math,drawVis(){draws++;}});
  vm.runInContext(section('function makeVidLoop(cv, kind, st){','/* 平面波形：墨色条 */'),ctx);
  st.onFrame=()=>frames++;const run=ctx.makeVidLoop({getContext:()=>g},'particles',st);
  return {run,get draws(){return draws;},get reads(){return reads;},pastes,get frames(){return frames;},set dark(v){dark=v;}};
}
test('视频暂停后不重画也不写界面，改对比线、换主题才画一帧；时间基准每帧都记，恢复播放不跳',()=>{
  const st={time:1,len:12,playing:false,ab:false,split:.5,variant:'A',seed:1},v=video(st);
  v.run(100);v.run(116);v.run(133);assert.equal(v.draws,1);assert.equal(v.frames,1);
  st.split=.6;v.run(150);assert.equal(v.draws,2);v.dark=true;v.run(166);assert.equal(v.draws,3);v.run(183);assert.equal(v.draws,3);
  st.playing=true;v.run(200);assert.equal(st.time,1+17/1000,'只走了一帧');
});
test('对比模式不做像素回读：A 从离屏画布贴回左半边',()=>{
  const st={time:1,len:12,playing:true,ab:true,split:.5,variant:'A',seed:1},v=video(st);v.run(100);
  assert.equal(v.reads,0);assert.equal(v.draws,2);assert.deepEqual(v.pastes,[[0,0,50,50,0,0,50,50]]);
});

function idle(){
  const loops=new Set(),events={},cleans=[],ctx=vm.createContext({window:{},console,document:{addEventListener:(k,f)=>events[k]=f,removeEventListener:(k,f)=>{if(events[k]===f)delete events[k];}},
    onClean:f=>cleans.push(f),loopAdd:f=>{loops.add(f);return ()=>loops.delete(f);}});
  vm.runInContext(bundle,ctx);return {ctx,loops,events,cleans,run:()=>[...loops].forEach(f=>f(16))};
}
test('静止的画布退出动画循环，敲击、主题、尺寸变化叫醒，离页全部摘掉',()=>{
  const e=idle(),cv={};let busy=2,ticks=0;const wake=e.ctx.idleLoop(cv,()=>{ticks++;return busy-->0;});
  assert.equal(e.loops.size,1);e.run();e.run();e.run();assert.equal(ticks,3);assert.equal(e.loops.size,0);
  wake();assert.equal(e.loops.size,1);e.run();assert.equal(e.loops.size,0);
  e.events.theme();assert.equal(e.loops.size,1);e.run();cv._onObs();e.run();assert.equal(e.loops.size,0);
  wake();e.cleans.forEach(f=>f());assert.equal(e.loops.size,0);assert.equal(cv._onObs,null);assert.deepEqual(Object.keys(e.events),[]);
});

function images(width=393){
  const listeners={},req=[],ctx=vm.createContext({innerWidth:width,Set,Map,Date,POSTS:[],POST:id=>ctx.POSTS.find(p=>p.id===id),
    document:{addEventListener:(k,f)=>listeners[k]=f},API:{on:()=>true,req:async(m,p)=>{req.push(p);return {fresh:true};}},apiPost:()=>({img:'new'}),
    encodeURIComponent});
  vm.runInContext(section('/* 帖子配图是后端原图','function postCard(p, i, list){'),ctx);return {ctx,listeners,req};
}
test('配图懒加载：每栏开头和显示过的立即加载，其余懒加载，示例内容不变',()=>{
  const {ctx,listeners}=images(393),list=Array.from({length:50});
  const eager=[...Array(50).keys()].filter(i=>!ctx.pimgAttr({id:'p'+i,live:true},i,list).includes('lazy'));
  assert.deepEqual(eager,[0,1,2,25,26,27],'手机两栏：第二栏从第 25 张开始');
  assert.equal(images(1920).ctx.pimgAttr({id:'x',live:true},13,list).includes('lazy'),false,'四栏：第二栏开头');
  assert.match(ctx.pimgAttr({id:'p9',live:true},9,list),/loading="lazy" decoding="async"/);
  listeners.load({target:{dataset:{pimg:'p9'}}});assert.equal(ctx.pimgAttr({id:'p9',live:true},9,list).includes('lazy'),false,'加载过的重绘时不闪');
  assert.equal(ctx.pimgAttr({id:'demo'},9,list),'');assert.equal(ctx.pimgAttr({id:'q',live:true}).includes('lazy'),false);
});
test('签名过期的配图重取帖子换地址重试一次，再失败不循环',async()=>{
  const {ctx,listeners,req}=images(),p={id:'p',live:true,img:'old'};ctx.POSTS.push(p);
  const el={dataset:{pimg:'p'},isConnected:true,getAttribute:()=>'old',src:'old'};
  listeners.error({target:el});await tick();assert.equal(el.src,'new');assert.equal(p.img,'new');assert.equal(req.length,1);
  listeners.error({target:el});await tick();assert.equal(req.length,1);
  listeners.error({target:{dataset:{}}});listeners.error({target:{}});assert.equal(req.length,1);
});

function dmList(key){
  const reqs=[];const ctx=vm.createContext({Date,CUR:{key},LDM:{listAt:Date.now(),unread:2},API:{req:async(m,p)=>{reqs.push(p);return {count:ctx.count};}},count:2});
  vm.runInContext(section('async function dmNeedList(){','function dmStart(){'),ctx);return {ctx,reqs};
}
test('私信轮询：别的页面只问未读数，不变不拉列表；变了、满 30 秒、在私信页或合作页才拉',async()=>{
  const a=dmList('home|');assert.equal(await a.ctx.dmNeedList(),false);assert.deepEqual(a.reqs,['/dm/unread']);
  a.ctx.count=3;assert.equal(await a.ctx.dmNeedList(),true);a.ctx.count=1;assert.equal(await a.ctx.dmNeedList(),true,'减少也要拉（别的设备读了）');
  a.ctx.count=2;a.ctx.LDM.listAt=Date.now()-30000;assert.equal(await a.ctx.dmNeedList(),true,'兜底');
  for(const key of ['msg|','msg|u','seller|collab']){const b=dmList(key);assert.equal(await b.ctx.dmNeedList(),true);assert.deepEqual(b.reqs,[]);}
  const first=dmList('home|');first.ctx.LDM.listAt=0;assert.equal(await first.ctx.dmNeedList(),true);assert.deepEqual(first.reqs,[]);
});
test('从别的页面进私信立即补读；软重绘不循环',async()=>{
  const route=(timer,key,fresh=[])=>{const threads=[],paints=[];let rerenders=0;
    const ctx=vm.createContext({API:{on:()=>true},STATE:{role:'user'},LIVE:{u:new Set()},USERS:{u:{}},LDM:{timer,listed:true,look:new Set(),full:new Set(),loading:new Set()},CUR:{key},msgBadge(){},dmPaint(u){paints.push(u);},
      rerender(){rerenders++;ctx.ROUTES.msg('');},dmThreads:async()=>{threads.push(1);return fresh;},ROUTES:{msg:()=>''},apiFail(){}});
    vm.runInContext(section('{ const msg0 = ROUTES.msg;','/* 私信待发送库'),ctx);return {ctx,threads,paints,get rerenders(){return rerenders;}};};
  const a=route(1,'home|',[['u',{}]]);a.ctx.ROUTES.msg('');assert.equal(a.threads.length,1);a.ctx.CUR.key='msg|';await tick();assert.equal(a.rerenders,1);assert.equal(a.threads.length,1,'已在私信页的重绘不再读');
  const same=route(1,'home|');same.ctx.ROUTES.msg('');same.ctx.CUR.key='msg|';await tick();assert.equal(same.rerenders,0,'没有新消息不整页重绘');assert.deepEqual(same.paints,['']);
  const b=route(0,null);b.ctx.ROUTES.msg('u');assert.equal(b.threads.length,0,'启动时交给 dmStart 的第一轮');
});

function boot({account}){
  const feeds=[],shops=[],seen=[];let me=defer();
  const ctx=vm.createContext({URLSearchParams,history:{replaceState(){}},location:{search:'',hash:'#home',pathname:'/'},Event:class{constructor(t){this.type=t;}},Promise,
    document:{dispatchEvent(e){seen.push(e.type);}},CUR:{key:'home|'},ME:'me',LIVE:{feed:{status:'ready'}},STAFF:{},
    API:{tok:{access:'t'},epoch:0,req:(m,p)=>{seen.push(p);return me.promise;}},liveMe(u){seen.push('liveMe');account?.(ctx,u);},liveUser:()=>false,
    liveFeed(){const d=defer();feeds.push(d);seen.push('feed');return d.promise;},liveShop(){const d=defer();shops.push(d);seen.push('shop');return d.promise;},
    apiFail(e){seen.push('fail:'+e.message);},rerender(){seen.push('rerender');},scheduleLiveRefresh(){},msgBadge(){},badge(){},syncFeedState(){},setRole(){}});
  vm.runInContext(section('async function liveBoot(){','/* —— 包装现有操作'),ctx);
  return {ctx,feeds,shops,seen,me};
}
test('首屏内容和 /me 同时发出，账号不变不重读；内容先到也等账号就绪再整页刷新',async()=>{
  const b=boot({}),task=b.ctx.liveBoot();assert.deepEqual(b.seen.slice(0,3),['shop','feed','/me'],'内容不等 /me');
  b.feeds[0].resolve();await tick();assert.equal(b.seen.includes('rerender'),false);
  b.me.resolve({id:'me'});b.shops[0].resolve();await task;assert.equal(b.feeds.length,1);assert.equal(b.shops.length,1);assert(b.seen.includes('rerender'));assert(b.seen.indexOf('liveMe')<b.seen.indexOf('rerender'));
});
test('登录过期或换了账号：先发的请求作废，按现在的身份重读',async()=>{
  for(const change of [ctx=>{ctx.API.epoch++;ctx.API.tok=null;},ctx=>{ctx.ME='other';}]){
    const b=boot({account:change}),task=b.ctx.liveBoot();b.me.resolve({id:'x'});await tick();
    assert.equal(b.feeds.length,2);assert.equal(b.shops.length,2);
    b.feeds[0].reject(Object.assign(new Error('账号已切换'),{code:'cancel'}));b.shops[0].resolve();await tick();assert.equal(b.seen.includes('rerender'),false,'等新的结果');
    b.feeds[1].resolve();b.shops[1].resolve();await task;assert(b.seen.includes('rerender'));
  }
});
