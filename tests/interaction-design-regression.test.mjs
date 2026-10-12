// 对照优化前的真实函数，覆盖局部更新不得改变按钮设计、空态和操作路径。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
const source = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
const baseline = execFileSync('git',['show','a1f15d596da626be30800b60b2ba636f463c36a4:index.html'],{cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:4*1024*1024});
const section = (start,end,text=source) => { const a=text.indexOf(start),b=text.indexOf(end,a+start.length); assert(a>=0 && b>a,start); return text.slice(a,b); };
const realm = data => vm.createContext({console,Date,Map,Set,Promise,Event,...data});
const plain = value => JSON.parse(JSON.stringify(value));
const button = (classes='',dataset={}) => {
  const set=new Set(classes.split(' ').filter(Boolean));
  return {dataset,style:{},innerHTML:'',attributes:{},classList:{contains:k=>set.has(k),add:k=>set.add(k),toggle(k,on){on?set.add(k):set.delete(k);}},setAttribute(k,v){this.attributes[k]=v;}};
};
function syncRealm(buttons,extra={}){
  const ctx=realm({STATE:{liked:new Set(),favs:new Set(),follows:new Set()},ME:'me',USERS:{me:{follow:3}},POST:()=>({likes:7}),likes:p=>p.likes+1,
    IC:{heart:'<svg>heart</svg>',heartF:'<svg>filled</svg>',save:'<svg>save</svg>',saveF:'<svg>saved</svg>'},CUR:{key:'home|'},UI:{},RL:{on:false},
    $:()=>null,$$:()=>buttons,patchBookmarks(){},patchMoreList(){},...extra});
  vm.runInContext(section('function syncInteraction(', '/* ---------- 浏览器历史'),ctx);return ctx;
}
test('帖子点赞图标保持独立粉色，卡片数字保留原 bump 动效',()=>{
  const icon=button('pill sm ic lt'),card=button('lk');const ctx=syncRealm([icon,card]);ctx.STATE.liked.add('p');ctx.syncInteraction('like','p',true);
  assert.equal(icon.style.color,'var(--pink)');assert.equal(icon.innerHTML,'<svg>filled</svg>');assert(!icon.classList.contains('on'));
  assert(card.classList.contains('on'));assert(card.innerHTML.includes('class="bump "'));assert(card.innerHTML.includes('>8</span>'));
  ctx.STATE.liked.delete('p');ctx.syncInteraction('like','p',true);assert.equal(icon.style.color,'');assert(!icon.innerHTML.includes('<span'));assert(card.innerHTML.includes('class="bump dn"'));
});
test('关注弹窗按原上下文保留关注、回关、已关注、互相关注，计数同步',()=>{
  const ordinary=button('pill'),fan=button('pill',{followOn:'互相关注',followOff:'回关'}),following=button('pill',{followOn:'已关注',followOff:'回关'}),count={dataset:{},textContent:''};
  const ctx=syncRealm([ordinary,fan,following],{$:q=>q.includes('me-list')?count:null});ctx.syncInteraction('follow','peer');
  assert.equal(ordinary.innerHTML,'关注');assert.equal(fan.innerHTML,'回关');assert.equal(following.innerHTML,'回关');
  ctx.STATE.follows.add('peer');ctx.syncInteraction('follow','peer');assert.equal(ordinary.innerHTML,'已关注');assert.equal(fan.innerHTML,'互相关注');assert.equal(String(count.textContent),'4');
});
test('收藏局部更新同步我页面页签数字',()=>{
  const count={textContent:'0'};const ctx=syncRealm([button('pill ic')],{$:q=>q.includes('me-tab')?count:null});ctx.STATE.favs.add('p');ctx.syncInteraction('fav','p');assert.equal(count.textContent,1);
});
test('关注流取消最后一个作者后恢复原空态，保留推荐关注区域',()=>{
  let replacement,rendered=0;const box={children:[],replaceWith:e=>replacement=e},area={};
  const ctx=realm({POSTS:[],STATE:{follows:new Set(),blocks:new Set(),settings:{pers:true}},UI:{homeTab:'fol'},LIVE:{next:null},blocked:()=>false,postCard(){},
    $:q=>q==='#app .hfeed'?area:q==='.mason'?box:null,$$:()=>[],document:{createElement:()=>({}),dispatchEvent:()=>rendered++},Event});
  vm.runInContext(section('function patchMoreList(', 'async function moreLoad(k)'),ctx);assert.equal(ctx.patchMoreList('home'),true);
  assert.equal(replacement.className,'empty');assert(replacement.innerHTML.includes('关注的人还没有发东西'));assert(!replacement.innerHTML.includes('data-act="compose"'));assert.equal(rendered,1);
});
test('推荐关注卡缩回动画期间请求失败，不永久隐藏可重新关注的作者',()=>{
  let animation,removed=0,cancelled=0,synced=0;const sg={animate:()=>animation={},remove:()=>removed++,getAnimations:()=>[{cancel:()=>cancelled++}]},b=button('pill',{id:'peer'});
  b.closest=()=>sg;b.getBoundingClientRect=()=>({left:0,top:0,width:40,height:40});
  const ctx=realm({STATE:{follows:new Set()},needLogin:()=>false,reduced:()=>false,IC:{check:'<svg/>'},USERS:{peer:{c:'pink'}},fxPop(){},burst(){},haptic(){},
    syncInteraction:()=>synced++,$$:()=>[]});
  const text=section('  follow: b => {','  share: () =>');vm.runInContext('followAction = ('+text.trim().replace(/^follow:\s*/,'').replace(/,\s*$/,'')+');',ctx);
  ctx.followAction(b);assert.equal(sg._followLeaving,true);ctx.STATE.follows.delete('peer');animation.onfinish();
  assert.equal(sg._followLeaving,false);assert.equal(removed,0);assert.equal(cancelled,1);assert.equal(synced,1);
});
test('收藏补入新卡后同步播放、排版与 rendered 事件，不失去材质和浮现挂载',()=>{
  let rendered=0,sync=0,loops=0;const host={appendChild(){}},fresh={querySelectorAll:()=>[]},old={classList:{contains:()=>true},replaceWith(){}};
  const content={querySelector:q=>q==='.mason,.grid-p'?fresh:null};const ctx=realm({document:{createElement:()=>({content}),dispatchEvent:()=>rendered++},
    $:q=>q==='#app .mtb'?host:null,$$:()=>[],meTabBody:()=>'<div/>',onClean:()=>loops++,waveLoop:()=>()=>{},rollNums(){},fitText(){},syncLive:()=>sync++});
  host.querySelector=()=>old;vm.runInContext(section('function patchBookmarks()', 'function syncInteraction('),ctx);ctx.patchBookmarks();
  assert.equal(rendered,1);assert.equal(sync,1);assert.equal(loops,1);
});
function coRealm(text=source){
  const ctx=realm({ME:'me',CO:{orders:[]},CO_FREE_REV:2,CO_AUTO_DAYS:7,H:3600000,SVC_DEF:{arr:{n:'编曲',c:'pink',f:[['style','风格']]}},CO_ST:{},
    f2y:x=>x/100,apiUser(){},coT:v=>v?+new Date(v):undefined,CO_BY:id=>ctx.CO.orders.find(o=>o.id===id),
    coOther:o=>o.to==='me'?o.from:o.to,repOf:()=>({avg:4.5}),svcIcon:()=>'<svg/>',av:()=>'<span/>',stars:()=>'*',esc:x=>String(x),
    USERS:{me:{name:'我'},peer:{name:'对方'}},cny:x=>x==null?'面议':'¥'+x,coNet:x=>x*.95,CO_FEE:.05,coDay:()=> '11 月 1 日',coFv:(o,k)=>o.fields?.[k] || null});
  vm.runInContext(section('const coTodo =', '/* 主页「合作」',text),ctx);return ctx;
}
const fullOrder=(st,recipient=true)=>({id:'c',from:recipient?'peer':'me',to:recipient?'me':'peer',svc:'arr',title:'邀约',st,v:3,rev:1,budget:100,price:125,
  due:'2 周内',delivAt:100,note:'保留原描述',fields:{style:'lo-fi'},offers:[{by:'me',price:110,note:'旧报价'},{by:'peer',price:125,note:'新报价'}],rated:{},deliv:{files:['delivery.wav']},ruling:{text:'裁决',refund:10}});
