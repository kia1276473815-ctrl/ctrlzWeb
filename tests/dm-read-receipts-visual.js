async(page)=>{
 const origin=new URL(page.url()).origin;if(!origin.startsWith('http://127.0.0.1:'))throw Error('需要隔离fixture');
 await page.reload();await page.waitForFunction(()=>STATE.role==='user'&&!!CZCommunication);
 const uid=await page.evaluate(()=>CUR.key.slice(4));await page.waitForSelector('#cvIn');
 const ctx=await page.context().browser().newContext({serviceWorkers:'block'}),peer=await ctx.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await peer.goto(origin+'/#me');await peer.getByRole('button',{name:'登录',exact:true}).click();await peer.getByRole('textbox',{name:'用户名',exact:true}).fill('comm_bravo');await peer.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await peer.getByRole('checkbox',{name:'同意协议'}).check();await peer.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await peer.waitForFunction(()=>STATE.role==='user'&&!!CZCommunication);
  const id=await page.evaluate(async uid=>(await API.req('POST','/dm/with/'+uid,{kind:'text',body:'这段和声听起来很舒服。',clientMessageId:crypto.randomUUID()})).id,uid),me=await page.evaluate(()=>ME);
  await peer.evaluate(async me=>{await API.req('POST','/dm/with/'+me+'/read');},me);
  await page.waitForFunction(({uid,id})=>CHATS[uid]?.some(m=>m.id===id&&m.delivery==='read'),{uid,id},{timeout:20000});
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  const inspect=async(surface,w,h,theme)=>{
   await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
   const metrics=await page.evaluate(()=>{
    const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden',roots=[document.documentElement,...document.querySelectorAll('#cvB,#layer .sheet,.comm-dm-policy')].filter(visible),overflow=roots.filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>({tag:el.className||el.tagName,scroll:el.scrollWidth,client:el.clientWidth}));
    const outside=[...document.querySelectorAll('#layer .sheet,.dm-delivery,.comm-dm-policy label')].filter(visible).map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.left < -2||r.right>innerWidth+2).map(({el,r})=>({tag:el.className,left:r.left,right:r.right}));
    const targets=[...document.querySelectorAll('.comm-dm-policy label,[data-key="readReceipts"],[data-act="comm-privacy-save"]')].filter(visible).map(el=>({text:el.textContent.trim().slice(0,25),height:el.getBoundingClientRect().height})).filter(el=>el.height<40);
    return {overflow,outside,smallTargets:targets,font:getComputedStyle(document.body).fontFamily};
   });
   const file=`D:/ctrlz/output/playwright/communication-read-receipts-20261111/${surface}-${w}x${h}-${theme}.png`;await page.screenshot({path:file,animations:'disabled'});results.push({surface,w,h,theme,...metrics,file});
  };
  const close=async()=>{await page.evaluate(()=>closeSheet());await page.waitForFunction(()=>!HST.ov&&!document.querySelector('body > .sov[aria-hidden="true"]'));};
  const more=async()=>{await page.locator('[data-act="cv-more"]').click();await page.getByRole('button',{name:'全部私信设置',exact:true}).waitFor();};
  for(const surface of ['read-chat','private-chat','thread-menu','settings-top','settings-bottom']){
   if(surface==='private-chat'){await more();await page.getByRole('button',{name:'关闭本会话已读回执',exact:true}).click();await page.waitForFunction(({uid,id})=>CHATS[uid]?.find(m=>m.id===id)?.delivery==='sent',{uid,id});}
   if(surface==='thread-menu'){await more();await page.getByRole('button',{name:'开启本会话已读回执',exact:true}).click();await page.waitForFunction(({uid,id})=>CHATS[uid]?.find(m=>m.id===id)?.delivery==='read',{uid,id});}
   for(const [w,h]of sizes)for(const theme of ['light','dark']){
    await close();await page.setViewportSize({width:w,height:h});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;const b=document.querySelector('#cvB');b.scrollTop=b.scrollHeight;},theme);
    if(surface==='thread-menu')await more();
    if(surface.startsWith('settings')){await more();await page.getByRole('button',{name:'全部私信设置',exact:true}).click();await page.waitForSelector('input[name="dmReadReceipts"]');if(surface==='settings-bottom')await page.getByRole('button',{name:'保存设置',exact:true}).scrollIntoViewIfNeeded();}
    await inspect(surface,w,h,theme);
   }
  }
  await close();await page.setViewportSize({width:1280,height:800});return {passed:errors.length===0&&!results.some(r=>r.overflow.length||r.outside.length||r.smallTargets.length),surfaces:results.length,viewportThemes:24,errors,violations:results.filter(r=>r.overflow.length||r.outside.length||r.smallTargets.length),results};
 }finally{await ctx.close();}
}
