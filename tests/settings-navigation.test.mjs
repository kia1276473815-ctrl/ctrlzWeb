// 运行真实导航代码；模拟浏览器 history 事件，不读取账号或调用业务接口。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert(a >= 0 && b > a, from); return source.slice(a, b);
};
const navigation = section('const HST = ', '/* 顶栏：往下滑');
const goSource = section('function go(h)', 'function render(force)');
const docTabSource = source.match(/ACTIONS\['doc-tab'\] = [^\n]+/)[0];

function app(url = 'https://example.test/#home', previous) {
  const entries = previous ? structuredClone(previous.entries) : [{url, state:null}];
  let index = previous?.index ?? 0, renders = 0;
  const events = new Map(), pending = [], layer = {firstElementChild:null}, overlays = {search:null,lab:null};
  const current = () => new URL(entries[index].url);
  const emit = type => { for (const f of events.get(type) || []) f(); };
  const changed = (before, after) => {
    if (new URL(before).hash !== new URL(after).hash) pending.push(() => emit('hashchange'));
  };
  const history = {
    get state() { return entries[index].state; }, get length() { return entries.length; },
    replaceState(state, _title, next) { entries[index] = {state:structuredClone(state), url:next == null ? current().href : new URL(next, current()).href}; },
    pushState(state, _title, next) { const url = next == null ? current().href : new URL(next, current()).href; entries.splice(index + 1); entries.push({state:structuredClone(state),url}); index++; },
    go(delta) { const next = index + delta; if (next < 0 || next >= entries.length || next === index) return;
      const before = current().href; index = next; pending.push(() => emit('popstate')); changed(before,current().href); },
    back() { this.go(-1); }, forward() { this.go(1); }
  };
  const location = {
    get hash() { return current().hash; },
    set hash(hash) { const before = current().href, next = new URL(hash.startsWith('#') ? hash : '#' + hash, current()).href;
      if (before === next) return; history.pushState(null,'',next); changed(before,next); },
    replace(next) { const before=current().href; entries[index]={url:new URL(next,current()).href,state:null}; changed(before,current().href); }
  };
  const ctx = vm.createContext({
    location, history, UI:{shop:{cat:'all',sub:'all'}}, CUR:{hash:location.hash,post:null}, ACTIONS:{}, RL:{on:false}, ME:'me',
    P:id => id==='p3' ? {id,cat:'preset'} : null, isOverlay:h => /^#?(post|v)-/.test(h),
    document:{body:{},documentElement:{scrollHeight:1000}}, MutationObserver:class {observe(){}},
    $:selector => selector==='#layer' ? layer : selector==='#srch' ? overlays.search : selector==='#vlov .sov' ? overlays.lab : null,
    $$:() => [], getComputedStyle:el => ({zIndex:el.z ?? 90}),
    closeSheet:() => {layer.firstElementChild=null;}, closeSearch:() => {overlays.search=null;}, vlClose:() => {overlays.lab=null;},
    addEventListener:(type,fn) => {if(!events.has(type)) events.set(type,[]); events.get(type).push(fn);},
    scrollY:40, innerHeight:800, scrollTo(){}, requestAnimationFrame:fn=>fn(), navDir:()=>null,
    pageSwap:(_dir,fn)=>fn(), render:()=>{ctx.CUR.hash=location.hash;renders++;}
  });
  vm.runInContext(navigation + goSource + docTabSource,ctx); ctx.initHistory();
  const flush = () => {let count=0;while(pending.length){assert(++count<40,'导航事件不得循环');pending.shift()();}};
  return {ctx, entries, history, location, layer, overlays, flush,
    read:code=>vm.runInContext(code,ctx), navigate:h=>{ctx.go(h);flush();}, back:()=>{ctx.ACTIONS.back();flush();},
    reload:()=>app(current().href,{entries,index}), get index(){return index;}, get renders(){return renders;}};
}

const documents = ['terms','privacy','collect','share','rules','copyright','refund','seller','license','consent'];
for (const root of ['home','shop','msg','me']) test(`${root} 进入设置后全部协议逐级返回设置`, () => {
  for (const doc of documents) {
    const a=app(`https://example.test/#${root}`);assert.equal(a.ctx.UI.lastTab,root);
    a.navigate('me-settings');a.navigate('doc-'+doc); const length=a.history.length;
    assert.equal(a.read('parentOf(location.hash)'),'me-settings');a.back();
    assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.read('HST.d'),1);assert.equal(a.history.length,length);
  }
});

