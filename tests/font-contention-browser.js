// Playwright CLI run-code --filename。冷 context 弱网对照，只读取8789隔离服务。
async(page)=>{
  const origin='http://127.0.0.1:8789',browser=page.context().browser(),results=[];
  for(const [round,blockChinese] of [[1,false],[1,true],[2,true],[2,false],[3,false],[3,true]]){
    const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block'}),p=await context.newPage(),errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(p),trace=new Map();
    await context.route('**/*',route=>{
      const request=route.request();
      if(!['GET','HEAD'].includes(request.method()))return route.abort('blockedbyclient');
      if(blockChinese && /\/fonts\/HarmonyOS_Sans_SC\.part[12]\.ttf/.test(request.url()))return route.abort('blockedbyclient');
      return route.continue();
    });
    await context.addInitScript(()=>{
      const fetch0=globalThis.fetch;globalThis.__fontFetches=0;
      globalThis.fetch=function(url,...args){if(String(url).includes('HarmonyOS_Sans_SC.part'))__fontFetches++;return fetch0.call(this,url,...args);};
    });
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:256*1024,uploadThroughput:256*1024});
    cdp.on('Network.requestWillBeSent',e=>{if(/HarmonyOS_Sans_SC\.part|fixture-real\.wav/.test(e.request.url))trace.set(e.requestId,{url:new URL(e.request.url).pathname,priority:e.request.initialPriority,bytes:0});});
    cdp.on('Network.dataReceived',e=>{const item=trace.get(e.requestId);if(item)item.bytes+=e.dataLength;});
    try{
      await p.goto(origin+'/?api=&demo=1#home',{waitUntil:'domcontentloaded',timeout:30000});
      await p.waitForFunction(()=>typeof GEN!=='undefined' && globalThis.__fontFetches>=2,{timeout:6000});
      const media=await p.evaluate(async()=>{
        if(location.origin!=='http://127.0.0.1:8789')throw Error('只允许隔离8789');
        const a=new Audio(),start=performance.now(),events=[],result=await new Promise(resolve=>{
          const timer=setTimeout(()=>resolve({canplayMs:null,timedOut:true,events}),29000);
          for(const type of ['loadstart','loadedmetadata','loadeddata','canplay','error'])a.addEventListener(type,()=>{
            events.push({type,ms:Math.round((performance.now()-start)*10)/10});
            if(type==='canplay' || type==='error'){clearTimeout(timer);resolve({canplayMs:type==='canplay'?performance.now()-start:null,timedOut:false,error:a.error?.code,events});}
          });
          a.preload='auto';a.src='/fixture-real.wav';a.load();
        });
        a.pause();a.removeAttribute('src');a.load();return result;
      });
      results.push({round,blockChinese,media,trace:[...trace.values()],errors});
    }finally{await context.close();}
  }
  const summary=blocked=>{const xs=results.filter(r=>r.blockChinese===blocked).map(r=>r.media.canplayMs).filter(Number.isFinite).sort((a,b)=>a-b);return{samples:xs.map(x=>Math.round(x*10)/10),medianMs:xs.length?Math.round(xs[Math.floor(xs.length/2)]*10)/10:null};};
  return {fixtureBytes:962226,latencyMs:100,downloadKiBps:256,original:summary(false),blockedChinese:summary(true),results};
}
