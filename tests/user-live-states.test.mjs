// 用户端连着后端时的状态：关注流翻页、商品直达、官方通知轮询、收藏后台补取、读取失败可重试、发验证码防连点；运行真实代码片段，接口全部隔离。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('首页下一页：「关注」只用关注流游标，游客不翻页，「推荐」用推荐流游标',()=>{
  const ctx=vm.createContext({UI:{homeTab:'fol'},LIVE:{next:'rec-1',fnext:'fol-1',fol:['a'],folMe:'me'},ME:'me',liveUser:()=>true});
  vm.runInContext(source.split('\n').find(l=>l.startsWith('const homeNext =')),ctx);
  const next=()=>vm.runInContext('homeNext()',ctx);
  assert.equal(next(),'fol-1');
  ctx.liveUser=()=>false;assert.equal(next(),null,'游客的关注页签不去翻推荐流');
  ctx.liveUser=()=>true;ctx.LIVE.fol=undefined;assert.equal(next(),null,'关注流还没读到时没有下一页');
  ctx.UI.homeTab='rec';assert.equal(next(),'rec-1');
});

test('moreLoad 在「关注」翻 tab=following，换账号后的迟到响应不写入',async()=>{
  const requests=[],added=[];let reply=defer();
  const ctx=vm.createContext({CUR:{key:'home|'},UI:{homeTab:'fol',shop:{},userTab:'works'},STATE:{settings:{pers:true},follows:new Set(),blocks:new Set()},ME:'me',
    LIVE:{next:'rec-1',fnext:'fol-1',fol:['a'],folMe:'me',folSeq:3},LSHOP:{},MORE:{busy:{}},API:{req:(m,p)=>{requests.push(p);return reply.promise;}},
    homeNext:()=>ctx.LIVE.fnext,folAdd:items=>added.push(...items),addPosts(){},patchMoreList:()=>true,rerender(){},apiFail(){},$:()=>null});
  vm.runInContext(section('const moreState = () =>','function patchMoreList('),ctx);
  vm.runInContext(section('async function moreLoad(k){','ACTIONS.more ='),ctx);
  let task=ctx.moreLoad('home');reply.resolve({items:[{id:'b'}],next:null});await task;
  assert.deepEqual(requests,['/posts?tab=following&limit=30&cursor=fol-1']);assert.equal(ctx.LIVE.fnext,null);assert.equal(added.length,1);assert.equal(ctx.LIVE.next,'rec-1','推荐流游标不动');
  ctx.LIVE.fnext='fol-2';reply=defer();task=ctx.moreLoad('home');ctx.LIVE.folSeq=4;reply.resolve({items:[{id:'c'}],next:'x'});await task;
  assert.equal(added.length,1);assert.equal(ctx.LIVE.fnext,'fol-2');
});

test('商品不在本地时单独取：加载中占位、404 回到原来的不存在页、网络错误可重试',async()=>{
  const products=new Map(),pending=[];let renders=0;
  const ctx=vm.createContext({Map,Set,Promise,ME:'me',CUR:{key:'item|x'},LSHOP:{},ACTIONS:{},ROUTES:{item:id=>'原页面:'+id},P:id=>products.get(id),esc:String,
    API:{base:'b',on:()=>true,req:(m,p)=>{const d=defer();pending.push({path:p,...d});return d.promise;}},apiProduct:d=>{products.set(d.id,d);return d;},rerender:()=>renders++,saleLeft:()=>''});
  vm.runInContext(section('{ const it3 = ROUTES.item;',"wrapAct('sp-manage'"),ctx);
  assert.match(ctx.ROUTES.item('x'),/正在加载/);ctx.ROUTES.item('x');assert.equal(pending.length,1,'重绘不重复请求');assert.equal(pending[0].path,'/products/x');
  pending[0].reject(Object.assign(Error('offline'),{code:'network'}));await tick();assert.equal(renders,1);
  const err=ctx.ROUTES.item('x');assert.match(err,/data-act="item-retry"/);assert.doesNotMatch(err,/原页面/);
  ctx.ACTIONS['item-retry']({dataset:{id:'x'}});assert.equal(renders,2);ctx.ROUTES.item('x');assert.equal(pending.length,2);
  pending[1].reject(Object.assign(Error('gone'),{status:404}));await tick();assert.equal(ctx.ROUTES.item('x'),'原页面:x');assert.equal(pending.length,2,'不存在的商品不反复请求');
  ctx.CUR.key='item|y';ctx.ROUTES.item('y');pending[2].resolve({id:'y'});await tick();assert.equal(ctx.ROUTES.item('y'),'原页面:y');assert(products.get('y').pvAt>0,'刚取过不再重复取预览');
});

