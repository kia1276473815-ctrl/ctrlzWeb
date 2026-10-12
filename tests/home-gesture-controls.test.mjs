// 执行首页原触摸处理器，验证列表横滑与独立拖动控件不会共享坐标变化。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const begin = source.indexOf('const HOME_TABS = '), end = source.indexOf('/* ================= 短视频：', begin);
assert(begin >= 0 && end > begin);

function start() {
  const listeners = new Map(), animations = [], feed = {style: {}, animate: (frames, options) => { animations.push({frames, options}); return {}; }};
  let rendered = 0, now = 0;
  const ctx = vm.createContext({
    ACTIONS: {}, CUR: {hash: '#home', post: null}, RL: {on: false}, HST: {ov: false}, UI: {homeTab: 'rec'}, innerWidth: 390,
    routeOf: hash => hash.slice(1).split('-')[0], performance: {now: () => now}, reduced: () => true,
    $: selector => selector === '#app .hfeed' ? feed : null, rerender: () => rendered++, inkFrom() {},
    document: {addEventListener: (type, handler) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); }}
  });
  vm.runInContext(source.slice(begin, end), ctx);
  const target = (...ancestors) => ({closest: selector => selector.split(',').some(s => ancestors.includes(s)) ? (selector === '.hfeed' ? feed : {}) : null});
  const touch = (type, el, x, y = 140) => { now += 80; for (const listener of listeners.get(type) || []) listener({type,target: el, touches: type === 'touchend' || type === 'touchcancel' ? [] : [{clientX: x, clientY: y}]}); };
  return {ctx, feed, animations, target, touch, get rendered() { return rendered; }};
}

test('普通首页列表仍能横拖切换关注和推荐，保持原跟手距离和阈值', () => {
  const app = start(), target = app.target('.hfeed');
  app.touch('touchstart', target, 70); app.touch('touchmove', target, 190);
  assert.equal(app.feed.style.transform, 'translateX(120px)');
  assert.equal(app.ctx.UI.homeTab, 'rec');
  app.touch('touchend', target, 190);
  assert.equal(app.ctx.UI.homeTab, 'fol'); assert.equal(app.rendered, 1); assert.equal(app.feed.style.transform, '');
  app.touch('touchstart', target, 230); app.touch('touchmove', target, 110); app.touch('touchend', target, 110);
  assert.equal(app.ctx.UI.homeTab, 'rec'); assert.equal(app.rendered, 2);
});

test('真实波形控件上的横拖不移动 hfeed，也不触发首页页签切换', () => {
  const app = start(), wave = app.target('.hfeed', 'canvas[data-wave]');
  app.touch('touchstart', wave, 55);
  for (const x of [75, 95, 115, 135, 155]) {
    app.touch('touchmove', wave, x);
    assert.equal(app.feed.style.transform, undefined, '波形坐标容器不得跟手平移');
  }
  app.touch('touchend', wave, 155);
  assert.equal(app.ctx.UI.homeTab, 'rec'); assert.equal(app.rendered, 0); assert.equal(app.animations.length, 0);
});

test('独立范围滑块和其内部节点不被首页横滑抢走，普通输入原排除条件保留', () => {
  for (const control of ['[data-rng]', 'input', 'textarea', '.sugg-r', '.rail']) {
    const app = start(), child = app.target('.hfeed', control);
    app.touch('touchstart', child, 70); app.touch('touchmove', child, 190); app.touch('touchend', child, 190);
    assert.equal(app.feed.style.transform, undefined, control);
    assert.equal(app.ctx.UI.homeTab, 'rec', control); assert.equal(app.rendered, 0, control);
  }
});

test('首页垂直滚动和最外侧阻尼回弹仍保留，不误切换页签', () => {
  const app = start(), target = app.target('.hfeed');
  app.touch('touchstart', target, 100, 100); app.touch('touchmove', target, 110, 170); app.touch('touchend', target, 110, 170);
  assert.equal(app.feed.style.transform, undefined); assert.equal(app.rendered, 0);
  app.touch('touchstart', target, 230); app.touch('touchmove', target, 110);
  assert.equal(app.feed.style.transform, 'translateX(-30px)');
  app.touch('touchend', target, 110);
  assert.equal(app.ctx.UI.homeTab, 'rec'); assert.equal(app.rendered, 0);
  assert.equal(app.animations.length, 1); assert.equal(app.animations[0].options.duration, 220);
});

test('系统取消已经超过阈值的首页横滑时回弹，不提交页签切换', () => {
  const app = start(), target = app.target('.hfeed');
  app.touch('touchstart', target, 70); app.touch('touchmove', target, 230);
  assert.equal(app.feed.style.transform, 'translateX(160px)');
  app.touch('touchcancel', target, 230);
  assert.equal(app.ctx.UI.homeTab, 'rec'); assert.equal(app.rendered, 0);
  assert.equal(app.feed.style.transform, ''); assert.equal(app.feed.style.opacity, '');
  assert.equal(app.animations.length, 1); assert.equal(app.animations[0].options.duration, 220);
});
