// Playwright CLI run-code --filename。只在8789写少量隔离音频fixture；不会连接8787。
// 输出原始测量与中位数，不自动把一次本机测量推广成用户设备性能结论。
async (page) => {
  const origin = 'http://127.0.0.1:8789';
  const browser = page.context().browser();
  if (!browser) throw Error('需要 Chromium 浏览器以建立 CDP 性能会话');
  const baselineResponse = await page.request.get(origin + '/scripts/optimization-baseline.js');
  if (!baselineResponse.ok()) throw Error('Git基线文件不可达');
  const baseline = await baselineResponse.text(), samples = [], errors = [];
  const metricNames = ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'];
  const metrics = async cdp => { const result=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name,m.value]));
    if(metricNames.some(k=>!Number.isFinite(result[k]))) throw Error('CDP 未提供完整的 CPU/布局指标'); return result; };
  const delta = (before,after) => Object.fromEntries(metricNames.map(k => [k,after[k] - before[k]]));
  const summarize = values => { const a = [...values].sort((a,b)=>a-b); return {median:a[Math.floor(a.length/2)],min:a[0],max:a[a.length-1]}; };
  let referenceData;
  for (const [group,order] of [[1,['baseline','current']],[2,['current','baseline']],[3,['baseline','current']]]) {
    for (const version of order) {
      const context = await browser.newContext({viewport:{width:1280,height:800},colorScheme:'light',reducedMotion:'no-preference',serviceWorkers:'block'});
      const testPage = await context.newPage(); testPage.on('pageerror',e=>errors.push({phase:'benchmark',group,version,message:e.message}));
      const cdp = await context.newCDPSession(testPage);
      try {
        await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        if (version === 'baseline') await testPage.route('**/__runtime_baseline__*',r=>r.fulfill({status:200,contentType:'text/html',body:baseline}));
        await testPage.goto(origin + (version === 'baseline' ? '/__runtime_baseline__' : '/') + '?api=&demo=1#home');
        await testPage.waitForFunction(()=>typeof GEN !== 'undefined' && typeof drawTrackWave === 'function');
        await testPage.waitForLoadState('networkidle'); await testPage.evaluate(()=>document.fonts.ready);
        // 等初次生成波形完成再测“空闲”；若超时明确留下未稳定标记。
        let settled = true;
        try { await testPage.waitForFunction(()=>typeof TQ === 'undefined' || (!TQ.length && !tBusy),null,{timeout:45000}); }
        catch { settled = false; }
        const data = await testPage.evaluate(()=>({posts:POSTS.map(p=>p.id),products:PRODUCTS.map(p=>p.id)}));
        const fingerprint = JSON.stringify(data);
        if (!referenceData) referenceData = fingerprint;
        if (fingerprint !== referenceData) throw Error('基线和当前演示数据不一致，不能对比');
        await testPage.evaluate(()=>{
          window.__runtimeProbe = {waveDraws:0,longTasks:[]}; const draw = drawTrackWave;
          drawTrackWave = function(...args){ window.__runtimeProbe.waveDraws++; return draw.apply(this,args); };
          if ('PerformanceObserver' in window) {
            window.__runtimeLongTasks = new PerformanceObserver(list=>window.__runtimeProbe.longTasks.push(...list.getEntries().map(e=>e.duration)));
            window.__runtimeLongTasks.observe({type:'longtask'});
          }
          scrollTo({top:0,behavior:'instant'});
        });
        await testPage.waitForTimeout(100); await testPage.evaluate(()=>{__runtimeProbe.waveDraws=0;__runtimeProbe.longTasks=[];});
        const idleStart = await metrics(cdp); await testPage.waitForTimeout(5000); const idleEnd = await metrics(cdp);
        const idleVisual = await testPage.evaluate(()=>({staticWaveDraws:__runtimeProbe.waveDraws,longTasks:__runtimeProbe.longTasks,
          visibleWaves:[...document.querySelectorAll('canvas[data-wave]')].filter(cv=>cv._vis).length}));
        await testPage.evaluate(()=>{__runtimeProbe.waveDraws=0;__runtimeProbe.longTasks=[];});
        const scrollStart = await metrics(cdp);
        const scroll = await testPage.evaluate(()=>new Promise(resolve=>{
          const intervals=[], max=Math.min(2000,Math.max(0,document.documentElement.scrollHeight-innerHeight)); let start,last;
          const frame = t => { if (start == null) start=t; if(last != null) intervals.push(t-last); last=t;
            const elapsed=t-start, phase=(elapsed/2500)%2; scrollTo({top:max*(phase<=1 ? phase : 2-phase),behavior:'instant'});
            if(elapsed<5000) requestAnimationFrame(frame); else { const sorted=[...intervals].sort((a,b)=>a-b), at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
              resolve({durationMs:elapsed,frames:intervals.length,rangePx:max,rafP50Ms:at(.5),rafP95Ms:at(.95),rafMaxMs:sorted.at(-1),framesOver50Ms:intervals.filter(n=>n>50).length,
                waveDraws:__runtimeProbe.waveDraws,longTasks:__runtimeProbe.longTasks}); }
          }; requestAnimationFrame(frame);
        }));
        const scrollEnd = await metrics(cdp);
        await cdp.send('HeapProfiler.collectGarbage'); const retained = await metrics(cdp);
        samples.push({group,version,cpuRate:4,settled,dataCount:{posts:data.posts.length,products:data.products.length},
          idle:{seconds:5,...delta(idleStart,idleEnd),...idleVisual},scroll:{...delta(scrollStart,scrollEnd),...scroll},
          retainedAfterForcedGC:{JSHeapUsedSize:retained.JSHeapUsedSize,Nodes:retained.Nodes,JSEventListeners:retained.JSEventListeners}});
      } finally { await cdp.detach(); await context.close(); }
    }
  }
  const comparison = {};
  for (const version of ['baseline','current']) {
    const rows=samples.filter(s=>s.version===version); comparison[version]={idle:{},scroll:{}};
    for (const k of metricNames) { comparison[version].idle[k]=summarize(rows.map(s=>s.idle[k])); comparison[version].scroll[k]=summarize(rows.map(s=>s.scroll[k])); }
    comparison[version].scroll.rafP95Ms=summarize(rows.map(s=>s.scroll.rafP95Ms));
    comparison[version].retainedJSHeapBytes=summarize(rows.map(s=>s.retainedAfterForcedGC.JSHeapUsedSize));
  }

  // 功能证据与基准在不同context内：真实文件上传/播放不混进空闲与滚动样本。
  const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'}), livePage=await context.newPage();
  livePage.on('pageerror',e=>errors.push({phase:'live-audio',message:e.message}));
  let visibility, realAudio;
  try {
    await livePage.goto(origin + '/?api=self#home');
    await livePage.waitForFunction(()=>typeof API !== 'undefined' && LIVE.contentReady);
    visibility=await livePage.evaluate(async()=>{
      let ticks=0,draws=0; const off=loopAdd(()=>ticks++), proto=CanvasRenderingContext2D.prototype, old=proto.fillRect;
      proto.fillRect=function(...args){draws++;return old.apply(this,args);};
      const wait=ms=>new Promise(r=>setTimeout(r,ms)); await wait(250); const visibleTicks=ticks;
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
      document.dispatchEvent(new Event('visibilitychange')); await wait(50); const t=ticks,d=draws; await wait(400);
      const result={simulatedVisibility:true,visibleTicks,hiddenLoopTicks:ticks-t,hiddenCanvasFills:draws-d};
      delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));await wait(100);
      result.resumedLoopTicks=ticks-t;off();proto.fillRect=old; return result;
    });
    realAudio=await livePage.evaluate(async()=>{
      if(location.origin !== 'http://127.0.0.1:8789') throw Error('fixture写入只允许8789');
      const phone='13500990011',sent=await API.req('POST','/auth/sms/send',{phone});
      if(!sent.devCode) throw Error('隔离后端需开启DEV_EXPOSE_OTP，音频fixture不会使用真实验证码');
      const login=await API.req('POST','/auth/sms/login',{phone,code:sent.devCode});
      API.setTok({access:login.accessToken,refresh:login.refreshToken});ME=login.user.id;STATE.role='user';apiUser(login.user);
      const existing=(await API.req('GET',`/posts?author=${encodeURIComponent(ME)}&limit=50`)).items.filter(p=>p.title.startsWith('runtime-long-audio-'));
      const key=existing[0]?.media.find(m=>m.kind==='audio')?.key;
      // uploads 路由 key 格式为 post_audio/<uid>/<YYYYMM>/<f_id>.<ext>，不从签名 URL 猜 ID。
      let upId=key?.match(/^post_audio\/[^/]+\/\d{6}\/(f_[a-z0-9]+)\.[a-z0-9]+$/)?.[1];
      if(key && !upId)throw Error('既有fixture媒体key不符合uploads格式：'+key);
      if(!upId){
        const rate=22050,seconds=180,n=rate*seconds,bytes=new ArrayBuffer(44+n*2),v=new DataView(bytes),peaks=Array(240).fill(0);
        const word=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
        word(0,'RIFF');v.setUint32(4,36+n*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
        v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,n*2,true);
        for(let i=0;i<n;i++){const sample=.3*Math.sin(2*Math.PI*220*i/rate)*Math.min(1,i/220,(n-1-i)/220),bin=Math.min(239,Math.floor(i/n*240));v.setInt16(44+i*2,Math.round(sample*32767),true);peaks[bin]=Math.max(peaks[bin],Math.abs(sample));}
        const file=new File([bytes],'runtime-sine-180s.wav',{type:'audio/wav'}),up=await liveUpload(file,'post_audio',{duration:seconds,peaks});upId=up.id;
      }
      for(let i=0;i<3;i++)if(!existing.some(p=>p.title===`runtime-long-audio-${i}`))
        await API.req('POST','/posts',{type:'audio',title:`runtime-long-audio-${i}`,body:'隔离运行性能验收用真实180秒音频。',uploadIds:[upId],requestKey:`runtime-long-audio-v1-${i}`});
      const rows=(await API.req('GET',`/posts?author=${encodeURIComponent(ME)}&limit=50`)).items.filter(p=>p.title.startsWith('runtime-long-audio-'));
      if(rows.length!==3)throw Error('隔离真实音频fixture数量异常：'+rows.length);
      window.__runtimeAudioProbe={decodeCalls:0,renderCalls:0,jsFileFetches:0};
      for(const C of [window.AudioContext,window.OfflineAudioContext])if(C?.prototype.decodeAudioData){const old=C.prototype.decodeAudioData;C.prototype.decodeAudioData=function(...a){__runtimeAudioProbe.decodeCalls++;return old.apply(this,a);};}
      const oldRender=renderTrack;renderTrack=function(...a){__runtimeAudioProbe.renderCalls++;return oldRender.apply(this,a);};
      const oldFetch=window.fetch;window.fetch=function(input,...args){if(String(input?.url || input).includes('/files/'))__runtimeAudioProbe.jsFileFetches++;return oldFetch.call(this,input,...args);};
      POSTS.splice(0);addPosts(rows);LIVE.next=null;STATE.settings.pers=false;UI.homeTab='rec';UI.feed.type='all';renderBase('home','',true);
      window.__runtimeAudioId=rows[0].id;return {fixturePosts:rows.length,duration:rows[0].media.find(m=>m.kind==='audio')?.audioMeta?.duration,
        peakCount:rows[0].media.find(m=>m.kind==='audio')?.audioMeta?.peaks.length,id:rows[0].id};
    });
    await livePage.waitForTimeout(700);
    realAudio.list=await livePage.evaluate(()=>({...__runtimeAudioProbe,wholeTrackBuffers:Object.values(TRACKS).filter(t=>t?.buffer).length}));
    await livePage.locator(`[data-act="aplay"][data-id="${realAudio.id}"]`).first().click();
    await livePage.waitForFunction(()=>{
      if(!GEN.media || !AU.an || GEN.media.paused)return false;const a=new Float32Array(AU.an.fftSize);AU.an.getFloatTimeDomainData(a);
      return a.some(x=>Math.abs(x)>0.0001);
    },null,{timeout:20000});
    realAudio.play=await livePage.evaluate(()=>{const a=new Float32Array(AU.an.fftSize);AU.an.getFloatTimeDomainData(a);
      return {mediaElement:GEN.media instanceof HTMLAudioElement,duration:GEN.media.duration,position:GEN.pos(),analyzerPeak:Math.max(...a.map(Math.abs)),
        analyzerRms:Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length),wholePCM:!!GEN.tr?.buffer,...__runtimeAudioProbe};});
    await livePage.evaluate(()=>GEN.seek(73));await livePage.waitForFunction(()=>GEN.media?.currentTime>=72);
    realAudio.seek=await livePage.evaluate(()=>({position:GEN.pos(),fraction:GEN.frac()}));
    await livePage.evaluate(()=>{window.__stoppedMedia=GEN.media;window.__disconnectCalls=0;const source=GEN.mediaSource,old=source.disconnect;
      source.disconnect=function(...a){__disconnectCalls++;return old.apply(this,a);};});
    await livePage.locator(`[data-act="aplay"][data-id="${realAudio.id}"]`).first().click();
    realAudio.stop=await livePage.evaluate(()=>({on:GEN.on,mediaCleared:GEN.media===null,sourceCleared:GEN.mediaSource===null,trackCleared:GEN.tr===null,
      paused:__stoppedMedia.paused,srcRemoved:__stoppedMedia.getAttribute('src')===null,disconnectCalls:__disconnectCalls}));
    if(visibility.hiddenLoopTicks || visibility.hiddenCanvasFills || !visibility.visibleTicks || !visibility.resumedLoopTicks)throw Error('隐藏期间调度/绘制未停止或恢复失败：'+JSON.stringify(visibility));
    if(realAudio.list.decodeCalls || realAudio.list.renderCalls || realAudio.list.jsFileFetches || realAudio.list.wholeTrackBuffers)throw Error('长音频列表触发全量获取或PCM解码：'+JSON.stringify(realAudio.list));
    if(!realAudio.play.mediaElement || realAudio.play.wholePCM || realAudio.play.decodeCalls || realAudio.play.renderCalls || realAudio.play.analyzerRms<=0 || realAudio.play.analyzerPeak<=0)throw Error('真实音频流式播放验收失败：'+JSON.stringify(realAudio.play));
    if(realAudio.stop.on || !realAudio.stop.mediaCleared || !realAudio.stop.sourceCleared || !realAudio.stop.trackCleared || !realAudio.stop.paused || !realAudio.stop.srcRemoved || !realAudio.stop.disconnectCalls)throw Error('停止播放后未释放资源：'+JSON.stringify(realAudio.stop));
  } catch(error) { throw Error('visibility/real-audio 阶段失败：'+error.message+'；partial='+JSON.stringify({visibility,realAudio,pageErrors:errors})); }
  finally { await context.close(); }
  if(errors.length)throw Error('运行期间出现 pageErrors：'+JSON.stringify(errors));
  return {method:{browserVersion:browser.version(),measuredAt:new Date().toISOString(),cpuThrottle:4,groups:3,idleSeconds:5,scrollSeconds:5,viewport:'1280x800',sameDemoData:true,
    visibility:'模拟document.hidden/visibilitychange；未作为真实操作系统后台测量',memory:'各样本末尾强制GC后的JS堆保留量；不等于音频/显存或系统总内存'},
    samples,comparison,visibility,realAudio,pageErrors:errors};
}
