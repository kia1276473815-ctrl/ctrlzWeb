async(page)=>{
  const origin=new URL(page.url()).origin,errors=[],cases=[];
  page.on('pageerror',e=>errors.push(e.message));
  const assert=(v,m)=>{if(!v)throw Error(m);};
  const login=async(p,name)=>{await p.goto(origin+'/#me');if(await p.evaluate(()=>STATE.role==='user'))return;await p.getByRole('button',{name:'登录',exact:true}).click();await p.getByRole('textbox',{name:'用户名',exact:true}).fill(name);await p.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await p.getByRole('checkbox',{name:'同意协议'}).check();await p.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await p.waitForFunction(()=>STATE.role==='user'&&!!globalThis.CZCommunication);};
  await login(page,'comm_alpha');
  const a=await page.evaluate(()=>ME),context=await page.context().browser().newContext({viewport:{width:393,height:852},serviceWorkers:'block'}),peer=await context.newPage();
  peer.on('pageerror',e=>errors.push(e.message));
  try{
    await login(peer,'comm_bravo');const b=await peer.evaluate(()=>ME);
    await page.evaluate(id=>go('msg-'+id),b);await page.waitForSelector('#cvIn');await page.waitForFunction(id=>CZCommunication.threads[id]?.canSend,b);
    const run=Date.now(),text='需要引用的原消息 '+run,replyText='引用回复浏览器验收 '+run;await page.locator('#cvIn').fill(text);await page.locator('[data-act="cv-send"]').click();
    await page.waitForFunction(({id,text})=>CHATS[id]?.some(m=>!m.pend&&m.text===text),{id:b,text});
    const original=await page.evaluate(({id,text})=>CHATS[id].find(m=>m.text===text&&!m.pend).id,{id:b,text});
    await peer.evaluate(id=>go('msg-'+id),a);await peer.waitForFunction(({id,original})=>CHATS[id]?.some(m=>m.id===original),{id:a,original});
    const choose=async(p,id)=>{await p.locator(`[data-dm="msg-${id}"] [data-act="comm-message-menu"]`).click();await p.getByRole('button',{name:'引用回复',exact:true}).click();await p.waitForSelector('.comm-dm-reply');};
    await choose(peer,original);await peer.reload();await peer.waitForSelector('.comm-dm-reply');assert(await peer.evaluate(()=>!!document.querySelector('#cvIn')._dmReplyToId),'空正文引用草稿刷新后丢失');cases.push('reply-only-draft-restored');
    await peer.locator('#cvIn').fill(replyText);await peer.locator('[data-act="cv-send"]').click();await peer.waitForFunction(({a,replyText})=>CHATS[a]?.some(m=>m.text===replyText&&!m.pend),{a,replyText});
    const reply=await peer.evaluate(({a,replyText})=>CHATS[a].find(m=>m.text===replyText&&!m.pend).id,{a,replyText});
    await page.waitForFunction(({id,reply})=>CHATS[id]?.some(m=>m.id===reply),{id:b,reply});
    await page.waitForFunction(({reply,text})=>document.querySelector(`[data-dm="msg-${reply}"] .dm-quote`)?.textContent.includes(text),{reply,text});
    assert(await page.locator(`[data-dm="msg-${reply}"] .dm-quote`).textContent().then(v=>v.includes(text)),'另一客户端引用未显示原文');cases.push('two-client-reference-delivery');
    await peer.locator(`[data-dm="msg-${reply}"] button.dm-quote`).click();await peer.waitForSelector('.comm-context');assert(await peer.locator(`[data-dm="msg-${original}"]`).count()===1,'点击引用未定位原消息');cases.push('reference-context-navigation');
    await peer.getByRole('button',{name:'返回最新',exact:true}).click();await peer.waitForFunction(()=>!document.querySelector('.comm-context'));
    await choose(peer,original);await peer.getByRole('button',{name:'取消引用回复',exact:true}).click();assert(await peer.locator('.comm-dm-reply').count()===0,'取消引用未清空');cases.push('cancel-reference');
    await page.locator(`[data-dm="msg-${original}"] [data-act="comm-message-menu"]`).click();await page.getByRole('button',{name:'撤回消息',exact:true}).click();await page.waitForFunction(({b,id})=>CHATS[b]?.find(m=>m.id===id)?.rc,{b,id:original});
    await peer.waitForFunction(({id,reply})=>CHATS[id]?.find(m=>m.id===reply)?.reply?.state==='recalled',{id:a,reply},{timeout:15000});
    await peer.waitForFunction(({reply,text})=>{const q=document.querySelector(`[data-dm="msg-${reply}"] .dm-quote`);return q?.textContent.includes('已撤回')&&!q.textContent.includes(text);},{reply,text});
    assert(await peer.locator(`[data-dm="msg-${reply}"] .dm-quote`).textContent().then(v=>!v.includes(text)&&v.includes('已撤回')),'撤回原文仍残留');assert(await peer.locator(`[data-dm="msg-${reply}"] button.dm-quote`).count()===0,'撤回引用仍可定位');cases.push('recalled-target-redacted');
    // 接收方清空后，对方再引用旧消息不能把旧正文带回来。
    const old=await page.evaluate(async b=>API.req('POST','/dm/with/'+b,{kind:'text',body:'单方清空的秘密正文'}),b);
    await peer.evaluate(async({a,old})=>{await dmConv(a);await API.req('POST','/dm/with/'+a+'/clear');await CZCommunication.poll();},{a,old:old.id});
    const later=await page.evaluate(async({b,id})=>API.req('POST','/dm/with/'+b,{kind:'text',body:'清空后的引用回复',replyToId:id}),{b,id:old.id});
    await peer.waitForFunction(({a,id})=>CHATS[a]?.find(m=>m.id===id)?.reply?.state==='unavailable',{a,id:later.id},{timeout:15000});
    assert(!(await peer.locator('#cvB').textContent()).includes('单方清空的秘密正文'),'单方清空后旧原文复活');cases.push('cleared-target-remains-private');
    await peer.evaluate(()=>go('msg'));await peer.getByRole('button',{name:'私信设置',exact:true}).click();await peer.getByRole('radio',{name:/不接收新私信/}).check();await peer.getByRole('button',{name:'保存设置',exact:true}).click();await peer.waitForFunction(()=>!document.querySelector('.comm-dm-policy'));
    assert((await peer.evaluate(()=>API.req('GET','/me/communication/settings'))).newDmPolicy==='nobody','新私信设置未持久化');
    const stranger=await page.context().browser().newContext();let rejected;try{const login=await stranger.request.post(origin+'/auth/login',{data:{username:'comm_charlie',password:'isolated-password-123'}}),j=await login.json(),send=await stranger.request.post(origin+'/dm/with/'+b,{headers:{authorization:'Bearer '+j.accessToken},data:{body:'应被设置拦截'}});rejected={status:send.status(),body:await send.json()};}finally{await stranger.close();}
    assert(rejected.status===403&&rejected.body.error.code==='dm_closed','关闭新私信未在服务端生效');cases.push('new-conversation-privacy-enforced');
    await page.locator('#cvIn').fill('设置后原会话继续');await page.locator('[data-act="cv-send"]').click();await page.waitForFunction(id=>CHATS[id]?.some(m=>m.text==='设置后原会话继续'&&!m.pend),b);cases.push('accepted-conversation-preserved');
    await peer.evaluate(()=>go('msg'));await peer.getByRole('button',{name:'私信设置',exact:true}).click();await peer.getByRole('radio',{name:/允许文字请求/}).check();await peer.getByRole('button',{name:'保存设置',exact:true}).click();
    assert(errors.length===0,errors.join('|'));return {passed:true,cases,errors,users:{a,b}};
  }catch(e){throw Error(e.message+' | '+JSON.stringify(await peer.evaluate(()=>({url:location.href,view:CUR.key,overlay:HST.ov,privacy:document.querySelectorAll('[data-act="comm-privacy"]').length,side:document.querySelector('.msgp')?.className,actions:document.querySelector('.comm-list-actions')?.textContent})).catch(()=>({closed:true}))));}finally{await context.close();}
}
