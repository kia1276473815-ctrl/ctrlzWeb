import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, a); return source.slice(start, end);
};
const line = a => source.split('\n').find(s => s.startsWith(a));
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
};
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// 直接执行真实源函数，隔离请求、计时器和页面绘制，不读取或修改真实账号。
function comments({temporary = false, sendState = '', review = false, counted, activeMine = false, realRead = false} = {}){
  const pending = defer(), reads = [], jobs = new Map(), handlers = new Map(), requests = [], toasts = [], failures = [], paints = [], refreshes = [], microtasks = [];
  let timer = 0;
  const first = {u:'me', t:'待检查的评论', likes:0, ...(temporary ? {} : {id:'c_first'}), ...(sendState ? {sendState, _client:'client_first'} : {}), ...(review ? {review:true} : {}), ...(counted === undefined ? {} : {_counted:counted})};
  const other = {id:'c_other', u:'other', t:'保留的公开评论', likes:0};
  const mineOther = {id:'c_mine_other', u:'me', t:'保留的另一条本人评论', likes:0};
  const post = {id:'p', author:'other', live:true, cmts:review || counted === false ? 1 : 2, cmtsRev:1};
  const ctx = vm.createContext({Map, Set, Promise, Date, JSON, AbortController,
    UI:{newCmts:{p:temporary ? [first] : []}, meTab:activeMine ? 'cmts' : 'works'},
    STATE:{role:'user', cdel:new Set(), blocks:new Set(), liked:new Set()},
    COMMENTS:{p:temporary ? [other] : [first, other], _default:[]}, ADM:{taken:{cmt:{}}}, ME:'me',
    CUR:{post:activeMine ? null : 'p', key:activeMine ? 'me|cmts' : 'post|p'}, RL:{on:false, cm:false},
    LIVE:{pend:{}}, BODY:{}, TRACKS:{}, POSTS:[post], TC_PALS:{},
    API:{base:'https://fixture.invalid', epoch:1, on:() => true, req:async (...args) => { requests.push({me:ctx.ME, args}); if (realRead && args[0] === 'GET'){ const read = defer(); reads.push(read); return read.promise; } return pending.promise; }},
    POST:id => id === 'p' ? post : null, hash:t => t, esc:t => t, ago:() => '刚刚', apiUser:() => {}, cmtLikeHydrate:c => c, blocked:() => false,
    liveUser:() => ctx.STATE.role === 'user' && !!ctx.API.base,
    store:{set(){}},
    setTimeout:(fn, ms) => { jobs.set(++timer, {fn, ms}); return timer; }, clearTimeout:id => jobs.delete(id),
    queueMicrotask:fn => microtasks.push(fn), addEventListener:(name, fn) => handlers.set(name, fn), ACTIONS:{},
    toast:(...args) => toasts.push(args), closeSheet(){},
    renderPost:() => paints.push('post'), reelCur:() => post, openReelCm:() => paints.push('reel'), reelBar:() => paints.push('bar'),
    patchMyComments:() => paints.push('mine'), apiFail:e => failures.push(e), rerender(){},
    loadMyComments:(...args) => { refreshes.push(args); return Promise.resolve(); }
  });
  vm.runInContext(section('const cmtKey =', 'function cmtFlash('), ctx);
  vm.runInContext([line('const cmtMine ='), line('const cmtScope ='), line('function wrapAct(')].join('\n'), ctx);
  vm.runInContext(section('const cmtCtl =', '/* —— 卖家改自己的商品'), ctx);
  vm.runInContext(section('const CDEL_PEND =', 'function sheet('), ctx);
  vm.runInContext('Object.assign(ACTIONS, {' + section("  'cmt-del': b =>", '  // 卖家商品管理') + '});', ctx);
  vm.runInContext(section('const MY_CMTS =', 'function myCmtStatusHtml('), ctx);
  vm.runInContext(section('function myCmtStatusHtml(', '// 只更新评论列表和总数'), ctx);
  vm.runInContext(section('function cmtSendFeedback(', 'async function liveCmtSent('), ctx);
  vm.runInContext(section('const pendingCmt =', "wrapAct('cmt',"), ctx);
  vm.runInContext(section("wrapAct('cmt-dgo', async", '/* 发帖：'), ctx);
  vm.runInContext(section('function apiPost(', 'const apiCmt ='), ctx);
  if (realRead){ vm.runInContext(line('const apiCmt ='), ctx); vm.runInContext(section('function loadMyComments(', "ACTIONS['my-cmt-retry']"), ctx); }
  ctx.first = first; ctx.mineOther = mineOther;
  vm.runInContext('Object.assign(myCmtState(),{rows:[{p:POST("p"),c:first},{p:POST("p"),c:mineOther}],count:2,loaded:true,status:"ready",lastRead:Date.now(),next:"next_page"})', ctx);
  const key = c => vm.runInContext('cmtKey("p", fixture)', Object.assign(ctx, {fixture:c}));
  const remove = (c = first) => ctx.ACTIONS['cmt-del']({dataset:{p:'p', k:key(c)}});
  const visible = () => vm.runInContext('cmtsOf("p")', ctx);
  const mine = () => vm.runInContext('myComments()', ctx);
  const state = () => vm.runInContext('myCmtState()', ctx);
  const fire = () => { for (const [id, job] of [...jobs]){ jobs.delete(id); job.fn(); } };
  const flush = () => { for (const job of microtasks.splice(0)) job(); };
  const mapPost = count => vm.runInContext('apiPost(rawPost)', Object.assign(ctx, {rawPost:{id:'p',author:{id:'other'},title:'测试帖子',body:'正文',type:'text',style:{},likeCount:0,commentCount:count,status:'published',createdAt:'2026-10-12T00:00:00.000Z'}}));
  return {ctx, post, first, other, mineOther, pending, reads, jobs, requests, toasts, failures, paints, refreshes, microtasks, key, remove, visible, mine, state, fire, flush, mapPost};
}

