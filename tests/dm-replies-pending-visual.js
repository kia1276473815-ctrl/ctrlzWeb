async(page)=>{
  const origin=new URL(page.url()).origin,context=await page.context().browser().newContext({storageState:await page.context().storageState(),serviceWorkers:'block'}),p=await context.newPage(),errors=[],results=[];p.on('pageerror',e=>errors.push(e.message));
  try{
    await p.goto(origin+'/#msg');await p.waitForFunction(()=>STATE.role==='user'&&!!globalThis.CZCommunication);
    const fixture=await p.evaluate(async()=>{await dmThreads();const peer=Object.keys(CHATS).find(id=>CZCommunication.threads[id]?.state==='accepted'),m=await API.req('POST','/dm/with/'+peer,{kind:'text',body:'待发送失效引用检查'});await API.req('POST','/dm/messages/'+m.id+'/recall');go('msg-'+peer);return{peer,id:m.id};});
    await p.waitForSelector('#cvIn');await p.waitForFunction(id=>CZCommunication.threads[id]?.canSend,fixture.peer);await p.evaluate(async({peer,id})=>{await sendMsg(peer,{t:'text',text:'原消息不可访问时，这段回复仍保存在本机。可以移除引用后重新发送。',replyToId:id});},fixture);await p.waitForFunction(id=>[...DMOUT.rows.values()].some(r=>r.replyToId===id&&r.state==='failed'),fixture.id);
    const rowId=await p.evaluate(id=>[...DMOUT.rows.values()].find(r=>r.replyToId===id).id,fixture.id),sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
    for(const [w,h] of sizes)for(const theme of ['light','dark']){
      await p.setViewportSize({width:w,height:h});await p.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.classList.add('rm');STATE.settings.rm=true;},theme);await p.locator(`[data-dm="msg-outbox-${rowId}"]`).scrollIntoViewIfNeeded();
      await p.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await p.waitForFunction(()=>!document.documentElement.classList.contains('thvt')&&+getComputedStyle(document.querySelector('#app .page')).opacity>=.99);
      const metrics=await p.evaluate(()=>{const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';return{overflow:[document.documentElement,...document.querySelectorAll('.cv-b,.dm-content,.dm-send-actions,.dm-pending')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.className||e.tagName),small:[...document.querySelectorAll('.dm-send-actions button')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.width<43||r.height<43;}).map(e=>e.textContent)};});
      const file=`D:/ctrlz/output/playwright/communication-dm-replies-20261110/${w}x${h}-${theme}-pending.png`;await p.screenshot({path:file});results.push({w,h,theme,file,...metrics});
    }
    await p.setViewportSize({width:844,height:390});await p.evaluate(()=>go('msg'));const short=[];
    for(const theme of ['light','dark']){
      await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);await p.getByRole('button',{name:'私信设置',exact:true}).click();const save=p.getByRole('button',{name:'保存设置',exact:true});await save.scrollIntoViewIfNeeded();const reachable=await save.evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('.sheet').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=s.top&&r.bottom<=s.bottom+1&&r.bottom<=innerHeight&&e.contains(hit);});if(!reachable)throw Error('横屏保存设置被遮挡');const file=`D:/ctrlz/output/playwright/communication-dm-replies-20261110/844x390-${theme}-privacy-scrolled.png`;await p.screenshot({path:file});short.push({theme,reachable,file});await p.evaluate(()=>closeSheet());await p.waitForFunction(()=>!HST.ov);
    }
    await p.evaluate(async id=>{const row=DMOUT.rows.get(id);if(row){await DMOUT.store.remove(row.key);dmForgetMemory(row);}},rowId);
    return{passed:results.every(r=>!r.overflow.length&&!r.small.length)&&!errors.length,count:results.length,short,errors,results};
  }finally{await context.close();}
}