test('首页/商城/私信进入设置和协议，完整逐级返回我之后回到第0层', () => {
  for(const root of ['home','shop','msg']){
    const a=app(`https://example.test/#${root}`);a.navigate('me-settings');a.navigate('doc-terms');const length=a.history.length;
    a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.read('HST.d'),1);
    a.back();assert.equal(a.location.hash,'#me');assert.equal(a.read('HST.d'),0);assert.equal(a.history.state.ctrlz,0);
    assert.equal(a.index,0);assert.equal(a.history.length,length);
    a.history.back();a.flush();assert.equal(a.location.hash,'#me');assert.equal(a.index,0);
  }
});

test('协议页签换页不新增历史，刷新后保留设置入口并可继续返回', () => {
  let a=app('https://example.test/#shop');a.navigate('me-settings');a.navigate('doc-terms');const length=a.history.length;
  for(const doc of documents){a.ctx.ACTIONS['doc-tab']({dataset:{v:doc}});a.flush();assert.equal(a.history.length,length);assert.equal(a.read('HST.d'),2);}
  a=a.reload();assert.equal(a.history.length,length);assert.equal(a.ctx.UI.lastTab,'shop');assert.equal(a.read('parentOf(location.hash)'),'me-settings');
  a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
  a.history.forward();a.flush();assert.equal(a.location.hash,'#doc-consent');assert.equal(a.read('parentOf(location.hash)'),'me-settings');
  a.back();assert.equal(a.location.hash,'#me-settings');
});

test('协议浏览器返回、前进和再次刷新都恢复同一入口', () => {
  let a=app('https://example.test/#home');a.navigate('me-settings');a.navigate('doc-privacy');a=a.reload();
  a.history.back();a.flush();assert.equal(a.location.hash,'#me-settings');assert.equal(a.read('HST.d'),1);
  a.history.forward();a.flush();assert.equal(a.location.hash,'#doc-privacy');assert.equal(a.read('parentOf(location.hash)'),'me-settings');
  a=a.reload();a.back();assert.equal(a.location.hash,'#me-settings');
});

test('从商品许可和付款退款协议返回真实商品入口', () => {
  for(const doc of ['license','refund']){
    let a=app('https://example.test/#shop');a.navigate('item-p3');a.navigate('doc-'+doc);a=a.reload();
    assert.equal(a.read('parentOf(location.hash)'),'item-p3');a.back();assert.equal(a.location.hash,'#item-p3');assert.equal(a.index,1);
  }
});

test('工作室和上架授权文档返回实际入口，仍保留原工作室层级', () => {
  for(const entrance of ['seller-overview','seller-upload']){
    let a=app('https://example.test/#me');a.navigate(entrance);a.navigate('doc-seller');
    a.ctx.ACTIONS['doc-tab']({dataset:{v:'consent'}});a.flush();a=a.reload();
    assert.equal(a.read('parentOf(location.hash)'),entrance);a.back();assert.equal(a.location.hash,'#'+entrance);assert.equal(a.index,1);
  }
});

test('商城根页协议返回商城，页签切换后没有旧协议入口残留', () => {
  const a=app('https://example.test/#shop');a.navigate('doc-refund');a.back();assert.equal(a.location.hash,'#shop');assert.equal(a.index,0);
  a.ctx.navTab('home');a.flush();a.navigate('doc-terms');a.back();assert.equal(a.location.hash,'#home');assert.equal(a.index,0);
});

test('文档中的普通协议链接继承该组入口，应用返回不堆叠设置历史', () => {
  const a=app('https://example.test/#home');a.navigate('me-settings');a.navigate('doc-terms');a.navigate('doc-privacy');
  assert.equal(a.read('parentOf(location.hash)'),'me-settings');a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
});

