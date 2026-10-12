// 所有被测逻辑提取自当前页面；只模拟接口/DOM，不镜像分页实现。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,`找不到实际源码：${a}`);return source.slice(start,end);};
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const plain=value=>JSON.parse(JSON.stringify(value));
const order=(id,extra={})=>({id,no:'NO-'+id,productId:'product-'+id,title:'历史订单 '+id,price:1000,voucherAmount:0,payMethod:'wechat',status:'paid',createdAt:'2026-10-10T00:00:00Z',paidAt:'2026-10-10T00:00:00Z',seller:{id:'seller'},downloads:0,product:null,...extra});
function accountRealm(overrides={}){
  const products={},actions={},stored=new Map();let uuid=0;
  const ctx=vm.createContext({console,Date,Map,Set,Promise,ME:'me',liveUser:()=>true,STATE:{role:'user',orders:[],owned:new Set(),dlc:{},seller:false},
    LSHOP:{ordersNext:'cursor1',salesNext:null,library:new Map(),libraryTried:new Set()},LCO:{next:null},SELLER_ORDERS:[],CUR:{key:'me|orders'},
    API:{req:async()=>({items:[],next:null})},apiUser:u=>u || {id:'unknown'},f2y:n=>(n||0)/100,ymdhm:x=>x || '',PAY_N:{wechat:'微信支付'},
    P:id=>products[id],apiProduct:p=>products[p.id]=p,apiFail:e=>{throw e;},coMapCard(){},CO_BY(){},coMap(){},ROUTES:{me:()=>'<div></div>',seller:()=>'<div></div></div></div>'},
    ACTIONS:{},wrapAct:(name,fn)=>actions[name]=fn,onMount(){},liveReset(){},meLegacy:()=>'<div></div>',$:()=>null,$$:()=>[],fitText(){},
    document:{createElement:()=>({content:{querySelector:()=>null,querySelectorAll:()=>[]}}),dispatchEvent(){}},Event:class{},
    esc:x=>String(x??''),uname:x=>x,yuan2:x=>String(x),crypto:{randomUUID:()=> 'uuid-'+(++uuid)},
    localStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)},...overrides});
  vm.runInContext(section('const store =','/* ================= 管理后台数据'),ctx);
  vm.runInContext(section('const apiOrder =','function liveApplyOrder'),ctx);
  vm.runInContext(section('const ACCOUNT_PAGES =','(function boot(){'),ctx);
  return {ctx,products,actions,stored};
}

test('摘要订单 product:null 保留订单标题，历史表不要求商品已在当前页',()=>{
  const {ctx}=accountRealm();ctx.input=order('old');const mapped=vm.runInContext('apiOrder(input)',ctx);
  assert.equal(mapped.title,'历史订单 old');assert.equal(mapped.summary,true);
  Object.assign(ctx,{USERS:{me:{name:'Me',city:'',bio:''}},PRODUCTS:[],POSTS:[],ROLE_NAME:{user:'用户'},protoOn:()=>false,gate(){},
    MESUB:{},ME_SUB_T:{orders:'订单'},IC:{back:''},ordSt:o=>o.st,rfOf:()=>null});ctx.STATE.orders=[mapped];
  vm.runInContext(section('function meLegacy(arg){','ACTIONS.metab ='),ctx);
  const html=ctx.meLegacy('orders');assert(html.includes('历史订单 old'));assert(html.includes('data-no="NO-old"'));assert(!html.includes('undefined'));
});

test('资源库每批最多24件、最多4个在途请求，重复触发复用工作，完成后清掉loading',async()=>{
  const pending=[],calls=[],patches=[];let active=0,peak=0;
  const {ctx,products}=accountRealm({CUR:{key:'me|lib'},API:{req:(method,path)=>{calls.push(path);peak=Math.max(peak,++active);return new Promise(resolve=>pending.push(()=>{active--;resolve({id:decodeURIComponent(path.split('/').at(-1))});}));}}});
  ctx.STATE.owned=new Set(Array.from({length:30},(_,i)=>'p'+i));ctx.patchAccountPage=k=>patches.push([k,vm.runInContext('ACCOUNT_PAGES.busy.has("lib")',ctx)]);
  const first=ctx.loadLibraryChunk(),second=ctx.loadLibraryChunk();await tick();assert.equal(calls.length,4);
  while(pending.length){pending.splice(0).forEach(resolve=>resolve());await tick();}await Promise.all([first,second]);
  assert.equal(calls.length,24);assert.equal(peak,4);assert.equal(Object.keys(products).length,24);assert.equal(ctx.STATE.owned.size,30);
  assert.deepEqual(patches,[['lib',false]]);assert.equal(vm.runInContext('libraryRemaining().length',ctx),6);
});

