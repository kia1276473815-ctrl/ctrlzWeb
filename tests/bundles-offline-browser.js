// Playwright CLI run-code --filename：独立contexts，验证直接入口以及SW离线缓存。
async (page) => {
  const origin='http://127.0.0.1:8789',browser=page.context().browser(),errors=[],direct=[],navigationNetwork=[],browserEvents=[];
  let cached;
  if(!browser)throw Error('需要Chromium浏览器');
  const routes=[['item-p1','audio'],['item-p3','audio'],['item-p7','audio'],['doc-terms','docs'],['admin-dash','admin']];
  const diagnostic=async(p,phase,route,bundle,error)=>{
    let state;try{state=await p.evaluate(()=>({url:location.href,cur:typeof CUR!=='undefined'?CUR.key:null,role:typeof STATE!=='undefined'?STATE.role:null,
      demo:typeof DEMO!=='undefined'?DEMO:null,api:typeof API!=='undefined'?{on:API.on(),base:API.base}:null,
      bundles:typeof BUNDLES!=='undefined'?Object.fromEntries(Object.entries(BUNDLES).map(([k,v])=>[k,{ready:!!v.ready,error:!!v.error,pending:!!v.task,src:v.src}])):null,
      templates:[...document.querySelectorAll('[data-bundle-view],[data-doc-body]')].map(e=>({bundle:e.dataset.bundleView,doc:e.dataset.docBody,text:e.textContent.slice(0,120)})),
      product:typeof P==='function' && location.hash.startsWith('#item-')?{exists:!!P(location.hash.slice(6)),tpl:P(location.hash.slice(6))?.tpl,cat:P(location.hash.slice(6))?.cat}:null,
      appText:document.querySelector('#app')?.textContent.slice(0,400),controller:!!navigator.serviceWorker?.controller}));}catch(e){state={diagnosticError:e.message};}
    return Error(`${phase} route=${route} bundle=${bundle}：${error.message}；state=${JSON.stringify(state)}；cache=${JSON.stringify(cached)}；navigationNetwork=${JSON.stringify(navigationNetwork)}；browserEvents=${JSON.stringify(browserEvents)}；onlineDirect=${JSON.stringify(direct)}；pageErrors=${JSON.stringify(errors)}`);
  };
  const ready=async(p,route,bundle)=>{
    const at=route.indexOf('-'),key=route.slice(0,at)+'|'+route.slice(at+1);
    await p.waitForFunction(({bundle,key})=>typeof BUNDLES!=='undefined' && BUNDLES[bundle].ready && CUR.key===key && !document.querySelector('[data-bundle-view]') &&
      (bundle!=='docs' || document.querySelector('#app').textContent.includes('协议的范围')),{bundle,key});
  };
  for(const [route,bundle] of routes){
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'}),p=await context.newPage();
    p.on('pageerror',e=>errors.push({route,message:e.message}));
    try{
      if(bundle==='admin')await p.addInitScript(()=>localStorage.setItem('ctrlz2.role',JSON.stringify('admin')));
      await p.goto(origin + '/?api=&demo=1#' + route);
      await ready(p,route,bundle);
      const state=await p.evaluate(()=>({route:location.hash,placeholder:!!document.querySelector('[data-bundle-view]'),
        contentLength:document.querySelector('#app').textContent.trim().length,docsHaveBody:location.hash!=='#doc-terms' || document.querySelector('#app').textContent.includes('协议的范围')}));
      if(state.placeholder || state.contentLength<50 || !state.docsHaveBody)throw Error('直接入口没有加载实际内容：'+route);
      direct.push(state);
    }catch(e){throw await diagnostic(p,'online-direct',route,bundle,e);}finally{await context.close();}
  }
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'allow'}),p=await context.newPage();
  const relevant=r=>r.isNavigationRequest() || r.url().includes('/scripts/audio-cache.js');
  p.on('request',r=>{if(relevant(r))navigationNetwork.push({event:'request',url:r.url(),type:r.resourceType()});});
  p.on('requestfailed',r=>{if(relevant(r))navigationNetwork.push({event:'requestfailed',url:r.url(),failure:r.failure()?.errorText});});
  p.on('response',r=>{if(relevant(r.request()))navigationNetwork.push({event:'response',url:r.url(),status:r.status(),headers:r.headers(),fromServiceWorker:r.fromServiceWorker()});});
  p.on('download',d=>browserEvents.push({event:'download',url:d.url(),fileName:d.suggestedFilename()}));
  p.on('console',m=>{if(['error','warning'].includes(m.type()))browserEvents.push({event:'console',type:m.type(),text:m.text().slice(0,500)});});
  p.on('pageerror',e=>errors.push({route:'offline',message:e.message}));const offline=[];
  let phase='SW install',route='home',bundle='none';try{
    await p.goto(origin+'/?api=&demo=1#home');await p.waitForFunction(()=>typeof BUNDLES!=='undefined');
    await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    cached=await p.evaluate(async()=>{
      const name=(await caches.keys()).filter(x=>x.startsWith('ctrlz-static-')).sort().at(-1),cache=await caches.open(name);
      const keys=(await cache.keys()).map(x=>new URL(x.url).pathname),html=await cache.match('./');let body;
      if(html){const bytes=new Uint8Array(await html.clone().arrayBuffer()),text=new TextDecoder().decode(bytes),hash=await crypto.subtle.digest('SHA-256',bytes);
        body={status:html.status,headers:Object.fromEntries(html.headers),byteLength:bytes.length,textLength:text.length,prefix:text.slice(0,120),
          prefixHex:[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join(''),sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''),
          hasAudioCacheScript:text.includes('scripts/audio-cache.js'),hasClosingHtml:text.trimEnd().endsWith('</html>')};}
      return {name,keys,homepage:!!html,body};
    });
    if(!cached.homepage)throw Error('新SW激活后没有缓存主页，首次离线刷新无法启动');
    for(const file of ['audio-cache.js','views-admin-v1.js','views-audio-v1.js','docs-v1.js'])if(!cached.keys.some(k=>k.endsWith('/scripts/'+file)))throw Error('SW缺少经典脚本：'+file);
    // API.init 会消费 ?api= 并删除query；带self元数据的页面刷新需再次声明本地demo。
    phase='offline-first-reload';await p.evaluate(()=>history.replaceState(history.state,'','/?api=&demo=1#home'));
    await context.setOffline(true);
    navigationNetwork.push({event:'offline-state',pageOnline:await p.evaluate(()=>navigator.onLine),
      worker:await context.serviceWorkers()[0]?.evaluate(()=>({online:navigator.onLine,url:location.href})).catch(e=>({error:e.message}))});
    await p.reload({waitUntil:'commit'});phase='offline-first-script';await p.waitForFunction(()=>typeof BUNDLES!=='undefined' && typeof AudioResources!=='undefined' && !!document.querySelector('#app .page'));
    for(const current of routes){
      [route,bundle]=current;phase='offline-route';
      if(bundle==='admin')await p.evaluate(()=>setRole('admin',true));
      await p.evaluate(route=>{location.hash=route;},route);
      await ready(p,route,bundle);
      offline.push(await p.evaluate(()=>({route:location.hash,contentLength:document.querySelector('#app').textContent.trim().length})));
    }
  }catch(e){throw await diagnostic(p,phase,route,bundle,e);}finally{await context.close();}
  if(errors.length)throw Error('页面异常：'+JSON.stringify(errors));
  return {onlineDirectEntry:direct,newWorkerCachedHomepageAndScripts:cached,offlineReloadAndRoutes:offline,navigationNetwork,browserEvents,pageErrors:errors};
}
