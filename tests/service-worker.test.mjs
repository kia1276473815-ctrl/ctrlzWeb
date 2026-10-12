// 执行当前Service Worker源码；验证离线与无响应网络的缓存恢复，不复制实现。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker({online=true,fetchImpl=async()=>new Response('network'),cached=true}={}){
  const origin='http://127.0.0.1:8789',listeners=new Map(),cache=new Map(),timers=[],cleared=[],puts=[],precache=[],matched=[];
  const key=k=>new URL(typeof k==='string'?k:k.url,origin+'/').href;
  if(cached){cache.set(key('./'),new Response('cached-html'));cache.set(key('/scripts/audio-cache.js'),new Response('cached-script'));}
  const ca={match:async k=>{const response=cache.get(key(k))?.clone();matched.push(response);return response;},put:async(k,r)=>{puts.push(key(k));cache.set(key(k),r);},addAll:async xs=>precache.push(...xs)};
  const ctx=vm.createContext({URL,Headers,Response,AbortController,console,location:{origin},
    self:{navigator:{onLine:online},addEventListener:(kind,fn)=>listeners.set(kind,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async()=>ca,keys:async()=>['ctrlz-static-v4'],delete:async()=>true},fetch:fetchImpl,
    setTimeout:(fn,ms)=>{const id={fn,ms};timers.push(id);return id;},clearTimeout:id=>cleared.push(id)});
  vm.runInContext(source,ctx);
  const dispatch=(path,options={})=>{let response;const waits=[],request={url:origin+path,method:'GET',mode:'cors',...options};
    listeners.get('fetch')({request,respondWith:value=>response=value,waitUntil:value=>waits.push(value)});return {response,waits};};
  return {dispatch,listeners,cache,key,timers,cleared,puts,precache,matched};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('已离线时主页和必需脚本直接命中缓存，不启动网络或计时器',async()=>{
  let requests=0;const w=worker({online:false,fetchImpl:async()=>{requests++;throw Error('离线不应发网络');}});
  assert.equal(await(await w.dispatch('/?api=&demo=1',{mode:'navigate'}).response).text(),'cached-html');
  assert.equal(await(await w.dispatch('/scripts/audio-cache.js').response).text(),'cached-script');
  assert.equal(requests,0);assert.equal(w.timers.length,0);
});

test('联网但请求挂起时四秒取消并回缓存，完成后清理计时器',async()=>{
  let aborted=false;const w=worker({fetchImpl:(request,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));}))});
  const {response}=w.dispatch('/',{mode:'navigate'});await tick();assert.equal(w.timers.length,1);assert.equal(w.timers[0].ms,4000);
  w.timers[0].fn();assert.equal(await(await response).text(),'cached-html');assert.equal(aborted,true);assert.deepEqual(w.cleared,w.timers);
});

test('联网成功采用新页面并更新统一主页缓存，未命中离线缓存时返回网络错误',async()=>{
  const w=worker(),e=w.dispatch('/?api=self',{mode:'navigate'}),response=await e.response;
  assert.equal(await response.text(),'network');await Promise.all(e.waits);assert.deepEqual(w.puts,[w.key('./')]);assert.equal(await w.cache.get(w.key('./')).text(),'network');
  assert.deepEqual(w.cleared,w.timers);
  const missing=worker({online:false,cached:false});assert.equal((await missing.dispatch('/',{mode:'navigate'}).response).type,'error');
});

test('安装缓存HTML与四个经典脚本，私密签名文件和接口请求不被主页策略接管',async()=>{
  const w=worker(),waits=[];w.listeners.get('install')({waitUntil:value=>waits.push(value)});await Promise.all(waits);
  assert.deepEqual(w.precache,['./','./scripts/audio-cache.js?v=20261011','./scripts/dm-outbox.js','./scripts/harmony-loader.js?v=20261012','./scripts/views-admin-v1.js?v=20261012-voucher','./scripts/views-audio-v1.js','./scripts/docs-v1.js?v=20261012-voucher']);
  for(const path of ['/files/post_audio/u/202610/f_1.wav?sig=secret','/avatars/photo.png','/s/p_1','/dm/with/u','/posts'])assert.equal(w.dispatch(path).response,undefined,path);
});

const decodedHtml='<!doctype html><html><head><title>离线中文页面</title></head><body><script src="scripts/audio-cache.js"></script></body></html>';
const gzipMetadata={
  'content-type':'text/html; charset=UTF-8','content-encoding':'gzip','content-length':'427736',connection:'keep-alive','keep-alive':'timeout=5','transfer-encoding':'chunked',
  'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','cache-control':'no-cache',
};
const assertOriginalHeaders=r=>{
  for(const [name,value] of Object.entries(gzipMetadata))assert.equal(r.headers.get(name),value,name);
};
test('离线直接交还原缓存响应，保留浏览器元数据与全部安全头，不重建导航Response',async()=>{
  const w=worker({online:false});w.cache.set(w.key('./'),new Response(decodedHtml,{headers:gzipMetadata,status:200,statusText:'OK'}));
  const response=await w.dispatch('/?api=&demo=1',{mode:'navigate'}).response;assert.equal(response,w.matched[0]);assertOriginalHeaders(response);assert.equal(response.status,200);assert.equal(response.statusText,'OK');
  assert.equal(await response.text(),decodedHtml);assert.equal(w.cache.get(w.key('./')).bodyUsed,false,'缓存原件没有被消费');
});

test('联网缓存使用原响应clone，网络失败回退同样保留原响应及安全头',async()=>{
  const w=worker({fetchImpl:async()=>new Response(decodedHtml,{headers:gzipMetadata})}),event=w.dispatch('/',{mode:'navigate'}),response=await event.response;
  assert.equal(response.headers.get('content-encoding'),'gzip','网络响应仍由浏览器处理原始传输');await Promise.all(event.waits);
  const saved=w.cache.get(w.key('./'));assertOriginalHeaders(saved);assert.notEqual(saved,response);assert.equal(await saved.clone().text(),decodedHtml);
  const fallback=worker({fetchImpl:async()=>{throw Error('网络不可达');}});fallback.cache.set(fallback.key('./'),new Response(decodedHtml,{headers:gzipMetadata}));
  const cached=await fallback.dispatch('/',{mode:'navigate'}).response;assert.equal(cached,fallback.matched[0]);assertOriginalHeaders(cached);assert.equal(await cached.text(),decodedHtml);
});
