async(page)=>{
  const run=Date.now().toString(36),mentionLabel='浏览器提及验收-'+run,lostText='浏览器响应丢失去重-'+run;
  const errors=[],cases=[],origin=new URL(page.url()).origin;
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const assert=(value,message)=>{if(!value)throw Error(message);};
  await page.reload();await page.waitForFunction(()=>STATE.role==='user' && !!globalThis.CZCommunication && POSTS.some(p=>p.live));
  const fixture=await page.evaluate(async()=>({me:ME,post:POSTS.find(p=>p.live).id,users:Object.fromEntries((await API.req('GET','/users?q=comm_')).items.map(u=>[u.name,u.id]))}));
  const a=fixture.me,b=fixture.users.comm_bravo,c=fixture.users.comm_charlie,pid=fixture.post;
  await page.evaluate(id=>go('post-'+id),pid);await page.waitForSelector('#cmtIn');await page.waitForSelector('[data-act="comm-close-comments"]');
  if(await page.locator('[data-act="comm-close-comments"]').textContent().then(t=>t.includes('重开'))){await page.locator('[data-act="comm-close-comments"]').click();await page.waitForFunction(()=>!document.querySelector('#post [data-act="cmt"]')?.disabled);}
  await page.locator('[data-act="comm-close-comments"]').click();await page.waitForFunction(()=>document.querySelector('#post [data-act="cmt"]')?.disabled);
  await page.reload();await page.waitForSelector('#cmtIn');await page.waitForFunction(()=>document.querySelector('#post [data-act="cmt"]')?.disabled);assert(await page.locator('#post [data-act="cmt"]').isDisabled(),'关评刷新丢失');
  await page.locator('[data-act="comm-close-comments"]').click();await page.waitForFunction(()=>!document.querySelector('#post [data-act="cmt"]')?.disabled);cases.push('comment-close-reopen-persistence');
  if(!await page.evaluate(()=>POST(CUR.post)?.solved))await page.locator('#post [data-act="solve"]').click();await page.waitForFunction(()=>POST(CUR.post)?.solved===true);cases.push('question-solved-persistence');
  await page.locator('#post .comm-at').click();await page.locator('#commMentionQuery').fill('comm_bravo');await page.locator('.comm-user').filter({hasText:'comm_bravo'}).click();
  await page.locator('#cmtIn').press('End');await page.locator('#cmtIn').pressSequentially(' '+mentionLabel);await page.locator('#post [data-act="cmt"]').click();
  await page.waitForFunction(label=>cmtsOf(CUR.post).some(c=>c.t.includes(label) && c.id && !c.sendState),mentionLabel);
  assert(await page.locator('#post .comm-mention').count()>0,'提及没有安全渲染成用户链接');cases.push('mention-selector-real-http-comment');
  const pin=page.locator('[data-cmt-id="c_browser_000"] [data-act="comm-pin-comment"]');await pin.click();await page.waitForFunction(()=>POST(CUR.post)?.pinnedCommentId==='c_browser_000');cases.push('comment-pin-real-http');
  // 丢失已提交响应后重试，真实HTTP仍只产生一条评论。
  let dropped=false;
  await page.route(`**/posts/${pid}/comments`,async route=>{if(route.request().method()==='POST' && !dropped){dropped=true;await route.fetch();return route.abort('failed');}return route.continue();});
  await page.locator('#cmtIn').fill(lostText);await page.locator('#post [data-act="cmt"]').click();await page.waitForSelector('[data-act="cmt-retry"]');
  await page.unroute(`**/posts/${pid}/comments`);await page.locator('[data-act="cmt-retry"]').click();await page.waitForFunction(()=>!document.querySelector('[data-act="cmt-retry"]'));
  const duplicates=await page.evaluate(async ({id,text})=>{let cursor=null,n=0;do{const r=await API.req('GET',`/posts/${id}/comments?limit=50${cursor ? '&cursor='+encodeURIComponent(cursor):''}`);n+=r.items.filter(c=>c.body===text).length;cursor=r.next;}while(cursor);return n;},{id:pid,text:lostText});
  assert(duplicates===1,'断线重试重复评论');cases.push('response-lost-idempotent-comment');
  await page.locator('#post [data-act="pclose"]').click();await page.evaluate(()=>go('me'));await page.getByRole('button',{name:'我的发布与审核'}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('#peB').fill('浏览器确认保存的正文');await page.getByRole('button',{name:'保存修改'}).click();await page.waitForFunction(()=>!document.querySelector('#peB'));cases.push('my-publications-edit-server-confirmation');
  await page.evaluate(id=>go('msg-'+id),b);await page.waitForSelector('#cvIn');await page.waitForFunction(id=>!!CZCommunication.threads[id],b);
  await page.locator('[data-act="cv-more"]').click();if(await page.getByRole('button',{name:'取消置顶',exact:true}).count()){await page.getByRole('button',{name:'取消置顶',exact:true}).click();await page.locator('[data-act="cv-more"]').click();}await page.getByRole('button',{name:'置顶会话',exact:true}).click();await page.waitForFunction(id=>CZCommunication.threads[id]?.pinned,b);
  await page.locator('[data-act="cv-more"]').click();if(await page.getByRole('button',{name:'关闭免打扰',exact:true}).count()){await page.getByRole('button',{name:'关闭免打扰',exact:true}).click();await page.locator('[data-act="cv-more"]').click();}await page.getByRole('button',{name:'开启免打扰',exact:true}).click();await page.waitForFunction(id=>CZCommunication.threads[id]?.muted,b);cases.push('thread-pin-mute');
  await page.getByRole('button',{name:'搜索聊天记录',exact:true}).click();await page.locator('#sq').fill('音乐灵感');await page.waitForSelector('.comm-search-results .comm-search-row');await page.locator('.comm-search-row').first().click();await page.waitForSelector('.comm-context');assert(await page.locator('[data-act="comm-latest"]').isVisible(),'历史定位无返回最新入口');await page.locator('[data-act="comm-latest"]').click();await page.waitForFunction(()=>!document.querySelector('.comm-context'));cases.push('full-history-search-and-context');
  // 第二个独立浏览器账号发起真实消息请求。
  const second=await page.context().browser().newContext({viewport:{width:393,height:852}}),peer=await second.newPage();peer.on('pageerror',e=>errors.push(e.message));
  await peer.goto(origin+'/#me');await peer.getByRole('button',{name:'登录',exact:true}).click();await peer.getByRole('textbox',{name:'用户名',exact:true}).fill('comm_charlie');await peer.getByRole('textbox',{name:'密码',exact:true}).fill('isolated-password-123');await peer.getByRole('checkbox',{name:'同意协议'}).check();await peer.locator('#au').getByRole('button',{name:'登录',exact:true}).click();await peer.waitForFunction(()=>STATE.role==='user');
  await peer.evaluate(id=>go('msg-'+id),a);await peer.waitForSelector('#cvIn');await peer.waitForFunction(id=>!!CZCommunication.threads[id],a);if(await peer.evaluate(id=>CZCommunication.threads[id]?.state==='none',a)){await peer.locator('#cvIn').fill('陌生人请求浏览器验收');await peer.locator('[data-act="cv-send"]').click();}await peer.waitForFunction(id=>CZCommunication.threads[id]?.state==='pending',a);
  assert(await peer.locator('[data-act="cv-send"]').isDisabled(),'请求首条后仍可续发');assert(await peer.locator('#cvImg').isDisabled(),'请求未接受仍可发图');
  await page.getByRole('button',{name:/^消息请求/}).click();await page.waitForSelector('.comm-request');await page.screenshot({path:'D:/ctrlz/output/communication-20261110/browser/requests-desktop.png'});await page.locator('.comm-request').filter({hasText:'comm_charlie'}).getByRole('button',{name:'接受',exact:true}).click();
  await peer.waitForFunction(id=>CZCommunication.threads[id]?.state==='accepted',a,{timeout:15000});await peer.locator('#cvIn').fill('接受后的继续消息');await peer.locator('[data-act="cv-send"]').click();cases.push('stranger-request-accept-two-real-clients');
  await page.evaluate(id=>go('msg-'+id),c);await page.waitForFunction(()=>document.querySelector('#cvB')?.textContent.includes('接受后的继续消息'));
  await page.locator('[data-act="cv-more"]').click();await page.getByRole('button',{name:'清空我的聊天记录',exact:true}).click();await page.locator('[data-act="cv-cgo"]').click();await page.waitForFunction(()=>!document.querySelector('#cvB')?.textContent.includes('接受后的继续消息'));
  assert(await peer.locator('#cvB').textContent().then(t=>t.includes('接受后的继续消息')),'单方清空影响对方');cases.push('single-sided-clear-cross-client');
  await second.close();assert(errors.length===0,'页面异常：'+errors.join('|'));return {passed:true,cases,errors,fixture};
}