for (const sendState of ['sending', 'failed', '']) test(`真实未同步评论 ${sendState || '无 ID'} 不提供普通删除，陈旧点击也不启动删除计时器`, () => {
  const r = comments({temporary:true, sendState});
  const html = vm.runInContext('cmtCtl("p", first)', r.ctx);
  assert.doesNotMatch(html, /data-act="cmt-del"/);
  r.remove(); assert.equal(r.jobs.size, 0); assert.equal(r.toasts.length, 0); assert.equal(r.visible().length, 2); assert.equal(r.requests.length, 0);
});

test('发送中仍防误移除；失败行继续保留现有重试、编辑、移除，移除只影响对应临时行', () => {
  const r = comments({temporary:true, sendState:'sending'}), button = {dataset:{p:'p', id:'client_first'}};
  r.ctx.ACTIONS['cmt-remove'](button); assert.equal(r.ctx.UI.newCmts.p.length, 1);
  r.first.sendState = 'failed'; r.first._counted = false;
  const html = vm.runInContext('cmtSendFeedback("p", first)', r.ctx);
  for (const name of ['cmt-retry', 'cmt-edit', 'cmt-remove']) assert.match(html, new RegExp(`data-act="${name}"`));
  const keep = {_client:'client_other', u:'me', t:'另一条失败文字', sendState:'failed'}; r.ctx.UI.newCmts.p.push(keep);
  r.ctx.ACTIONS['cmt-remove'](button); assert.equal(r.ctx.UI.newCmts.p.length, 1); assert.equal(r.ctx.UI.newCmts.p[0], keep); assert.equal(r.post.cmts, 2); assert.equal(r.requests.length, 0);
});

