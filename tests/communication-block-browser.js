async(page)=>{
  const origin=new URL(page.url()).origin,errors=[];page.on('pageerror',e=>errors.push(e.message));
  const a=await page.evaluate(()=>ME),peerContext=await page.context().browser().newContext({viewport:{width:393,height:852}}),peer=await peerContext.newPage();
  try{
    await page.evaluate(()=>go('home'));await peer.goto(origin+'/#me');await peer.getByRole('button',{name:'登录',exact:true}).click();await peer.getByRole('textbox',{name:'用户名',exact:true}).fill('comm_bravo');await peer.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await peer.getByRole('checkbox',{name:'同意协议'}).check();await peer.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await peer.waitForFunction(()=>STATE.role==='user');
    const b=await peer.evaluate(()=>ME);await peer.evaluate(id=>go('msg-'+id),a);await peer.waitForSelector('#cvIn');await peer.waitForFunction(id=>CZCommunication.threads[id]?.canSend,a);await peer.locator('#cvIn').fill('拉黑未读一致性 '+Date.now());await peer.locator('[data-act="cv-send"]').click();
    await page.waitForFunction(async()=>((await API.req('GET','/dm/unread')).count)>0);
    await page.evaluate(async id=>{await API.req('PUT','/me/blocks/'+id);go('msg');await CZCommunication.poll();},b);
    await page.waitForFunction(id=>!CHATS[id]&&LDM.unread===0,b);
    const blocked=await page.evaluate(async()=>({unread:await API.req('GET','/dm/unread'),threads:await API.req('GET','/dm/threads'),sync:await API.req('GET','/me/communication/sync')}));
    if(blocked.unread.count!==0||blocked.sync.unread.dm!==0||blocked.threads.items.some(t=>t.peer.id===b))throw Error('拉黑后列表或红点残留');
    await page.screenshot({path:'D:/ctrlz/output/communication-followup-20261110/browser/blocked-list.png',animations:'disabled'});
    await page.evaluate(async id=>{await API.req('DELETE','/me/blocks/'+id);await CZCommunication.poll();},b);await page.waitForFunction(id=>!!CHATS[id]&&LDM.unread>0,b);
    if(errors.length)throw Error(errors.join('|'));return {pass:true,cases:['block-hides-thread-and-unread','unblock-restores-history-without-clearing'],errors};
  }finally{await peerContext.close();}
}
