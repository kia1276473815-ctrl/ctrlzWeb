import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert(a >= 0 && b > a); return source.slice(a, b); };
const line = prefix => source.split('\n').find(s => s.startsWith(prefix));

function shop({state = 'pending', products = [], content = null} = {}){
  let inserted = 0, removed = 0; const area = {insertAdjacentHTML(where, html){ assert.equal(where, 'beforeend'); assert.match(html, /sk-list/); content = 'sk'; inserted++; }}, note = {parentElement:area, innerHTML:''};
  const ctx = vm.createContext({PRODUCTS:products, LSHOP:{feed:{status:state}}, API:{on:() => true}, shopStatusHtml:() => 'state', skGrid:() => '<div class="sk-list"></div>',
    $:(selector, root) => selector === '#app .shop-state' ? note : (assert.equal(root, area), content ? {kind:content} : null),
    $$:(selector, root) => { assert.equal(selector, '.sk-list'); assert.equal(root, area); return content === 'sk' ? [{remove(){content=null;removed++;}}] : []; }});
  vm.runInContext([line('const shopSk ='), line('function syncShopState()')].join('\n'), ctx);
  return {ctx, note, get inserted(){return inserted;}, get removed(){return removed;}, get content(){return content;}};
}

test('首次商城失败重试重新补骨架，重复同步不重复插入，成功后清理', () => {
  const r = shop({state:'error'}); r.ctx.syncShopState(); assert.equal(r.content, null);
  r.ctx.LSHOP.feed.status='pending'; r.ctx.syncShopState(); r.ctx.syncShopState(); assert.equal(r.inserted,1); assert.equal(r.content,'sk');
  r.ctx.LSHOP.feed.status='ready'; r.ctx.syncShopState(); assert.equal(r.removed,1); assert.equal(r.content,null);
});

test('首读错误清除骨架并保留独立失败反馈', () => {
  const r=shop({content:'sk'}); r.ctx.syncShopState(); assert.equal(r.inserted,0);
  r.ctx.LSHOP.feed.status='error'; r.ctx.syncShopState(); assert.equal(r.removed,1); assert.equal(r.note.innerHTML,'state');
});

test('已确认空态、商品和现有骨架在刷新中保留，不插入额外骨架', () => {
  for(const content of ['empty','grid','sk']){const r=shop({content,state:'refreshing'});r.ctx.syncShopState();assert.equal(r.content,content);assert.equal(r.inserted,0);assert.equal(r.removed,0);}
  const r=shop({products:[{id:'p'}]});r.ctx.syncShopState();assert.equal(r.inserted,0);
});

test('商城状态容器已移除时迟到状态同步不写 DOM', () => {
  const ctx=vm.createContext({$:()=>null});vm.runInContext(line('function syncShopState()'),ctx);assert.doesNotThrow(()=>ctx.syncShopState());
});

function ghost(){
  const original = [{scrollTop:0,scrollLeft:0},{scrollTop:18,scrollLeft:0},{scrollTop:0,scrollLeft:620},{scrollTop:400,scrollLeft:0}], copies = original.map(() => ({style:{},scrollTop:0,scrollLeft:0}));
  let appended=false, removed=0, timeout; const animation={};
  const sheet={scrollTop:18,scrollLeft:0,offsetHeight:600,offsetWidth:620,getClientRects:()=>[{}],classList:{contains:()=>false}}, copySheet={...copies[1],style:{},classList:sheet.classList,animate:()=>animation};copies[1]=copySheet;
  const g={style:{},removeAttribute(){},setAttribute(){},querySelector:()=>copySheet,querySelectorAll:selector => selector==='*' ? copies : [],animate:()=>({}),remove:()=>removed++};
  for(const copy of copies){let top=0,left=0;Object.defineProperty(copy,'scrollTop',{get:()=>top,set:value=>{assert(appended,'restore must follow layout append');top=value;}});Object.defineProperty(copy,'scrollLeft',{get:()=>left,set:value=>{assert(appended,'restore must follow layout append');left=value;}});}
  const ov={querySelector:()=>sheet,querySelectorAll:selector => selector==='*' ? original : [],cloneNode:()=>g};
  const ctx=vm.createContext({Set,Math,performance:{now:()=>1},isMob:()=>false,getComputedStyle:()=>({transform:'none',backgroundColor:'rgba(20,20,24,.38)'}),
    document:{body:{appendChild:()=>appended=true}},setTimeout:fn=>timeout=fn,clamp:(n,min,max)=>Math.max(min,Math.min(max,n))});
  vm.runInContext('const SHEET_GHOSTS = new Set();\n'+section('function sheetGhost(', '/* 关掉马上又开新面板'),ctx);
  return {ctx,ov,original,copies,g,animation,get removed(){return removed;},expire:()=>timeout()};
}

test('退场影子保持主面板与嵌套横纵滚动，阻止吸附或平滑滚动重新跳位', () => {
  const r=ghost();r.ctx.sheetGhost(r.ov,0);assert.equal(r.g.inert,true);assert.equal(r.g.style.pointerEvents,'none');
  r.original.forEach((original,i)=>{assert.equal(r.copies[i].scrollTop,original.scrollTop);assert.equal(r.copies[i].scrollLeft,original.scrollLeft);if(original.scrollTop||original.scrollLeft){assert.equal(r.copies[i].style.scrollBehavior,'auto');assert.equal(r.copies[i].style.scrollSnapType,'none');}});
  assert.equal(vm.runInContext('SHEET_GHOSTS.size',r.ctx),1);r.animation.onfinish();assert.equal(vm.runInContext('SHEET_GHOSTS.size',r.ctx),0);
});

test('影子动画取消或兜底超时会释放节点和记录', () => {
  for(const kind of ['cancel','timeout']){const r=ghost();r.ctx.sheetGhost(r.ov,0);kind==='cancel'?r.animation.oncancel():r.expire();assert.equal(r.removed,1);assert.equal(vm.runInContext('SHEET_GHOSTS.size',r.ctx),0);}
});
