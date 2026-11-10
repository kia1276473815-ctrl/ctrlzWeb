async(page)=>{
  const origin=new URL(page.url()).origin;if(origin==='null')throw Error('请先打开本轮隔离验证页面');
  await page.goto(origin+'/#me');await page.waitForFunction(()=>STATE.role==='user'&&!!globalThis.CZCommunication&&POSTS.some(p=>p.live&&p.author===ME));
  const fixture=await page.evaluate(()=>({post:POSTS.find(p=>p.live&&p.author===ME).id,peer:Object.keys(CHATS).find(k=>CHATS[k]?.length)||Object.keys(CZCommunication.threads)[0]}));
  const unavailable=await page.evaluate(async peer=>{const p=await API.req('POST','/posts',{type:'text',title:'分享不可用适配检查'}),m=await API.req('POST','/dm/with/'+peer,{kind:'post',ref:p.id,clientMessageId:crypto.randomUUID()});await API.req('DELETE','/posts/'+p.id);return m.id;},fixture.peer);
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]],results=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const inspect=async(surface,w,h,theme)=>{
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
    await page.waitForFunction(()=>!document.querySelector('body > .sov[aria-hidden="true"]'));
    const metrics=await page.evaluate(()=>{
      const width=innerWidth,visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
      const roots=[document.documentElement,...document.querySelectorAll('#post .post,#layer .sheet,.comm-picker,.cv,#srch,#sres')].filter(visible);
      const overflow=roots.filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>({tag:el.className||el.tagName,scroll:el.scrollWidth,client:el.clientWidth}));
      const outside=[...document.querySelectorAll('.comm-picker,.comm-admission,.comm-list-actions,.comm-discussion,#layer .sheet')].filter(visible).map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.left < -2||r.right>width+2).map(({el,r})=>({tag:el.className,left:r.left,right:r.right}));
      return {overflow,outside,font:getComputedStyle(document.body).fontFamily};
    });
    const file=`D:/ctrlz/output/communication-followup-20261110/browser/visual-${w}x${h}-${theme}-${surface}.png`;
    await page.screenshot({path:file,animations:'disabled'});results.push({surface,w,h,theme,...metrics,file});
  };
  for(const [w,h]of sizes)for(const theme of ['light','dark']){
    await page.setViewportSize({width:w,height:h});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;closeSheet();},theme);
    await page.evaluate(id=>go('post-'+id),fixture.post);await page.waitForSelector('#cmtIn');await page.waitForSelector('#post .comm-at');await inspect('post',w,h,theme);
    await page.locator('#post .comm-at').click();await page.waitForSelector('.comm-picker');await inspect('mention',w,h,theme);await page.locator('.comm-picker [data-close]').click();
    await page.evaluate(()=>go('me'));await page.getByRole('button',{name:'我的发布与审核'}).click();await page.waitForSelector('.comm-publication');await inspect('publications',w,h,theme);
    await page.getByRole('button',{name:'编辑',exact:true}).first().click();await page.waitForSelector('#peB');await inspect('editor',w,h,theme);
    await page.evaluate(id=>{closeSheet();go('msg-'+id);},fixture.peer);await page.waitForSelector('#cvIn');await inspect('chat',w,h,theme);
    await page.evaluate(peer=>CZCommunication.refreshReferences(peer),fixture.peer);const unavailableTile=page.locator('[data-dm="msg-'+unavailable+'"]');await unavailableTile.scrollIntoViewIfNeeded();await inspect('unavailable-share',w,h,theme);
    await page.evaluate(()=>openSearch('msg'));await page.locator('#sq').fill('音乐灵感');await page.waitForSelector('#sOptions .comm-search-row');await inspect('search',w,h,theme);await page.evaluate(()=>closeSearch());
  }
  const violations=results.filter(r=>r.overflow.length||r.outside.length);await page.setViewportSize({width:1280,height:800});
  return {surfaces:results.length,viewportThemes:24,violations,errors,results};
}