for (const options of [{review:true}, {counted:false}]) test(`${options.review ? '审核中' : '明确未计数'} 的真实评论可以删除，但不减少公开评论总数`, async () => {
  const r = comments(options); assert.match(vm.runInContext('cmtCtl("p", first)', r.ctx), /data-act="cmt-del"/);
  r.remove(); r.fire(); await tick(); assert.equal(r.requests.length, 1); assert.equal(r.requests[0].args[1], '/comments/c_first'); assert.equal(r.post.cmts, 1);
  r.pending.resolve({ok:true}); await tick(); assert.equal(r.post.cmts, 1); assert.deepEqual(Array.from(r.visible(), c => c.id), ['c_other']);
});

test('撤销窗口内我的评论与帖子同时隐藏待删行，撤销立即恢复两处且不发请求', async () => {
  const r = comments(); r.remove(); assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_mine_other']); assert.deepEqual(Array.from(r.visible(), c => c.id), ['c_other']);
  r.ctx.CUR.post = null; r.ctx.CUR.key = 'me|cmts'; r.ctx.UI.meTab = 'cmts'; r.toasts[0][3].undo(); r.fire(); await tick();
  assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_first','c_mine_other']); assert.equal(r.requests.length, 0); assert.equal(r.post.cmts, 2);
});

test('不同账号作用域的待删记录不隐藏我的评论，旧原型标记不能覆盖服务器返回的真实行', () => {
  const r = comments(); r.remove(); r.ctx.API.epoch++;
  r.ctx.STATE.cdel.add(r.key(r.first));
  vm.runInContext('Object.assign(myCmtState(),{rows:[{p:POST("p"),c:first},{p:POST("p"),c:mineOther}],count:2,loaded:true,status:"ready"})', r.ctx);
  assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_first','c_mine_other']);
});

test('我的评论正在读取时失效缓存：中止旧读取、替换状态对象并保留已有行及数量', () => {
  const r = comments({activeMine:true}), old = r.state(); let aborted = 0;
  old.controller = {abort:() => aborted++}; old.task = Promise.resolve(); old.status = 'pending';
  vm.runInContext('myCmtInvalidate()', r.ctx); const current = r.state();
  assert.equal(aborted, 1); assert.notEqual(current, old); assert.deepEqual(Array.from(current.rows, row => row.c.id), ['c_first','c_mine_other']); assert.equal(current.count, 2);
  assert.match(vm.runInContext('myCmtStatusHtml()', r.ctx), /正在更新评论/);
  r.flush(); assert.equal(r.refreshes.length, 1); assert.equal(r.refreshes[0][1], true);
});

test('我的评论失效后的异步刷新在切账号或离开我的页面时取消', () => {
  for (const change of ['account','page']){
    const r = comments({activeMine:true}); vm.runInContext('myCmtInvalidate()', r.ctx);
    if (change === 'account'){ r.ctx.ME = 'next'; r.ctx.API.epoch++; } else r.ctx.CUR.key = 'shop|';
    r.flush(); assert.equal(r.refreshes.length, 0, change);
  }
});

test('删除成功在我的评论页到达：只清对应行，保留其它行和分页后强制刷新', async () => {
  const r = comments(); r.remove(); r.fire(); await tick();
  r.ctx.CUR.post = null; r.ctx.CUR.key = 'me|cmts'; r.ctx.UI.meTab = 'cmts';
  r.pending.resolve({ok:true}); await tick();
  assert.deepEqual(Array.from(r.state().rows, row => row.c.id), ['c_mine_other']); assert.equal(r.state().count, 1); assert.equal(r.state().next, 'next_page');
  assert.match(vm.runInContext('myCmtStatusHtml()', r.ctx), /正在更新评论/);
  r.flush(); assert.equal(r.refreshes.length, 1); assert.equal(r.refreshes[0][1], true); assert.equal(r.post.cmts, 1);
});

test('删除成功在帖子页完成时保留其余我的评论缓存，不额外读取不可见页面', async () => {
  const r = comments(); r.remove(); r.fire(); await tick(); r.pending.resolve({ok:true}); await tick(); r.flush();
  assert.deepEqual(Array.from(r.state().rows, row => row.c.id), ['c_mine_other']); assert.equal(r.state().count, 1); assert.equal(r.refreshes.length, 0);
});

