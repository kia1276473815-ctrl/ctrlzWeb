/* CTRL Z · Service Worker：只做缓存加速，不改任何内容和外观
   - 页面本身（导航请求）：网络优先，拿到就顺手存一份；断网时用存的那份 → 永远是最新版本
   - 字体 / 图标 / vendor 打包（three、Paper）/ 分享图：先用缓存（秒开），同时在后台取新的替换（下次生效）
   - 中文字体分片由页面自己存进 ctrlz-font-sc-v1，这里直接放行，不重复占空间
   更新 vendor 里的文件时请改文件名（例如加版本号），否则老用户会先用到一次旧缓存 */
const V = 'ctrlz-static-v7';
const STATIC = /\/(fonts|icons|vendor)\/|\.(woff2|ttf|png|jpg|svg|webmanifest)$/;
function cachedResponse(res){
  // 直接交还原响应，保留 URL/type 等浏览器元数据及安全头；重建导航响应会影响隔离策略。
  return res || Response.error();
}
async function networkFirst(e,key){
  const ca = await caches.open(V), hit = await ca.match(key);
  if (!self.navigator.onLine) return cachedResponse(hit);
  const controller = new AbortController(), timer = hit ? setTimeout(() => controller.abort(),4000) : null;
  try { const res = await fetch(e.request,{signal:controller.signal}); if (res.ok) e.waitUntil(ca.put(key,cachedResponse(res.clone())).catch(() => {})); return res; }
  catch(err){ return cachedResponse(hit); }
  finally { if (timer !== null) clearTimeout(timer); }
}

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(['./','./scripts/audio-cache.js?v=20261011','./scripts/dm-outbox.js','./scripts/harmony-loader.js?v=20261012','./scripts/views-admin-v1.js?v=20261012-voucher','./scripts/views-audio-v1.js','./scripts/docs-v1.js?v=20261012-voucher'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ctrlz-static-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (/HarmonyOS_Sans_SC\.part/.test(u.pathname)) return;
  if (/^\/(s|files|avatars)\//.test(u.pathname)) return;   // 分享卡片页、带签名的文件、头像：不缓存（分享页也不能当成首页存）
  if (/\/scripts\/.*\.js$/.test(u.pathname)){
    // 代码与页面一起更新，断网时仍能启动；不能先给旧脚本再后台更新。
    e.respondWith(networkFirst(e,r)); return;
  }
  if (r.mode === 'navigate'){
    e.respondWith(networkFirst(e,'./'));
    return;
  }
  if (STATIC.test(u.pathname)){
    e.respondWith(caches.open(V).then(ca => ca.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res.ok) ca.put(r, res.clone()); return res; }).catch(() => hit || Response.error());
      if (hit){ e.waitUntil(net.then(() => {}, () => {})); return hit; }
      return net;
    })));
  }
});

/* 网页推送：服务器推来的通知显示在系统通知栏；点一下打开（或切到）网页对应的页面 */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch(err){ d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'CTRL Z', {body: d.body || '', tag: d.tag || 'ctrlz', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: {url: d.url || '/#msg'}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = new URL(e.notification.data && e.notification.data.url || '/#msg', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(ws => {
    const w = ws.find(c => new URL(c.url).origin === self.location.origin);
    if (w){ w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
