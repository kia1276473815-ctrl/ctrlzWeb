// Playwright CLI run-code --filename：真实公开音频只读验收；分页为页面内fixture，不写业务数据库。
async (page) => {
  const browser=page.context().browser();if(!browser)throw Error('需要Chromium浏览器');
  const origin='http://127.0.0.1:8787',context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const p=await context.newPage(),errors=[],blockedWrites=[],results={},held=[],paginationReads=[];let holdMedia=false,fixture=[],phase='initial';
  p.on('pageerror',error=>errors.push(error.message));
  const check=(value,message)=>{if(!value)throw Error(message);};
  await context.addInitScript(() => {
    window.__audioQaProbe={decodeCalls:0,waveFrames:0,listenerMap:new Map(),seeks:[],resizeCallbacks:[],resizeWarnings:[]};
    const OriginalResizeObserver=window.ResizeObserver;let resizeId=0;
    window.ResizeObserver=class extends OriginalResizeObserver{constructor(fn){const id=++resizeId,stack=new Error().stack;
      super((entries,observer)=>{__audioQaProbe.resizeCallbacks.push({id,stack,targets:entries.map(e=>({tag:e.target.tagName,cls:e.target.className,wave:e.target.dataset?.wave}))});
        if(__audioQaProbe.resizeCallbacks.length>12)__audioQaProbe.resizeCallbacks.shift();return fn(entries,observer);});}};
    window.addEventListener('error',e=>{if(e.message.includes('ResizeObserver'))__audioQaProbe.resizeWarnings.push({message:e.message,callbacks:__audioQaProbe.resizeCallbacks.slice(-6)});});
    for(const C of [window.AudioContext,window.OfflineAudioContext])if(C?.prototype.decodeAudioData){const original=C.prototype.decodeAudioData;C.prototype.decodeAudioData=function(...args){__audioQaProbe.decodeCalls++;return original.apply(this,args);};}
    const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
    document.addEventListener=function(type,fn,...args){if(typeof fn==='function'&&String(fn).includes('all.forEach(cv')){
      if(!__audioQaProbe.listenerMap.has(type))__audioQaProbe.listenerMap.set(type,new Set());__audioQaProbe.listenerMap.get(type).add(fn);}
      return add(type,fn,...args);};
    document.removeEventListener=function(type,fn,...args){__audioQaProbe.listenerMap.get(type)?.delete(fn);return remove(type,fn,...args);};
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD'].includes(request.method())){const entry={method:request.method(),path:url.pathname};if(url.pathname==='/client-errors')try{entry.report=JSON.parse(request.postData());}catch(_){}blockedWrites.push(entry);await route.abort('blockedbyclient');return;}
    if(holdMedia&&url.pathname.startsWith('/files/')){held.push(route);return;}
    const cursor=url.searchParams.get('cursor');
    if(url.origin===origin&&url.pathname==='/posts'&&cursor?.startsWith('audio-qa-')){
      const batch=Number(cursor.split('-').at(-1));paginationReads.push(batch);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:fixture.map((post,i)=>({...post,id:`p_audio_qa_${batch}_${i}`,title:`只读分页 ${batch}-${i}`})),next:batch<2?`audio-qa-${batch+1}`:null})});return;
    }
    await route.continue();
  });
  const state=()=>p.evaluate(()=>({state:GEN.state,on:GEN.on,pending:GEN.pending,owner:GEN.owner,position:GEN.pos(),duration:GEN.tr?.dur,
    media:!!GEN.media,pcm:!!GEN.tr?.buffer,decodeCalls:__audioQaProbe.decodeCalls,active:waveLoop.runtime?.active.size||0,
    all:waveLoop.runtime?.all.size||0,connected:document.querySelectorAll('canvas[data-wave]').length,
    listenerCount:[...__audioQaProbe.listenerMap.values()].reduce((n,set)=>n+set.size,0),listenerKinds:__audioQaProbe.listenerMap.size,
    waveFrames:__audioQaProbe.waveFrames,hover:!!COVER_HOVER.box,liveCanvases:document.querySelectorAll('canvas.live').length}));
  try{
    await p.goto(origin+'/?api=self#home');await p.waitForFunction(()=>typeof LIVE!=='undefined'&&LIVE.contentReady&&document.querySelector('#app canvas[data-wave]')?._peaks?.length===240);
    await p.evaluate(()=>{const oldLoop=loopAdd;loopAdd=function(fn){if(String(fn).includes('active.forEach(cv')){const work=fn;fn=(...args)=>{__audioQaProbe.waveFrames++;return work(...args);};}return oldLoop(fn);};
      const oldSeek=GEN.seek;GEN.seek=function(at){__audioQaProbe.seeks.push(at);return oldSeek.call(this,at);};});
    results.initial=await state();check(results.initial.active===0&&results.initial.listenerCount===6,'首页静止波形应无持续循环且仅6个共享监听');
    const audioId=await p.locator('#app canvas[data-wave]').first().getAttribute('data-wave'),button=p.locator(`#app [data-act="aplay"][data-id="${audioId}"]`);
    const slider=p.locator(`#app canvas[data-wave="${audioId}"]`);
    phase='cancel-loading';holdMedia=true;await button.click();await p.waitForFunction(()=>GEN.pending&&GEN.media);
    for(let i=0;held.length===0&&i<30;i++)await p.waitForTimeout(20);
    check(held.length>0,'真实音频GET未被加载取消故障注入接住');check(await button.getAttribute('aria-label')==='取消加载','加载按钮缺取消标签');
    const whileLoading=await state();await button.click();await p.waitForFunction(()=>GEN.state==='stopped'&&!GEN.media);
    holdMedia=false;for(const route of held.splice(0))await route.abort('failed').catch(()=>{});await p.waitForTimeout(100);
    results.cancel={whileLoading,after:await state()};check(!results.cancel.after.media&&!results.cancel.after.on&&results.cancel.after.decodeCalls===0,'取消必须释放媒体且不读整份PCM');
    phase='keyboard-home';await slider.focus();await p.keyboard.press('Home');await p.waitForFunction(()=>GEN.on&&GEN.media);await p.waitForTimeout(100);
    results.home=await state();check(results.home.position<1,'Home未从0开始');
    await p.keyboard.press('ArrowRight');await p.waitForTimeout(100);results.arrowRight=await state();check(results.arrowRight.position>4.9&&results.arrowRight.position<6.5,'右方向键未按实际秒数+5');
    await p.keyboard.press('ArrowLeft');await p.waitForTimeout(100);results.arrowLeft=await state();check(results.arrowLeft.position>=0&&results.arrowLeft.position<1.5,'左方向键未按实际秒数-5');
    await p.keyboard.press('End');results.end=await p.evaluate(()=>({requested:__audioQaProbe.seeks.at(-1),duration:GEN.tr.dur,position:GEN.pos()}));
    check(Math.abs(results.end.requested-(results.end.duration-.01))<.001,'End必须请求duration-.01，避免循环取模归零');
    await p.keyboard.press('Home');await p.keyboard.press('ArrowRight');await p.waitForTimeout(100);await button.click();
    results.paused=await state();check(results.paused.state==='paused'&&!results.paused.media&&results.paused.active===0&&results.paused.position>4.9,'暂停应保存位置并释放媒体/循环');
    phase='home-resume';await button.click();await p.waitForFunction(()=>GEN.on&&GEN.media);results.resumed=await state();
    check(results.resumed.position>=results.paused.position-.02&&results.resumed.position<results.paused.position+1.5,'续播没有恢复暂停位置');
    await p.locator('#player [data-act="gen-stop"]').click();await p.waitForFunction(()=>GEN.state==='stopped');
    phase='hover';const vis=p.locator('#app article.card .vcard[data-qbox^="v:"]').first();await vis.hover();await p.waitForFunction(()=>!!COVER_HOVER.box&&!!COVER_HOVER.box.querySelector('canvas.live'));
    results.hover=await state();check(results.hover.owner===null&&!results.hover.on&&results.hover.decodeCalls===0,'封面悬停不得动GEN或解码音频');
    await p.mouse.move(8,8);await p.waitForFunction(()=>!COVER_HOVER.box);results.hoverLeave=await state();check(results.hoverLeave.liveCanvases===0,'移开鼠标应移除悬停画布');
    await vis.hover();await p.waitForFunction(()=>!!COVER_HOVER.box);await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>!COVER_HOVER.box);
    results.hoverReducedMotion=await state();check(results.hoverReducedMotion.liveCanvases===0,'减少动效应停止预览');await p.emulateMedia({reducedMotion:'no-preference'});await p.mouse.move(8,8);
    results.reelCycles=[];
    for(let i=0;i<4;i++){phase='reel-cycle-'+i;
      await p.evaluate(id=>go('v-'+id),audioId);await p.waitForFunction(()=>RL.on&&GEN.on);await p.locator('.rl-vis').first().click();await p.waitForFunction(()=>GEN.state==='paused');
      const reel=await state();check(reel.all===reel.connected&&reel.listenerCount===6&&reel.active===0,'详情静止资源数量或监听器积累');
      await p.locator('#reels [data-act="rl-close"]').click();await p.waitForFunction(()=>!RL.on);await p.evaluate(()=>{if(routeOf(CUR.hash)!=='home')go('home');});
      await p.waitForFunction(()=>!!document.querySelector('#app canvas[data-wave]'));await p.waitForTimeout(60);
      const home=await state();check(home.all===home.connected&&home.listenerCount===6&&home.active===0,'回首页后波形资源未清理');results.reelCycles.push({reel,home});
    }
    phase='pagination';const raw=await context.request.get(origin+'/posts?limit=50');const data=await raw.json();fixture=data.items.filter(post=>post.type==='audio');check(fixture.length>0,'只读分页fixture缺原音频');
    await p.evaluate(async()=>{LIVE.next='audio-qa-1';await moreLoad('home');await moreLoad('home');});
    await p.waitForFunction(()=>LIVE.next===null&&POSTS.some(post=>post.id==='p_audio_qa_2_0'),{},{timeout:10000});
    await p.waitForTimeout(150);results.pagination={reads:paginationReads,state:await state()};
    check(results.pagination.state.all===results.pagination.state.connected&&results.pagination.state.listenerCount===6&&results.pagination.state.active===0,'分页后资源/监听器积累');
    const before=results.pagination.state.waveFrames;await p.waitForTimeout(300);results.idleFrames=(await state()).waveFrames-before;check(results.idleFrames===0,'静止声纹仍产生逐帧回调');
    await p.screenshot({path:'D:/ctrlz/output/playwright/audio-experience-desktop.png',fullPage:true});
    results.pageErrors=errors;results.blockedWrites=blockedWrites;results.resizeWarnings=await p.evaluate(()=>__audioQaProbe.resizeWarnings);check(errors.length===0,'浏览器出现JS异常：'+errors.join('; '));check(blockedWrites.length===0,'出现意外业务写请求');
    return {passed:true,scope:'真实8787公开GET/文件流+客户端分页fixture，不写业务数据库',results};
  }catch(error){const current=await state().catch(()=>null);throw Error(JSON.stringify({phase,error:error.message,current,errors,blockedWrites,partial:results}));}
  finally{for(const route of held)await route.abort('failed').catch(()=>{});await context.close();}
}