test('切换账号后资源库旧任务停止，不污染新账号的尝试集合和商品',async()=>{
  const pending=[],calls=[];const {ctx,products}=accountRealm({CUR:{key:'me|lib'},API:{req:(method,path)=>{calls.push(path);return new Promise(resolve=>pending.push(()=>resolve({id:path.split('/').at(-1)})));}}});
  ctx.STATE.owned=new Set(Array.from({length:12},(_,i)=>'old'+i));ctx.patchAccountPage=()=>{throw Error('旧会话不能重绘');};
  const task=ctx.loadLibraryChunk();await tick();ctx.ME='new';ctx.liveReset();ctx.LSHOP.library=new Map();ctx.STATE.owned=new Set(['new-product']);
  while(pending.length){pending.splice(0).forEach(resolve=>resolve());await tick();}await task;
  assert.equal(calls.length,4);assert.equal(ctx.LSHOP.libraryTried.size,0);assert.equal(Object.keys(products).length,0);
});

test('旧历史已购权限独立于订单首屏，下载使用library内的orderId',async()=>{
  const calls=[],links=[],toasts=[];const {ctx,actions,products}=accountRealm({API:{req:async(method,path)=>{calls.push([method,path]);return {url:'/signed-real-file',fileName:'old.wav'};}},
    toast:(...a)=>toasts.push(a),document:{createElement:()=>({click(){links.push(this.href);},remove(){}}),body:{appendChild(){}},dispatchEvent(){}}});
  products.old={id:'old',live:true};ctx.STATE.orders=[];ctx.LSHOP.library.set('old',{productId:'old',orderId:'order-outside-first-50'});
  vm.runInContext(section("wrapAct('dl', async",'/* —— 退款：后端判断'),ctx);
  await actions.dl(()=>{throw Error('真实旧已购不能回落演示下载');},{dataset:{id:'old'}});
  assert.deepEqual(calls,[['POST','/orders/order-outside-first-50/download']]);assert.deepEqual(links,['/signed-real-file']);assert.equal(ctx.STATE.dlc.old,1);
});

test('摘要详情按需加载订单和商品，完整详情缓存后不重复请求',async()=>{
  const calls=[];const {ctx,products}=accountRealm({API:{req:async(method,path)=>{calls.push(path);return path.startsWith('/orders/')?order('one',{licenseNo:'L-one',downloads:3}):{id:'product-one',live:true};}}});
  ctx.input=order('one');ctx.STATE.orders=[vm.runInContext('apiOrder(input)',ctx)];
  const first=await ctx.ensureOrderDetails('NO-one'),second=await ctx.ensureOrderDetails('NO-one');
  assert.equal(first,second);assert.deepEqual(calls,['/orders/one','/products/product-one']);assert.equal(first.lic,'L-one');assert.equal(first.summary,false);assert(products['product-one']);
});

test('详情加载中切换账号或重置epoch不会更新旧订单或继续读取商品',async()=>{
  for(const reset of ['account','epoch']){
    let resolve;const calls=[];const {ctx}=accountRealm({API:{req:(method,path)=>{calls.push(path);return new Promise(r=>resolve=r);}}});
    ctx.input=order('one');const saved=vm.runInContext('apiOrder(input)',ctx);ctx.STATE.orders=[saved];const task=ctx.ensureOrderDetails('NO-one');
    if(reset==='account')ctx.ME='new';else ctx.liveReset();resolve(order('one',{licenseNo:'L-one'}));await task;
    assert.equal(saved.summary,true);assert.equal(saved.lic,undefined);assert.equal(calls.length,1);
  }
});

