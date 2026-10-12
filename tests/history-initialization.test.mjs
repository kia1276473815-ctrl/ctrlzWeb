// 执行真实启动与导航代码，并检查 history 中 URL / state 的实际变更。
// 浏览器已实测：同文档历史的 query 不同时，片段改变不会触发 hashchange。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
};
const historySource = section('const HST = ', '/* 顶栏：往下滑');
const apiStartupSource = section('const API = {', '/* 后台会话：');

function start(url, {entries: previous, index: previousIndex, apiBase = ''} = {}) {
  const entries = previous ? previous.map(e => ({url: new URL(e.url).href, state: structuredClone(e.state)})) : [{url: new URL(url).href, state: null}];
  let index = previousIndex ?? entries.length - 1, renders = 0, closedSheets = 0;
  const events = new Map(), pending = [], layer = {firstElementChild: null}, overlays = {search:null,lab:null}, storage = {apiBase, apiTok: null};
  const current = () => new URL(entries[index].url);
  const send = type => { for (const handler of events.get(type) || []) handler(); };
  const queueHash = (oldUrl, nextUrl) => {
    const before = new URL(oldUrl), after = new URL(nextUrl);
    if (before.origin === after.origin && before.pathname === after.pathname && before.search === after.search && before.hash !== after.hash)
      pending.push(() => send('hashchange'));
  };
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    replaceState(state, _title, nextUrl) {
      entries[index] = {state: structuredClone(state), url: nextUrl === undefined ? entries[index].url : new URL(nextUrl, current()).href};
    },
    pushState(state, _title, nextUrl) {
      const next = {state: structuredClone(state), url: nextUrl === undefined ? entries[index].url : new URL(nextUrl, current()).href};
      entries.splice(index + 1); entries.push(next); index++;
    },
    go(delta) {
      const next = index + delta;
      if (next < 0 || next >= entries.length || next === index) return;
      const before = entries[index].url;
      index = next;
      pending.push(() => send('popstate'));
      queueHash(before, entries[index].url);
    },
    back() { this.go(-1); }
  };
  const location = {
    get hash() { return current().hash; },
    get search() { return current().search; },
    get pathname() { return current().pathname; },
    get origin() { return current().origin; },
    replace(nextUrl) {
      const before = entries[index].url;
      entries[index] = {state: null, url: new URL(nextUrl, current()).href};
      queueHash(before, entries[index].url);
    }
  };
  const ctx = vm.createContext({
    URLSearchParams, history, location, ACTIONS: {}, CUR: {hash: location.hash, post: null},
    UI: {shop: {cat: 'all', sub: 'all'}, lastTab: 'home'}, RL: {on: false}, ME: 'me',
    P: id => id === 'p3' ? {id, cat: 'preset'} : null,
    isOverlay: h => /^#?(post|v)-/.test(h),
    document: {body: {}, documentElement: {scrollHeight: 1000}, querySelector: () => ({content: 'self'})},
    MutationObserver: class { observe() {} },
    $: selector => selector === '#layer' ? layer : selector === '#srch' ? overlays.search : selector === '#vlov .sov' ? overlays.lab : null, $$: () => [],
    getComputedStyle: el => ({zIndex:el.z ?? 90}),
    closeSheet: () => { layer.firstElementChild = null; closedSheets++; }, closeSearch() {overlays.search=null;}, vlClose() {overlays.lab=null;},
    addEventListener: (type, handler) => { if (!events.has(type)) events.set(type, []); events.get(type).push(handler); },
    scrollY: 40, innerHeight: 800, scrollTo() {}, requestAnimationFrame: fn => fn(),
    pageSwap: (_direction, render) => render(), navDir: () => 'back',
    render: () => { ctx.CUR.hash = location.hash; renders++; },
    store: {get: (key, fallback) => storage[key] ?? fallback, set: (key, value) => { storage[key] = value; }}
  });
  vm.runInContext(historySource, ctx);
  vm.runInContext(apiStartupSource, ctx);
  const flush = () => { let count = 0; while (pending.length) { assert(++count < 20, '导航事件不得无限循环'); pending.shift()(); } };
  return {ctx, entries, history, location, layer, overlays, flush, read: text => vm.runInContext(text, ctx),
    get index() { return index; }, get renders() { return renders; }, get closedSheets() { return closedSheets; }};
}

