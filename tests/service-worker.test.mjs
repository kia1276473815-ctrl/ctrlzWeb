// 执行当前Service Worker源码；验证离线与无响应网络的缓存恢复，不复制实现。
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker({online=true,fetchImpl=async()=>new Response('network'),cached=true,keys=['ctrlz-static-v4']}={}){
  const origin='http://127.0.0.1:8789',listeners=new Map(),cache=new Map(),timers=[],cleared=[],puts=[],precache=[],matched=[],deleted=[];
  const key=k=>new URL(typeof k==='string'?k:k.url,origin+'/').href;
  if(cached){cache.set(key('./'),new Response('cached-html'));cache.set(key('/scripts/audio-cache.js'),new Response('cached-script'));}
  const ca={match:async k=>{const response=cache.get(key(k))?.clone();matched.push(response);return response;},put:async(k,r)=>{puts.push(key(k));cache.set(key(k),r);},addAll:async xs=>precache.push(...xs),
    keys:async k=>[...cache.keys()].filter(u=>u.split('?')[0]===key(k).split('?')[0]).map(url=>({url})),delete:async k=>cache.delete(key(k))};
  class Request{constructor(url,init={}){this.url=url;this.cache=init.cache;}}
  const opened=[],ctx=vm.createContext({URL,Headers,Response,Request,AbortController,console,location:{origin},
    self:{navigator:{onLine:online},addEventListener:(kind,fn)=>listeners.set(kind,fn),skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    caches:{open:async name=>{opened.push(name);return ca;},keys:async()=>keys,delete:async name=>{deleted.push(name);return true;}},fetch:fetchImpl,
    setTimeout:(fn,ms)=>{const id={fn,ms};timers.push(id);return id;},clearTimeout:id=>cleared.push(id)});
  vm.runInContext(source,ctx);
  const dispatch=(path,options={})=>{let response;const waits=[],request={url:origin+path,method:'GET',mode:'cors',...options};
    listeners.get('fetch')({request,respondWith:value=>response=value,waitUntil:value=>waits.push(value)});return {response,waits};};
  return {dispatch,listeners,cache,key,timers,cleared,puts,precache,matched,deleted,opened};
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('已离线时主页和必需脚本直接命中缓存，不启动网络或计时器',async()=>{
  let requests=0;const w=worker({online:false,fetchImpl:async()=>{requests++;throw Error('离线不应发网络');}});
  assert.equal(await(await w.dispatch('/?api=&demo=1',{mode:'navigate'}).response).text(),'cached-html');
  assert.equal(await(await w.dispatch('/scripts/audio-cache.js').response).text(),'cached-script');
  assert.equal(requests,0);assert.equal(w.timers.length,0);
});
test('付款二维码组件离线从预缓存读取，不向外部二维码服务发送支付地址',async()=>{
  let requests=0;const w=worker({online:false,fetchImpl:async()=>{requests++;throw Error('不能联网');}});
  w.cache.set(w.key('/vendor/qrcodegen.js'),new Response('local-qr-library'));
  assert.equal(await(await w.dispatch('/vendor/qrcodegen.js').response).text(),'local-qr-library');
  assert.equal(requests,0);
});

test('交流样式离线直接从版本缓存读取，不发网络请求',async()=>{
  let requests=0;const w=worker({online:false,fetchImpl:async()=>{requests++;throw Error('offline');}});
  w.cache.set(w.key('/scripts/communication.css?v=20261111-r13'),new Response('.comm-picker{}'));
  assert.equal(await(await w.dispatch('/scripts/communication.css?v=20261111-r13').response).text(),'.comm-picker{}');assert.equal(requests,0);
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
  assert.deepEqual(w.precache.map(x=>typeof x==='string'?x:x.url),["./scripts/recommendation-window.js?v=20261112-2","./scripts/recommendation-window.css?v=20261112-1","./scripts/following-feed.js?v=20261112-1","./scripts/following-feed.css?v=20261112-1","./scripts/publications.js?v=20261112-1","./scripts/publications.css?v=20261112-1","./scripts/media-url-core.js?v=20261112-1","./scripts/post-edit-core.js?v=20261112-1","./scripts/comment-replies.js?v=20261111-1","./scripts/comment-replies.css?v=20261111-1","./scripts/relationship-lists.js?v=20261111-1","./scripts/relationship-lists.css?v=20261111-1","./scripts/official-inbox.js?v=20261112-1","./scripts/official-inbox.css?v=20261112-1","./scripts/block-operations.js?v=20261111-1","./scripts/block-operations.css?v=20261111-1","./","./scripts/communication.js?v=20261112-r22","./scripts/communication.css?v=20261112-r21","./scripts/audio-cache.js?v=20261011","./scripts/dm-outbox.js?v=20261111-voice1","./scripts/dm-voice-core.js?v=20261111-2","./scripts/dm-voice.js?v=20261111-5","./scripts/dm-voice.css?v=20261111-4","./scripts/post-audience-core.js?v=20261111-1","./scripts/post-audience.js?v=20261111-2","./scripts/post-access.js?v=20261112-3","./scripts/my-interactions.js?v=20261112-1","./scripts/my-interactions.css?v=20261112-1","./scripts/post-audience.css?v=20261111-2","./scripts/favorites.js?v=20261111-5","./scripts/favorites.css?v=20261111-2","./scripts/dm-expressions.js?v=20261111-2","./scripts/harmony-loader.js?v=20261012","./scripts/native-video-v1.js?v=20261111-2","./scripts/views-admin-v1.js?v=20261030-2","./scripts/views-payments-v1.js?v=20261111-2","./scripts/views-audio-v1.js?v=20261030-sec","./scripts/docs-v1.js?v=20261110-oauth","./scripts/oauth-v1.js?v=20261111-2","./vendor/qrcodegen.js"]);
  // 首页跳过旧HTTP副本，保证新缓存离线启动使用当前脚本；有版本号的资源复用HTTP缓存。
  assert.equal(w.precache.find(x=>x.url==='./').cache,'reload');
  assert.deepEqual(w.precache.filter(x=>typeof x==='string'),['./vendor/qrcodegen.js']);assert(w.precache.filter(x=>typeof x!=='string'&&x.url!=='./').every(x=>x.cache==='force-cache'));
  for(const path of ['/files/post_audio/u/202610/f_1.wav?sig=secret','/avatars/photo.png','/s/p_1','/dm/with/u','/posts'])assert.equal(w.dispatch(path).response,undefined,path);
});

const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

test('OAuth回调及完成导航永不读写首页缓存；旧页面可核验worker支持',()=>{
  const w=worker({online:false});
  for(const path of ['/auth/oauth/wechat/callback?code=private&state=private','/auth/oauth/qq/callback?code=private','/?oauth=complete'])assert.equal(w.dispatch(path,{mode:'navigate'}).response,undefined,path);
  assert.equal(w.puts.length,0);let version;w.listeners.get('message')({data:'ctrlz-oauth-version',ports:[{postMessage:v=>version=v}]});assert.equal(version,'ctrlz-oauth-v1');
});
test('字体 / vendor 进独立缓存且升 V 时保留；后台刷新内容没变不重写，变了才写',async()=>{
  const headers={etag:'"a"','content-length':'3'},w=worker({keys:['ctrlz-static-v4','ctrlz-assets-v1'],fetchImpl:async()=>new Response('new',{headers})});
  const waits=[];w.listeners.get('activate')({waitUntil:value=>waits.push(value)});await Promise.all(waits);assert.deepEqual(w.deleted,['ctrlz-static-v4']);
  w.cache.set(w.key('/fonts/a.ttf'),new Response('old',{headers}));
  const same=w.dispatch('/fonts/a.ttf');assert.equal(await(await same.response).text(),'old');await Promise.all(same.waits);await nextTurn();
  assert.equal(w.opened.at(-1),'ctrlz-assets-v1');assert.deepEqual(w.puts,[],'ETag 一样不重写');
  w.cache.set(w.key('/fonts/b.ttf'),new Response('old',{headers:{etag:'"old"'}}));
  const changed=w.dispatch('/fonts/b.ttf');await changed.response;await Promise.all(changed.waits);await nextTurn();assert.deepEqual(w.puts,[w.key('/fonts/b.ttf')]);
  const icon=w.dispatch('/icons/a.png');await icon.response;await Promise.all(icon.waits);assert.match(w.opened.at(-1),/^ctrlz-static-v\d+$/);
});
test('脚本换了 ?v= 版本写入时删掉同路径旧条目；页面和缓存是同一份时不重写',async()=>{
  const w=worker();w.cache.set(w.key('/scripts/views.js?v=1'),new Response('old'));
  const e=w.dispatch('/scripts/views.js?v=2');await e.response;await Promise.all(e.waits);
  assert.equal(w.cache.has(w.key('/scripts/views.js?v=1')),false);assert.equal(w.cache.has(w.key('/scripts/views.js?v=2')),true);
  const headers={'last-modified':'Fri, 30 Oct 2026 00:00:00 GMT','content-length':'7'},same=worker({fetchImpl:async()=>new Response('network',{headers})});same.cache.set(same.key('./'),new Response('network',{headers}));
  const nav=same.dispatch('/',{mode:'navigate'});await nav.response;await Promise.all(nav.waits);assert.deepEqual(same.puts,[]);
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

test('ASSETS 升级时清掉旧的字体 / vendor 缓存，当前这份保留',async()=>{
  const w=worker({keys:['ctrlz-static-v4','ctrlz-assets-v0','ctrlz-assets-v1','ctrlz-font-sc-v1']}),waits=[];w.listeners.get('activate')({waitUntil:value=>waits.push(value)});await Promise.all(waits);
  assert.deepEqual(w.deleted,['ctrlz-static-v4','ctrlz-assets-v0']);
});
test('旧标签页按旧 ?v= 请求脚本：不挤掉预缓存的新版本，离线时新页面还能打开',async()=>{
  const name=source.match(/views-admin-v1\.js\?v=[^'"]+/)[0],w=worker();w.cache.set(w.key('/scripts/'+name),new Response('precached'));
  const e=w.dispatch('/scripts/views-admin-v1.js?v=old');await e.response;await Promise.all(e.waits);
  assert.equal(w.cache.has(w.key('/scripts/'+name)),true);assert.equal(w.cache.has(w.key('/scripts/views-admin-v1.js?v=old')),true);
});
test('服务器没有校验值（ctrlz-server 的压缩响应）：字体 / vendor 大小一样不重写，大小变了才写；图标和页面照常写',async()=>{
  const plain={'content-length':'3'},w=worker({fetchImpl:async()=>new Response('new',{headers:plain})});
  w.cache.set(w.key('/fonts/a.ttf'),new Response('old',{headers:plain}));
  const same=w.dispatch('/fonts/a.ttf');await same.response;await Promise.all(same.waits);await nextTurn();assert.deepEqual(w.puts,[]);
  w.cache.set(w.key('/vendor/b.js'),new Response('longer',{headers:{'content-length':'6'}}));
  const changed=w.dispatch('/vendor/b.js');await changed.response;await Promise.all(changed.waits);await nextTurn();assert.deepEqual(w.puts,[w.key('/vendor/b.js')]);
  w.cache.set(w.key('/icons/c.png'),new Response('old',{headers:plain}));
  const icon=w.dispatch('/icons/c.png');await icon.response;await Promise.all(icon.waits);await nextTurn();assert.equal(w.puts.at(-1),w.key('/icons/c.png'));
  const nav=worker({fetchImpl:async()=>new Response('new',{headers:plain})});nav.cache.set(nav.key('./'),new Response('old',{headers:plain}));
  const page=nav.dispatch('/',{mode:'navigate'});await page.response;await Promise.all(page.waits);assert.deepEqual(nav.puts,[nav.key('./')],'HTML 不按大小判断');
});
