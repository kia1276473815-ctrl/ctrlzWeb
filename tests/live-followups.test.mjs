// 连着后端时的几处收尾：令牌快过期先刷新、关注流只信服务器、主页不被信息流刷新打回「正在加载」、后台筛选不闪、搜索框保住焦点。只用页面里的真实代码，接口全部隔离。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const line=start=>source.split('\n').find(l=>l.startsWith(start));

/* —— 令牌 —— */
const now=()=>Math.floor(Date.now()/1000),jwt=(exp,iat=exp-900)=>'h.'+Buffer.from(JSON.stringify({exp,iat})).toString('base64url')+'.s';
function api(access,reply=path=>path==='/auth/refresh'?{accessToken:jwt(now()+900),refreshToken:'r2'}:{items:[]}){
  const sent=[],gate={wait:null},out={sent,gate,logouts:0};
  const res=j=>({status:200,ok:true,headers:{get:()=>'application/json'},json:async()=>j});
  const ctx=vm.createContext({console,AbortController,setTimeout,clearTimeout,URLSearchParams,atob,store:{get:()=>null,set(){}},location:{search:'',origin:'x',pathname:'/',hash:''},document:{querySelector:()=>null},history:{replaceState(){}},
    fetch:async(url,init)=>{const path=url.slice(1);if(path==='/auth/refresh' && gate.wait)await gate.wait;sent.push([path,init.headers.Authorization]);return res(reply(path));},liveLoggedOut(){out.logouts++;}});
  vm.runInContext(section('function requestTask(','const API = {'),ctx);
  vm.runInContext(section('const API = {','API.init();')+';API.base="b";API.epoch=0;API.tok={access:'+JSON.stringify(access)+',refresh:"r1"};this.API=API;',ctx);
  out.API=ctx.API;return out;
}
test('令牌过期：几个请求共用一次刷新，内容请求带新令牌发出（optionalUser 不回 401，发出去就是游客结果）',async()=>{
  const old=jwt(now()-5),a=api(old),wait=defer();a.gate.wait=wait.promise;
  const first=a.API.req('GET','/posts?tab=rec&limit=50'),second=a.API.req('GET','/products');await tick();
  assert.deepEqual(a.sent,[],'刷新完成前不发内容请求');wait.resolve();await Promise.all([first,second]);
  assert.deepEqual(a.sent.map(x=>x[0]),['/auth/refresh','/posts?tab=rec&limit=50','/products']);
  assert.equal(a.sent[1][1],'Bearer '+a.API.tok.access);assert.notEqual(a.API.tok.access,old);
});
test('令牌还有效、快过期、不是 JWT：只有快过期才先刷新',async()=>{
  const fresh=api(jwt(now()+600));await fresh.API.req('GET','/posts');assert.deepEqual(fresh.sent.map(x=>x[0]),['/posts']);
  const soon=api(jwt(now()+10));await soon.API.req('GET','/posts');assert.deepEqual(soon.sent.map(x=>x[0]),['/auth/refresh','/posts']);
  const opaque=api('not-a-jwt');await opaque.API.req('GET','/posts');assert.deepEqual(opaque.sent.map(x=>x[0]),['/posts'],'解析不了交给 401 流程');
});
test('本机时钟快一天：刷新一次后按服务器时间算，不会每个请求都刷新',async()=>{
  const server=now()-86400,a=api(jwt(server+500),path=>path==='/auth/refresh'?{accessToken:jwt(server+900,server),refreshToken:'r2'}:{items:[]});
  await a.API.req('GET','/posts');await a.API.req('GET','/products');assert.deepEqual(a.sent.map(x=>x[0]),['/auth/refresh','/posts','/products']);
});

