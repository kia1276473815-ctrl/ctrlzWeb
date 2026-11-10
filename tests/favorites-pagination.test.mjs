import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../scripts/favorites.js',import.meta.url),'utf8');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function setup(){let active=false,handler=async(method,path,body)=>method==='POST'?{posts:[],products:[],counts:{posts:0,products:0}}:{items:[],next:null,counts:{posts:0,products:0}};const calls=[],entities=new Map(),host={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]},events=new Map();
 const ctx=vm.createContext({Date,Map,Set,Promise,JSON,Error,queueMicrotask,encodeURIComponent,API:{base:'local',epoch:1,req:async(...args)=>{calls.push(args);return handler(...args);}},ME:'me',STATE:{favs:new Set()},LIVE:{},UI:{meTab:'favs'},CUR:{key:'me|favs'},ACTIONS:{fav(){},'rl-fav'(){},'cv-pick'(){}},liveUser:()=>active,POST:id=>entities.get('post:'+id),P:id=>entities.get('product:'+id),reelCur:()=>null,RL:{on:false},$:selector=>selector==='#app .mtb'?host:null,document:{activeElement:null,hidden:false,dispatchEvent(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>events.set(name,fn)},window:{addEventListener(){}},CSS:{escape:s=>s},esc,syncInteraction(){},patchBookmarks(){},onMount(){},onClean(){},waveLoop:()=>()=>{},mountWaves(){},rollNums(){},fitText(){},syncLive(){},renderPost(){},reelBar(){},Event:class Event{constructor(type){this.type=type;}},dmRefs:async rows=>{for(const r of rows)entities.set((r.t==='post'?'post':'product')+':'+r.ref,{id:r.ref,title:'公开 '+r.ref});return new Map(rows.map(r=>[r.t+':'+r.ref,'available']));},postCard:p=>'<article>'+esc(p.title)+'</article>',sleeve:p=>'<article>'+esc(p.title)+'</article>',miniThumb:()=>'',cover:()=>'',hash:()=>0,toast(){},apiFail(){}});vm.runInContext(source,ctx);active=true;
 return{ctx,calls,entities,host,events,set handler(value){handler=value;},refresh:()=>ctx.ACTIONS['favs-refresh']({dataset:{context:'profile',kind:'post'}}),next:()=>ctx.ACTIONS['favs-next']({dataset:{context:'profile',kind:'post'}}),retry:()=>ctx.ACTIONS['favs-retry']({dataset:{context:'profile',kind:'post'}})};
}
const button=id=>({dataset:{id},getAttribute:()=>null,setAttribute(){},removeAttribute(){}});
const row=id=>({kind:'post',id,available:true,createdAt:'2020-01-01T00:00:00.000000Z'});
test('分页按服务器收藏顺序渲染，不使用全站缓存顺序；总数不等于已加载40项',async()=>{
 const h=setup();h.handler=async()=>({items:[row('older'),row('newer')],next:'cut-1',counts:{posts:603,products:2}});await h.refresh();const html=h.ctx.CZFavorites.profile();assert(html.indexOf('公开 older')<html.indexOf('公开 newer'));assert(html.includes('帖子 603'));assert.equal(h.ctx.CZFavorites.total(),605);assert(html.includes('更早收藏'));assert(h.ctx.STATE.favs.has('older'));
});
test('翻页失败保留当前内容，重试沿用失败边界而不是回第一页',async()=>{
 const h=setup();let nextFails=true;h.handler=async(method,path)=>{if(path.includes('cursor=cut-1')){if(nextFails){nextFails=false;throw Error('暂时断网');}return{items:[row('page-two')],next:null,counts:{posts:80,products:0}};}return{items:[row('page-one')],next:'cut-1',counts:{posts:80,products:0}};};await h.refresh();await h.next();assert(h.ctx.CZFavorites.profile().includes('公开 page-one'));await h.retry();assert(h.ctx.CZFavorites.profile().includes('公开 page-two'));assert.equal(h.calls.filter(c=>c[1].includes('cursor=cut-1')).length,2);
});
test('500项以外的精确状态先校对再取消，不会误发PUT',async()=>{
 const h=setup();h.entities.set('post:very-old',{id:'very-old',title:'很早收藏'});h.handler=async(method)=>method==='POST'?{posts:['very-old'],products:[],counts:{posts:603,products:0}}:{ok:true};await h.ctx.CZFavorites.hydrate([{kind:'post',id:'very-old'}]);assert(h.ctx.STATE.favs.has('very-old'));await h.ctx.ACTIONS.fav(button('very-old'));assert(h.calls.some(c=>c[0]==='DELETE'&&c[1]==='/me/favs/post/very-old'));assert(!h.calls.some(c=>c[0]==='PUT'));
});
test('旧账号/服务的迟到分页和状态不进入新账号',async()=>{
 for(const kind of ['page','status']){const h=setup();let resolve;h.handler=()=>new Promise(r=>resolve=r);const work=kind==='page'?h.refresh():h.ctx.CZFavorites.hydrate([{kind:'post',id:'private-old'}]);await new Promise(r=>setTimeout(r,0));h.ctx.ME='other';h.ctx.API.epoch++;resolve(kind==='page'?{items:[row('private-old')],next:null,counts:{posts:7,products:0}}:{posts:['private-old'],products:[],counts:{posts:7,products:0}});await work;assert(!h.ctx.STATE.favs.has('private-old'));assert(!h.ctx.CZFavorites.profile().includes('private-old'));}
});
test('不可访问和临时读取失败不显示旧缓存的私有标题，保留移除/重试',async()=>{
 const h=setup();h.entities.set('post:private',{id:'private',title:'绝不回显的旧标题'});h.handler=async()=>({items:[{...row('private'),available:false}],next:null,counts:{posts:1,products:0}});await h.refresh();const html=h.ctx.CZFavorites.profile();assert(!html.includes('绝不回显'));assert(html.includes('内容已删除或暂不可访问'));assert(html.includes('移除收藏'));
});
test('取消收藏失败回滚原选择和可见记录，不移除其他人的状态',async()=>{
 const h=setup();h.handler=async method=>method==='POST'?{posts:['saved'],products:[],counts:{posts:1,products:0}}:Promise.reject(Error('断网'));await h.ctx.CZFavorites.hydrate([{kind:'post',id:'saved'}]);await h.ctx.ACTIONS.fav(button('saved'));assert(h.ctx.STATE.favs.has('saved'));
});
test('同项变更串行，迟到只读校对不能覆盖刚完成的取消',async()=>{
 const h=setup();h.handler=async()=>({posts:['saved'],products:[],counts:{posts:1,products:0}});await h.ctx.CZFavorites.hydrate([{kind:'post',id:'saved'}]);let resolveStatus,resolveDelete;h.handler=(method)=>method==='POST'?new Promise(r=>resolveStatus=r):new Promise(r=>resolveDelete=r);
 const pending=h.ctx.CZFavorites.hydrate([{kind:'post',id:'saved'}],true);await new Promise(r=>setTimeout(r,0));const mutation=h.ctx.ACTIONS.fav(button('saved'));await h.ctx.ACTIONS.fav(button('saved'));assert.equal(h.calls.filter(c=>c[0]==='DELETE').length,1);resolveDelete({ok:true});await mutation;resolveStatus({posts:['saved'],products:[],counts:{posts:1,products:0}});await pending;assert(!h.ctx.STATE.favs.has('saved'));
});
test('状态校对100项一批、最多两路，整批失败不把收藏改成未收藏',async()=>{
 const h=setup();let active=0,max=0;h.handler=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return{posts:[],products:[],counts:{posts:0,products:0}};};await h.ctx.CZFavorites.hydrate(Array.from({length:501},(_,i)=>({kind:'post',id:'p'+i})));assert.equal(h.calls.length,6);assert(max<=2);assert(h.calls.every(c=>c[2].posts.length<=100));
});
test('旧接口回退明确只读最近收藏，并仍按页展示，不宣称总数等于已加载数',async()=>{
 const h=setup();h.handler=async(method,path)=>{if(path==='/me/favs')return{posts:Array.from({length:500},(_,i)=>'old-'+i),products:[]};throw Object.assign(Error('旧服务'),{status:404});};await h.refresh();const html=h.ctx.CZFavorites.profile();assert(html.includes('暂时只能读取最近的收藏'));assert.equal(h.ctx.CZFavorites.total(),'≥500');assert.equal((html.match(/<article>/g)||[]).length,40);
});
test('帖子弹层首次显示时校对旧收藏，完成前禁用按钮并提供正确无障碍选中状态',async()=>{
 const h=setup(),attrs=new Map(),b={dataset:{id:'older'},disabled:false,getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};h.ctx.document.querySelectorAll=s=>s.includes('[data-act="fav"]')?[b]:[];h.handler=async()=>({posts:['older'],products:[],counts:{posts:601,products:0}});h.ctx.renderPost('older');assert(b.disabled);await new Promise(r=>setTimeout(r,0));assert(!b.disabled);assert(h.ctx.STATE.favs.has('older'));assert.equal(attrs.get('aria-pressed'),'true');assert.equal(attrs.get('aria-label'),'取消收藏');
});
test('服务切换后已排队的旧账号批次不再向新服务发送旧收藏ID',async()=>{
 const h=setup(),pending=[];h.handler=()=>new Promise(resolve=>pending.push(resolve));const work=h.ctx.CZFavorites.hydrate(Array.from({length:501},(_,i)=>({kind:'post',id:'old-'+i})));await new Promise(r=>setTimeout(r,0));assert.equal(h.calls.length,2);h.ctx.ME='other';h.ctx.API.epoch++;pending.forEach(resolve=>resolve({posts:[],products:[],counts:{posts:0,products:0}}));await work;assert.equal(h.calls.length,2);assert.equal(h.ctx.STATE.favs.size,0);
});
