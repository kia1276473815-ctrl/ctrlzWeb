async(page)=>{
  await page.goto(new URL(page.url()).origin+'/#msg');await page.waitForFunction(()=>STATE.role==='user'&&!!globalThis.CZCommunication);
  const fixture=await page.evaluate(async()=>{await dmThreads();const peer=Object.keys(CHATS).find(id=>CZCommunication.threads[id]?.state==='accepted');if(!peer)throw Error('缺少隔离联系人');const first=await API.req('POST','/dm/with/'+peer,{kind:'text',body:'这是需要保留上下文的原消息。'.repeat(20)}),reply=await API.req('POST','/dm/with/'+peer,{kind:'text',body:'引用后的讨论，包含很长的连续文本 '+ 'reference'.repeat(30),replyToId:first.id});return{peer,original:first.id,reply:reply.id};});
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]],results=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const capture=async(surface,w,h,theme)=>{
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
    const metrics=await page.evaluate(()=>{
      const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const roots=[document.documentElement,...document.querySelectorAll('.cv-b,.m-side,.comm-dm-reply,.dm-content,#layer .sheet')].filter(visible);
      const overflow=roots.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,scroll:e.scrollWidth,client:e.clientWidth}));
      const outside=[...document.querySelectorAll('.comm-dm-reply,.dm-quote,.comm-message-menu,.comm-list-actions,#layer .sheet')].filter(visible).map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.left< -2||r.right>innerWidth+2).map(({e,r})=>({class:e.className,left:r.left,right:r.right}));
      const small=[...document.querySelectorAll('.comm-message-menu,button.dm-quote,.comm-dm-reply button,.comm-dm-policy label')].filter(visible).map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.width<43||r.height<43).map(({e,r})=>({class:e.className,width:r.width,height:r.height}));
      return{overflow,outside,small,font:getComputedStyle(document.body).fontFamily};
    });
    const file=`D:/ctrlz/output/playwright/communication-dm-replies-20261110/${w}x${h}-${theme}-${surface}.png`;await page.screenshot({path:file});results.push({surface,w,h,theme,file,...metrics});
  };
  for(const [w,h] of sizes)for(const theme of ['light','dark']){
    await page.setViewportSize({width:w,height:h});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.classList.add('rm');},theme);
    await page.evaluate(peer=>go('msg-'+peer),fixture.peer);await page.waitForSelector('#cvIn');await page.evaluate(async peer=>{await dmConv(peer);dmPaint(peer);},fixture.peer);await page.locator(`[data-dm="msg-${fixture.reply}"]`).scrollIntoViewIfNeeded();
    await capture('conversation',w,h,theme);
    await page.locator(`[data-dm="msg-${fixture.original}"] [data-act="comm-message-menu"]`).click();await page.getByRole('button',{name:'引用回复',exact:true}).click();await page.locator('#cvIn').fill('未发送的引用回复');await capture('composer',w,h,theme);await page.getByRole('button',{name:'取消引用回复',exact:true}).click();await page.locator('#cvIn').fill('');
    await page.locator(`[data-dm="msg-${fixture.reply}"] [data-act="comm-message-menu"]`).click();await capture('message-actions',w,h,theme);await page.evaluate(()=>closeSheet());await page.waitForFunction(()=>!HST.ov);
    await page.evaluate(()=>go('msg'));await page.getByRole('button',{name:'私信设置',exact:true}).click();await page.waitForSelector('.comm-dm-policy');await capture('privacy-settings',w,h,theme);await page.evaluate(()=>closeSheet());await page.waitForFunction(()=>!HST.ov);
  }
  const failures=results.filter(r=>r.overflow.length||r.outside.length||r.small.length);return {passed:!failures.length&&!errors.length,count:results.length,failures,errors,results};
}