test('?api=self 深链在消费 query 后建立底层历史，页面返回完成路由且不增加历史', () => {
  assert(apiStartupSource.indexOf('API.init();') < apiStartupSource.indexOf('initHistory();'));
  const app = start('https://example.test/?api=self#item-p3');
  assert.deepEqual(app.entries.map(e => new URL(e.url).search), ['', '']);
  assert.deepEqual(app.entries.map(e => e.state.ctrlz), [0, 1]);
  assert.equal(app.read('API.base'), 'https://example.test');
  assert.equal(app.read('HST.d'), 1);
  assert.equal(app.ctx.CUR.hash, '#item-p3');
  app.ctx.ACTIONS.back(); app.flush();
  assert.equal(app.location.hash, '#shop');
  assert.equal(app.ctx.CUR.hash, '#shop');
  assert.equal(app.read('HST.d'), 0);
  assert.equal(app.read('HST.pend'), null);
  assert.equal(app.history.length, 2);
  assert.equal(app.index, 0);
  assert.equal(app.renders, 1);
});

test('无 query 的直接子页链接保留原页面返回和浏览器返回层级', () => {
  const button = start('https://example.test/#item-p3');
  button.ctx.ACTIONS.back(); button.flush();
  assert.equal(button.ctx.CUR.hash, '#shop');
  assert.equal(button.read('HST.d'), 0);
  assert.equal(button.history.length, 2);
  const gesture = start('https://example.test/#item-p3');
  gesture.history.back(); gesture.flush();
  assert.equal(gesture.ctx.CUR.hash, '#shop-preset');
  assert.equal(gesture.read('HST.d'), 0);
  assert.equal(gesture.read('NAVX.back'), false);
  assert.equal(gesture.renders, 1);
});

test('刷新已有 ctrlz state 时沿用层级，API query 清理不重建历史', () => {
  const app = start('https://example.test/?api=self#item-p3', {entries: [
    {url: 'https://example.test/#shop', state: {ctrlz: 0}},
    {url: 'https://example.test/#shop-preset', state: {ctrlz: 1}},
    {url: 'https://example.test/?api=self#item-p3', state: {ctrlz: 2}}
  ]});
  assert.equal(app.history.length, 3);
  assert.equal(app.index, 2);
  assert.equal(app.read('HST.d'), 2);
  assert.equal(app.read('HST.stk[2]'), '#item-p3');
  assert.equal(app.history.state.ctrlz, 2);
  assert.equal(app.location.search, '');
  assert.equal(app.renders, 0);
  app.history.back(); app.flush();
  assert.equal(app.ctx.CUR.hash, '#shop-preset');
  assert.equal(app.read('HST.d'), 1);
  assert.equal(app.history.length, 3);
});

test('弹层同 hash 的浏览器返回只关闭弹层，不重渲染或再退页面', () => {
  const app = start('https://example.test/?api=self#item-p3');
  app.layer.firstElementChild = {id: 'sheet'};
  app.ctx.ovSync();
  assert.equal(app.read('HST.ov'), true);
  assert.equal(app.read('HST.d'), 2);
  assert.equal(app.history.state.ov, 1);
  assert.equal(app.entries[1].url, app.entries[2].url);
  app.history.back(); app.flush();
  assert.equal(app.layer.firstElementChild, null);
  assert.equal(app.read('HST.ov'), false);
  assert.equal(app.read('HST.d'), 1);
  assert.equal(app.ctx.CUR.hash, '#item-p3');
  assert.equal(app.renders, 0);
  assert.equal(app.closedSheets, 1);
  app.ctx.ovSync(); app.flush();
  assert.equal(app.index, 1);
});

