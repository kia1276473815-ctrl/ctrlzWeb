// 从合并后的实际页面提取交易逻辑；只在 VM 中操作隔离券和订单，不连接真实服务。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, `找不到正式逻辑 ${a}`);
  return source.slice(start, end);
};
const plain = value => JSON.parse(JSON.stringify(value));
const pr = () => ({id:'fixture-product', title:'隔离商品', seller:'fixture-seller', price:100, live:true});
const coupon = (id, amt, extra = {}) => ({id, uid:'fixture-me', amt, exp:0, note:id, ts:Date.now(), ...extra});

function voucherRealm(vouchers = [], {live = false, product = pr()} = {}) {
  const calls = [], errors = [], notices = [], feedback = [], frames = [], saved = new Map();
  const sh = {innerHTML:''}, box = {innerHTML:''}, input = {value:'', focusCount:0, focus(){this.focusCount++;}};
  const reason = {textContent:'文件损坏'};
  let paid = 0, sequence = 0, responder = async (method, path) => path === '/orders'
    ? {id:'fixture-order', status:'paid'} : path === '/me/wallet' ? ctx.LSHOP.wallet : {fast:false, appeal:true};
  const ctx = vm.createContext({console, Date, Map, Set, Promise, Math, ME:'fixture-me',
    UI:{pay:'微信支付', vcSel:undefined, vcOk:false}, STATE:{orders:[], dlc:{}, owned:new Set(), libNew:0},
    ADM:{vouchers, vuse:[], lst:{}}, REFUNDS:[], LSHOP:{wallet:{vouchers:[], uses:[]}}, ACTIONS:{},
    API:{on:() => live, async req(method, path, body){calls.push({method, path, body:body && plain(body)});return responder(method, path, body);}},
    crypto:{randomUUID:() => 'fixture-' + ++sequence},
    store:{get:(key, fallback) => saved.has(key) ? plain(saved.get(key)) : fallback, set:(key, value) => saved.set(key, plain(value))},
    P:id => id === product.id ? product : null, esc:String, uname:String, pad2:n => String(n).padStart(2, '0'),
    yuan2:n => '¥' + n.toFixed(2), fmtDay:ts => new Date(ts).toISOString().slice(0, 10), fmtDT:() => '10-12 12:00',
    INK:{green:'green', blue:'blue', ink:'black'}, stTag:(s, c) => `<span class="${c}">${s}</span>`,
    $:selector => selector === '#layer .sheet' ? sh : selector === '#payBox' ? box
      : selector === '#rp' ? {style:{setProperty(){}}}
      : selector === '#rfX' ? input : selector === '#rfR .on' ? reason : null,
    reduced:() => true, vcWarnFx(){}, haptic(){}, fxPop:(...args) => feedback.push(args),
    sheet:html => {sh.innerHTML = html;}, closeSheet(){}, toast:(...args) => notices.push(args),
    admSave(){}, notify:(...args) => notices.push(args), apiFail:e => errors.push(e), badge(){}, rerender(){},
    paidUI:() => paid++, liveApplyOrder:o => feedback.push({appliedOrder:o}), liveShop:async()=>{}, liveMine:async()=>{},
    performance:{now:() => 0}, requestAnimationFrame:fn => {frames.push(fn);return frames.length;}});
  const run = text => vm.runInContext(text, ctx);
  run(section('const f2y =', 'const SP_ST ='));
  run(section('const r2 = x =>', '/* 在首页 / 视频流里直接处理内容'));
  run(section('function grant(pr, pay, price', '/* 付款面板下半截：'));
  run(section('function vcSel(pr){', '/* 提醒出现时的动效：'));
  run(section('function payBox(pr){', 'ACTIONS.buy0 ='));
  run(section("ACTIONS['vc-pick'] =", "ACTIONS['do-pay'] ="));
  run(section("ACTIONS['do-pay'] =", 'function paidUI(pr, sh)'));
  run(section('const ordTs =', 'refundSync();'));
  run('Object.assign(ACTIONS, {' + section('  refund: b =>', '  // 收款账户') + '});');
  run(section('function orderAttempt(pr,body){', '(function boot(){'));
  run(section('function walletView(){', 'const liveWalletView ='));
  run(section('function wrapAct(name, fn){', 'const softRefresh ='));
  run(section("wrapAct('do-pay',", '/* —— 下载：'));
  run(section("wrapAct('do-refund',", '/* —— 「我 › 代金券」'));
  return {ctx, calls, errors, notices, feedback, sh, box, input, reason, product, run,
    get paid(){return paid;}, setResponder:fn => {responder = fn;},
    flushPayment(){const pending = frames.splice(0);pending.forEach(fn => fn(1200));},
    select:id => ctx.ACTIONS['vc-pick']({dataset:{id:product.id, v:id}}),
    confirm:() => ctx.ACTIONS['vc-ok']({dataset:{id:product.id}}),
    pay:() => ctx.ACTIONS['do-pay']({dataset:{id:product.id}}),
    refund:no => ctx.ACTIONS['do-refund']({dataset:{no}})};
}
function addOrder(r, extra = {}) {
  const order = {id:'fixture-order', no:'CZ-fixture', pid:r.product.id, price:100, vc:60,
    time:new Date(Date.now() - 3600000).toISOString(), st:'已完成', live:true, ...extra};
  r.ctx.STATE.orders.push(order);
  return order;
}
function walletCoupon(id, amount, status = 'active', extra = {}) {
  return {id, amount, status, note:id, createdAt:new Date().toISOString(), expiresAt:null, ...extra};
}

