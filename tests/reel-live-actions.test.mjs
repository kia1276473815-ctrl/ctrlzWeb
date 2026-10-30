// 视频流连着后端时的点赞 / 收藏 / 关注提交、#v-<id> 深链补拉单条帖子、评论面板占一条历史；运行真实代码片段，不连接真实账号。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

/* ---------- ① 点赞 / 双击点赞 / 收藏 / 关注 ---------- */
function interactions({on=true}={}){
  const calls=[],fails=[],posts={a:{id:'a',live:true,likes:2,favs:0}},fo={textContent:'关注',cls:new Set(),classList:{toggle(k,v){v ? fo.cls.add(k) : fo.cls.delete(k);}}};
  let bars=0,fail=null;
  const ctx=vm.createContext({Map,Set,Promise,console,ACTIONS:{},ME:'me',STATE:{liked:new Set(),favs:new Set(),follows:new Set()},
    API:{on:()=>on,req:async(method,path)=>{calls.push([method,path]);await Promise.resolve();if(fail)throw fail;return {likeCount:5};}},
    accountSession:()=>()=>true,POST:id=>posts[id],USERS:{u1:{id:'u1',fans:3,c:'pink'},me:{follow:0}},apiFail:e=>fails.push(e),
    $:sel=>sel==='[data-act="rl-like"]' ? {animate(){}} : null,$$:sel=>sel==='.rl-fo[data-id="u1"]' ? [fo] : [],
    IC:{heart:'',heartF:'',save:'',saveF:''},likes:p=>p.likes,CUR:{key:null,post:null},UI:{},patchMoreList(){},patchBookmarks(){},folReset(){},
    RL:{on:true,el:{}},reelBar:()=>bars++,reelCur:()=>posts.a,needLogin:()=>false,liveUser:()=>true,LIVE:{u:new Set(['u1'])},
    toast(){},fxPop(){},burst(){},haptic(){}});
  vm.runInContext(section('function syncInteraction(kind,id,feedback=false){','/* ---------- 浏览器历史'),ctx);
  vm.runInContext(section('function reelLike(force){','function bindReelGestures(el){'),ctx);
  vm.runInContext(section("Object.assign(ACTIONS, {\n  'rl-more'",'/* ================= 转发到私信'),ctx);
  vm.runInContext(section('function wrapAct(name, fn){','const softRefresh'),ctx);
  vm.runInContext(section('const INTERACTIONS = new Map();',"wrapAct('like', async"),ctx);
  vm.runInContext(section("wrapAct('rl-fav', async","wrapAct('at-like'"),ctx);
  const btn={dataset:{id:'u1'},getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})};
  return {ctx,calls,fails,posts,fo,btn,setFail:e=>fail=e,get bars(){return bars;}};
}

test('视频流点赞按钮和双击都经 reelLike 提交到后端，双击已赞不重复提交',async()=>{
  assert.match(section('function bindReelGestures(el){','document.addEventListener'),/reelLike\(true\)/);
  const h=interactions();h.ctx.ACTIONS['rl-like']();await tick();
  assert.deepEqual(h.calls,[['PUT','/posts/a/like']]);assert.equal(h.ctx.STATE.liked.has('a'),true);assert.equal(h.posts.a.likes,4);
  h.ctx.reelLike(true);await tick();assert.equal(h.calls.length,1,'双击已赞的视频只播动效');
  h.ctx.reelLike();await tick();assert.deepEqual(h.calls.at(-1),['DELETE','/posts/a/like']);assert.equal(h.ctx.STATE.liked.has('a'),false);
  h.setFail(Object.assign(new Error('网络错误'),{status:500}));h.ctx.reelLike(true);await tick();
  assert.equal(h.ctx.STATE.liked.has('a'),false,'失败撤回');assert.equal(h.fails.length,1);assert(h.bars>0,'撤回后刷新视频流底栏');
  const proto=interactions({on:false});proto.ctx.ACTIONS['rl-like']();proto.ctx.reelLike(true);await tick();assert.deepEqual(proto.calls,[]);
});

test('视频流收藏和关注接上后端，关注失败撤回时同步视频流里的关注按钮',async()=>{
  const h=interactions();h.ctx.ACTIONS['rl-fav']();await tick();assert.deepEqual(h.calls,[['PUT','/me/favs/post/a']]);
  h.ctx.ACTIONS['rl-fav']();await tick();assert.deepEqual(h.calls.at(-1),['DELETE','/me/favs/post/a']);assert.equal(h.ctx.STATE.favs.has('a'),false);
  h.ctx.ACTIONS['rl-follow'](h.btn);await tick();assert.deepEqual(h.calls.at(-1),['PUT','/users/u1/follow']);assert.equal(h.fo.textContent,'已关注');
  h.setFail(Object.assign(new Error('网络错误'),{status:500}));h.ctx.ACTIONS['rl-follow'](h.btn);assert.equal(h.fo.textContent,'关注');await tick();
  assert.deepEqual(h.calls.at(-1),['DELETE','/users/u1/follow']);assert.equal(h.ctx.STATE.follows.has('u1'),true);
  assert.equal(h.fo.textContent,'已关注');assert.equal(h.fo.cls.has('on'),true);assert.equal(h.fails.length,1);
  const proto=interactions({on:false});proto.ctx.ACTIONS['rl-fav']();proto.ctx.ACTIONS['rl-follow'](proto.btn);await tick();assert.deepEqual(proto.calls,[]);
  assert.equal(proto.ctx.STATE.follows.has('u1'),true);
});

