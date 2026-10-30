// 对照优化前的真实函数，覆盖局部更新不得改变按钮设计、空态和操作路径。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
const section = (start,end,text=source) => { const a=text.indexOf(start),b=text.indexOf(end,a+start.length); assert(a>=0 && b>a,start); return text.slice(a,b); };
const realm = data => vm.createContext({console,Date,Map,Set,Promise,Event,...data});
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
  const ctx=realm({POSTS:[],STATE:{follows:new Set(),blocks:new Set(),settings:{pers:true}},UI:{homeTab:'fol'},LIVE:{next:null},blocked:()=>false,liveUser:()=>false,homeNext:()=>null,postCard(){},
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
