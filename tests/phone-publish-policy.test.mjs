import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const line = prefix => { const start = source.indexOf(prefix); assert(start >= 0); return source.slice(start, source.indexOf('\n', start)); };
function fixture(phoneBinding) {
  const messages = [], timers = [], heading = {}, description = {};
  let opened = 0;
  const ctx = vm.createContext({ ACTIONS: {}, LIVE: { cfg: phoneBinding === undefined ? {} : { phoneBinding } },
    toast: (...args) => messages.push(args), esc: String, setTimeout: fn => timers.push(fn),
    accPhone0: () => { opened++; }, $: selector => selector.endsWith('+ p') ? description : heading });
  vm.runInContext(line('const apiFail = ') + '\n' + line("ACTIONS['live-bind'] = ") + '\nglobalThis.fail = apiFail;', ctx);
  return { ctx, messages, timers, heading, description, opened: () => opened };
}
test('手机验证未开放时发布拒绝只提示一次，不把购买者带入不可用的短信流程', () => {
  const h = fixture(false);
  h.ctx.fail({ code: 'phone_required', message: '先验证手机' });
  assert.equal(h.messages.length, 1); assert.match(h.messages[0][0], /领取和下载不受影响/);
  assert.equal(h.timers.length, 0); assert.equal(h.opened(), 0);
});
test('直接点击绑定入口也遵守服务端能力，避免绕过禁用提示', () => {
  const h = fixture(false); h.ctx.ACTIONS['live-bind']();
  assert.equal(h.opened(), 0); assert.equal(h.ctx.LIVE.bind, undefined);
  assert.match(h.messages[0][0], /暂未开放/);
});
for (const available of [true, undefined]) test(`绑定可用或旧API未声明能力时保留原绑定流程：${available}`, () => {
  const h = fixture(available); h.ctx.fail({ code: 'phone_required', message: '先验证手机' });
  assert.equal(h.timers.length, 1); h.timers[0]();
  assert.equal(h.opened(), 1); assert.equal(h.ctx.LIVE.bind, true); assert.equal(h.heading.textContent, '绑定手机号');
});
test('其他权限错误仍显示服务端原因，不误引导手机验证', () => {
  const h = fixture(false); h.ctx.fail({ code: 'banned', message: '账号已被封禁' });
  assert.equal(h.messages[0][0], '账号已被封禁'); assert.equal(h.timers.length, 0);
});