/* ---------- ② 直接打开 #v-<id> ---------- */
function deepLink({on=true,ready=true}={}){
  let pending=null;const opened=[],direct=[],fails=[],reqs=[];
  const location={hash:'#v-target'},CUR={key:null,hash:'#home',post:null};
  const ctx=vm.createContext({Promise,location,CUR,UI:{},POSTS:[],LIVE:{contentReady:ready},RL:{on:false},
    API:{on:()=>on,req:(method,path)=>{reqs.push([method,path]);return new Promise((resolve,reject)=>pending={resolve,reject});}},
    POST:id=>ctx.POSTS.find(p=>p.id===id),inStream:p=>!!p && p.type==='audio',commentRouteRestore(){},commentRouteSuffix:()=>'',
    navReplace:h=>{location.hash=h;},renderBase:(r,arg)=>{CUR.key=r+'|'+arg;CUR.hash='#'+(arg ? r+'-'+arg : r);},closePostLayer(){},closeReels(){},
    openReels:id=>opened.push(id),openPost:id=>direct.push(id),cmtScope:()=>'scope',apiPost:raw=>({id:raw.id,type:'audio',live:true}),
    commentVisible:()=>false,apiFail:e=>fails.push(e),loadLiveCmts(){},commentJumpReady(){}});
  vm.runInContext(section('function parseHash(){','function renderBase('),ctx);
  vm.runInContext(section('  const open0 = openPost;','\n}\n\n/* 设置里切换数据来源'),ctx);
  return {ctx,opened,direct,fails,reqs,location,CUR,get pending(){return pending;}};
}

test('连着后端直接打开不在信息流里的 #v-<id>：先拉单条帖子再进视频流，失败按帖子的处理回到首页',async()=>{
  const h=deepLink();h.ctx.render();assert.deepEqual(h.reqs,[['GET','/posts/target']]);assert.deepEqual(h.opened,[]);assert.equal(h.CUR.key,'home|');
  h.pending.resolve({id:'target'});await tick();assert.deepEqual(h.ctx.POSTS.map(p=>p.id),['target']);assert.deepEqual(h.opened,['target']);
  const miss=deepLink();miss.ctx.render();miss.pending.reject(Object.assign(new Error('不存在'),{status:404}));await tick();
  assert.equal(miss.location.hash,'#home');assert.equal(miss.fails.length,1);assert.deepEqual(miss.opened,[]);
  const cold=deepLink({ready:false});cold.ctx.render();assert.deepEqual(cold.reqs,[],'信息流还在读：等 liveBoot 读完再判断');assert.deepEqual(cold.opened,['target']);
  const proto=deepLink({on:false});proto.ctx.render();assert.deepEqual(proto.reqs,[]);assert.deepEqual(proto.opened,['target']);
});

/* ---------- ③ 评论面板占一条历史 ---------- */
function nav(url){
  const entries=[{url,state:null}];let index=0,renders=0,closes=0;
  const events=new Map(),pending=[],layer={firstElementChild:null},overlays={search:null,lab:null},cm={on:false,classList:{remove(k){if(k==='on')cm.on=false;}},setAttribute(){}};
  const current=()=>new URL(entries[index].url),emit=type=>{for(const f of events.get(type) || [])f();};
  const changed=(before,after)=>{if(new URL(before).hash!==new URL(after).hash)pending.push(()=>emit('hashchange'));};
  const history={get state(){return entries[index].state;},get length(){return entries.length;},
    replaceState(state,_t,next){entries[index]={state:structuredClone(state),url:next==null ? current().href : new URL(next,current()).href};},
    pushState(state,_t,next){const u=next==null ? current().href : new URL(next,current()).href;entries.splice(index+1);entries.push({state:structuredClone(state),url:u});index++;},
    go(delta){const next=index+delta;if(next<0 || next>=entries.length || next===index)return;const before=current().href;index=next;pending.push(()=>emit('popstate'));changed(before,current().href);},
    back(){this.go(-1);}};
  const location={get hash(){return current().hash;},set hash(h){const before=current().href,next=new URL(h.startsWith('#') ? h : '#'+h,current()).href;if(before===next)return;history.pushState(null,'',next);changed(before,next);},
    replace(next){const before=current().href;entries[index]={url:new URL(next,current()).href,state:null};changed(before,current().href);}};
  const ctx=vm.createContext({location,history,UI:{shop:{cat:'all',sub:'all'}},CUR:{hash:'#home',post:null},ACTIONS:{},ME:'me',
    RL:{on:true,cm:false,el:{classList:{remove(){}}}},P:()=>null,isOverlay:h=>/^#?(post|v)-/.test(h),
    document:{body:{},documentElement:{scrollHeight:1000}},MutationObserver:class {observe(){}},
    $:sel=>sel==='#layer' ? layer : sel==='#srch' ? overlays.search : sel==='#vlov .sov' ? overlays.lab : sel==='#reels .rl-cm.on' ? (cm.on ? cm : null) : sel==='.rl-cm' ? cm : null,
    $$:()=>[],getComputedStyle:el=>({zIndex:el.z ?? 7}),closeSheet(){layer.firstElementChild=null;},closeSearch(){overlays.search=null;},vlClose(){overlays.lab=null;},
    addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},
    scrollY:0,innerHeight:800,scrollTo(){},requestAnimationFrame:fn=>fn(),navDir:()=>null,pageSwap:(_d,fn)=>fn(),render:()=>{renders++;},
    inputDraftSave(){},closeReels:()=>{closes++;ctx.RL.on=false;}});
  vm.runInContext(section('const HST = ','/* 顶栏：往下滑'),ctx);
  vm.runInContext(section('function closeReelCm(){','Object.assign(ACTIONS, {'),ctx);
  const close=source.match(/\n  'rl-close': (\(\) => \{[^\n]+\}),\n/);assert(close);vm.runInContext(`ACTIONS['rl-close'] = ${close[1]};`,ctx);
  ctx.initHistory();
  const flush=()=>{let n=0;while(pending.length){assert(++n<40,'导航事件不得循环');pending.shift()();}};
  // 和 openReelCm 一样：加上 on 之后同步历史
  const open=()=>{ctx.RL.cm=true;cm.on=true;ctx.reelCmSync();};
  return {ctx,cm,history,location,flush,open,read:code=>vm.runInContext(code,ctx),get index(){return index;},get renders(){return renders;},get closes(){return closes;}};
}

