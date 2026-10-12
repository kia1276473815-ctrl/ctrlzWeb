// 在真实 Chromium DOM 上使用隔离API响应；网络层拦截所有写请求，不发真实评论。
async(page)=>{
  const p=page, errors=[], writes=[], cases=[], layouts=[];
  p.setDefaultTimeout(10000); p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>{if(!['GET','HEAD'].includes(r.request().method())){writes.push(r.request().url());return r.abort();}return r.continue();});
  await p.goto('http://127.0.0.1:8787/?api=&demo=1#home');
  const setup=async()=>p.evaluate(()=>{
    API.base=location.origin;API.epoch=(API.epoch||0)+1;API.tok=null;STATE.role='user';STATE.settings.rm=true;document.documentElement.classList.add('rm');
    window.crAudio=POSTS.find(x=>x.type==='audio');window.crImage=POSTS.find(x=>x.type==='image');[crAudio,crImage].forEach(x=>{x.live=true;x.cmts=2;});
    window.crMode='ok';window.crPosts=[];window.crWait=[];window.crSaved=[];
    window.crRow=(id,body='相同正文',pid=crAudio.id,parentId=null,status='published')=>({id,body,postId:pid,parentId,status,author:{id:'nova',name:'NOVA_K'},createdAt:'2026-10-12T00:00:00Z'});
    toggleAudio=async()=>false;
    API.req=async(method,path,body)=>{
      if(method==='POST'&&/^\/posts\/[^/]+\/comments$/.test(path)){
        crPosts.push({path,body:structuredClone(body)});
        if(crMode==='offline')throw Error('隔离断网');if(crMode==='bad-parent')throw Object.assign(Error('父评论不可用'),{code:'bad_parent'});
        if(crMode==='held')return new Promise(resolve=>crWait.push(resolve));
        const row=crRow('sent-'+crPosts.length,body.body,path.split('/')[2],body.parentId||null);row.author={id:ME,name:USERS[ME].name};crSaved.push(row);return row;
      }
      if(method==='GET'&&path.includes('/comments?')){const pid=decodeURIComponent(path.split('/')[2]);return {items:[crRow('first','相同正文',pid),crRow('second','相同正文',pid),crRow('review','送审评论',pid,null,'review'),...crSaved.filter(x=>x.postId===pid)],next:null};}
      return {items:[],next:null};
    };
    go('v-'+crAudio.id);
  });
  await p.waitForFunction(()=>typeof commentReplySelect==='function');await p.evaluate(()=>sessionStorage.clear());await setup();await p.waitForFunction(()=>RL.on);
  const assert=(v,m)=>{if(!v)throw Error(m);};
  const audioOpen=async()=>{await p.locator('.rl-bar [data-act="rl-cmts"][aria-label="评论"]').click();await p.waitForSelector('.rl-cm-l [data-cmt-id="second"]');};
  const second=()=>p.locator('.rl-cm-l [data-cmt-id="second"] [data-act="rl-re"]');
  await audioOpen();await p.locator('#rlIn').fill('原来的草稿');await second().click();
  assert(await p.evaluate(()=>document.querySelector('#rlIn')._reply.id==='second'),'同正文回复目标串条');assert(await p.locator('#rlIn').inputValue()==='@NOVA_K 原来的草稿','选择回复覆盖原草稿');
  await p.locator('[data-act="cmt-reply-cancel"]').click();assert(await p.locator('#rlIn').inputValue()==='原来的草稿','取消回复丢正文');assert(await p.evaluate(()=>!document.querySelector('#rlIn')._reply),'取消没清目标');cases.push('same-text-id-target-preserves-draft-and-cancel');
  await second().click();await p.locator('#rlIn').fill('@NOVA_K 关闭后继续回复');await p.locator('[data-act="rl-cm-x"]').click();await audioOpen();
  assert(await p.evaluate(()=>document.querySelector('#rlIn')._reply?.id==='second'),'重开丢回复目标');assert(await p.locator('#rlIn').inputValue()==='@NOVA_K 关闭后继续回复','重开丢回复草稿');cases.push('close-and-reopen-retains-reply-target');
  await p.evaluate(()=>crMode='held');await p.locator('[data-act="rl-send"]').click();await p.waitForFunction(()=>crWait.length===1);
  assert(await p.evaluate(()=>crPosts.at(-1).body.parentId==='second'),'发送未传parentId');assert(await p.locator('#rlIn').inputValue()==='','发送后旧输入未清');assert(await p.evaluate(()=>!document.querySelector('#rlIn')._reply),'发送后目标残留');
  await p.locator('#rlIn').fill('发送期间另一条草稿');await p.evaluate(()=>{const sent=crPosts.at(-1);crWait.shift()({...crRow('held-sent',sent.body.body,crAudio.id,sent.body.parentId),author:{id:ME}});});await p.waitForFunction(()=>!(UI.newCmts[crAudio.id]||[]).some(x=>x.sendState==='sending'));
  assert(await p.locator('#rlIn').inputValue()==='发送期间另一条草稿','迟到成功清新草稿');cases.push('audio-parent-send-and-late-success-retains-new-input');
  await p.locator('#rlIn').fill('');await second().click();await p.locator('#rlIn').fill('@NOVA_K 断网时的回复');await p.evaluate(()=>crMode='offline');await p.locator('[data-act="rl-send"]').click();await p.waitForSelector('[data-act="cmt-retry"]');
  assert(await p.evaluate(()=>UI.newCmts[crAudio.id].at(-1).parentId==='second'),'失败丢parentId');await p.locator('[data-act="cmt-edit"]').click();await p.locator('#cmtEdit').fill('@NOVA_K 编辑后重试');await p.locator('[data-act="cmt-edit-save"]').click();await p.evaluate(()=>crMode='ok');await p.locator('[data-act="cmt-retry"]').click();await p.waitForFunction(()=>UI.newCmts[crAudio.id].at(-1).id);
  assert(await p.evaluate(()=>crPosts.at(-1).body.parentId==='second'&&crPosts.at(-1).body.body==='@NOVA_K 编辑后重试'),'编辑重试丢父评论或正文');cases.push('offline-edit-retry-retains-parent-and-content');
  await second().click();await p.locator('#rlIn').fill('@NOVA_K 原评论删除后保留');await p.evaluate(()=>crMode='bad-parent');await p.locator('[data-act="rl-send"]').click();await p.waitForSelector('[data-act="cmt-edit"]');
  assert((await p.locator('.rl-cm-l').innerText()).includes('原评论已不可回复'),'父评论失败缺反馈');await p.locator('[data-act="cmt-edit"]').click();await p.locator('#cmtEditReply').uncheck();await p.locator('[data-act="cmt-edit-save"]').click();await p.evaluate(()=>crMode='ok');await p.locator('[data-act="cmt-retry"]').click();await p.waitForFunction(()=>UI.newCmts[crAudio.id].at(-1).id);
  assert(await p.evaluate(()=>!('parentId' in crPosts.at(-1).body)),'显式改普通评论仍带parentId');cases.push('removed-parent-feedback-and-explicit-ordinary-comment');
  assert(!await p.locator('[data-cmt-id="review"] [data-act="rl-re"]').isEnabled(),'审核中允许真实回复');
  const child=await p.evaluate(()=>crSaved.find(x=>x.parentId==='second').id);await p.locator(`[data-cmt-id="${child}"] [data-act="rl-re"]`).click();await p.locator('#rlIn').fill('直接回复这条回复');await p.locator('[data-act="rl-send"]').click();await p.waitForFunction(()=>UI.newCmts[crAudio.id].at(-1).id);assert(await p.evaluate(id=>crPosts.at(-1).body.parentId===id,child),'回复的回复没有直接父ID');cases.push('reply-to-reply-and-review-button');
  await second().click();await p.locator('#rlIn').fill('@NOVA_K 刷新后继续');await p.evaluate(()=>history.replaceState(history.state,'','/?api=&demo=1'+location.hash));await p.reload({waitUntil:'domcontentloaded',timeout:20000});await p.waitForFunction(()=>typeof commentReplySelect==='function');await setup();await audioOpen();assert(await p.evaluate(()=>document.querySelector('#rlIn')._reply?.id==='second'),'刷新丢回复对象');assert(await p.locator('#rlIn').inputValue()==='@NOVA_K 刷新后继续','刷新丢回复文本');await p.locator('[data-act="cmt-reply-cancel"]').click();await p.locator('#rlIn').fill('');cases.push('refresh-restores-reply-draft');
  await p.locator('.rl-top [data-act="rl-close"]').click();await p.evaluate(()=>go('post-'+crImage.id));await p.waitForSelector('#post [data-cmt-id="second"]');await p.locator('#post [data-cmt-id="second"] [data-act="reply"]').click();await p.locator('#cmtIn').fill('@NOVA_K 图文回复');await p.locator('#post [data-act="cmt"]').click();await p.waitForFunction(()=>UI.newCmts[crImage.id].at(-1).id);assert(await p.evaluate(()=>crPosts.at(-1).body.parentId==='second'),'普通详情丢parentId');assert(await p.locator('#cmtIn').inputValue()==='','普通详情未清成功输入');cases.push('ordinary-post-reply-submission');
  const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
  for(const kind of ['image','audio']){
    if(kind==='audio'){await p.locator('#post [data-act="pclose"]').click();await p.evaluate(()=>go('v-'+crAudio.id));await p.waitForFunction(()=>RL.on);await audioOpen();}
    const selector=kind==='audio'?'#rlIn':'#cmtIn',target=kind==='audio'?'.rl-cm-l [data-cmt-id="second"] [data-act="rl-re"]':'#post [data-cmt-id="second"] [data-act="reply"]';
    await p.locator(selector).fill('');await p.locator(target).click();
    for(const [w,h]of sizes)for(const theme of ['light','dark']){
      await p.setViewportSize({width:w,height:h});await p.evaluate(t=>{STATE.settings.theme=t;applyTheme();},theme);
      await p.waitForFunction(({sel,theme})=>getComputedStyle(document.querySelector(sel)).color===(theme==='dark'?'rgb(236, 236, 230)':'rgb(20, 20, 24)'),{sel:selector,theme});
      const layout=await p.evaluate(sel=>{const input=document.querySelector(sel),r=input.getBoundingClientRect(),bar=input.parentNode.querySelector('.cmt-reply-context'),b=bar.getBoundingClientRect(),x=bar.querySelector('button').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,inputVisible:r.top>=0&&r.bottom<=innerHeight&&r.width>40,contextVisible:b.top>=0&&b.bottom<=innerHeight,cancel44:x.width>=44&&x.height>=44};},selector);
      assert(!layout.overflow&&layout.inputVisible&&layout.contextVisible&&layout.cancel44,'回复布局异常 '+JSON.stringify({kind,w,h,theme,layout}));layouts.push({kind,w,h,theme,...layout});
      if(theme==='dark'&&(w===393||w===1280))await p.screenshot({path:`D:/ctrlz/output/playwright/comment-notification/reply-${kind}-${w}x${h}.png`});
    }
    await p.locator('[data-act="cmt-reply-cancel"]').click();await p.locator(selector).fill('');
  }
  assert(!errors.length&&!writes.length,'页面错误/真实网络写入 '+JSON.stringify({errors,writes}));return {passed:true,cases,layouts,errors,writes,notes:'Application submits to isolated API fixtures; all network writes blocked; no production comments sent'};
}