test('删除失败保留本人历史行并恢复这次计数，同时保留本地新增的数量', async () => {
  const r = comments(); r.remove(); r.fire(); await tick(); assert.equal(r.post.cmts, 1);
  r.post.cmts++; r.pending.reject(Object.assign(new Error('弱网失败'), {code:'network'})); await tick(); r.flush();
  assert.equal(r.post.cmts, 3); assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_first','c_mine_other']); assert.equal(r.state().count, 2); assert.equal(r.failures.length, 1); assert.equal(r.refreshes.length, 0);
});

test('apiPost 每次服务器映射推进计数修订，即使权威数量相同也不会复用旧修订', () => {
  const r = comments(), first = r.mapPost(2), second = r.mapPost(2);
  assert.equal(first.cmts, 2); assert.equal(second.cmts, 2); assert.equal(typeof first.cmtsRev, 'number'); assert(second.cmtsRev > first.cmtsRev);
});

test('删除失败期间权威帖子计数重新读取，失败回滚不能把服务器数量额外加一', async () => {
  const r = comments(); Object.assign(r.post, r.mapPost(2)); const originalRev = r.post.cmtsRev;
  r.remove(); r.fire(); await tick(); assert.equal(r.post.cmts, 1);
  Object.assign(r.post, r.mapPost(2)); assert(r.post.cmtsRev > originalRev);
  r.pending.reject(Object.assign(new Error('响应丢失'), {code:'network'})); await tick();
  assert.equal(r.post.cmts, 2); assert.equal(r.visible().length, 2); assert.equal(r.failures.length, 1);
});

test('我的评论未缓存待删 ID 时删除成功不扣另一页的数量，不清掉已有历史行', async () => {
  const r = comments(); const old = r.state(); old.rows = old.rows.filter(row => row.c.id !== 'c_first'); old.count = 5;
  r.remove(); r.fire(); await tick(); r.pending.resolve({ok:true}); await tick();
  assert.deepEqual(Array.from(r.state().rows, row => row.c.id), ['c_mine_other']); assert.equal(r.state().count, 5);
});

test('删除成功使我的评论旧读取失效，迟到响应不能复活已删除行，新读取可以正常完成', async () => {
  const r = comments({activeMine:true, realRead:true});
  const oldRead = vm.runInContext('loadMyComments(false,true)', r.ctx), oldState = r.state();
  assert.equal(r.reads.length, 1); r.remove(); r.fire(); await tick(); r.pending.resolve({ok:true}); await tick();
  const nextState = r.state(); assert.notEqual(nextState, oldState); assert.equal(oldState.controller.signal.aborted, true);
  const rawPost = {id:'p',author:{id:'other'},title:'测试帖子',body:'正文',type:'text',style:{},likeCount:0,commentCount:1,status:'published',createdAt:'2026-10-12T00:00:00.000Z'};
  const rawComment = id => ({id,author:{id:'me'},body:id,createdAt:'2026-10-12T00:00:00.000Z',status:'published',likeCount:0});
  r.reads[0].resolve({items:[{post:rawPost,comment:rawComment('c_first')}],count:8,next:'obsolete_page'}); await oldRead; await tick();
  assert.equal(r.state(), nextState); assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_mine_other']); assert.equal(r.state().count, 1); assert.equal(r.state().next, 'next_page');
  r.flush(); await tick(); assert.equal(r.reads.length, 2); assert.equal(r.state().status, 'pending');
  r.reads[1].resolve({items:[{post:rawPost,comment:rawComment('c_mine_other')}],count:1,next:null}); await r.state().task; await tick();
  assert.equal(r.state().status, 'ready'); assert.equal(r.state().count, 1); assert.equal(r.state().next, null); assert.deepEqual(Array.from(r.mine(), row => row.c.id), ['c_mine_other']);
});