test('视频流评论面板占一条历史：返回先关评论，点收起 / Esc / 换一条退掉这条历史且不换页',()=>{
  assert.match(section('function openReelCm(focus){','function closeReelCm(){'),/classList\.add\('cm-on'\); reelCmSync\(\);/);
  const a=nav('https://example.test/#v-a');assert.equal(a.index,1);
  a.open();assert.equal(a.index,2);assert.equal(a.read('HST.ov'),true);
  a.history.back();a.flush();assert.equal(a.cm.on,false);assert.equal(a.ctx.RL.cm,false);assert.equal(a.index,1);assert.equal(a.location.hash,'#v-a');assert.equal(a.renders,0);assert.equal(a.read('HST.ov'),false);
  a.open();a.ctx.closeReelCm();a.flush();assert.equal(a.index,1,'点收起 / Esc 退掉评论那条历史');assert.equal(a.renders,0);assert.equal(a.read('HST.ov'),false);
  // 评论开着时换到下一条（goReel 原地换网址后关评论）：落回下面那条并沿用新网址，不触发换页
  a.open();a.history.replaceState(a.history.state,'','#v-b');a.read("HST.stk[HST.d] = '#v-b'");a.ctx.closeReelCm();a.flush();
  assert.equal(a.index,1);assert.equal(a.location.hash,'#v-b');assert.equal(a.renders,0);assert.equal(a.read('HST.stk[HST.d]'),'#v-b');
  a.history.back();a.flush();assert.equal(a.index,0);assert.equal(a.location.hash,'#home');
});

test('评论开着时点视频流返回键：先退掉评论那条，再退出视频流回到首页',()=>{
  const a=nav('https://example.test/#v-a');a.open();assert.equal(a.index,2);
  a.ctx.ACTIONS['rl-close']();a.flush();assert.equal(a.closes,1);assert.equal(a.index,0);assert.equal(a.location.hash,'#home');assert.equal(a.read('HST.then'),null);
  const b=nav('https://example.test/#v-a');b.ctx.ACTIONS['rl-close']();b.flush();assert.equal(b.closes,1);assert.equal(b.index,0);
});

test('评论面板是最上层时视频流键盘仍可用：Esc 只收起评论，上面还有面板时不处理',()=>{
  const start=source.indexOf("document.addEventListener('keydown', e => {\n  if (!RL.on"),end=source.indexOf('\n});',start)+4;assert(start>=0 && end>start);
  const calls=[];let cb;const ctx=vm.createContext({document:{addEventListener:(_n,fn)=>cb=fn},RL:{on:true,cm:true},HST:{ov:true},top:{kind:'rlcm'},topOverlay:()=>ctx.top,
    closeReelCm:()=>calls.push('cm-close'),reelToggle:()=>calls.push('toggle'),ACTIONS:{'rl-close':()=>calls.push('reel-close')}});
  vm.runInContext(source.slice(start,end),ctx);
  const send=key=>{const e={key,defaultPrevented:false,isComposing:false,keyCode:0,target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;}};cb(e);return e;};
  assert.equal(send('Escape').defaultPrevented,true);send(' ');assert.deepEqual(calls,['cm-close','toggle']);
  ctx.top={kind:'layer'};send('Escape');send(' ');assert.deepEqual(calls,['cm-close','toggle']);
});
