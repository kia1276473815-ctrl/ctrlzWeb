async(page)=>{
  const origin=new URL(page.url()).origin,cases=[],assert=(v,m)=>{if(!v)throw Error(m);};await page.goto(origin+'/#msg');await page.waitForFunction(()=>STATE.role==='user'&&!!globalThis.CZCommunication);
  const fixture=await page.evaluate(async()=>{await dmThreads();const peer=Object.keys(CHATS).find(id=>CZCommunication.threads[id]?.state==='accepted'),original=await API.req('POST','/dm/with/'+peer,{kind:'text',body:'引用原文不应复制到本机 '+Date.now()});return {peer,original:original.id,body:original.body};});
  await page.evaluate(peer=>go('msg-'+peer),fixture.peer);await page.waitForSelector('#cvIn');await page.evaluate(async peer=>{await dmConv(peer);dmPaint(peer);},fixture.peer);
  const choose=async id=>{await page.locator(`[data-dm="msg-${id}"] [data-act="comm-message-menu"]`).click();await page.getByRole('button',{name:'引用回复',exact:true}).click();};
  await choose(fixture.original);const text='离线引用回复 '+Date.now(),pattern='**/dm/with/'+fixture.peer;
  await page.route(pattern,r=>r.request().method()==='POST' ? r.abort('failed'):r.continue());
  try{
    await page.locator('#cvIn').fill(text);await page.locator('[data-act="cv-send"]').click();await page.waitForFunction(text=>[...DMOUT.rows.values()].some(r=>r.text===text&&r.state==='failed'),text);
    const stored=await page.evaluate(async text=>{const row=[...DMOUT.rows.values()].find(r=>r.text===text);return {row,saved:(await DMOUT.store.list(dmScope())).find(r=>r.id===row.id)};},text);
    assert(stored.row.replyToId===fixture.original&&stored.saved.replyToId===fixture.original,'待发送引用ID丢失');assert(!JSON.stringify(stored.saved).includes(fixture.body),'本机草稿复制了引用原文');cases.push('outbox-keeps-only-reference-id');
    await page.reload();await page.waitForFunction(id=>DMOUT.rows.get(id)?.state==='failed',stored.row.id);assert((await page.evaluate(id=>DMOUT.rows.get(id).replyToId,stored.row.id))===fixture.original,'刷新后引用ID丢失');cases.push('failed-reference-restores-after-reload');
    await page.unroute(pattern);await page.locator(`[data-act="dm-retry"][data-id="${stored.row.id}"]`).click();await page.waitForFunction(id=>!DMOUT.rows.has(id),stored.row.id);
    const matches=await page.evaluate(async({peer,id})=>(await API.req('GET','/dm/with/'+peer)).items.filter(m=>m.clientMessageId===id),{peer:fixture.peer,id:stored.row.id});assert(matches.length===1&&matches[0].reply.id===fixture.original,'重试重复发送或丢失引用');cases.push('retry-preserves-key-and-reference');
    const doomed=await page.evaluate(peer=>API.req('POST','/dm/with/'+peer,{kind:'text',body:'发送前撤回的目标'}),fixture.peer);await page.evaluate(async peer=>{await dmConv(peer);dmPaint(peer);},fixture.peer);await choose(doomed.id);
    await page.evaluate(id=>API.req('POST','/dm/messages/'+id+'/recall'),doomed.id);const nextText='取消无效引用后保留正文 '+Date.now();await page.locator('#cvIn').fill(nextText);await page.locator('[data-act="cv-send"]').click();await page.waitForFunction(text=>[...DMOUT.rows.values()].some(r=>r.text===text&&r.state==='failed'),nextText);
    const failedId=await page.evaluate(text=>[...DMOUT.rows.values()].find(r=>r.text===text).id,nextText);await page.locator(`[data-act="dm-unquote"][data-id="${failedId}"]`).click();
    await page.waitForFunction(text=>[...DMOUT.rows.values()].some(r=>r.text===text&&!r.replyToId),nextText);const edited=await page.evaluate(text=>[...DMOUT.rows.values()].find(r=>r.text===text),nextText);assert(edited.id!==failedId,'编辑引用沿用了旧内容提交键');assert(edited.text===nextText,'移除引用后正文丢失');cases.push('unavailable-reference-can-be-removed-with-new-key');
    await page.locator(`[data-act="dm-retry"][data-id="${edited.id}"]`).click();await page.waitForFunction(id=>!DMOUT.rows.has(id),edited.id);const sent=await page.evaluate(async({peer,id})=>(await API.req('GET','/dm/with/'+peer)).items.find(m=>m.clientMessageId===id),{peer:fixture.peer,id:edited.id});assert(sent?.reply===null,'移除引用后仍携带原关系');cases.push('edited-message-sends-without-reference');
    return {passed:true,cases};
  }finally{await page.unroute(pattern);}
}