for (const child of ['blocks','close']) test(`设置的 ${child} 返回设置，直达链接也保留底层我`, () => {
  let a=app('https://example.test/#shop');a.navigate('me-settings');a.navigate('me-'+child);a=a.reload();a.back();
  assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
  a=app('https://example.test/#me-'+child);assert.equal(a.history.length,2);assert.equal(new URL(a.entries[0].url).hash,'#me');
  a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.history.length,2);
  a.back();assert.equal(a.location.hash,'#me');assert.equal(a.index,0);
});

test('无入口的协议深链只垫旧默认根页，不强制新增设置记录', () => {
  const a=app('https://example.test/#doc-terms');assert.equal(a.history.length,2);assert.equal(new URL(a.entries[0].url).hash,'#home');
  assert.equal(a.read('parentOf(location.hash)'),'home');a.back();assert.equal(a.location.hash,'#home');assert.equal(a.index,0);
});

test('协议上多个弹层先逐层关闭，刷新后页面返回仍回协议原入口', () => {
  let a=app('https://example.test/#shop');a.navigate('me-settings');a.navigate('doc-terms');
  a.layer.firstElementChild={z:90};a.ctx.ovSync();a.overlays.lab={z:96};a.ctx.ovSync();
  assert.equal(a.history.state.ov,2);assert.equal(a.read('parentOf(location.hash)'),'me-settings');
  a.history.back();a.flush();a.ctx.ovSync();a.flush();assert(a.layer.firstElementChild);assert.equal(a.overlays.lab,null);assert.equal(a.index,3);
  a.history.back();a.flush();a.ctx.ovSync();a.flush();assert.equal(a.layer.firstElementChild,null);assert.equal(a.index,2);
  a=a.reload();a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
});

test('关闭弹层之后打开协议保留入口，根页签继续保持第0层', () => {
  const a=app('https://example.test/#shop');a.navigate('me-settings');a.layer.firstElementChild={z:90};a.ctx.ovSync();
  a.ctx.go('doc-terms');a.ctx.ovSync();a.flush();assert.equal(a.location.hash,'#doc-terms');assert.equal(a.read('parentOf(location.hash)'),'me-settings');
  a.back();assert.equal(a.location.hash,'#me-settings');
  for(const tab of ['home','shop','msg','me']){a.ctx.navTab(tab);a.flush();assert.equal(a.location.hash,'#'+tab);assert.equal(a.index,0);assert.equal(a.read('HST.d'),0);}
});

test('历史快照保存已有 state 字段，协议换页和弹层也不丢弃', () => {
  let a=app('https://example.test/#home');a.navigate('me-settings');a.navigate('doc-terms');
  a.history.replaceState({...a.history.state,custom:{keep:'same-entry'}},'');a=a.reload();
  assert.equal(a.history.state.custom.keep,'same-entry');
  a.ctx.ACTIONS['doc-tab']({dataset:{v:'privacy'}});a.flush();assert.equal(a.history.state.custom.keep,'same-entry');
  a.layer.firstElementChild={z:90};a.ctx.ovSync();assert.equal(a.history.state.custom.keep,'same-entry');a.history.back();a.flush();
  assert.equal(a.history.state.custom.keep,'same-entry');assert.equal(a.read('parentOf(location.hash)'),'me-settings');
});

const legacyEntries = (root='shop', extra={}) => ({entries:[
  {url:'https://example.test/#'+root,state:{ctrlz:0}},
  {url:'https://example.test/#me-settings',state:{ctrlz:1}},
  {url:'https://example.test/#doc-terms',state:{ctrlz:2,...extra}}
],index:2});

for(const root of ['home','shop','msg','me']) test(`旧 ${root} 历史只有 ctrlz：协议刷新后真实退回设置，不伪造祖先`, () => {
  const a=app('https://example.test/#doc-terms',legacyEntries(root));
  assert.equal(a.read('docEntry(location.hash)'),null);assert.equal(a.history.state.ctrlzStack[0]??null,null);
  assert.equal(a.history.state.ctrlzStack[1]??null,null);assert.equal(a.history.state.ctrlz,2);
  const length=a.history.length;a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.history.length,length);
  assert.equal(a.read('HST.docBack'),false);a.back();assert.equal(a.location.hash,'#me');assert.equal(a.index,0);assert.equal(a.history.state.ctrlz,0);
});

