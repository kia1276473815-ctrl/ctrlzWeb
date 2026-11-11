async(page)=>{
  const errors=[],origin=new URL(page.url()).origin,tag=Date.now().toString(36),contexts=[],cases=[];let release;
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const a=await page.evaluate(()=>ME),other=await page.context().browser().newContext({viewport:{width:393,height:852}}),peer=await other.newPage();contexts.push(other);
  try{
    await peer.goto(origin+'/#me');await peer.getByRole('button',{name:'登录',exact:true}).click();await peer.getByRole('textbox',{name:'用户名',exact:true}).fill('comm_bravo');await peer.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await peer.getByRole('checkbox',{name:'同意协议'}).check();await peer.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await peer.waitForFunction(()=>STATE.role==='user');
    const b=await peer.evaluate(()=>ME),label='分享状态验证'+tag;
    const fixture=await peer.evaluate(async({a,label})=>{
      const post=await API.req('POST','/posts',{type:'text',title:label,body:'删除前的合成内容'}),share=await API.req('POST','/dm/with/'+a,{kind:'post',ref:post.id,body:label,clientMessageId:crypto.randomUUID()});
      for(let i=0;i<30;i++)await API.req('POST','/dm/with/'+a,{body:'阅读位置合成消息 '+i,clientMessageId:crypto.randomUUID()});return {postId:post.id,messageId:share.id};
    },{a,label});
    await page.evaluate(id=>go('msg-'+id),b);await page.waitForSelector('#cvB');await page.evaluate(()=>openSearch('msg'));await page.locator('#sq').fill(label);await page.locator('[data-message-id="'+fixture.messageId+'"]').click();await page.waitForSelector('.comm-context');
    await page.waitForFunction(({id,label})=>document.querySelector('[data-dm="msg-'+id+'"]')?.textContent.includes(label),{id:fixture.messageId,label});
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
    await peer.evaluate(async a=>API.req('POST','/dm/with/'+a,{body:'保持未读的新消息',clientMessageId:crypto.randomUUID()}),a);
    await page.waitForFunction(async()=>((await API.req('GET','/dm/unread')).count)>0);
    const before=await page.evaluate(async b=>{
      clearTimeout(LDM.timer);const unread=(await API.req('GET','/dm/unread')).count,box=document.querySelector('#cvB');box.scrollTop=Math.max(0,Math.min(250,box.scrollHeight-box.clientHeight-150));
      const top=box.getBoundingClientRect().top,anchor=[...box.children].find(el=>el.dataset.dm?.startsWith('msg-')&&el.getBoundingClientRect().top>=top);
      return {unread,cursor:LDM.since[b],anchor:anchor?.dataset.dm,offset:anchor?.getBoundingClientRect().top-top};
    },b);
    await peer.evaluate(id=>API.req('DELETE','/posts/'+id),fixture.postId);await page.evaluate(b=>CZCommunication.refreshReferences(b),b);
    const after=await page.evaluate(async({b,id})=>{const unread=(await API.req('GET','/dm/unread')).count,box=document.querySelector('#cvB'),anchor=[...box.children].find(el=>el.dataset.dm===id);return {unread,cursor:LDM.since[b],context:CZCommunication.contextFor(b),offset:anchor?.getBoundingClientRect().top-box.getBoundingClientRect().top};},{b,id:before.anchor});
    const tile=page.locator('[data-dm="msg-'+fixture.messageId+'"]');if(!(await tile.textContent()).includes('帖子暂不可用')||(await tile.textContent()).includes(label))throw Error('删帖后仍显示旧分享卡片');
    if(after.unread!==before.unread||after.cursor!==before.cursor||!after.context)throw Error('分享校对改动历史阅读状态');
    if(before.anchor&&Math.abs(after.offset-before.offset)>3)throw Error('分享变化移动了正在阅读的位置 '+JSON.stringify({before,after}));
    await page.screenshot({path:'D:/ctrlz/output/communication-reference-20261110/browser/unavailable-share-context.png',animations:'disabled'});cases.push('deleted-share-refresh-without-read-or-cursor-change','share-refresh-preserves-reading-anchor');
    const late=await peer.evaluate(async a=>{const p=await API.req('POST','/posts',{type:'text',title:'迟到分享响应'});return API.req('POST','/dm/with/'+a,{kind:'post',ref:p.id,clientMessageId:crypto.randomUUID()});},a);
    await page.evaluate(async b=>{await dmConv(b);dmPaint(b);},b);
    let entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),handler=async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});};
    await page.route('**/dm/with/*/references',handler);
    try{const pending=page.evaluate(b=>CZCommunication.refreshReferences(b),b);await started;await peer.evaluate(id=>API.req('POST','/dm/messages/'+id+'/recall'),late.id);await page.evaluate(async b=>{await dmConv(b);dmPaint(b);},b);release();await pending;
      if(!await page.evaluate(({b,id})=>CHATS[b].find(m=>m.id===id)?.rc,{b,id:late.id}))throw Error('迟到分享校对覆盖了撤回');cases.push('late-reference-response-keeps-recall');
    }finally{release();await page.unroute('**/dm/with/*/references',handler);}
    const recovery=await peer.evaluate(async a=>{const p=await API.req('POST','/posts',{type:'text',title:'断网后恢复的分享卡片'}),m=await API.req('POST','/dm/with/'+a,{kind:'post',ref:p.id,clientMessageId:crypto.randomUUID()});return {postId:p.id,messageId:m.id};},a);
    const abortRecovery=async route=>{if(route.request().postDataJSON()?.refs?.some(r=>r.kind==='post'&&r.id===recovery.postId)){await route.abort('failed');await page.unroute('**/content/resolve',abortRecovery);}else await route.continue();};
    await page.route('**/content/resolve',abortRecovery);await page.evaluate(async b=>{await dmConv(b);dmPaint(b);},b);
    if(await page.evaluate(id=>!!POST(id),recovery.postId))throw Error('合成断网未覆盖卡片补读');
    await page.evaluate(b=>CZCommunication.refreshReferences(b,true),b);await page.waitForFunction(id=>!!POST(id),recovery.postId);
    if(!(await page.locator('[data-dm="msg-'+recovery.messageId+'"]').textContent()).includes('断网后恢复的分享卡片'))throw Error('缺失分享卡片未恢复');cases.push('fresh-reference-retries-failed-card-hydration');
    if(errors.length)throw Error(errors.join('|'));return {pass:true,cases,errors,readingAnchorDelta:after.offset-before.offset,unread:after.unread};
  }finally{release?.();for(const context of contexts)await context.close();}
}