test('分页合并按订单ID去重，离开路由后只缓存数据，不重画新页面',async()=>{
  let resolve;const calls=[],patches=[];const {ctx}=accountRealm({API:{req:(method,path)=>{calls.push(path);return new Promise(r=>resolve=r);}}});
  ctx.input=order('old');ctx.STATE.orders=[vm.runInContext('apiOrder(input)',ctx)];ctx.patchAccountPage=k=>patches.push(k);
  const a=ctx.loadAccountMore('orders'),b=ctx.loadAccountMore('orders');ctx.CUR.key='shop|';resolve({items:[order('old'),order('new'),order('new')],next:'cursor2'});await Promise.all([a,b]);
  assert.equal(calls.length,1);assert.deepEqual(plain(ctx.STATE.orders.map(o=>o.id)),['old','new']);assert.equal(ctx.LSHOP.ordersNext,'cursor2');assert.deepEqual(patches,[]);
  ctx.CUR.key='me|orders';const next=ctx.loadAccountMore('orders');resolve({items:[],next:null});await next;
  assert.equal(calls.length,2);assert(calls[1].includes('cursor=cursor2'));assert.deepEqual(patches,['orders']);assert.equal(vm.runInContext('ACCOUNT_PAGES.busy.size',ctx),0);
});

test('切换账号后分页旧响应不改新账号订单和游标',async()=>{
  let resolve;const {ctx}=accountRealm({API:{req:()=>new Promise(r=>resolve=r)}});ctx.patchAccountPage=()=>{throw Error('不应重绘');};
  const task=ctx.loadAccountMore('orders');ctx.ME='other';ctx.STATE.orders=[];ctx.LSHOP.ordersNext='other-cursor';resolve({items:[order('private')],next:'old-next'});await task;
  assert.equal(ctx.STATE.orders.length,0);assert.equal(ctx.LSHOP.ordersNext,'other-cursor');
});

test('提交键持久化覆盖同请求重试、不同用户和tier隔离，成功后释放键',()=>{
  const {ctx}=accountRealm();const product={id:'same-product'},body={productId:'same-product',useVoucher:true,payMethod:'wechat'};
  const a=ctx.orderAttempt(product,body),b=ctx.orderAttempt(product,body);assert.equal(a.body.requestKey,b.body.requestKey);
  ctx.ME='other';const other=ctx.orderAttempt(product,body);assert.notEqual(other.body.requestKey,a.body.requestKey);
  ctx.ME='me';const extended=ctx.orderAttempt(product,{...body,tier:'extended'});assert.notEqual(extended.body.requestKey,a.body.requestKey);
  a.done();assert.notEqual(ctx.orderAttempt(product,body).body.requestKey,a.body.requestKey);assert.equal(ctx.orderAttempt(product,{...body,tier:'extended'}).body.requestKey,extended.body.requestKey);
});

test('付款切换代金券或作废确认状态使用独立提交键，同券同确认重试复用',()=>{
  const {ctx}=accountRealm(),product={id:'same-product'},body={productId:'same-product',useVoucher:true,payMethod:'wechat',voucherId:'voucher-a',confirmWaste:true};
  const first=ctx.orderAttempt(product,body),retry=ctx.orderAttempt(product,{...body});assert.equal(retry.body.requestKey,first.body.requestKey);
  assert.equal(first.body.voucherId,'voucher-a');assert.equal(first.body.confirmWaste,true);
  const other=ctx.orderAttempt(product,{...body,voucherId:'voucher-b'}),unconfirmed=ctx.orderAttempt(product,{...body,confirmWaste:false});
  assert.notEqual(other.body.requestKey,first.body.requestKey);assert.notEqual(unconfirmed.body.requestKey,first.body.requestKey);
  const noVoucher=ctx.orderAttempt(product,{productId:product.id,useVoucher:false,payMethod:'wechat'});assert.notEqual(noVoucher.body.requestKey,first.body.requestKey);
});

test('合作单局部补页处理全部列表，保留已有节点并追加历史，不误用单个$元素',()=>{
  const old1={children:[{dataset:{co:'a'}}],appendChild(e){this.children.push(e);},querySelector:()=>null},old2={children:[{dataset:{co:'b'}}],appendChild(e){this.children.push(e);},querySelector:()=>null};
  const original=old1.children[0],fresh=[{children:[{dataset:{co:'a'}},{dataset:{co:'c'}}]},{children:[{dataset:{co:'b'}},{dataset:{co:'d'}}]}];
  const {ctx}=accountRealm({CUR:{key:'seller|collab'},$$:selector=>selector==='#app .co-list'?[old1,old2]:[],$:selector=>selector==='#app .co-list'?old1:null,
    document:{createElement:()=>({content:{querySelectorAll:()=>fresh}}),dispatchEvent(){}}});
  ctx.patchAccountPage('collabs');assert.equal(old1.children[0],original);assert.deepEqual(old1.children.map(e=>e.dataset.co),['a','c']);assert.deepEqual(old2.children.map(e=>e.dataset.co),['b','d']);
});