test('原型券用一次后全部消耗，退款与刷新投影都不恢复可用状态', () => {
  const r = voucherRealm([coupon('once', 120)]), o = addOrder(r, {live:false, vc:100});
  assert.equal(r.ctx.vcSpend('fixture-me', 'once', 100, o.no), 100);
  r.ctx.REFUNDS.push({no:o.no, st:'已退款'});
  r.ctx.refundSync();
  assert.equal(o.st, '已退款');
  assert.equal(r.run("vcLeft(ADM.vouchers[0])"), 0);
  assert.equal(r.run("vcFree(ME).length"), 0);
  assert.equal(r.ctx.vcSpend('fixture-me', 'once', 100, 'second-order'), 0);
  assert.equal(r.ctx.ADM.vuse.length, 1);
  const items = plain(r.ctx.vcItems('fixture-me'));
  assert.equal(items[0].st[0], '已用');
  assert.equal(items[0].use.ded, 100);
  assert.equal(items[0].use.waste, 20);
  assert.match(r.ctx.walletView(), /已退款（券不退回）/);
});

test('后端已退款使用记录保持已用券，金额按分转换，券面额不变为可用余额', () => {
  const r = voucherRealm([], {live:true});
  r.ctx.LSHOP.wallet = {vouchers:[walletCoupon('used', 12000, 'used_up', {
    use:{title:'隔离商品', orderNo:'CZ-fixture', amount:10000, waste:2000, createdAt:new Date().toISOString()}})],
    uses:[{title:'隔离商品', orderNo:'CZ-fixture', amount:10000, face:12000, refunded:true, createdAt:new Date().toISOString()}]};
  const v = plain(r.ctx.vcItems('fixture-me'))[0];
  assert.equal(v.amt, 120);assert.equal(v.use.ded, 100);assert.equal(v.use.waste, 20);
  assert.equal(v.st[0], '已用');assert.equal(r.run('vcCount(ME)'), 0);
  const html = r.ctx.walletView();
  assert.match(html, /0<small>张能用/);assert.match(html, /已退款（券不退回）/);
});

test('默认只选不会作废且抵扣最多的一张，过期和已撤回券不参与', () => {
  const r = voucherRealm([coupon('small', 40), coupon('safe', 80), coupon('waste', 150),
    coupon('expired', 100, {exp:Date.now()-1000}), coupon('revoked', 100, {off:Date.now()})]);
  assert.equal(r.ctx.vcSel(r.product).id, 'safe');
  assert.equal(r.run('vcDed(P("fixture-product"))'), 80);
  assert.equal(r.run('vcWasteOf(P("fixture-product"))'), 0);
  const html = r.ctx.payBox(r.product);
  assert.match(html, /aria-checked="true"[^>]*data-v="safe"/);
  assert.doesNotMatch(html, /data-v="expired"|data-v="revoked"/);
  assert.match(html, /data-act="do-pay"/);
  assert.match(html, /¥20\.00/);
});