test('liveShop 刷新保留单独取来的商品和正打开的商品',async()=>{
  const d=defer(),PRODUCTS=[{id:'solo'},{id:'open'},{id:'drop'}];
  const ctx=vm.createContext({Map,Set,Promise,PRODUCTS,ME:'me',CUR:{key:'item|open'},LSHOP:{feed:{seq:0},one:{solo:'ok'}},API:{base:'b',req:()=>d.promise},apiProduct:p=>p,sleeve:String,ACTIONS:{},$:()=>null,$$:()=>[],apiFail(){},patchMoreList(){},rerender(){}});
  vm.runInContext(section('function syncShopState(){','async function liveMine(){'),ctx);
  const task=ctx.liveShop();d.resolve({items:[{id:'first'}],next:null});await task;
  assert.deepEqual(PRODUCTS.map(p=>p.id),['first','solo','open']);
});

test('官方通知：有变化才更新，保留本地已读和已提交的反通知；旧账号响应丢弃',async()=>{
  let reply,badges=0,paints=0,alive=true;
  const ctx=vm.createContext({Map,JSON,Date,ME:'me',ADM:{inbox:{me:[{id:'n1',title:'a',text:'',ts:1,read:true,done:true}]}},CUR:{key:'msg|'},LDM:{side:'x'},API:{req:async()=>reply},dmSession:()=>()=>alive,msgBadge:()=>badges++,dmPaint:()=>paints++});
  vm.runInContext(section('async function sysLoad(){','{ const poll0 = dmPoll;'),ctx);
  const row=(id,read=false)=>({id,title:'t',body:'b',createdAt:'2026-10-12T00:00:00Z',read});
  reply={items:[row('n1')]};await ctx.sysLoad();assert.equal(badges,0,'内容没变不重画');assert.equal(ctx.ADM.inbox.me[0].done,true);
  reply={items:[row('n2'),row('n1')]};await ctx.sysLoad();assert.equal(badges,1);assert.equal(paints,1);assert.equal(ctx.ADM.inbox.me[0].id,'n2');assert.equal(ctx.ADM.inbox.me[1].read,true,'本地已读不被赛跑的响应改回未读');assert.equal(ctx.ADM.inbox.me[1].done,true);
  alive=false;reply={items:[row('n3')]};await ctx.sysLoad();assert.equal(ctx.ADM.inbox.me[0].id,'n2');
});

test('dmRefs 限制并发并逐条补完；收藏不等补取结束，补完只在收藏页重画',async()=>{
  let active=0,peak=0;const posts=new Map();
  const ctx=vm.createContext({Map,Set,Promise,Array,STATE:{favs:new Set()},CUR:{key:'home|'},UI:{},POSTS:[],LDM:{miss:new Set()},dmSession:()=>()=>true,accountSession:()=>()=>true,rerender(){},
    POST:id=>posts.get(id),P:()=>null,apiPost:p=>{posts.set(p.id,p);return p;},apiProduct(){},API:{req:async(m,p)=>{active++;peak=Math.max(peak,active);await tick();active--;return {id:p.split('/').pop()};}}});
  vm.runInContext(section('async function dmRefs(list){','async function dmThreads(){'),ctx);
  await ctx.dmRefs(Array.from({length:10},(_,i)=>({t:'post',ref:'p'+i})));assert.equal(peak,3);assert.equal(posts.size,10);
  let finish;const r=defer();let renders=0;ctx.rerender=()=>renders++;ctx.CUR.key='me|favs';ctx.dmRefs=()=>new Promise(res=>finish=res);ctx.API.req=()=>r.promise;
  vm.runInContext(section('async function liveFavs(){',"wrapAct('fav', async"),ctx);
  const task=ctx.liveFavs();r.resolve({posts:['a'],products:[]});await task;assert(ctx.STATE.favs.has('a'));assert.equal(renders,0,'liveFavs 已返回，补取还在后台');
  finish();await tick();assert.equal(renders,1);
});

test('私信列表：读到前显示读取中，失败给重试，读到过才是「还没有私信」',()=>{
  const ctx=vm.createContext({LDM:{listState:''}});
  vm.runInContext(source.split('\n').find(l=>l.startsWith('const dmListNote =')),ctx);
  const note=()=>vm.runInContext('dmListNote()',ctx);
  assert.match(note(),/正在读取私信/);ctx.LDM.listState='error';assert.match(note(),/data-act="dm-list-retry"/);
});

