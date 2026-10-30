// 后台列表连着后端时的分页、服务器端筛选：只用页面里的真实函数，请求全部是假的。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (a, b) => { const start = source.indexOf(a), end = source.indexOf(b, start + a.length); assert(start >= 0 && end > start, a); return source.slice(start, end); };
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

function realm(){
  const requests = [];
  const ctx = vm.createContext({console, Promise, Map, Set, JSON, UI:{}, ACTIONS:{}, STAFF:{epoch:1},
    LADM:{users:null, staff:null, content:null, busy:{}, errors:{}, reads:{}, requests:{}, contentNext:null, contentSeen:new Set()},
    staffSession:() => { const e = ctx.STAFF.epoch; return () => e === ctx.STAFF.epoch; }, staffCan:() => true,
    apiFail(){}, apiUser:u => u, rerender(){}, esc:String, adH:t => t, CUR:{key:'admin|'},
    fq:k => (ctx.UI.adq?.[k] || '').trim().toLowerCase()});
  ctx.STAFF.req = (m, p) => { const w = defer(); requests.push({...w, path:p}); return w.promise; };
  const load = s => vm.runInContext(s, ctx);
  return {ctx, requests, load};
}

test('用户列表：筛选传给服务器，加载更多带游标并按 id 去重追加', async () => {
  const r = realm(); r.load(section('async function ladmGet(', 'const RP_K')); r.load(section('async function ladmLoad(', '// 一次性凭据'));
  r.ctx.UI.adf = {us:'limited'};
  const a = r.ctx.ladmLoad('users'); assert.match(r.requests[0].path, /filter=limited/); assert.doesNotMatch(r.requests[0].path, /cursor=/);
  r.requests[0].resolve({items:[{id:'u1'}, {id:'u2'}], next:'c/1'}); await a;
  assert.equal(r.ctx.LADM.usersNext, 'c/1'); assert.equal(r.ctx.LADM.uf, 'limited');
  const b = r.ctx.ladmLoad('users', true); assert.match(r.requests[1].path, /cursor=c%2F1/); assert.match(r.requests[1].path, /filter=limited/);
  r.requests[1].resolve({items:[{id:'u2'}, {id:'u3'}], next:null}); await b;
  assert.deepEqual([...r.ctx.LADM.users.map(u => u.id)], ['u1', 'u2', 'u3']); assert.equal(r.ctx.LADM.usersNext, null);
  // 后端不认的筛选值（原型的「被警告过」）不传上去
  r.ctx.UI.adf.us = 'warned'; const c = r.ctx.ladmLoad('users'); assert.doesNotMatch(r.requests[2].path, /filter=/); r.requests[2].resolve({items:[], next:null}); await c;
});

test('用户列表：续页失败保留已读的行，重试接着读那一页', async () => {
  const r = realm(); r.load(section('async function ladmGet(', 'const RP_K')); r.load(section('async function ladmLoad(', '// 一次性凭据'));
  r.load(section("ACTIONS['lus-more'] =", 'Object.assign(ACTIONS, {'));
  const a = r.ctx.ladmLoad('users'); r.requests[0].resolve({items:[{id:'u1'}], next:'n1'}); await a;
  const b = r.ctx.ACTIONS['lus-more'](); r.requests[1].reject(new Error('弱网')); await b;
  assert.equal(r.ctx.LADM.users.length, 1); assert.equal(r.ctx.LADM.errors.users, '弱网'); assert.equal(r.ctx.LADM.usersNext, 'n1');
  const c = r.ctx.ACTIONS['lus-retry'](); assert.match(r.requests[2].path, /cursor=n1/); r.requests[2].resolve({items:[{id:'u2'}], next:null}); await c;
  assert.deepEqual([...r.ctx.LADM.users.map(u => u.id)], ['u1', 'u2']); assert.equal(r.ctx.LADM.errors.users, undefined);
});

test('内容页：帖子 / 商品的搜索和已下架交给服务器，换词时旧行先留着、旧请求作废', async () => {
  const r = realm(); r.load(section('async function adminLoadContent(', '{ const ct0 = ADMV.content;'));
  r.ctx.UI.adf = {cs:'off'}; r.ctx.UI.adq = {content:' Rain '};
  const a = r.ctx.adminLoadContent('post'); assert.equal(r.requests[0].path, '/admin/posts?view=taken_down&q=rain&limit=50');
  r.requests[0].resolve({items:[{id:'p1'}], next:'n'}); await a; assert.equal(r.ctx.LADM.contentNext, 'n');
  r.ctx.UI.adq.content = 'tape'; const b = r.ctx.adminLoadContent('post');
  assert.equal(r.ctx.LADM.content[0].id, 'p1'); assert.equal(r.ctx.LADM.contentNext, null); assert.match(r.requests[1].path, /q=tape/);
  r.ctx.UI.adq.content = 'tapes'; const c = r.ctx.adminLoadContent('post');
  r.requests[1].resolve({items:[{id:'old'}], next:null}); await b; assert.equal(r.ctx.LADM.content[0].id, 'p1');
  r.requests[2].resolve({items:[{id:'p2'}], next:null}); await c; assert.deepEqual([...r.ctx.LADM.content.map(x => x.id)], ['p2']);
  r.ctx.UI.adf.cs = 'on'; const d = r.ctx.adminLoadContent('prod'); assert.equal(r.requests[3].path, '/admin/products?status=on_sale&q=tapes'); r.requests[3].resolve({items:[]}); await d;
  const e = r.ctx.adminLoadContent('cmt'); assert.equal(r.requests[4].path, '/admin/comments?view=all&limit=50'); r.requests[4].resolve({items:[], next:null}); await e;
});
