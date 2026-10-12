// 直接提取商城正式逻辑，以受控 GET 验证等待、恢复与迟到响应；不写真实业务数据。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0 && end>start,a);return source.slice(start,end);};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<18;i++)await Promise.resolve();};
const plain=x=>JSON.parse(JSON.stringify(x));
function shopRealm(products=[]){
  const pending=[],patches=[],status={innerHTML:''},failures=[];
  const ctx=vm.createContext({Date,Map,Set,Promise,console,PRODUCTS:products,UI:{shop:{cat:'all',sub:'all',price:'all',sort:'new'}},CATS:{sample:{}},ME:'me',CUR:{key:'shop|'},ACTIONS:{},
    LSHOP:{feed:{status:'ready',seq:0},next:null},onSale:p=>p.status==='on_sale',esc:String,
    API:{base:'fixture',on:()=>true,req:()=>{const d=defer();pending.push(d);return d.promise;}},
    P:id=>ctx.PRODUCTS.find(p=>p.id===id),apiProduct:p=>{const old=ctx.PRODUCTS.find(x=>x.id===p.id);if(old)return Object.assign(old,p);ctx.PRODUCTS.push(p);return p;},
    sleeve:p=>JSON.stringify(p),$$:()=>[],$:s=>s==='#app .shop-state'?status:s==='#app .grid-p'?{}:null,
    patchMoreList:(k,changed)=>patches.push({k,changed:[...changed]}),rerender:()=>patches.push({full:true}),apiFail:e=>failures.push(e.message)});
  vm.runInContext(section('function shopProducts(){','ROUTES.shop = arg => {'),ctx);
  vm.runInContext(section('function syncShopState(){','async function liveMine(){'),ctx);
  return {ctx,pending,patches,status,failures};
}
const product=(id,date,extra={})=>({id,publishedAt:date,live:true,status:'on_sale',cat:'sample',price:10,sales:0,...extra});
test('真实“最新”按发布时间倒序，追加旧页和其它缓存商品都不会颠倒列表',()=>{
  const r=shopRealm([product('new','2026-10-12T00:00:00Z'),product('middle','2026-10-11T00:00:00Z')]);
  r.ctx.PRODUCTS.push(product('old','2026-10-10T00:00:00Z'),product('equal','2026-10-11T00:00:00Z'));
  assert.deepEqual(plain(r.ctx.shopProducts()).map(x=>x.id),['new','middle','equal','old']);
});
test('原型商品保留原有新增顺序，免费与价格筛选语义不变',()=>{
  const r=shopRealm([product('a',null,{live:false,price:20}),product('b',null,{live:false,price:0}),product('c',null,{live:false,price:150})]);
  assert.deepEqual(plain(r.ctx.shopProducts()).map(x=>x.id),['c','b','a']);
  r.ctx.UI.shop.price='free';assert.deepEqual(plain(r.ctx.shopProducts()).map(x=>x.id),['b']);
  r.ctx.UI.shop.price='gt100';assert.deepEqual(plain(r.ctx.shopProducts()).map(x=>x.id),['c']);
});
test('初读与错误显示请求状态，真实空列表及分类空结果不会被误说成价格限制',async()=>{
  const r=shopRealm(),task=r.ctx.liveShop();assert.match(r.status.innerHTML,/正在读取资源/);assert.equal(r.ctx.shopEmptyHtml(),'');
  r.pending[0].reject(new Error('读取超时'));await task;assert.match(r.status.innerHTML,/读取超时/);assert.match(r.status.innerHTML,/shop-retry/);assert.equal(r.ctx.shopEmptyHtml(),'');
  const retry=r.ctx.ACTIONS['shop-retry']();r.pending[1].resolve({items:[],next:null});await retry;assert.equal(r.status.innerHTML,'');assert.match(r.ctx.shopEmptyHtml(),/还没有上架的资源/);assert.doesNotMatch(r.ctx.shopEmptyHtml(),/清除筛选/);
  r.ctx.PRODUCTS.push(product('sample','2026-10-12T00:00:00Z'));r.ctx.UI.shop.cat='preset';assert.match(r.ctx.shopEmptyHtml(),/这个分类/);assert.match(r.ctx.shopEmptyHtml(),/shop-clear/);
  r.ctx.LSHOP.next='more';assert.match(r.ctx.shopEmptyHtml(),/还有资源待加载/);
});
test('刷新保留旧内容及节点，失败可重试，成功只标记真正变化的商品卡',async()=>{
  const old=product('same','2026-10-12T00:00:00Z'),changed=product('changed','2026-10-11T00:00:00Z');
  const r=shopRealm([old,changed]),task=r.ctx.liveShop();assert.match(r.status.innerHTML,/正在更新资源/);assert.equal(r.ctx.PRODUCTS[0],old);assert.equal(r.patches.length,0);
  r.pending[0].reject(new Error('offline'));await task;assert.equal(r.ctx.PRODUCTS[0],old);assert.equal(r.patches.length,0);
  const retry=r.ctx.liveShop();r.pending[1].resolve({items:[{...old},{...changed,price:39},product('new','2026-10-13T00:00:00Z')],next:null});await retry;
  assert.equal(r.ctx.PRODUCTS[0],old);assert.deepEqual(r.patches,[{k:'shop',changed:['changed']}]);assert.equal(r.ctx.PRODUCTS[1].price,39);
});
test('迟到商城请求及旧账号响应不能覆盖先到的新列表',async()=>{
  const r=shopRealm(),a=r.ctx.liveShop(),b=r.ctx.liveShop();r.pending[1].resolve({items:[product('new','2026-10-12T00:00:00Z')],next:null});await b;
  r.pending[0].resolve({items:[product('stale','2026-10-10T00:00:00Z')],next:'old-next'});await a;assert.equal(r.ctx.PRODUCTS[0].id,'new');assert.equal(r.ctx.LSHOP.next,null);
  const c=r.ctx.liveShop();r.ctx.ME='other';r.pending[2].resolve({items:[product('old-account','2026-10-12T00:00:00Z')],next:null});await c;assert.equal(r.ctx.PRODUCTS[0].id,'new');
});
test('分类直链的初读和重试同样局部补齐商品，不仅更新状态文字',async()=>{
  const r=shopRealm();r.ctx.CUR.key='shop|sample';r.ctx.UI.shop.cat='sample';const task=r.ctx.liveShop();
  r.pending[0].resolve({items:[product('sample','2026-10-12T00:00:00Z')],next:'second-page'});await task;
  assert.deepEqual(r.patches,[{k:'shop',changed:[]}]);assert.equal(r.ctx.LSHOP.next,'second-page');assert.equal(r.ctx.PRODUCTS[0].id,'sample');
});
function previewRealm(){
  const p={id:'p',live:true,status:'on_sale'},pending=[];let renders=0;
  const ctx=vm.createContext({Date,Map,Set,Promise,console,ME:'me',CUR:{key:'item|p'},P:id=>id==='p'?p:null,API:{base:'fixture',on:()=>true,req:()=>{const d=defer();pending.push(d);return d.promise;}},
    ACTIONS:{},ROUTES:{item:()=>vm.runInContext("pvEmpty(P('p'))",ctx)},apiProduct:d=>Object.assign(p,d),productPreviewButton:h=>h,pvDemo:()=>'',esc:String,
    rerender:()=>{renders++;ctx.ROUTES.item('p');}});
  vm.runInContext(section('const pvEmpty =','function productPreviewAudio('),ctx);
  vm.runInContext(section('{ const it1 = ROUTES.item;','/* 审核员听素材 */'),ctx);
  return {ctx,p,pending,get renders(){return renders;}};
}
test('试听预览重复重绘只取一次；失败不缓存三小时、不自动循环重试，可就地恢复',async()=>{
  const r=previewRealm();assert.match(r.ctx.ROUTES.item('p'),/正在读取预览/);r.ctx.ROUTES.item('p');assert.equal(r.pending.length,1);
  r.pending[0].reject(new Error('offline'));await tick();assert.equal(r.p.pvLoading,false);assert.equal(r.p.pvAt,0);assert.match(r.ctx.ROUTES.item('p'),/pv-retry/);assert.equal(r.pending.length,1);
  r.ctx.ACTIONS['pv-retry']({dataset:{id:'p'}});assert.equal(r.pending.length,2);r.pending[1].resolve({id:'p',status:'on_sale',preview:null});await tick();
  assert.equal(r.p.previewError,false);assert.equal(r.p.pvLoading,false);assert(r.p.pvAt>0);assert.match(r.ctx.ROUTES.item('p'),/卖家还没有上传预览/);assert.equal(r.pending.length,2);
});
test('预览返回null也结束等待；迟到预览不重绘其它商品、旧服务响应不回填',async()=>{
  const r=previewRealm();r.ctx.ROUTES.item('p');r.pending[0].resolve({id:'p',status:'on_sale',preview:null});await tick();assert.equal(r.renders,1);
  r.p.pvAt=0;r.ctx.ROUTES.item('p');r.ctx.CUR.key='item|other';r.pending[1].resolve({id:'p',status:'on_sale',preview:{pads:[]}});await tick();assert.equal(r.renders,1);
  r.p.pvAt=0;r.ctx.ROUTES.item('p');r.ctx.API.base='different';r.pending[2].resolve({id:'p',status:'on_sale',preview:{pads:['stale']}});await tick();assert.deepEqual(plain(r.p.preview),{pads:[]});
});
test('商品A评价迟到时只缓存A结果，不替换正在交互的商品B节点',async()=>{
  const wait=defer();let renders=0;const ctx=vm.createContext({Promise,Date,Map,Set,console,API:{on:()=>true,req:()=>wait.promise},LPRV:{},prvBox:()=>'',CUR:{key:'item|a'},STATE:{role:'guest'},esc:String,apiUser:()=>{},rerender:()=>renders++,stars:()=>'',uav:()=>'',fmtDay:()=>''});
  // 不包含const LPRV声明；沿用测试的缓存对象便于直接读取结果。
  vm.runInContext(section('{ const pb0 = prvBox;',"ACTIONS['prv-retry'] ="),ctx);
  const p={id:'a'};ctx.prvBox(p);ctx.CUR.key='item|b';wait.resolve({items:[],avg:0,count:0,canWrite:false});await tick();assert.equal(renders,0);assert.equal(ctx.LPRV.a.count,0);
});