test('发送验证码请求期间锁住按钮，失败恢复可点',async()=>{
  const d=defer(),calls=[],fails=[];const b={disabled:false,textContent:'发送',isConnected:true},ctx=vm.createContext({Promise,setInterval(){},clearInterval(){},liveUser:()=>true,AUTH:{},LIVE:{},$:()=>({value:'13800000000'}),smsShow(){},fxPop(){},toast(){},apiFail:e=>fails.push(e),
    API:{on:()=>true,req:(m,p)=>{calls.push(p);return d.promise;}},ACTIONS:{'acc-code':()=>{}}});
  vm.runInContext(source.split('\n').find(l=>l.startsWith('function wrapAct(')),ctx);
  vm.runInContext(section("wrapAct('acc-code', async","wrapAct('acc-pgo'"),ctx);
  const task=ctx.ACTIONS['acc-code'](b);ctx.ACTIONS['acc-code'](b);assert.equal(calls.length,1);assert.equal(b.disabled,true);
  d.reject(Error('offline'));await task;assert.equal(b.disabled,false);assert.equal(fails.length,1);assert.equal(b.textContent,'发送','失败不改按钮文字');
});

test('别人主页网络错误显示重试且不缓存成不存在，404 才是不存在',async()=>{
  const pending=[];let renders=0;
  const ctx=vm.createContext({Promise,ROUTES:{user:id=>'原主页:'+id},ME:'me',LIVE:{prof:{}},ACTIONS:{},esc:String,POSTS:[],STATE:{follows:new Set()},API:{on:()=>true,req:()=>{const d=defer();pending.push(d);return d.promise;}},apiFail(){},rerender:()=>renders++,openPost(){}});
  vm.runInContext(section('{ const userRoute0 = ROUTES.user;','  const open0 = openPost;')+'}',ctx);
  vm.runInContext(source.split('\n').find(l=>l.startsWith("ACTIONS['prof-retry'] =")),ctx);
  assert.match(ctx.ROUTES.user('u'),/正在加载/);pending.forEach(d=>d.reject(Object.assign(Error('offline'),{code:'network'})));await tick();
  assert.equal(ctx.LIVE.prof.u,'error');assert.match(ctx.ROUTES.user('u'),/data-act="prof-retry"/);assert.equal(pending.length,2,'出错后重绘不自动重试');
  ctx.ACTIONS['prof-retry']({dataset:{id:'u'}});assert.equal(renders,2);ctx.ROUTES.user('u');assert.equal(pending.length,4);
  pending.slice(2).forEach(d=>d.reject(Object.assign(Error('gone'),{status:404})));await tick();assert.equal(ctx.LIVE.prof.u,'missing');assert.equal(ctx.ROUTES.user('u'),'原主页:u');
});

test('代金券读取失败后显示重试，不一直停在正在读取',()=>{
  const ctx=vm.createContext({API:{on:()=>true},LSHOP:{wallet:null,wTry:true,mineError:true}});
  vm.runInContext(section('function walletView(){','const liveWalletView ='),ctx);
  assert.match(ctx.walletView(),/暂时读不到代金券[\s\S]*data-act="studio-retry"/);
  ctx.LSHOP.mineError=false;assert.match(ctx.walletView(),/正在读取/);
});

test('海报：连着后端时示例商品不显示示例价，改去分类页；真实商品和原型不变',()=>{
  const products=new Set(['real']);let on=true;
  const ctx=vm.createContext({API:{on:()=>on},P:id=>products.has(id),SLIDES0:[{cta:['试听整套','item-p1']}]});
  vm.runInContext(section('const SLIDE_CAT =','const ripple ='),ctx);
  const demo={scene:'drums',price:68,cta:['试听整套','item-p1']};
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.slideCta(demo))),['shop-sample',null]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.slideCta({scene:'drums',price:50,cta:['看看','item-real']}))),['item-real',50]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.slideCta({scene:'drums',price:50,cta:['看看','item-other']}))),['item-other',50],'运营配的真实商品即使不在第一页也不改');
  on=false;assert.deepEqual(JSON.parse(JSON.stringify(ctx.slideCta(demo))),['item-p1',68]);
});

test('开店海报的抽成跟着参数变，后台改过的文案不动',()=>{
  const ctx=vm.createContext({ADM:{params:{plat:.05,coFee:0,coRev:2,coAuto:7}},SLIDES0:[{scene:'stamp',sub:'平台只收 3%，每月结算'}],SLIDES:[{scene:'stamp',sub:'平台只收 3%，每月结算'}]});
  vm.runInContext('let PLAT,CO_FEE,CO_FREE_REV,CO_AUTO_DAYS;'+section('function applyParams(){','applyParams();'),ctx);
  ctx.applyParams();assert.equal(ctx.SLIDES[0].sub,'平台只收 5%，每月结算');assert.equal(ctx.SLIDES0[0].sub,'平台只收 5%，每月结算');
  ctx.SLIDES[0].sub='运营写的';ctx.ADM.params.plat=.1;ctx.applyParams();assert.equal(ctx.SLIDES[0].sub,'运营写的');
});