/* —— 关注流 —— */
function home({fol,follows=[],off,me='me',mine=true}={}){
  const posts=[{id:'p1',author:'near'},{id:'p2',author:'far'}];
  const ctx=vm.createContext({UI:{homeTab:'fol'},ME:me,LIVE:{fol,folMe:'me',folBusy:1,u:new Set(),...(off?{folOff:new Set(off)}:{})},POSTS:posts,POST:id=>posts.find(p=>p.id===id),STATE:{settings:{pers:true},follows:new Set(follows),blocks:new Set()},USERS:{},
    liveUser:()=>mine,liveFol(){},blocked:()=>false,byTime:x=>x,API:{on:()=>true},onMount(){},mountWaves(){},ISSUE_NO:'NO.1',annBar:()=>'',postCard:p=>`[${p.id}]`,folStatusHtml:()=>'',feedStatusHtml:()=>'',skMason:()=>'<sk>',esc:String,ROUTES:{}});
  vm.runInContext(section('ROUTES.home = () => {','ROUTES.feed = ROUTES.home;'),ctx);return ctx;
}
test('关注超过 50 人：关注流里排在后面的作者照样显示，只排除本地刚取关的',()=>{
  const all=home({fol:['p1','p2'],follows:['near']}).ROUTES.home();assert.match(all,/\[p1\]/);assert.match(all,/\[p2\]/);
  const off=home({fol:['p1','p2'],follows:['near'],off:['far']}).ROUTES.home();assert.match(off,/\[p1\]/);assert.doesNotMatch(off,/\[p2\]/);
  const back=home({fol:['p1','p2'],follows:['near','far'],off:['far']}).ROUTES.home();assert.match(back,/\[p2\]/,'取关失败回滚 / 重新关注后恢复');
  const guest=home({fol:undefined,follows:[],mine:false}).ROUTES.home();assert.doesNotMatch(guest,/\[p/,'没登录仍按本地关注过滤');
});
test('关注页读取中：已经关注了人时标题不显示「先关注几位创作者」',()=>{
  assert.match(home({fol:undefined,follows:['near']}).ROUTES.home(),/还可以关注/);
  assert.match(home({fol:undefined,follows:[]}).ROUTES.home(),/先关注几位创作者/);
});
function folFeed({state=true,patched=true}={}){
  const counts={renders:0,patches:0},reply=defer(),sk={removed:0,remove(){this.removed++;}},after=[];let found=null;
  const parent={};const st=state?{innerHTML:'旧',parentElement:parent,insertAdjacentHTML:(w,h)=>after.push(h)}:null;
  const ctx=vm.createContext({CUR:{key:'home|',post:null},UI:{homeTab:'fol'},ME:'me',LIVE:{},POSTS:[],POST:()=>null,API:{base:'b',req:()=>reply.promise},apiPost:x=>x,liveUser:()=>true,esc:String,apiFail(){},
    $:(s,root)=>s==='#app .hfeed .fol-state'?st:root===parent?found:null,$$:()=>[sk],patchMoreList:()=>{counts.patches++;return patched;},rerender:()=>counts.renders++});
  vm.runInContext(section('function folStatusHtml(){',"ACTIONS['fol-retry']"),ctx);
  return {ctx,counts,reply,sk,after,st,show:x=>{found=x;}};
}
test('关注流读完不整页重画：拿掉骨架、原地补列表，空列表补空状态（推荐卡收起动画不被切断）',async()=>{
  const a=folFeed(),task=a.ctx.liveFol();a.reply.resolve({items:[],next:null});await task;
  assert.equal(a.counts.renders,0);assert.equal(a.counts.patches,1);assert.equal(a.sk.removed,1);assert.equal(a.st.innerHTML,'');assert.match(a.after[0],/关注的人还没有发东西/);
  const b=folFeed();b.show({});const t=b.ctx.liveFol();b.reply.resolve({items:[{id:'x',author:'a'}],next:null});await t;assert.equal(b.after.length,0,'已有列表 / 空状态时不重复插');
  const c=folFeed(),e=c.ctx.liveFol();c.reply.reject(new Error('断网'));await e;assert.equal(c.counts.renders,0);assert.match(c.st.innerHTML,/fol-retry/);assert.equal(c.after.length,0);
  const d=folFeed({state:false}),f=d.ctx.liveFol();d.reply.resolve({items:[],next:null});await f;assert.equal(d.counts.renders,1,'关注页还没画出来就走整页');
});
test('帖子先进关注流、又在推荐后续页读到：解除 folOnly',()=>{
  const old={id:'a',folOnly:true},ctx=vm.createContext({POSTS:[old],apiPost:x=>x});vm.runInContext(line('const addPosts =').replace('const addPosts','this.addPosts'),ctx);
  ctx.addPosts([{id:'a'},{id:'b'}]);assert.equal(old.folOnly,undefined);assert.deepEqual(ctx.POSTS.map(p=>p.id),['a','b']);
});

/* —— 信息流刷新不动当前主页 —— */
function feed(key,{prof,pnext,posts=[]}={}){
  const pending=[],POSTS=[...posts];
  const ctx=vm.createContext({LIVE:{pend:{},feed:{status:'ready',seq:0},prof,pnext},POSTS,POST:id=>POSTS.find(p=>p.id===id),ME:'me',CUR:{key,post:null},ACTIONS:{},UI:{},API:{base:'b',on:()=>true,req:()=>{const d=defer();pending.push(d);return d.promise;}},apiPost:x=>x,esc:String,$:()=>null,$$:()=>[],patchMoreList(){},rerender(){},apiFail(){}});
  vm.runInContext(section('function feedStatusHtml(){','async function liveMeExtras(){'),ctx);return {ctx,pending};
}
test('正在看的主页：信息流刷新后作品、状态、游标都留着，其它主页下次重读，还在读的不打断',async()=>{
  const f=feed('user|u',{prof:{u:'ok',v:'ok',w:'loading'},pnext:{u:'next',v:'old'},posts:[{id:'mine',author:'u'},{id:'both',author:'u'},{id:'gone',author:'v'}]});
  const task=f.ctx.liveFeed();f.pending[0].resolve({items:[{id:'both',author:'u'},{id:'rec',author:'z'}],next:null});await task;
  assert.deepEqual(f.ctx.POSTS.map(p=>p.id),['both','rec','mine'],'当前主页的帖子留着，重复的用新的');assert.equal(f.ctx.POSTS[2].folOnly,true,'留下的不进「推荐」');assert.equal(f.ctx.POSTS[0].folOnly,undefined);
  assert.deepEqual({...f.ctx.LIVE.prof},{u:'ok',w:'loading'});assert.deepEqual({...f.ctx.LIVE.pnext},{u:'next'});
});
test('不在主页上：信息流刷新清掉所有主页缓存',async()=>{
  const f=feed('home|',{prof:{v:'ok'},pnext:{v:'old'},posts:[{id:'gone',author:'v'}]}),task=f.ctx.liveFeed();f.pending[0].resolve({items:[],next:null});await task;
  assert.deepEqual(f.ctx.POSTS.map(p=>p.id),[]);assert.deepEqual({...f.ctx.LIVE.prof},{});assert.deepEqual({...f.ctx.LIVE.pnext},{});
});
test('刚登录（stale）：主页接着显示，后台重读关注状态，失败也不换成错误页',async()=>{
  const pending=[];let renders=0;
  const ctx=vm.createContext({Promise,ROUTES:{user:id=>'原主页:'+id},ME:'me',LIVE:{prof:{u:'stale'}},ACTIONS:{},esc:String,POSTS:[],STATE:{follows:new Set()},API:{on:()=>true,req:()=>{const d=defer();pending.push(d);return d.promise;}},apiFail(){},apiUser(){},apiPost:x=>x,rerender:()=>renders++,openPost(){}});
  vm.runInContext(section('{ const userRoute0 = ROUTES.user;','  const open0 = openPost;')+'}',ctx);
  assert.equal(ctx.ROUTES.user('u'),'原主页:u');assert.equal(pending.length,2);ctx.ROUTES.user('u');assert.equal(pending.length,2,'重绘不重复读');
  pending[0].resolve({id:'u',isFollowing:true,followers:1,following:2});pending[1].resolve({items:[],next:null});await tick();assert.equal(ctx.STATE.follows.has('u'),true);assert.equal(renders,1);assert.equal(ctx.LIVE.prof.u,'ok');
  ctx.LIVE.prof.u='stale';ctx.ROUTES.user('u');pending.slice(2).forEach(d=>d.reject(new Error('断网')));await tick();assert.equal(ctx.LIVE.prof.u,'ok');assert.equal(ctx.ROUTES.user('u'),'原主页:u');
});

/* —— 商品直达 —— */
function item(){
  const pending=[];let renders=0;
  const ctx=vm.createContext({Map,Set,Promise,ME:'me',CUR:{key:'item|x'},LSHOP:{},ACTIONS:{},ROUTES:{item:id=>'原页面:'+id},P:()=>null,esc:String,API:{base:'b',on:()=>true,req:(m,p)=>{const d=defer();pending.push(d);return d.promise;}},apiProduct:d=>d,rerender:()=>renders++,saleLeft:()=>''});
  vm.runInContext(section('{ const it3 = ROUTES.item;',"wrapAct('sp-manage'"),ctx);return {ctx,pending,get renders(){return renders;}};
}
test('商品读取途中换账号：不停在「正在加载」，取消也不算失败，重绘时按现在的身份重取',async()=>{
  const a=item();a.ctx.ROUTES.item('x');a.ctx.ME='other';a.pending[0].resolve({id:'x'});await tick();assert.equal(a.ctx.LSHOP.one.x,undefined);assert.equal(a.renders,1);a.ctx.ROUTES.item('x');assert.equal(a.pending.length,2);
  const b=item();b.ctx.ROUTES.item('x');b.pending[0].reject(Object.assign(new Error('账号已切换'),{code:'cancel'}));await tick();assert.doesNotMatch(b.ctx.ROUTES.item('x'),/商品读取失败/);assert.equal(b.pending.length,2);
});

/* —— 官方通知 —— */
test('官方通知轮询：最新一条和未读数没变只问一行，变了才拉全量；首轮直接拉全量',async()=>{
  const paths=[];let list=[{id:'n1',title:'t',body:'b',createdAt:'2026-10-12T00:00:00Z',read:false}],unread=1;
  const ctx=vm.createContext({Map,JSON,Date,ME:'me',ADM:{inbox:{me:[]}},CUR:{key:'home|'},LDM:{},API:{req:async(m,p)=>{paths.push(p);return {items:p.endsWith('limit=1')?list.slice(0,1):list,unread};}},dmSession:()=>()=>true,msgBadge(){},dmPaint(){}});
  vm.runInContext(section('async function sysLoad(){','{ const poll0 = dmPoll;'),ctx);
  await ctx.sysLoad();assert.deepEqual(paths,['/notifications?limit=50']);
  await ctx.sysLoad();assert.deepEqual(paths.slice(1),['/notifications?limit=1']);
  unread=0;await ctx.sysLoad();assert.deepEqual(paths.slice(2),['/notifications?limit=1','/notifications?limit=50'],'别的设备标已读');
  list=[{...list[0],id:'n2'},...list];await ctx.sysLoad();assert.equal(ctx.ADM.inbox.me[0].id,'n2');
  ctx.LDM.sysMark=null;paths.length=0;await ctx.sysLoad();assert.deepEqual(paths,['/notifications?limit=50'],'换账号后重新来');
});

/* —— 后台 —— */
function admin(extra={}){
  const shops=[];let draws=0;
  const ctx=vm.createContext({console,Promise,Map,Set,JSON,UI:{adf:{}},ACTIONS:{},ADMV:{audit:()=>'原型'},CUR:{key:'admin|'},API:{on:()=>true},STAFF:{epoch:1},ADM_ROLES:{},IC:{dl:''},PAY_N:{},
    LADM:{busy:{},errors:{},reads:{},requests:{}},ladmShop(k){shops.push(k);ctx.LADM.busy[k]=true;},ladmQuiet(){},ladmWait:t=>'等待:'+t,ladmLoad(){},adH:(t,s,a)=>`<h>${t}|${s}|${a}</h>`,adQ:()=>'[搜索]',adSeg:()=>'[筛选]',stTag:a=>a,yuan2:x=>'¥'+x,f2y:x=>x,fq:()=>'',
    fmtDT:String,fmtDay:String,esc:String,uname:String,admCan:()=>true,csvDownload(){},wrapAct(){},staffSession:()=>()=>true,apiFail(){},rerender:()=>draws++,...extra});
  return {ctx,shops,get draws(){return draws;}};
}
const row=(no,status)=>({no,title:'T'+no,status,price:1,buyer:{name:'B'},seller:{name:'S'},createdAt:'2026-10-01'});
test('订单流水换状态：旧行、搜索和筛选条留着，后台读新的；失败在表格下方给重试',()=>{
  const a=admin();vm.runInContext(section('const LORD_S =',"wrapAct('od-csv'"),a.ctx);
  Object.assign(a.ctx.LADM,{orders:{items:[row('1','paid'),row('2','refunded')],sum:{gmv:9,cash:8,voucher:1}},ordSt:'all'});
  assert.match(a.ctx.liveOrdersView(),/成交 ¥9/);a.ctx.UI.adf.os='refunded';let html=a.ctx.liveOrdersView();
  assert.deepEqual(a.shops,['orders']);assert.match(html,/\[搜索\]/);assert.match(html,/\[筛选\]/);assert.match(html,/T2/);assert.doesNotMatch(html,/T1/,'旧行先按新状态在本地筛');
  a.ctx.liveOrdersView();assert.equal(a.shops.length,1,'重绘不重复请求');
  a.ctx.LADM.busy.orders=false;a.ctx.LADM.errors.orders=new Error('断网');html=a.ctx.liveOrdersView();assert.match(html,/data-act="lord-retry"/);assert.match(html,/\[筛选\]/);assert.equal(a.shops.length,1,'失败不自动重试');
  a.ctx.UI.adf.os='all';html=a.ctx.liveOrdersView();assert.equal(a.ctx.LADM.errors.orders,undefined,'切回已读到的状态：报错作废');assert.equal(a.shops.length,1);assert.match(html,/T1/);
});
test('订单流水选「已退款 / 待付款」：沿用上次的合计，没有就显示 —，不显示 ¥0',()=>{
  const a=admin();vm.runInContext(section('const LORD_S =',"wrapAct('od-csv'"),a.ctx);a.ctx.UI.adf.os='refunded';
  Object.assign(a.ctx.LADM,{orders:{items:[row('2','refunded')],sum:{gmv:0,cash:0,voucher:0}},ordSt:'refunded'});
  let html=a.ctx.liveOrdersView();assert.match(html,/成交 — · 实收现金 — · 代金券抵扣 —/);assert.doesNotMatch(html,/¥0/);
  a.ctx.LADM.ordSum={gmv:7,cash:6,voucher:1};html=a.ctx.liveOrdersView();assert.match(html,/成交 ¥7 · 实收现金 ¥6/);
  a.ctx.UI.adf.os='paid';Object.assign(a.ctx.LADM,{orders:{items:[row('1','paid')],sum:{gmv:5,cash:5,voucher:0}},ordSt:'paid'});assert.match(a.ctx.liveOrdersView(),/成交 ¥5/);assert.equal(a.ctx.LADM.ordSum.gmv,5);
});
test('操作日志换成员：旧行和筛选条留着；切回已读到的成员时另一位的请求作废',async()=>{
  const reqs=[],a=admin();a.ctx.STAFF.req=(m,p)=>{const d=defer();reqs.push({...d,path:p});return d.promise;};
  vm.runInContext(section('async function ladmGet(','/* 处理完一条'),a.ctx);vm.runInContext(section('{ const lg0 = ADMV.audit;','/* 启动：站点配置以服务器为准'),a.ctx);
  Object.assign(a.ctx.LADM,{staff:[{id:'s1',name:'甲'}],audit:[{id:'a1',staffName:'乙',action:'旧行',targetId:'x',createdAt:'2026-10-01'}],lgv:'all',requests:{audit:{who:'all'}}});
  a.ctx.UI.adf.lg='s1';let html=a.ctx.ADMV.audit();assert.match(html,/旧行/);assert.match(html,/\[筛选\]/);assert.match(reqs[0].path,/staffId=s1/);
  a.ctx.UI.adf.lg='all';html=a.ctx.ADMV.audit();assert.match(html,/旧行/);assert.equal(reqs.length,1);
  reqs[0].resolve({items:[{id:'a2',staffName:'甲',action:'新行',targetId:'y',createdAt:'2026-10-02'}],next:null});await tick();assert.equal(a.ctx.LADM.audit[0].id,'a1','迟到的结果不覆盖');assert.equal(a.ctx.LADM.lgv,'all');
  a.ctx.UI.adf.lg='s1';a.ctx.ADMV.audit();assert.equal(reqs.length,2);reqs[1].resolve({items:[{id:'a2',staffName:'甲',action:'新行',targetId:'y',createdAt:'2026-10-02'}],next:null});await tick();assert.match(a.ctx.ADMV.audit(),/新行/);
});
test('「已被别人处理」：举报、头像回 400 handled，裁决回 400 bad_state，都按服务器状态刷新这一行',async()=>{
  const run=async(load,act,err,check)=>{let done=0,quiet=0;const fails=[],ctx=vm.createContext({console,Promise,Map,Set,UI:{},ACTIONS:{},LADM:{rpv:'open'},STAFF:{req:async()=>{throw err;}},staffSession:()=>()=>true,admGuard:()=>true,admMe:()=>({name:'值'}),apiFail:e=>fails.push(e),ladmDone:()=>done++,ladmQuiet:()=>quiet++,toast(){},closeSheet(){},fxPop(){},
      $:()=>({value:'说明',dataset:{v:'release'},focus(){}}),CO_BY:()=>({id:'c',live:true}),y2f:x=>x,sheet(){},rsnSheet(){},wrapAct:(n,fn)=>{ctx.ACTIONS[n]=b=>fn(()=>{},b);}});
    load(ctx);await act(ctx);assert.equal(fails.length,1);check(done,quiet);};
  const handled=Object.assign(new Error('这条已经处理过了'),{status:400,code:'handled'}),state=Object.assign(new Error('这单已完成原裁决'),{status:400,code:'bad_state'}),other=Object.assign(new Error('说明太长'),{status:400,code:'bad_request'});
  const lrp=ctx=>vm.runInContext(section('const lrpDone =','/* ================= 操作日志'),ctx),av=ctx=>vm.runInContext(section('ACTIONS.lavq =','/* —— 收藏 —— */'),ctx),dp=ctx=>vm.runInContext(section("wrapAct('dp-go',",'/* ================= 敏感词'),ctx);
  const b=(v='1')=>({dataset:{id:'x',v},disabled:false,isConnected:true});
  await run(lrp,ctx=>ctx.ACTIONS['lrp-go'](b('resolved')),handled,done=>assert.equal(done,1));await run(lrp,ctx=>ctx.ACTIONS['lrp-go'](b('resolved')),other,done=>assert.equal(done,0));
  await run(av,async ctx=>{ctx.ACTIONS.lavq(b());await tick();},handled,done=>assert.equal(done,1));
  await run(dp,ctx=>ctx.ACTIONS['dp-go'](b()),state,(done,quiet)=>{assert.equal(done,1);assert.equal(quiet,1);});await run(dp,ctx=>ctx.ACTIONS['dp-go'](b()),other,done=>assert.equal(done,0));
});
test('搜索词截断落在 emoji 中间：不留半个字符，encodeURIComponent 不抛错，长度仍不超过后端上限',()=>{
  const ctx=vm.createContext({UI:{adq:{content:'a'.repeat(39)+'😀'},adf:{}}});vm.runInContext(section('function adminContentQuery(kind){',"ACTIONS['lct-more']"),ctx);
  const q=decodeURIComponent(ctx.adminContentQuery('prod').split('&q=')[1]);assert.equal(q,'a'.repeat(39));
  ctx.UI.adq.content='a'.repeat(38)+'😀';assert.equal(decodeURIComponent(ctx.adminContentQuery('prod').split('&q=')[1]).length,40);
});
test('后台搜索框：整页重绘（服务器结果回来）后焦点和光标回到新输入框，别的输入框不碰',()=>{
  const fresh={focus(o){this.opt=o;},setSelectionRange(a,b){this.sel=[a,b];}},app={},box={hidden:false,classList:{toggle(){}}};
  const ctx=vm.createContext({CLEAN:[],MOUNTS:[],GEN:{owner:''},ROUTES:{admin:()=>'x'},scrollY:0,CUR:{},NAVX:{},document:{activeElement:{dataset:{adq:'content'},selectionStart:2,selectionEnd:3},documentElement:{dataset:{}},dispatchEvent(){}},CustomEvent:class{},Event:class{},rollNums(){},fitText(){},syncLive(){},msgBadge(){},navInk(){},fabUpdate(){},revealActive(){},scrollTo(){},parentOf:()=>null,ME:'me',$$:()=>[],
    $:(s,root)=>s==='#app'?app:s==='[data-adq="content"]'?(assert.equal(root,app),fresh):box});
  vm.runInContext(section('function renderBase(r, arg, soft){','/* 横向滚动的页签'),ctx);
  ctx.renderBase('admin','content',true);assert.deepEqual(fresh.sel,[2,3]);assert.equal(fresh.opt.preventScroll,true);
  fresh.sel=null;ctx.document.activeElement={dataset:{}};ctx.renderBase('admin','content',true);assert.equal(fresh.sel,null);
});