test('根页签互切始终原地替换，子页面切根页签先退到第 0 层', () => {
  const app = start('https://example.test/?api=self#home');
  for (const tab of ['shop', 'msg', 'me', 'home']) {
    app.ctx.navTab(tab); app.flush();
    assert.equal(app.ctx.CUR.hash, '#' + tab);
    assert.equal(app.history.length, 1);
    assert.equal(app.history.state.ctrlz, 0);
    assert.equal(app.read('HST.d'), 0);
  }
  const child = start('https://example.test/?api=self#item-p3');
  child.ctx.navTab('msg'); child.flush();
  assert.equal(child.ctx.CUR.hash, '#msg');
  assert.equal(child.index, 0);
  assert.equal(child.history.state.ctrlz, 0);
  assert.equal(child.read('HST.pend'), null);
  assert.equal(child.history.length, 2);
  assert.equal(child.renders, 1);
});

test('草稿面板上打开实验室增加一层，连续返回只逐层关闭，不提前丢草稿', () => {
  const app = start('https://example.test/?api=self#home');
  const draft = {id:'draft',z:90,text:'尚未发出的正文'};app.layer.firstElementChild=draft;app.ctx.ovSync();
  app.overlays.lab={id:'lab',z:96};app.ctx.ovSync();
  assert.equal(app.history.state.ov,2);assert.equal(app.read('HST.d'),2);
  app.history.back();app.flush();app.ctx.ovSync();app.flush();
  assert.equal(app.overlays.lab,null);assert.equal(app.layer.firstElementChild,draft);assert.equal(draft.text,'尚未发出的正文');
  assert.equal(app.read('HST.ov'),true);assert.equal(app.read('HST.ovN'),1);assert.equal(app.index,1);assert.equal(app.renders,0);
  app.history.back();app.flush();app.ctx.ovSync();app.flush();assert.equal(app.layer.firstElementChild,null);assert.equal(app.index,0);assert.equal(app.read('HST.ov'),false);
});

test('从实验室按钮关闭或一次关闭所有弹层，退掉对应历史且不再多退页面', () => {
  const app=start('https://example.test/?api=self#item-p3');app.layer.firstElementChild={z:90};app.ctx.ovSync();app.overlays.lab={z:96};app.ctx.ovSync();
  app.ctx.vlClose();app.ctx.ovSync();app.flush();assert.equal(app.index,2);assert(app.layer.firstElementChild);assert.equal(app.read('HST.d'),2);
  app.overlays.lab={z:96};app.ctx.ovSync();app.ctx.closeOverlays();app.ctx.ovSync();app.flush();
  assert.equal(app.index,1);assert.equal(app.read('HST.d'),1);assert.equal(app.ctx.CUR.hash,'#item-p3');assert.equal(app.renders,0);assert.equal(app.read('HST.ovN'),0);
});

test('视频详情中的搜索比实验室层级更高，返回优先关搜索', () => {
  const app=start('https://example.test/?api=self#home');app.overlays.lab={z:96};app.ctx.ovSync();app.overlays.search={z:100};app.ctx.ovSync();
  app.history.back();app.flush();assert.equal(app.overlays.search,null);assert(app.overlays.lab);assert.equal(app.read('HST.ovN'),1);assert.equal(app.index,1);
  app.ctx.ovSync();app.flush();assert.equal(app.index,1);
});

test('刷新后返回未恢复的弹层历史时，不把不存在的弹层标记为仍打开', () => {
  const app=start('https://example.test/?api=self#home',{entries:[
    {url:'https://example.test/#home',state:{ctrlz:0}},
    {url:'https://example.test/#home',state:{ctrlz:1,ov:1}},
    {url:'https://example.test/?api=self#home',state:{ctrlz:2,ov:2}}
  ]});
  assert.equal(app.read('HST.d'),2);app.history.back();app.flush();
  assert.equal(app.read('HST.d'),1);assert.equal(app.read('HST.ov'),false);assert.equal(app.read('HST.ovN'),0);
  app.ctx.ovSync();app.flush();assert.equal(app.index,1);assert.equal(app.renders,0);
  app.history.back();app.flush();assert.equal(app.index,0);assert.equal(app.read('HST.d'),0);
});