test('旧协议页签换页再刷新保留缺口和自定义state，返回仍找到真实设置', () => {
  let a=app('https://example.test/#doc-terms',legacyEntries('shop',{custom:{keep:'legacy-custom'}}));const length=a.history.length;
  a.ctx.ACTIONS['doc-tab']({dataset:{v:'privacy'}});a.flush();assert.equal(a.history.length,length);a=a.reload();
  assert.equal(a.history.state.custom.keep,'legacy-custom');assert.equal(a.read('docEntry(location.hash)'),null);
  assert.equal(a.history.state.ctrlzStack[0]??null,null);a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
});

test('旧记录经过原生返回和前进后，协议的应用返回仍回设置', () => {
  const a=app('https://example.test/#doc-terms',legacyEntries());a.history.back();a.flush();assert.equal(a.location.hash,'#me-settings');
  a.history.forward();a.flush();assert.equal(a.location.hash,'#doc-terms');a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
});

test('上一版已写入假home和空洞的旧state，不能越过空洞推断文档入口', () => {
  const a=app('https://example.test/#doc-terms',legacyEntries('shop',{ctrlzStack:['#home',null,'#doc-terms']}));
  assert.equal(a.read('docEntry(location.hash)'),null);assert.equal(a.read('rootOf(location.hash)'),'#home');
  a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.read('HST.docBack'),false);
});

test('商品退款/许可和工作室的旧协议记录也真实退回原入口', () => {
  for(const [root,entry,doc]of [['shop','item-p3','license'],['shop','item-p3','refund'],['me','seller-overview','seller']]){
    const previous={entries:[{url:'https://example.test/#'+root,state:{ctrlz:0}},
      {url:'https://example.test/#'+entry,state:{ctrlz:1}},{url:'https://example.test/#doc-'+doc,state:{ctrlz:2}}],index:2};
    const a=app(previous.entries[2].url,previous);a.back();assert.equal(a.location.hash,'#'+entry);assert.equal(a.index,1);assert.equal(a.read('HST.docBack'),false);
  }
});

test('连续旧协议记录自动退到非协议入口，只渲染目标设置一次', () => {
  const previous=legacyEntries();previous.entries.push({url:'https://example.test/#doc-privacy',state:{ctrlz:3}});previous.index=3;
  const a=app(previous.entries[3].url,previous);const length=a.history.length;a.back();
  assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.history.length,length);assert.equal(a.renders,1);assert.equal(a.read('HST.docBack'),false);
});

test('刷新后未恢复的同hash旧协议弹层记录也能逐步找回设置', () => {
  const previous=legacyEntries();previous.entries.push({url:'https://example.test/#doc-terms',state:{ctrlz:3,ov:1}});previous.index=3;
  const a=app(previous.entries[3].url,previous);a.back();assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);
  assert.equal(a.read('HST.docBack'),false);assert.equal(a.read('HST.ov'),false);assert.equal(a.renders,1);
});

test('旧协议快速重复返回不重复请求浏览器退层', () => {
  const a=app('https://example.test/#doc-terms',legacyEntries());a.ctx.ACTIONS.back();a.ctx.ACTIONS.back();a.ctx.ACTIONS.back();a.flush();
  assert.equal(a.location.hash,'#me-settings');assert.equal(a.index,1);assert.equal(a.read('HST.docBack'),false);
});

test('只有一层的旧根页协议和直接协议深链保留根页返回规则', () => {
  const a=app('https://example.test/#doc-terms',{entries:[{url:'https://example.test/#shop',state:{ctrlz:0}},
    {url:'https://example.test/#doc-terms',state:{ctrlz:1}}],index:1});a.back();assert.equal(a.location.hash,'#shop');assert.equal(a.index,0);
  const direct=app('https://example.test/#doc-terms');direct.back();assert.equal(direct.location.hash,'#home');assert.equal(direct.index,0);
});

test('没有子层的未知旧协议使用有限的默认父级，不继续遍历浏览器历史', () => {
  const a=app('https://example.test/#doc-terms',{entries:[{url:'https://example.test/#doc-terms',state:{ctrlz:0}}],index:0});
  assert.equal(a.read('rootOf(location.hash)'),'#home');a.back();assert.equal(a.location.hash,'#home');assert.equal(a.index,0);assert.equal(a.read('HST.docBack'),false);
});