test('全是超额券时默认不用券；明确选一张或不用券都会清掉上次作废确认', () => {
  const r = voucherRealm([coupon('a', 120), coupon('b', 150)]);
  assert.equal(r.ctx.vcSel(r.product), null);
  assert.match(r.ctx.payBox(r.product), /vct none on/);
  r.ctx.UI.vcOk = true;r.select('a');
  assert.equal(r.ctx.UI.vcOk, false);assert.equal(r.ctx.vcSel(r.product).id, 'a');
  r.confirm();assert.equal(r.ctx.UI.vcOk, true);
  r.select('b');assert.equal(r.ctx.UI.vcOk, false);assert.equal(r.ctx.vcSel(r.product).id, 'b');
  r.select('');assert.equal(r.ctx.vcSel(r.product), null);assert.equal(r.ctx.UI.vcOk, false);
  assert.match(r.box.innerHTML, /vct none on/);assert.doesNotMatch(r.box.innerHTML, /id="vcw"/);
});

test('作废提醒确认前隐藏付款按钮并阻止真实请求，确认后只送所选券和持久化请求键', async () => {
  const r = voucherRealm([], {live:true});
  r.ctx.LSHOP.wallet.vouchers = [walletCoupon('waste', 15000)];
  r.select('waste');
  assert.match(r.box.innerHTML, /剩下的 ¥50\.00 作废/);
  assert.match(r.box.innerHTML, /data-act="vc-ok"/);assert.doesNotMatch(r.box.innerHTML, /data-act="do-pay"/);
  await r.pay();assert.equal(r.calls.length, 0);
  r.confirm();assert.match(r.box.innerHTML, /data-act="do-pay"/);assert.match(r.box.innerHTML, /已确认/);
  await r.pay();
  const sent = r.calls.find(c => c.path === '/orders');
  assert.deepEqual(sent.body, {productId:r.product.id, payMethod:'wechat', useVoucher:true,
    voucherId:'waste', confirmWaste:true, requestKey:'web-fixture-1'});
  assert.equal(r.calls.filter(c => c.path === '/orders').length, 1);assert.equal(r.paid, 1);
});

test('明确不用券的真实付款不带 voucherId 或作废确认，不叠加两张券', async () => {
  const r = voucherRealm([], {live:true});
  r.ctx.LSHOP.wallet.vouchers = [walletCoupon('a', 6000), walletCoupon('b', 8000)];
  r.select('');await r.pay();
  const sent = r.calls.find(c => c.path === '/orders').body;
  assert.equal(sent.useVoucher, false);assert.equal(sent.productId, r.product.id);
  assert.equal(Object.hasOwn(sent, 'voucherId'), false);assert.equal(Object.hasOwn(sent, 'confirmWaste'), false);
});

test('付款响应丢失后同券重试复用请求键，换券会分配独立请求键', async () => {
  const r = voucherRealm([], {live:true});
  r.ctx.LSHOP.wallet.vouchers = [walletCoupon('a', 6000), walletCoupon('b', 8000)];
  r.setResponder(async()=>{throw new Error('隔离响应丢失');});
  r.select('a');await r.pay();await r.pay();r.select('b');await r.pay();
  const writes = r.calls.filter(c => c.path === '/orders');
  assert.equal(writes.length, 3);assert.equal(writes[0].body.requestKey, writes[1].body.requestKey);
  assert.notEqual(writes[0].body.requestKey, writes[2].body.requestKey);
  assert.deepEqual(writes.map(c => c.body.voucherId), ['a', 'a', 'b']);
  assert.equal(r.errors.length, 3);
});