test('摘要合作卡保留优化前各状态的快捷操作和可见信息',()=>{
  const current=coRealm(),old=coRealm(baseline);for(const st of ['sent','counter','accepted','paid','revising','delivered','done','dispute','refunded'])for(const recipient of [true,false]){
    const full=fullOrder(st,recipient),summary={...full,summary:true,lastOffer:full.offers.at(-1),previousOfferPrice:full.offers.at(-2).price,offers:[],deliv:{summary:true}};
    assert.equal(current.coActs(summary),old.coActs(full),`${st}/${recipient} 快捷操作改变`);assert.equal(current.coCard(summary),old.coCard(full),`${st}/${recipient} 卡片信息改变`);
  }
});
test('摘要最新报价与评价状态准确决定待处理筛选',()=>{
  const ctx=coRealm();ctx.CO.orders=[{...fullOrder('counter'),summary:true,lastOffer:{by:'me',price:100},offers:[]},{...fullOrder('done'),summary:true,rated:{me:true}}];
  assert.equal(vm.runInContext('coTodo().length',ctx),0);ctx.CO.orders[0].lastOffer.by='peer';assert.equal(vm.runInContext('coTodo().length',ctx),1);
});
test('合作摘要映射恢复展示字段但不传输交付内容，状态更新让旧详情失效',()=>{
  const ctx=coRealm();vm.runInContext(section('function coMapCard(s)', 'async function coLoad()'),ctx);
  const input={id:'c',no:'CO-c',from:{id:'peer'},to:{id:'me'},svc:'arr',title:'邀约',status:'counter',v:3,rev:1,budget:10000,price:12500,
    fields:{style:'lo-fi'},note:'描述',lastOffer:{by:'peer',price:12500,note:'新报价',at:'2026-10-11'},previousOfferPrice:11000,rated:['me'],hasDelivery:true,ruling:{kind:'partial',refund:1000,text:'裁决'}};
  const o=ctx.coMapCard(input);assert.equal(o.lastOffer.price,125);assert.equal(o.previousOfferPrice,110);assert.equal(o.note,'描述');assert.deepEqual(plain(o.fields),{style:'lo-fi'});
  assert.deepEqual(plain(o.deliv),{summary:true});assert.equal(o.ruling.refund,10);assert.equal(o.rated.me,true);
  o.summary=false;o.deliv={files:['full.wav']};ctx.coMapCard(input);assert.equal(o.summary,false);assert.deepEqual(plain(o.deliv),{files:['full.wav']});
  ctx.coMapCard({...input,status:'delivered'});assert.equal(o.summary,true);assert.deepEqual(plain(o.deliv),{summary:true});
});
function hydrationRealm(){
  const actions={},orders={c:{id:'c',live:true,summary:true}},calls=[],invoked=[];let resolve;
  const ctx=realm({ME:'me',ACCOUNT_PAGES:{epoch:0},API:{req:(method,path)=>{calls.push(path);return new Promise(r=>resolve=r);}},CO_BY:id=>orders[id],
    accountSession:()=>{const me=ctx.ME,epoch=ctx.ACCOUNT_PAGES.epoch;return ()=>ctx.ME===me && ctx.ACCOUNT_PAGES.epoch===epoch;},
    coMap:full=>Object.assign(orders[full.id],full,{summary:false}),apiFail:e=>{throw e;},wrapAct:(name,fn)=>{actions[name]=(b,e)=>fn((button,event)=>invoked.push({button,event,id:button.dataset.id,a:button.dataset.a,summary:orders.c.summary}),b,e);}});
  vm.runInContext(section('const CO_DETAILS =', '{ const resetAccount'),ctx);return {ctx,actions,orders,calls,invoked,reply:full=>resolve(full)};
}
test('原合作快捷按钮单次点击按需补详情，保留节点、data-a、事件及单一在途请求',async()=>{
  const r=hydrationRealm(),b={dataset:{id:'c',a:'accept'},isConnected:true},e={clientX:10};const first=r.actions['co-a'](b,e),second=r.actions['co-view']({...b,dataset:{id:'c'}},e);
  assert.equal(b.disabled,true);assert.equal(r.invoked.length,0);assert.equal(r.calls.length,1);r.reply({id:'c',note:'full'});await Promise.all([first,second]);
  assert.equal(r.invoked[0].button,b);assert.equal(r.invoked[0].event,e);assert.equal(r.invoked[0].a,'accept');assert.equal(r.invoked[0].summary,false);assert.equal(b.disabled,false);assert.equal(vm.runInContext('CO_DETAILS.size',r.ctx),0);
});
test('合作补详情期间换账号、重置会话或移除按钮，不执行旧动作',async()=>{
  for(const change of ['account','epoch','disconnect','id']){const r=hydrationRealm(),b={dataset:{id:'c',a:'pay'},isConnected:true};const task=r.actions['co-a'](b,{});
    if(change==='account')r.ctx.ME='new';if(change==='epoch')r.ctx.ACCOUNT_PAGES.epoch++;if(change==='disconnect')b.isConnected=false;if(change==='id')b.dataset.id='other';
    r.reply({id:'c'});await task;assert.equal(r.invoked.length,0,change);if(change==='account'||change==='epoch')assert.equal(r.orders.c.summary,true);assert.equal(b.disabled,false);
  }
});
