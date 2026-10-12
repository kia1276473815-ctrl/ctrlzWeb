const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ByteCache, resourceKey, pcmBytes, runDecode} = require('../scripts/audio-cache.js');

test('最近使用的缓存保留，按字节及条目限额淘汰', () => {
  const c = new ByteCache(10, 2); c.set('a', 1, 4); c.set('b', 2, 4); assert.equal(c.get('a'), 1); c.set('c', 3, 4);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1); assert.equal(c.stats().bytes, 8);
  c.set('huge', 4, 11); assert.equal(c.get('huge'), undefined); assert.equal(c.stats().entries, 2);
  c.clear(); assert.equal(c.stats().bytes, 0);
});
test('并发请求复用，失败后能重试，空结果不永久缓存', async () => {
  const c = new ByteCache(100); let n = 0;
  const loader = async () => { n++; return new Uint8Array(10); };
  const [a,b] = await Promise.all([c.load('a', loader, x => x.byteLength), c.load('a', loader, x => x.byteLength)]);
  assert.equal(a, b); assert.equal(n, 1); assert.equal(c.stats().bytes, 10);
  await assert.rejects(c.load('bad', () => Promise.reject(new Error('断网')), () => 0));
  assert.equal(await c.load('bad', () => 'ok', () => 2), 'ok');
  assert.equal(await c.load('none', () => null, () => 0), null); assert.equal(c.get('none'), undefined);
});
test('临时签名不会复制资源，业务版本与对象路径仍区分', () => {
  assert.equal(resourceKey('/files/a?expires=1&sig=a&v=2'), resourceKey('/files/a?expires=3&sig=b&v=2'));
  assert.equal(resourceKey('/files/a?exp=1&sig=a'), resourceKey('/files/a?exp=3&sig=b'));
  assert.notEqual(resourceKey('/files/a?v=2'), resourceKey('/files/a?v=3'));
  assert.notEqual(resourceKey('/files/a'), resourceKey('/files/b'));
  assert.equal(pcmBytes({length:44100*60, numberOfChannels:2}), 21168000);
});

test('解码与下载任务串行执行，失败后后续任务仍能继续', async () => {
  let active = 0, peak = 0; const starts = [];
  const tasks = [0,1,2].map(i => runDecode(async () => { starts.push(i); peak = Math.max(peak, ++active);
    await new Promise(r => setTimeout(r, 5)); active--; if (i === 1) throw new Error('不可解码'); return i; }));
  const result = await Promise.allSettled(tasks); assert.equal(peak,1); assert.deepEqual(starts,[0,1,2]);
  assert.equal(result[1].status,'rejected'); assert.equal(result[2].value,2);
});
