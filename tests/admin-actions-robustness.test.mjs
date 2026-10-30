// 后台操作的健壮性：处理完一条原地刷新、防重复提交、失败后重读、离开后台不重画。只用页面里的真实函数，请求全部是假的。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (a, b) => { const start = source.indexOf(a), end = source.indexOf(b, start + a.length); assert(start >= 0 && end > start, a); return source.slice(start, end); };
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

function realm(extra = {}){
  const requests = [], toasts = [], failures = [];let draws = 0;
  const ctx = vm.createContext({console, Promise, Map, Set, JSON, UI:{}, ACTIONS:{}, STAFF:{epoch:1, me:{name:'值班'}}, CUR:{key:'admin|'},
    LADM:{busy:{}, errors:{}, reads:{}, requests:{}}, ADMCNT:{v:{}, at:99, busy:false},
    staffSession:() => { const e = ctx.STAFF.epoch; return () => e === ctx.STAFF.epoch; }, admGuard:() => true, admMe:() => ctx.STAFF.me,
    apiFail:e => failures.push(e), toast:(...a) => toasts.push(a), rerender:() => draws++, closeSheet(){}, fxPop(){}, esc:String,
    ...extra});
  ctx.STAFF.req = (m, p, body) => { const w = defer(); requests.push({...w, method:m, path:p, body}); return w.promise; };
  const load = s => vm.runInContext(s, ctx);
  return {ctx, requests, toasts, failures, load, get draws(){ return draws; }};
}

test('后台读取完成时已经离开后台：数据照样存下，不整页重画', async () => {
  const r = realm(); r.load(section('async function ladmGet(', 'const RP_K'));
  r.ctx.CUR.key = 'home'; const a = r.ctx.ladmGet('reports', '/admin/reports?view=open', x => x.items);
  r.requests[0].resolve({items:[{id:'r1'}]}); await a; assert.equal(r.ctx.LADM.reports.length, 1); assert.equal(r.draws, 0);
  r.ctx.CUR.key = 'admin|reports'; r.ctx.LADM.reports = null; const b = r.ctx.ladmGet('reports', '/admin/reports?view=open', x => x.items);
  r.requests[1].resolve({items:[]}); await b; assert.equal(r.draws, 1);
});

test('处理完一条：列表不清空，本地先改，再用同一个接口静默重读，待办数马上重新问', async () => {
  const r = realm(); r.load(section('async function ladmGet(', 'const RP_K'));
  const a = r.ctx.ladmGet('reports', '/admin/reports?view=open', x => x.items); r.requests[0].resolve({items:[{id:'r1'}, {id:'r2'}]}); await a;
  r.ctx.ladmDone('reports', L => L.filter(x => x.id !== 'r1'));
  assert.deepEqual(r.ctx.LADM.reports.map(x => x.id), ['r2']); assert.equal(r.ctx.ADMCNT.at, 0); assert.equal(r.requests.length, 2); assert.equal(r.requests[1].path, '/admin/reports?view=open');
  r.requests[1].resolve({items:[{id:'r2'}, {id:'r3'}]}); await tick(); assert.deepEqual(r.ctx.LADM.reports.map(x => x.id), ['r2', 'r3']);
});

test('退款确认中的显示中文和「重试退款」；连点只发一次，失败也重读', async () => {
  let done = 0; const r = realm({ladmDone:() => done++, ladmShop(){}, ladmWait:() => '', adH:t => t, f2y:x => x / 100, yuan2:String, fmtDT:String, stTag:(a, c) => `<i class="${c}">${a}</i>`});
  r.load(section('function liveRefundsView(){', 'function liveVouchersView(){'));
  r.ctx.LADM.refunds = [{id:'rf1', status:'processing', title:'T', orderNo:'N', buyer:{name:'B'}, cashAmount:100, reason:'坏了', fast:false, downloads:1, createdAt:'2026-10-01'}];
  const html = r.ctx.liveRefundsView(); assert.match(html, /退款确认中/); assert.match(html, /data-act="lrf-ok"[^>]*>重试退款/); assert.doesNotMatch(html, /data-act="lrf-no"/);
  const b = {dataset:{id:'rf1'}, disabled:false, isConnected:true}; const work = r.ctx.ACTIONS['lrf-ok'](b); await r.ctx.ACTIONS['lrf-ok'](b);
  assert.equal(r.requests.length, 1); assert.equal(b.disabled, true);
  r.requests[0].reject(Object.assign(new Error('退款正在确认，请稍后查看'), {code:'refund_pending', status:400})); await work;
  assert.equal(r.failures.length, 1); assert.equal(done, 1); assert.equal(b.disabled, false);
});

test('批量发券：最多 50 人；名字去重、有限并发查人，找不到只提示一次且不发券', async () => {
  const looked = [];let inflight = 0, peak = 0;
  const to = {value:'', type:'text'}, f = {}, nodes = {'.vcTo':to, '.vcAmt':{value:'10'}, '.vcExp':{value:'30'}, '.vcNote':{value:''}};
  const r = realm({$:s => nodes[s], r2:x => x, VC_MAX:2000, yuan2:String, y2f:x => x * 100, LIVE:{u:new Set(['known'])}, API:{on:() => true}, admOn:() => true, wrapAct:(n, fn) => { r.ctx.ACTIONS[n] = b => fn(() => {}, b); },
    adminRecipient:async (name, onMiss) => { looked.push(name); inflight++; peak = Math.max(peak, inflight); await tick(); inflight--; if (name.startsWith('miss')){ onMiss('没找到这个用户'); return null; } return 'id-' + name; }});
  r.load(section("wrapAct('vc-send',", "ACTIONS['lvc-off']"));
  const b = {closest:() => f, disabled:false, isConnected:true};
  to.value = Array.from({length:51}, (_, i) => 'u' + i).join(','); await r.ctx.ACTIONS['vc-send'](b); assert.match(r.toasts.at(-1)[0], /50/); assert.equal(looked.length, 0);
  to.value = 'a,a,b,c,d,e,f,g,known'; const work = r.ctx.ACTIONS['vc-send'](b); await tick(); await tick(); await tick();
  assert(peak <= 5); assert.deepEqual(looked, ['a', 'b', 'c', 'd', 'e', 'f', 'g']); assert.equal(r.requests.length, 1); assert.deepEqual([...r.requests[0].body.userIds], ['id-a', 'id-b', 'id-c', 'id-d', 'id-e', 'id-f', 'id-g', 'known']);
  r.requests[0].resolve({ids:[]}); await work;
  looked.length = 0; to.value = 'miss1,miss2,x'; await r.ctx.ACTIONS['vc-send'](b);
  assert.equal(r.requests.length, 1); assert.equal(r.toasts.filter(t => t[0] === '没找到这个用户').length, 1); assert.equal(b.disabled, false);
});
