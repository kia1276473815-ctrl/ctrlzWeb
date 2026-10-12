// Playwright CLI 诊断：四个独立context比较 plain/query 与原安全头/移除COOP+OAC的缓存副本。
// 删除头只作用于测试context里的Cache副本，不修改服务器或生产SW；结果不是离线验收pass。
async(page)=>{
  const browser=page.context().browser();if(!browser)throw Error('需要Chromium浏览器');const variants=[];
  for(const stripProcessHeaders of [false,true])for(const query of [false,true]){
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:800}}),p=await context.newPage();
    const events=[],result={stripProcessHeaders,query,navigationPath:query?'/?api=&demo=1#home':'/#home',events};
    const relevant=r=>r.isNavigationRequest() || r.url().includes('/scripts/audio-cache.js');
    p.on('request',r=>{if(relevant(r))events.push({event:'request',url:r.url()});});
    p.on('response',r=>{if(relevant(r.request()))events.push({event:'response',url:r.url(),status:r.status(),headers:r.headers(),fromServiceWorker:r.fromServiceWorker()});});
    p.on('requestfinished',r=>{if(relevant(r))events.push({event:'finished',url:r.url()});});
    p.on('requestfailed',r=>{if(relevant(r))events.push({event:'failed',url:r.url(),error:r.failure()?.errorText});});
    p.on('framenavigated',f=>{if(f===p.mainFrame())events.push({event:'main-frame-navigated',url:f.url()});});
    p.on('domcontentloaded',()=>events.push({event:'DOMContentLoaded'}));
    p.on('download',d=>events.push({event:'download',url:d.url(),name:d.suggestedFilename()}));
    p.on('pageerror',e=>events.push({event:'pageerror',message:e.message}));
    try{
      await p.goto('http://127.0.0.1:8789/?api=&demo=1#home');await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
      result.cache=await p.evaluate(async strip=>{
        const name=(await caches.keys()).filter(k=>k.startsWith('ctrlz-static-')).sort().at(-1),cache=await caches.open(name),response=await cache.match('./');
        if(!response)throw Error('缺少HTML缓存');const originalHeaders=Object.fromEntries(response.headers),bytes=new Uint8Array(await response.clone().arrayBuffer()),text=new TextDecoder().decode(bytes);
        if(strip){const headers=new Headers(response.headers);headers.delete('cross-origin-opener-policy');headers.delete('origin-agent-cluster');
          await cache.put('./',new Response(response.body,{status:response.status,statusText:response.statusText,headers}));}
        const current=await cache.match('./');return {name,originalHeaders,variantHeaders:Object.fromEntries(current.headers),byteLength:bytes.length,
          prefix:text.slice(0,100),complete:text.trimEnd().endsWith('</html>')};
      },stripProcessHeaders);
      await p.evaluate(path=>history.replaceState(history.state,'',path),result.navigationPath);await context.setOffline(true);
      result.online={page:await p.evaluate(()=>navigator.onLine),worker:await context.serviceWorkers()[0]?.evaluate(()=>navigator.onLine)};
      events.push({event:'offline-navigation-start'});
      try{await p.reload({waitUntil:'commit',timeout:5000});result.commit=true;
        await p.waitForFunction(()=>typeof AudioResources!=='undefined' && typeof CUR!=='undefined' && !!document.querySelector('#app .page'),null,{timeout:5000});
        result.parsed=await p.evaluate(()=>({url:location.href,ready:document.readyState,cur:CUR.key,api:API.on(),bodyLength:document.body.textContent.length}));
      }catch(e){result.navigationError=e.message;}
      // 提前复制：关闭context导致的ERR_ABORTED归为teardown，不能倒推成导航失败原因。
      result.eventsBeforeTeardown=events.map(e=>({...e}));events.push({event:'teardown-start'});
    }catch(e){result.preparationError=e.message;events.push({event:'teardown-start'});}
    finally{await context.close();variants.push(result);}
  }
  return {diagnostic:true,acceptance:false,browserVersion:browser.version(),variants};
}
