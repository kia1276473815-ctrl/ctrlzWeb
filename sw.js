/* CTRL Z · Service Worker：只做缓存加速，不改任何内容和外观
   - 页面本身（导航请求）：网络优先，拿到就顺手存一份；断网时用存的那份 → 永远是最新版本
   - 字体 / 图标 / vendor 打包（three、Paper）/ 分享图：先用缓存（秒开），同时在后台取新的替换（下次生效）
   - 中文字体分片由页面自己存进 ctrlz-font-sc-v1，这里直接放行，不重复占空间
   更新 vendor 里的文件时请改文件名（例如加版本号），否则老用户会先用到一次旧缓存 */
const V = 'ctrlz-static-v1';
const STATIC = /\/(fonts|icons|vendor)\/|\.(woff2|ttf|png|jpg|svg|webmanifest)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ctrlz-static-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (/HarmonyOS_Sans_SC\.part/.test(u.pathname)) return;
  if (r.mode === 'navigate'){
    e.respondWith(fetch(r).then(res => { if (res.ok){ const c = res.clone(); caches.open(V).then(ca => ca.put('./', c)); } return res; })
      .catch(() => caches.match('./').then(m => m || Response.error())));
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