test('作废确认状态、换券、不用券的提交键相互隔离，成功只释放自己的键', () => {
  const r = voucherRealm(), base = {productId:r.product.id, payMethod:'wechat', useVoucher:true, voucherId:'a', confirmWaste:true};
  const confirmed = r.ctx.orderAttempt(r.product, base), same = r.ctx.orderAttempt(r.product, {...base});
  const notConfirmed = r.ctx.orderAttempt(r.product, {...base, confirmWaste:false});
  const other = r.ctx.orderAttempt(r.product, {...base, voucherId:'b'});
  const none = r.ctx.orderAttempt(r.product, {productId:r.product.id, payMethod:'wechat', useVoucher:false});
  assert.equal(confirmed.body.requestKey, same.body.requestKey);
  assert.equal(new Set([confirmed, notConfirmed, other, none].map(x => x.body.requestKey)).size, 4);
  confirmed.done();
  assert.notEqual(r.ctx.orderAttempt(r.product, base).body.requestKey, confirmed.body.requestKey);
  assert.equal(r.ctx.orderAttempt(r.product, {...base, voucherId:'b'}).body.requestKey, other.body.requestKey);
});

test('原型支付也遵守作废门控，确认后整张券用掉，未下载用券订单仍走申诉审核', async () => {
  const r = voucherRealm([coupon('once', 150)]);
  r.select('once');await r.pay();r.flushPayment();assert.equal(r.ctx.STATE.orders.length, 0);
  r.confirm();await r.pay();r.flushPayment();
  assert.equal(r.paid, 1);assert.equal(r.ctx.STATE.orders.length, 1);
  const o = r.ctx.STATE.orders[0];
  assert.equal(o.vc, 100);assert.equal(r.run('vcFree(ME).length'), 0);
  r.input.value='';await r.refund(o.no);assert.equal(r.ctx.REFUNDS.length, 0);assert.equal(r.input.focusCount, 1);
  r.input.value='隔离文件无法打开';await r.refund(o.no);
  assert.equal(r.ctx.REFUNDS[0].auto, false);assert.equal(r.ctx.REFUNDS[0].st, '待处理');
  assert.equal(r.ctx.REFUNDS[0].amt, 0);assert.match(r.ctx.REFUNDS[0].reason, /^【申诉】文件损坏/);
  assert.equal(r.run('vcFree(ME).length'), 0);
});

test('用券退款面板只给商品问题申诉，不提供不想要或极速退款选项', () => {
  const r = voucherRealm(), o = addOrder(r);
  r.ctx.ACTIONS.refund({dataset:{no:o.no}});
  assert.match(r.sh.innerHTML, /<h3>申诉：/);assert.match(r.sh.innerHTML, /提交申诉/);
  const reasons = [...r.sh.innerHTML.matchAll(/data-act="rs-pick">([^<]+)<\/button>/g)].map(x => x[1]);
  assert.deepEqual(reasons, ['文件损坏', '和描述不符']);
  assert.match(r.sh.innerHTML, /必填/);assert.doesNotMatch(r.sh.innerHTML, /可以极速退款|确认退款/);
  assert.match(r.sh.innerHTML, /实际付的 ¥40\.00/);
});

for (const [label, problem] of [['文件损坏', 'broken'], ['和描述不符', 'mismatch']]) {
  test(`用券${label}申诉说明必填，实际退款接口传 problem=${problem}`, async () => {
    const r = voucherRealm([], {live:true}), o = addOrder(r);
    r.reason.textContent = label;r.input.value = '   ';await r.refund(o.no);
    assert.equal(r.calls.length, 0);assert.equal(r.input.focusCount, 1);
    r.input.value = '  隔离具体问题  ';await r.refund(o.no);
    assert.deepEqual(r.calls, [{method:'POST', path:'/orders/fixture-order/refund',
      body:{reason:label + '：隔离具体问题', problem}}]);
    assert.equal(r.ctx.REFUNDS.length, 0);
    assert(r.notices.some(x => x[0] === '申诉已提交，平台会在 1 个工作日内审核'));
    assert(!r.notices.some(x => x[0] === '已退款，原路退回'));
  });
}

test('现金未下载新订单仍允许无补充说明退款，未退化为用券必填限制', async () => {
  const r = voucherRealm([], {live:true}), o = addOrder(r, {vc:0});
  r.reason.textContent = '不想要了';r.setResponder(async()=>({fast:true}));
  await r.refund(o.no);
  assert.deepEqual(r.calls[0].body, {reason:'不想要了', problem:'other'});
  assert.equal(r.input.focusCount, 0);
  assert(r.notices.some(x => x[0] === '已退款，原路退回'));
});
