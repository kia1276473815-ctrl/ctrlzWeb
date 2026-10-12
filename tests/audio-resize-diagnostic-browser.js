async (page) => {
  const browser=page.context().browser(),results=[];
  for(const deferWaveResize of [false,true]){
    const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'}),p=await context.newPage(),writes=[];
    await context.route('**/*',async route=>{if(!['GET','HEAD'].includes(route.request().method())){writes.push(new URL(route.request().url()).pathname);await route.abort('blockedbyclient');}else await route.continue();});
    await context.addInitScript(({deferWaveResize})=>{
      window.__resizeQa={callbacks:[],warnings:[]};let id=0;const RO=ResizeObserver;
      window.ResizeObserver=class extends RO{constructor(fn){const n=++id,stack=new Error().stack;super((entries,observer)=>{
        const type=stack.includes('waveLoop (')?'wave':entries.some(e=>e.target.matches?.('.tag,.vbadge,.rl-tc,.rl-fo,.pill.sm,[data-act="follow"],[data-act="pv-loop"],[data-act="au-fol"],.chip'))?'morph':'other';
        __resizeQa.callbacks.push({id:n,type,time:performance.now(),targets:entries.map(e=>({tag:e.target.tagName,cls:e.target.className,growing:!!e.target._grow,text:e.target.tagName==='SPAN'?e.target.textContent:undefined}))});
        if(__resizeQa.callbacks.length>20)__resizeQa.callbacks.shift();
        if(deferWaveResize&&type==='wave')requestAnimationFrame(()=>fn(entries,observer));else fn(entries,observer);
      });}};
      window.addEventListener('error',e=>{if(e.message.includes('ResizeObserver'))__resizeQa.warnings.push({message:e.message,time:performance.now(),callbacks:__resizeQa.callbacks.slice(-10)});});
    },{deferWaveResize});
    try{
      await p.goto('http://127.0.0.1:8787/?api=self#home');await p.waitForFunction(()=>LIVE.contentReady&&document.querySelector('#app canvas[data-wave]')?._peaks?.length===240);
      await p.waitForTimeout(2800);const button=p.locator('#app [data-act="aplay"]').first();
      await button.click();await p.waitForFunction(()=>GEN.on);await p.waitForTimeout(1150);await button.click();await p.waitForFunction(()=>GEN.state==='paused');await p.waitForTimeout(700);
      results.push({deferWaveResize,writes,...await p.evaluate(()=>__resizeQa)});
    }finally{await context.close();}
  }
  return results;
}
