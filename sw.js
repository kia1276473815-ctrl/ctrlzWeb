/* CTRL Z · Service Worker：只做缓存加速，不改任何内容和外观
   - 页面本身（导航请求）：网络优先，拿到就顺手存一份；断网时用存的那份 → 永远是最新版本
   - 字体 / 图标 / vendor 打包（three、Paper）/ 分享图：先用缓存（秒开），同时在后台取新的替换（下次生效），内容没变就不重写磁盘
   - 字体和 vendor 放在独立的缓存里，升 V 时不用整批重下
   - 中文字体分片由页面自己存进 ctrlz-font-sc-v1，这里直接放行，不重复占空间
   更新 vendor 里的文件时请改文件名（例如加版本号），否则老用户会先用到一次旧缓存；顺手把 ASSETS 升一级，老文件才会被清掉 */
const V = 'ctrlz-static-v62', ASSETS = 'ctrlz-assets-v1';
const STATIC = /\/(fonts|icons|vendor)\/|\.(woff2|ttf|png|jpg|svg|webmanifest)$/, ASSET = /\/(fonts|vendor)\//;
const PRECACHE = ["./scripts/publications.js?v=20261112-1","./scripts/publications.css?v=20261112-1","./scripts/media-url-core.js?v=20261112-1","./scripts/post-edit-core.js?v=20261112-1","./scripts/comment-replies.js?v=20261111-1","./scripts/comment-replies.css?v=20261111-1","./scripts/relationship-lists.js?v=20261111-1","./scripts/relationship-lists.css?v=20261111-1","./scripts/official-inbox.js?v=20261111-1","./scripts/official-inbox.css?v=20261111-1","./scripts/block-operations.js?v=20261111-1","./scripts/block-operations.css?v=20261111-1","./","./scripts/communication.js?v=20261112-r22","./scripts/communication.css?v=20261112-r21","./scripts/audio-cache.js?v=20261011","./scripts/dm-outbox.js?v=20261111-voice1","./scripts/dm-voice-core.js?v=20261111-2","./scripts/dm-voice.js?v=20261111-5","./scripts/dm-voice.css?v=20261111-4","./scripts/post-audience-core.js?v=20261111-1","./scripts/post-audience.js?v=20261111-2","./scripts/post-access.js?v=20261112-3","./scripts/my-interactions.js?v=20261111-2","./scripts/my-interactions.css?v=20261111-2","./scripts/post-audience.css?v=20261111-2","./scripts/favorites.js?v=20261111-5","./scripts/favorites.css?v=20261111-2","./scripts/dm-expressions.js?v=20261111-2","./scripts/harmony-loader.js?v=20261012","./scripts/native-video-v1.js?v=20261111-2","./scripts/views-admin-v1.js?v=20261030-2","./scripts/views-payments-v1.js?v=20261111-2","./scripts/views-audio-v1.js?v=20261030-sec","./scripts/docs-v1.js?v=20261110-oauth","./scripts/oauth-v1.js?v=20261111-2","./vendor/qrcodegen.js"];
function cachedResponse(res){
  // 直接交还原响应，保留 URL/type 等浏览器元数据及安全头；重建导航响应会影响隔离策略。
  return res || Response.error();
}
// 和缓存里那份是同一个文件（ETag，或 Last-Modified + 大小一致）就不用重写；对不上或没有校验值时照常写
function sameFile(a,b){
  if (!a) return false; const v = k => [a.headers.get(k),b.headers.get(k)], [e0,e1] = v('etag'), [m0,m1] = v('last-modified'), [l0,l1] = v('content-length');
  return e0 || e1 ? e0 === e1 : !!m0 && m0 === m1 && l0 === l1;
}
// 字体 / vendor 文件名不变内容就不变：服务器没给校验值（ctrlz-server 的压缩响应目前没有 ETag）时，大小一样就算同一份
function sameAsset(a,b){
  if (!a) return false; const v = k => a.headers.get(k) || b.headers.get(k), l = a.headers.get('content-length');
  return !v('etag') && !v('last-modified') && !!l && l === b.headers.get('content-length');
}
async function saveFresh(ca,key,res){
  await ca.put(key,res);
  if (typeof key === 'string') return;   // 脚本换了 ?v= 版本：同一路径的旧版本条目删掉
  // 预缓存的条目不删：被新 SW 接管的旧标签页还会按旧 ?v= 请求，不能把新版本挤掉（否则离线时脚本打不开）；旧条目随 V 一起清
  for (const old of await ca.keys(key,{ignoreSearch:true})) if (old.url !== key.url && !PRECACHE.some(u => old.url.endsWith(u.slice(1)))) await ca.delete(old);
}
async function networkFirst(e,key){
  const ca = await caches.open(V), hit = await ca.match(key);
  if (!self.navigator.onLine) return cachedResponse(hit);
  const controller = new AbortController(), timer = hit ? setTimeout(() => controller.abort(),4000) : null;
  try { const res = await fetch(e.request,{signal:controller.signal}); if (res.ok && !sameFile(hit,res)) e.waitUntil(saveFresh(ca,key,cachedResponse(res.clone())).catch(() => {})); return res; }
  catch(err){ return cachedResponse(hit); }
  finally { if (timer !== null) clearTimeout(timer); }
}

// 首页须读取当前版本，避免旧HTTP缓存把旧脚本引用带进新离线缓存；带版本号的脚本继续复用HTTP缓存。
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(PRECACHE.map(u => u === './' ? new Request(u,{cache:'reload'}) : u.includes('?v=') ? new Request(u,{cache:'force-cache'}) : u))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('ctrlz-static-') && k !== V) || (k.startsWith('ctrlz-assets-') && k !== ASSETS)).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (/^\/auth\//.test(u.pathname) || u.searchParams.get('oauth') === 'complete') return;
  if (/HarmonyOS_Sans_SC\.part/.test(u.pathname)) return;
  if (/^\/(s|files|avatars)\//.test(u.pathname)) return;   // 分享卡片页、带签名的文件、头像：不缓存（分享页也不能当成首页存）
  if (/\/scripts\/.*\.(js|css)$/.test(u.pathname) || /\/vendor\/qrcodegen\.js$/.test(u.pathname)){
    // 代码与页面一起更新，断网时仍能启动；不能先给旧脚本再后台更新。
    e.respondWith(networkFirst(e,r)); return;
  }
  if (r.mode === 'navigate'){
    e.respondWith(networkFirst(e,'./'));
    return;
  }
  if (STATIC.test(u.pathname)){
    e.respondWith(caches.open(ASSET.test(u.pathname) ? ASSETS : V).then(ca => ca.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res.ok && !sameFile(hit,res) && !(ASSET.test(u.pathname) && sameAsset(hit,res))) ca.put(r, res.clone()); return res; }).catch(() => hit || Response.error());
      if (hit){ e.waitUntil(net.then(() => {}, () => {})); return hit; }
      return net;
    })));
  }
});

self.addEventListener('message', e => {
  if (e.data === 'ctrlz-oauth-version') e.ports?.[0]?.postMessage('ctrlz-oauth-v1');
});

/* 网页推送：服务器推来的通知显示在系统通知栏；点一下打开（或切到）网页对应的页面 */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch(err){ d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'CTRL Z', {body: d.body || '', tag: d.tag || 'ctrlz', renotify: true, icon: 'icons/icon-192.png?v=20261111', badge: 'icons/icon-192.png?v=20261111', data: {url: d.url || '/#msg'}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL(e.notification.data && e.notification.data.url || '/#msg', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(ws => {
    const w = ws.find(c => new URL(c.url).origin === self.location.origin);
    if (w){ w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
