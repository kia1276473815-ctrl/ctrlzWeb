// 实际后端只读信息流；24 个尺寸/主题批量检查并留图。
async(page)=>{
  const context=await page.context().browser().newContext({viewport:{width:393,height:852},hasTouch:true,serviceWorkers:'block'}),p=await context.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  try{
    await p.goto('http://127.0.0.1:8787/?api=self#home');await p.waitForFunction(()=>POSTS.length>=2 && document.querySelector('canvas[data-wave]')?._peaks?.length===240);
    await p.evaluate(()=>document.fonts.ready);
    const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]],matrix=[];
    for(const [w,h] of sizes)for(const theme of ['light','dark']){
      await p.setViewportSize({width:w,height:h});await p.evaluate(theme=>{STATE.settings.theme=theme;applyTheme();GEN.stop();scrollTo(0,0);},theme);await p.waitForTimeout(150);
      const item=await p.evaluate(()=>{
        const cv=$('#app canvas[data-wave]'),visibleControl=s=>[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0 && r.height>0;}).map(e=>{const r=e.getBoundingClientRect();return {act:e.dataset.act,w:r.width,h:r.height};});
        return {width:innerWidth,height:innerHeight,theme:STATE.settings.theme,scroll:document.documentElement.scrollWidth,wavePoints:cv._peaks?.length,aria:{min:cv.getAttribute('aria-valuemin'),max:cv.getAttribute('aria-valuemax'),now:cv.getAttribute('aria-valuenow'),text:cv.getAttribute('aria-valuetext')},controls:visibleControl('#app [data-act="aplay"],#app [data-act="like"],.ht-t button'),waveActive:waveLoop.runtime?.active.size || 0,waveFrameRegistered:[...LOOPS].filter(fn=>String(fn).includes('active.forEach(cv')).length};
      });
      if(item.scroll>w+1 || item.wavePoints!==240 || item.aria.min!=='0' || !item.aria.text || item.waveActive || item.waveFrameRegistered)throw Error('尺寸/声纹检查失败 '+JSON.stringify(item));
      if(item.controls.some(c=>c.w<43.9 || c.h<43.9))throw Error('点击区域小于44 '+JSON.stringify(item));
      matrix.push(item);await p.screenshot({path:`D:/ctrlz/output/next-optimization/home-${theme}-${w}x${h}.png`});
    }
    if(errors.length)throw Error(JSON.stringify(errors));return {matrix,pageErrors:errors};
  }finally{await context.close();}
}
