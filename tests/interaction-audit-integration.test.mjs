import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a, b) => { const start = source.indexOf(a), end = source.indexOf(b, start + a.length); assert(start >= 0 && end > start, a); return source.slice(start, end); };
const line = a => source.split('\n').find(s => s.startsWith(a));
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

function comments({live = true, request} = {}){
  const pending = defer(), jobs = new Map(), handlers = new Map(), calls = [], paints = [], toasts = [], errors = [], saved = new Map(); let timer = 0, closes = 0;
  const first = {id:live ? 'c_first' : undefined, u:'me', t:'相同正文'}, second = {id:live ? 'c_second' : undefined, u:live ? 'me' : 'other', t:'相同正文'};
  const post = {id:'p', live, cmts:2};
  const ctx = vm.createContext({Map, Set, Promise, UI:{newCmts:{p:[first]}, meTab:'works'}, STATE:{role:'user', cdel:new Set()}, COMMENTS:{p:[first, second], _default:[]}, ADM:{taken:{cmt:{}}}, ME:'me', CUR:{post:'p'}, RL:{on:false, cm:false},
    API:{base:'https://fixture.invalid', epoch:1, on:() => live, req:async (...args) => { calls.push({me:ctx.ME, args}); return request ? request(...args) : pending.promise; }},
    POST:id => id === 'p' ? post : null, hash:s => s, blocked:() => false, liveUser:() => live && ctx.STATE.role === 'user',
    store:{set:(k, v) => saved.set(k, Array.from(v))}, setTimeout:(fn, ms) => { jobs.set(++timer, {fn, ms}); return timer; }, clearTimeout:id => jobs.delete(id),
    addEventListener:(name, fn) => handlers.set(name, fn), ACTIONS:{}, toast:(...args) => toasts.push(args), closeSheet:() => closes++,
    renderPost:() => paints.push(vm.runInContext('cmtsOf("p").map(c=>c.id || c.u)', ctx)), reelCur:() => post, openReelCm:() => paints.push('reel'),
    patchMyComments:() => paints.push('mine'), myCmtInvalidate:() => paints.push('invalidate'), apiFail:e => errors.push(e), rerender:() => paints.push('whole')});
  vm.runInContext([line('const cmtKey ='), line('const cmtsOf ='), line('const cmtMine ='), line('function wrapAct(')].join('\n'), ctx);
  vm.runInContext(section('const CDEL_PEND =', 'function sheet('), ctx);
  vm.runInContext('Object.assign(ACTIONS, {' + section("  'cmt-del': b =>", '  // 卖家商品管理') + '});', ctx);
  vm.runInContext(section('function cmtPaint(', 'async function liveCmtSent('), ctx);
  vm.runInContext(section("wrapAct('cmt-dgo', async", '/* 发帖：'), ctx);
  const key = c => vm.runInContext('cmtKey("p", fixture)', Object.assign(ctx, {fixture:c}));
  const visible = () => vm.runInContext('cmtsOf("p")', ctx);
  const remove = (c = first) => ctx.ACTIONS['cmt-del']({dataset:{p:'p', k:key(c)}});
  const fire = () => { for (const [id, job] of [...jobs]){ jobs.delete(id); job.fn(); } };
  return {ctx, post, first, second, jobs, handlers, calls, paints, toasts, errors, saved, pending, key, visible, remove, fire, get closes(){return closes;}};
}

test('真实同作者同正文评论以 ID 区分，待删立即隐藏且撤销恢复原对象，不发送请求', async () => {
  const r = comments(); assert.notEqual(r.key(r.first), r.key(r.second));
  r.remove(); assert.deepEqual(Array.from(r.visible(), c => c.id), ['c_second']); assert.equal(r.post.cmts, 2); assert.equal(r.calls.length, 0);
  assert.equal([...r.jobs.values()][0].ms, 5000); r.toasts[0][3].undo(); r.fire(); await tick();
  assert.equal(r.visible().length, 3); assert.equal(r.ctx.COMMENTS.p[0], r.first); assert.equal(r.calls.length, 0); assert.equal(r.jobs.size, 0);
});

test('五秒提交期间继续隐藏、禁止迟到撤销，成功按 ID 清两份缓存，保留其它评论', async () => {
  const r = comments(); r.remove(); r.fire(); await tick();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].args[1], '/comments/c_first'); assert.equal(r.post.cmts, 1); assert.equal(r.closes, 0);
  r.toasts[0][3].undo(); assert.deepEqual(Array.from(r.visible(), c => c.id), ['c_second']);
  r.pending.resolve({ok:true}); await tick();
  assert.deepEqual(Array.from(r.ctx.COMMENTS.p, c => c.id), ['c_second']); assert.equal(r.ctx.UI.newCmts.p.length, 0); assert.equal(r.visible().length, 1);
  assert(r.paints.includes('invalidate')); r.toasts[0][3].undo(); assert.equal(r.post.cmts, 1); assert.equal(r.calls.length, 1);
  r.ctx.STATE.cdel.add(r.key(r.first)); r.ctx.ADM.taken.cmt[r.key(r.first)] = true; r.ctx.COMMENTS.p.push(r.first);
  assert.equal(r.visible().length, 2, '服务器恢复的真实评论仍绕过旧原型持久删除标记');
});

