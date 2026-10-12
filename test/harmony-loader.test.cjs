// 真实下载调度器的资源生命周期；使用小 Blob 模拟原始完整字体分片。
const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../scripts/harmony-loader.js');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();await new Promise(setImmediate);for(let i=0;i<40;i++)await Promise.resolve();};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(fetcher){
  const h={now:0,blocked:false,network:true,calls:[],puts:[],deleted:[],blobs:new Map(),installed:[],timers:new Map()};let seq=0;
  h.cache={match:async u=>h.blobs.has(u)?new Response(h.blobs.get(u)):null,put:async(u,r)=>{h.puts.push(u);h.blobs.set(u,await r.blob());},delete:async u=>{h.deleted.push(u);h.blobs.delete(u);}};
  h.loader=create({parts:['one','two'],sizes:[4,4],fetch:async(u,o)=>{h.calls.push([u,o]);return fetcher?fetcher(u,o,h):new Response(u==='one'?'1234':'5678');},openCache:()=>h.cache,
    install:async bs=>h.installed.push(await Promise.all(bs.map(b=>b.text()))),blocked:()=>h.blocked,allowNetwork:()=>h.network,clock:()=>h.now,
    setTimer:(fn,ms)=>{const id=++seq;h.timers.set(id,{fn,at:h.now+ms});return id;},clearTimer:id=>h.timers.delete(id)});
  h.advance=async ms=>{h.now+=ms;for(const [id,t] of [...h.timers])if(t.at<=h.now){h.timers.delete(id);t.fn();}await flush();};return h;
}
test('单路字体下载与重复start合并，完整原始分片缓存后只安装一次',async()=>{
  const h=harness(),first=h.loader.start();assert.equal(h.loader.start(),first);assert.equal(h.loader.start(),first);await first;
  assert.deepEqual(h.calls.map(x=>x[0]),['one','two']);assert(h.calls.every(x=>x[1].priority==='low' && x[1].signal));
  assert.deepEqual(h.puts,['one','two']);assert.deepEqual(h.installed,[['1234','5678']]);assert.equal(h.loader.state.status,'ready');
  h.loader.hold();h.loader.sync();h.loader.start();assert.equal(h.calls.length,2);assert.equal(h.timers.size,0);
});
test('播放意图取消响应体下载；缓存完成的第一片，缓冲恢复后只重取第二片',async()=>{
  let second=0,aborted=false;const h=harness(async(u,o)=>{
    if(u==='one' || ++second>1)return new Response(u==='one'?'1234':'5678');
    return {ok:true,blob:()=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}))};
  });h.loader.start();await flush();assert.equal(h.calls.length,2);h.blocked=true;h.loader.hold();await flush();
  assert(aborted);assert.deepEqual(h.puts,['one']);assert.equal(h.loader.state.failures,0);await h.advance(800);assert.equal(h.calls.length,2);
  h.blocked=false;await h.loader.sync();assert.deepEqual(h.calls.map(x=>x[0]),['one','two','two']);assert.deepEqual(h.installed,[['1234','5678']]);
});
test('省流量或播放期间仍可使用完整本地缓存，不开启字体网络',async()=>{
  const h=harness();h.network=false;h.blocked=true;h.blobs.set('one',new Blob(['1234']));h.blobs.set('two',new Blob(['5678']));await h.loader.start();
  assert.equal(h.calls.length,0);assert.deepEqual(h.installed,[['1234','5678']]);
});
test('缓存缺片时省流量不下载；网络恢复事件允许继续，不保留周期轮询',async()=>{
  const h=harness();h.network=false;await h.loader.start();assert.equal(h.calls.length,0);assert.equal(h.timers.size,0);
  h.network=true;await h.loader.sync();assert.equal(h.calls.length,2);assert.equal(h.loader.state.status,'ready');
});
test('等待缓存期间发生播放意图，缓存返回后不启动字体请求',async()=>{
  const h=harness(),gate=defer();h.cache.match=()=>gate.promise;h.loader.start();await flush();h.blocked=true;h.loader.hold();gate.resolve(null);await flush();
  assert.equal(h.calls.length,0);await h.advance(800);assert.equal(h.calls.length,0);h.blocked=false;await h.loader.sync();assert.equal(h.loader.state.status,'ready');
});
test('隐藏页面取消字体body；回到前台恢复，取消不消耗失败重试次数',async()=>{
  let first=true;const h=harness(async(u,o)=>{if(!first)return new Response(u==='one'?'1234':'5678');first=false;
    return {ok:true,blob:()=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true}))};});
  h.loader.start();await flush();h.blocked=true;h.loader.sync();await flush();assert.equal(h.loader.state.failures,0);assert.equal(h.loader.state.networkActive,false);
  h.blocked=false;await h.loader.sync();assert.equal(h.loader.state.status,'ready');
});
test('不完整缓存和响应不被当成有效字体；失败退避有上限',async()=>{
  const h=harness(async()=>new Response('bad'));h.blobs.set('one',new Blob(['bad']));await h.loader.start();
  assert.deepEqual(h.deleted,['one']);assert.equal(h.puts.length,0);await h.advance(2000);await h.advance(4000);assert.equal(h.calls.length,3);
  assert.equal(h.loader.state.failures,3);assert.equal(h.timers.size,0);assert.equal(h.installed.length,0);h.loader.sync();assert.equal(h.calls.length,3);
});
test('字体响应体挂住时到期取消，迟到完整body不写缓存或安装',async()=>{
  const gate=defer();let signal;const h=harness(async(u,o)=>{signal=o.signal;return {ok:true,blob:()=>gate.promise};});h.loader.start();await flush();await h.advance(180000);
  assert(signal.aborted);gate.resolve(new Blob(['1234']));await flush();assert.equal(h.puts.length,0);assert.equal(h.installed.length,0);assert.equal(h.loader.state.failures,1);
});
test('Cache Storage配额错误不影响本次完整鸿蒙字体应用',async()=>{
  const h=harness();h.cache.put=async()=>{throw Error('quota');};await h.loader.start();assert.deepEqual(h.installed,[['1234','5678']]);assert.equal(h.loader.state.status,'ready');
});
