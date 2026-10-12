// Playwright CLI run-code --filename. Fixture 8789 only; real click/GEN/media, no business writes.
// Open /qa-control?phase=baseline or phase=after in a dedicated ctrlz-weak-qa session.
async (page) => {
  const origin='http://127.0.0.1:8789', phase=new URL(page.url()).searchParams.get('phase') || 'baseline';
  if(!['baseline','after'].includes(phase))throw Error('Unexpected benchmark phase');
  const browser=page.context().browser(), audioId='p_0mv211y2f6amyy6b3j5', results=[];
  const round=x=>Number.isFinite(x)?Math.round(x*10)/10:null;
  if(new URL(page.url()).searchParams.get('cache')==='1'){
    const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block',extraHTTPHeaders:{'X-QA-Version':phase}}),p=await context.newPage();
    const requests=[],errors=[],blockedWrites=[],cdp=await context.newCDPSession(p);let stage='cold';
    p.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){blockedWrites.push(req.method());return route.abort('blockedbyclient');}if(new URL(req.url()).origin!==origin)return route.abort('blockedbyclient');return route.continue();});
    p.on('request',req=>{if(/HarmonyOS_Sans_SC\.part/.test(req.url()))requests.push({stage,path:new URL(req.url()).pathname});});
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    const fontState=()=>p.evaluate(async()=>({hos:document.documentElement.classList.contains('hos'),faces:[...document.fonts].filter(f=>f.family.includes('HarmonyOS Sans SC')).map(f=>({family:f.family,status:f.status})),cacheKeys:await caches.keys(),parts:(await Promise.all((await caches.keys()).map(async key=>(await (await caches.open(key)).keys()).map(r=>new URL(r.url).pathname)))).flat().filter(x=>x.includes('HarmonyOS_Sans_SC.part')),saveData:navigator.connection?.saveData}));
    try{
      await p.goto(origin+'/?api=self#home',{waitUntil:'domcontentloaded',timeout:20000});
      await p.waitForFunction(()=>document.documentElement.classList.contains('hos'),null,{timeout:29000});const cold=await fontState();
      stage='warm';await p.reload({waitUntil:'domcontentloaded',timeout:20000});await p.waitForFunction(()=>document.documentElement.classList.contains('hos'),null,{timeout:29000});const warm=await fontState();
      stage='warm-save-data';await context.addInitScript(()=>{if(navigator.connection)Object.defineProperty(navigator.connection,'saveData',{configurable:true,get:()=>true});});
      await p.reload({waitUntil:'domcontentloaded',timeout:20000});await p.waitForFunction(()=>document.documentElement.classList.contains('hos'),null,{timeout:29000});const warmSaveData=await fontState();
      const passed=cold.parts.length===2&&cold.faces.some(f=>f.status==='loaded')&&warm.faces.some(f=>f.status==='loaded')&&warmSaveData.faces.some(f=>f.status==='loaded')&&requests.filter(r=>r.stage==='cold').length===2&&!requests.some(r=>r.stage!=='cold')&&errors.length===0&&blockedWrites.length===0;
      return{phase,cacheCheck:true,passed,conditions:{origin,httpCacheDisabled:true,serviceWorkers:'block',network:'unthrottled',realOriginalFontFiles:true},cold,warm,warmSaveData,requests,errors,blockedWrites};
    }catch(e){return{phase,cacheCheck:true,passed:false,stage,error:e.message,state:await fontState().catch(()=>null),requests,errors,blockedWrites};}
    finally{await context.close();}
  }
  for(const scene of ['immediate','font-in-flight'])for(let trial=1;trial<=3;trial++){
    const context=await browser.newContext({viewport:{width:393,height:852},serviceWorkers:'block',extraHTTPHeaders:{'X-QA-Version':phase}});
    const p=await context.newPage(), errors=[], blockedWrites=[], trace=new Map(), startedAt=Date.now();let stage='navigation';
    const cdp=await context.newCDPSession(p);
    p.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>{const req=route.request();if(!['GET','HEAD'].includes(req.method())){blockedWrites.push({method:req.method(),path:new URL(req.url()).pathname});return route.abort('blockedbyclient');}if(new URL(req.url()).origin!==origin)return route.abort('blockedbyclient');return route.continue();});
    await context.addInitScript(()=>{
      const q=globalThis.__weakQa={armed:false,clickAt:null,clickWall:null,playingAt:null,signalAt:null,decodeCalls:0,events:[],signalPeak:0};
      document.addEventListener('pointerdown',e=>{if(q.armed&&e.target.closest('[data-act="aplay"]')&&q.clickAt===null){q.clickAt=performance.now();q.clickWall=Date.now();}},true);
      document.addEventListener('click',e=>{if(q.armed&&e.target.closest('[data-act="aplay"]')&&q.clickAt===null){q.clickAt=performance.now();q.clickWall=Date.now();}},true);
      const oldPlay=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(...args){
        if(this.src.includes('/fixture-real.wav')&&!this.__weakObserved){this.__weakObserved=true;
          for(const name of ['loadstart','loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error'])this.addEventListener(name,()=>{
            const at=performance.now();q.events.push({name,ms:q.clickAt===null?null:at-q.clickAt,readyState:this.readyState});
            if(name==='playing'&&q.playingAt===null)q.playingAt=at;
            if(name==='error')q.mediaError=this.error?.code;
          });
        }return oldPlay.apply(this,args);
      };
      for(const C of [window.AudioContext,window.OfflineAudioContext])if(C?.prototype.decodeAudioData){const old=C.prototype.decodeAudioData;C.prototype.decodeAudioData=function(...args){q.decodeCalls++;return old.apply(this,args);};}
    });
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:256*1024,uploadThroughput:256*1024});
    cdp.on('Network.requestWillBeSent',e=>{if(/HarmonyOS_Sans_SC\.part|fixture-real\.wav/.test(e.request.url))trace.set(e.requestId,{path:new URL(e.request.url).pathname,priority:e.request.initialPriority,startWall:Date.now(),bytes:0,firstByteWall:null,endWall:null,failed:null});});
    cdp.on('Network.dataReceived',e=>{const t=trace.get(e.requestId);if(t){t.bytes+=e.dataLength;if(t.firstByteWall===null)t.firstByteWall=Date.now();}});
    cdp.on('Network.loadingFinished',e=>{const t=trace.get(e.requestId);if(t)t.endWall=Date.now();});
    cdp.on('Network.loadingFailed',e=>{const t=trace.get(e.requestId);if(t){t.endWall=Date.now();t.failed=e.errorText;}});
    let beforeClick=null, atPlaying=null, probe=null;
    try{
      await p.goto(origin+'/?api=self#home',{waitUntil:'domcontentloaded',timeout:20000});stage='feed-ready';
      await p.waitForFunction(id=>typeof LIVE!=='undefined'&&LIVE.contentReady&&document.querySelector(`#app canvas[data-wave="${id}"]`)?._peaks?.length===240,audioId,{timeout:Math.max(1000,25000-(Date.now()-startedAt))});
      // Same ready-to-click timing both versions. The after version may intentionally avoid starting fonts.
      if(scene==='font-in-flight')await p.waitForTimeout(1000);
      beforeClick=await p.evaluate(id=>({peakCount:TRACKS['post:'+id]?.peaks?.length,pcm:!!TRACKS['post:'+id]?.buffer,state:GEN.state,hos:document.documentElement.classList.contains('hos'),fontState:typeof HARMONY==='undefined'?null:{...HARMONY.state},connection:navigator.connection?{effectiveType:navigator.connection.effectiveType,downlink:navigator.connection.downlink,rtt:navigator.connection.rtt,saveData:navigator.connection.saveData}:null}),audioId);
      beforeClick.trace=[...trace.values()].map(t=>({...t}));
      stage='actual-click';
      await p.evaluate(()=>{
        __weakQa.armed=true;const data=new Float32Array(1024),deadline=performance.now()+27000;
        const inspect=()=>{if(__weakQa.clickAt!==null&&typeof AU!=='undefined'&&AU.an){AU.an.getFloatTimeDomainData(data);let peak=0;for(const x of data)peak=Math.max(peak,Math.abs(x));__weakQa.signalPeak=Math.max(__weakQa.signalPeak,peak);if(peak>0.000001&&__weakQa.signalAt===null)__weakQa.signalAt=performance.now();}
          if(__weakQa.signalAt===null&&performance.now()<deadline)requestAnimationFrame(inspect);};requestAnimationFrame(inspect);
      });
      await p.locator(`#app [data-act="aplay"][data-id="${audioId}"]`).click({timeout:2000});stage='playing';
      await p.waitForFunction(()=>__weakQa.playingAt!==null&&GEN.on&&GEN.media,null,{timeout:Math.max(1000,29000-(Date.now()-startedAt))});
      atPlaying=[...trace.values()].map(t=>({...t}));stage='audio-signal';
      await p.waitForFunction(()=>__weakQa.signalAt!==null,null,{timeout:Math.max(1000,29500-(Date.now()-startedAt))});
      probe=await p.evaluate(()=>({...__weakQa,state:GEN.state,on:GEN.on,position:GEN.pos(),mediaUrl:GEN.media?new URL(GEN.media.src).pathname:null,mediaBuffered:GEN.media?.buffered.length?GEN.media.buffered.end(GEN.media.buffered.length-1):0,contextState:AU.ctx?.state,hasPCM:!!GEN.tr?.buffer,fontState:typeof HARMONY==='undefined'?null:{...HARMONY.state}}));
      if(probe.mediaUrl!=='/fixture-real.wav'||probe.decodeCalls!==0||probe.hasPCM||!probe.on||probe.signalPeak<=0.000001)throw Error('Real streaming/audible analyser validation failed');
      let resumedFont=null;
      // Follow-up observation after the measured milestone; only once, without changing first-sound timing.
      if(phase==='after'&&scene==='font-in-flight'&&trial===3){stage='font-resume';await p.waitForFunction(()=>HARMONY.state.networkActive&&GEN.on,null,{timeout:Math.max(1000,Math.min(8000,29000-(Date.now()-startedAt)))});resumedFont=await p.evaluate(()=>({state:GEN.state,on:GEN.on,position:GEN.pos(),fontState:{...HARMONY.state},bufferedEnd:GEN.media?.buffered.length?GEN.media.buffered.end(GEN.media.buffered.length-1):0}));}
      results.push({scene,trial,passed:true,wallMs:Date.now()-startedAt,beforeClick,atPlaying,probe,resumedFont,playingMs:round(probe.playingAt-probe.clickAt),firstSignalMs:round(probe.signalAt-probe.clickAt),trace:[...trace.values()],errors,blockedWrites});
    }catch(e){probe=await p.evaluate(()=>({...__weakQa,state:typeof GEN==='undefined'?null:GEN.state})).catch(()=>null);results.push({scene,trial,passed:false,stage,error:e.message,wallMs:Date.now()-startedAt,beforeClick,atPlaying,probe,trace:[...trace.values()],errors,blockedWrites});}
    finally{await context.close();}
  }
  const summary={};for(const scene of ['immediate','font-in-flight']){const rows=results.filter(r=>r.scene===scene),median=k=>{const xs=rows.filter(r=>r.passed).map(r=>r[k]).filter(Number.isFinite).sort((a,b)=>a-b);return{samples:xs,medianMs:xs.length?xs[Math.floor(xs.length/2)]:null};};summary[scene]={passed:rows.filter(r=>r.passed).length,playing:median('playingMs'),firstSignal:median('firstSignalMs')};}
  return{phase,conditions:{origin,fixtureBytes:962226,fixturePeakCount:240,latencyMs:100,downloadKiBps:256,uploadKiBps:256,coldContext:true,httpCacheDisabled:true,serviceWorkers:'block',viewport:'393x852',fontInFlightDelayMs:1000,networkInformationUnmodified:true},summary,results,limitations:['First signal means nonzero samples reaching the real Web Audio output analyser, not physical speaker verification.','Fixture supplies one real public post and exact WAV over local Range HTTP; this does not measure production tunnel/TLS/CDN.','Browser routing/CDP bandwidth emulation approximates network contention; no aggregate whole-app CPU/speed claim.','Each trial stops within approximately 30 seconds, before the full 20MB font can finish on this network.']};
}
