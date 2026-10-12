// Playwright CLI run-code --filename：隔离浏览器对照与尺寸验收，不写真实业务数据。
async (page) => {
  const out = 'D:/ctrlz/output/playwright';
  const response = await page.request.get('http://127.0.0.1:8789/scripts/optimization-baseline.js'); if (!response.ok()) throw Error('基线文件不可达'); const baseline = await response.text();
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  // 先解除本隔离会话的 SW，保证 baseline 路由拦截生效，而非由已激活 SW 抢先请求。
  await page.evaluate(async () => { if(navigator.serviceWorker)for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
  await page.goto('about:blank');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/__baseline__*',r => r.fulfill({status:200,contentType:'text/html',body:baseline}));
  const cycles = async () => page.evaluate(async () => {
    const counts = [];
    for (let i=0;i<12;i++){ renderBase('item','p3',true); await new Promise(requestAnimationFrame); renderBase('home','',true); await new Promise(requestAnimationFrame); counts.push(Object.keys(CTRL).length); }
    GEN.stop(); return counts;
  });
  await page.goto('http://127.0.0.1:8789/__baseline__?api=&demo=1#home');
  await page.waitForFunction(() => typeof CTRL !== 'undefined'); const beforeControllers = await cycles();
  await page.unroute('**/__baseline__*');
  await page.goto('http://127.0.0.1:8789/?api=&demo=1#home');
  await page.waitForFunction(() => typeof AudioResources !== 'undefined'); await page.evaluate(() => loadBundle('audio')); await page.waitForTimeout(50); const afterControllers = await cycles();
  if (afterControllers.some(x => x > 0)) throw Error('离开预设页后仍保留滑杆闭包：' + afterControllers);
  const partial = await page.evaluate(() => {
    renderBase('shop','',true); const hero = document.querySelector('.bn'), first = document.querySelector('.grid-p > article');
    const template = PRODUCTS[0], id = 'performance-fixture-product'; PRODUCTS.push({...template,id,title:'增量追加测试',sales:0});
    if (!patchMoreList('shop')) throw Error('增量列表未应用'); const kept = hero === document.querySelector('.bn') && first === document.querySelector(`[data-flip="${first.dataset.flip}"]`);
    const added = !!document.querySelector(`[data-flip="i-${id}"]`); PRODUCTS.splice(PRODUCTS.findIndex(p => p.id === id),1); patchMoreList('shop'); return {heroAndExistingCardPreserved:kept,newCardAdded:added};
  });
  if (!partial.heroAndExistingCardPreserved || !partial.newCardAdded) throw Error('增量追加重建了已有节点');
  // 增量证明完成后恢复普通演示商城，尺寸截图不携带临时追加的商品节点。
  await page.evaluate(()=>renderBase('shop','',true));
  const sizes = [[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  const matrix = [];
  for (const theme of ['light','dark']){
    await page.evaluate(t => { STATE.settings.theme = t; store.set('theme',t); document.documentElement.dataset.theme = t; applyTheme(); },theme);
    for (const [width,height] of sizes){
      await page.setViewportSize({width,height});const started=Date.now();
      const initial=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const afterTwoFrames=await page.evaluate(()=>document.documentElement.scrollWidth);
      let settled=true;try{await page.waitForFunction(w=>innerWidth===w && document.documentElement.scrollWidth<=w+1,width,{timeout:3000});}catch{settled=false;}
      const layout = await page.evaluate(() => ({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dom:document.querySelectorAll('*').length}));
      const row={theme,...layout,height,initialScrollWidth:initial.scrollWidth,afterTwoFramesScrollWidth:afterTwoFrames,
        transientOverflow:initial.scrollWidth>width+1 || afterTwoFrames>width+1,stabilizationMs:Date.now()-started,settled};matrix.push(row);
      if(!settled || layout.scrollWidth>width+1)throw Error(`商城 ${theme} ${width} 持久横向溢出或responsive未稳定：${JSON.stringify(row)}`);
      await page.screenshot({path:`${out}/shop-${theme}-${width}x${height}.png`});
    }
  }
  await page.goto('http://127.0.0.1:8789/?api=self#home');
  await page.waitForFunction(() => LIVE.contentReady);
  const live = await page.evaluate(() => ({connected:API.on(),ready:LIVE.contentReady,posts:POSTS.length,products:PRODUCTS.length}));
  const result = {beforeControllers,afterControllers,partial,matrix,live,pageErrors:errors};
  if (errors.length) throw Error('页面运行错误：' + errors.join('; ')); return result;
}
