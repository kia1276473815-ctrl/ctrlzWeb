// Playwright CLI：只诊断新SW的HTML缓存/响应头与真实离线导航，不操作现有浏览器context。
async(page)=>{
  const browser=page.context().browser(),context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:800}}),p=await context.newPage();
  const events=[],output={events};const wanted=r=>r.isNavigationRequest() || r.url().includes('/scripts/audio-cache.js');
  p.on('request',r=>{if(wanted(r))events.push({event:'request',url:r.url(),type:r.resourceType()});});
  p.on('response',r=>{if(wanted(r.request()))events.push({event:'response',url:r.url(),status:r.status(),headers:r.headers(),fromServiceWorker:r.fromServiceWorker()});});
  p.on('requestfinished',r=>{if(wanted(r))events.push({event:'finished',url:r.url()});});
  p.on('requestfailed',r=>{if(wanted(r))events.push({event:'failed',url:r.url(),failure:r.failure()?.errorText});});
  p.on('framenavigated',f=>{if(f===p.mainFrame())events.push({event:'main-frame-navigated',url:f.url()});});
  p.on('domcontentloaded',()=>events.push({event:'DOMContentLoaded'}));p.on('load',()=>events.push({event:'load'}));
  p.on('download',d=>events.push({event:'download',url:d.url(),fileName:d.suggestedFilename()}));
  p.on('console',m=>{if(['warning','error'].includes(m.type()))events.push({event:'console',type:m.type(),text:m.text().slice(0,500)});});
  p.on('pageerror',e=>events.push({event:'pageerror',message:e.message}));
  try{
    await p.goto('http://127.0.0.1:8789/?api=&demo=1#home');await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    output.cache=await p.evaluate(async()=>{
      const names=(await caches.keys()).filter(x=>x.startsWith('ctrlz-static-')),name=names.sort().at(-1),cache=await caches.open(name),response=await cache.match('./');
      if(!response)throw Error('HTML没有预缓存');const bytes=new Uint8Array(await response.clone().arrayBuffer()),text=new TextDecoder().decode(bytes),digest=await crypto.subtle.digest('SHA-256',bytes);
      return {name,url:response.url,type:response.type,status:response.status,headers:Object.fromEntries(response.headers),byteLength:bytes.length,textLength:text.length,prefix:text.slice(0,120),
        prefixHex:[...bytes.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join(''),sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),
        hasAudioCacheScript:text.includes('scripts/audio-cache.js'),hasClosingHtml:text.trimEnd().endsWith('</html>'),workerUrl:navigator.serviceWorker.controller.scriptURL};
    });
    await p.evaluate(()=>history.replaceState(history.state,'','/?api=&demo=1#home'));await context.setOffline(true);
    output.online={page:await p.evaluate(()=>navigator.onLine),worker:await context.serviceWorkers()[0]?.evaluate(()=>navigator.onLine)};
    try{await p.reload({waitUntil:'commit',timeout:5000});output.commit=true;
      await p.waitForFunction(()=>typeof AudioResources!=='undefined' && typeof CUR!=='undefined' && !!document.querySelector('#app .page'),null,{timeout:5000});
      output.after=await p.evaluate(()=>({url:location.href,ready:document.readyState,cur:CUR.key,bodyLength:document.body.textContent.length}));
    }catch(e){output.navigationError=e.message;}
    // 诊断文件总是返回证据对象；它不是验收pass。bundles-offline测试仍严格throw失败。
    return output;
  }catch(e){throw Error('SW诊断准备失败：'+e.message+'；partial='+JSON.stringify(output));}finally{await context.close();}
}
