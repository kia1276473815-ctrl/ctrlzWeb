// 合并后的懒加载页面也要保留一次性代金券规则；所有数据均为隔离样本。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const adminSource = fs.readFileSync(new URL('../scripts/views-admin-v1.js', import.meta.url), 'utf8');
const docsSource = fs.readFileSync(new URL('../scripts/docs-v1.js', import.meta.url), 'utf8');
function adminRealm(vouchers = []) {
  const calls = [];
  const ctx = vm.createContext({window:{}, API:{on:() => false}, ADM:{vouchers}, UI:{adf:{}},
    liveVouchersView:() => { calls.push('live'); return 'server vouchers'; },
    fq:() => '', r2:x => Math.round(x * 100) / 100, VC_MAX:2000, yuan2:x => '¥' + x.toFixed(2),
    vcUse:v => v.use || null, vcUsed:v => v.use?.amt || 0, vcSt:v => [v.state, 'green'],
    uname:x => x, esc:String, uav:x => x, stTag:x => x, fmtDay:x => String(x), fmtDT:() => '10-12',
    adH:(title, text) => `<h3>${title}</h3><p>${text}</p>`, vcForm:() => '', adQ:() => '',
    adSeg:(key, choices, selected) => { calls.push({key, choices, selected}); return ''; }});
  vm.runInContext(adminSource, ctx);
  return {ctx, calls, render:() => ctx.window.CtrlzViews.admin.vouchers()};
}

test('后台与协议懒加载注册不会提前读取代金券或发请求', () => {
  const ctx = vm.createContext({window:{}});
  vm.runInContext(adminSource, ctx);
  vm.runInContext(docsSource, ctx);
  assert.equal(typeof ctx.window.CtrlzViews.admin.vouchers, 'function');
  assert.equal(ctx.window.CtrlzDocBodies.refund.t, '退款规则');
});

test('真实后台继续调用实时代金券视图，不混入原型券', () => {
  const r = adminRealm();
  r.ctx.API.on = () => true;
  Object.defineProperty(r.ctx.ADM, 'vouchers', {get(){throw new Error('不能读取原型券');}});
  assert.equal(r.render(), 'server vouchers');
  assert.deepEqual(r.calls, ['live']);
});

test('抵扣、用剩作废、未使用和过期撤回金额分开统计，不将已用券重新算余额', () => {
  const r = adminRealm([
    {id:'active', uid:'a', amt:100, state:'可用'},
    {id:'used', uid:'b', amt:100, state:'已用', use:{amt:60}},
    {id:'used-revoked', uid:'c', amt:50, state:'已撤回', use:{amt:40}},
    {id:'expired', uid:'d', amt:75, state:'已过期'},
    {id:'revoked', uid:'e', amt:100, state:'已撤回'}
  ]);
  const html = r.render();
  assert.match(html, /已发放<b>¥425\.00/);
  assert.match(html, /已抵扣<b>¥100\.00/);
  assert.match(html, /用剩作废<b>¥50\.00/);
  assert.match(html, /未使用<b>¥100\.00/);
  assert.match(html, /过期 \/ 撤回作废<b>¥175\.00/);
  assert.match(html, /<th class="r">抵扣<\/th>/);
  assert.match(html, /每张只能用一次/);
  assert.doesNotMatch(html, /拆开分几次|剩余/);
  assert.equal((html.match(/data-act="vc-off"/g) || []).length, 1);
});

test('已用筛选与一次性券状态匹配，展示实际抵扣而非未花完的面额', () => {
  const r = adminRealm([
    {id:'active', uid:'active-owner', amt:100, state:'可用'},
    {id:'used', uid:'used-owner', amt:100, state:'已用', use:{amt:60}}
  ]);
  r.ctx.UI.adf.vc = '已用';
  const html = r.render();
  assert.match(html, /used-owner/);
  assert.doesNotMatch(html, /active-owner|data-act="vc-off"/);
  assert.match(html, /<td class="r n">¥60\.00<\/td>/);
  const segment = r.calls.find(x => x.key === 'vc');
  assert(segment.choices.some(([key]) => key === '已用'));
  assert(!segment.choices.some(([key]) => key === '已用完'));
});

test('懒加载退款规则说明用券订单只接受商品问题申诉，券退款后不恢复', () => {
  const ctx = vm.createContext({window:{}});
  vm.runInContext(docsSource, ctx);
  const section = ctx.window.CtrlzDocBodies.refund.s.find(([title]) => title === '代金券');
  assert(section);
  const text = section[1].join(' ');
  assert.match(text, /不想要了、买错了等.*不能退款，只能就商品问题申诉/);
  assert.match(text, /文件损坏、和描述不符的，由平台审核/);
  assert.match(text, /每张只能用一次，用过就作废/);
  assert.match(text, /只退你实际付的钱.*抵扣的部分不退，券也不会恢复/);
});