test('删除失败保留缓存并回滚这次减少的计数，不覆盖同时新增评论的计数', async () => {
  const r = comments(); r.remove(); r.fire(); await tick(); assert.equal(r.post.cmts, 1);
  r.post.cmts++; r.pending.reject(Object.assign(new Error('断网'), {code:'network'})); await tick();
  assert.equal(r.post.cmts, 3); assert.equal(r.visible().length, 3); assert.equal(r.ctx.COMMENTS.p[0], r.first); assert.equal(r.ctx.UI.newCmts.p[0], r.first);
  assert.equal(r.errors.length, 1); assert.equal(r.ctx.STATE.cdel.has(r.key(r.first)), false); assert.deepEqual(r.saved.get('cdel'), []);
});

for (const change of ['account', 'service', 'epoch', 'logout']) test(`旧删除计时器在${change}变化后不提交、不隐藏新作用域的评论`, async () => {
  const r = comments(); r.remove();
  if (change === 'account') r.ctx.ME = 'next';
  if (change === 'service') r.ctx.API.base = 'https://other.invalid';
  if (change === 'epoch') r.ctx.API.epoch++;
  if (change === 'logout') r.ctx.STATE.role = 'guest';
  assert.equal(r.visible().length, 3); r.fire(); await tick(); r.toasts[0][3].undo();
  assert.equal(r.calls.length, 0); assert.equal(r.post.cmts, 2); assert.equal(r.ctx.STATE.cdel.size, 0);
});

test('提交后切账号，旧成功响应不删除新账号缓存或更新新账号计数', async () => {
  const r = comments(); r.remove(); r.fire(); await tick(); const replacement = {...r.first};
  r.ctx.ME = 'next'; r.ctx.API.epoch++; r.ctx.COMMENTS.p = [replacement, r.second]; r.post.cmts = 8;
  r.pending.resolve({ok:true}); await tick(); assert.equal(r.ctx.COMMENTS.p[0], replacement); assert.equal(r.post.cmts, 8); assert(!r.paints.includes('invalidate'));
});

test('pagehide 尽力提交使用 keepalive，只发一次；切换服务后的 pagehide 不发送旧删除', async () => {
  const r = comments(); r.remove(); r.handlers.get('pagehide')(); r.handlers.get('pagehide')(); r.fire(); await tick();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].args[4].keepalive, true); assert.equal(r.visible().length, 1);
  r.pending.resolve({ok:true}); await tick();
  const old = comments(); old.remove(); old.ctx.API.base = 'https://other.invalid'; old.handlers.get('pagehide')(); old.fire(); await tick(); assert.equal(old.calls.length, 0);
});

test('原型的无 ID 评论延迟提交仍保留持久删除标记和计数，无后端请求', async () => {
  const r = comments({live:false}); r.remove(); assert.equal(r.visible().length, 1); r.fire(); await tick();
  assert.equal(r.visible().length, 1); assert.equal(r.post.cmts, 1); assert.equal(r.calls.length, 0); assert(r.ctx.STATE.cdel.has(r.key(r.first))); assert(r.saved.get('cdel').includes(r.key(r.first)));
});

test('后台重新读取空商城、失败商城和失败首页都清理加载占位，pending 保留占位', () => {
  for (const kind of ['shop', 'feed']) for (const status of ['ready', 'error']){
    let removed = 0; const parent = {}, note = {parentElement:parent, innerHTML:''};
    const ctx = vm.createContext({LIVE:{feed:{status:'pending'}}, LSHOP:{feed:{status:'pending'}}, $:() => note,
      $$:(selector, owner) => { assert.equal(selector, '.sk-list'); assert.equal(owner, parent); return [{remove:() => removed++}]; }, feedStatusHtml:() => 'feed', shopStatusHtml:() => 'shop'});
    vm.runInContext(line(kind === 'shop' ? 'function syncShopState()' : 'function syncFeedState()'), ctx);
    const sync = vm.runInContext(kind === 'shop' ? 'syncShopState' : 'syncFeedState', ctx); sync(); assert.equal(removed, 0);
    (kind === 'shop' ? ctx.LSHOP : ctx.LIVE).feed.status = status; sync(); assert.equal(removed, 1);
  }
});

test('请求层实际 fetch 透传明确的 keepalive，默认请求不加该选项', async () => {
  const calls = [], ctx = vm.createContext({Promise, Date, AbortController, TypeError, setTimeout, clearTimeout, store:{get(){}, set(){}},
    liveLoggedOut(){}, fetch:async (url, init) => { calls.push(init); return {status:200, ok:true, headers:{get:() => 'application/json'}, json:async () => ({ok:true})}; }});
  vm.runInContext(section('function requestTask(', 'API.init();'), ctx); vm.runInContext("API.base='https://fixture.invalid';API.epoch=1;API.tok={access:'fixture'};", ctx);
  const api = vm.runInContext('API', ctx); await api.req('DELETE', '/comments/c', undefined, true, {keepalive:true}); await api.req('GET', '/posts');
  assert.equal(calls[0].keepalive, true); assert.equal('keepalive' in calls[1], false); assert.equal(calls[0].method, 'DELETE');
});
