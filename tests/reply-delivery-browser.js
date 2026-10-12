// 两个隔离账号连接真实内存后端；禁止向其它地址写业务数据，不使用生产账号。
async(page)=>{
  const browser=page.context().browser(),origin='http://127.0.0.1:8794',contexts=[],errors=[],forbiddenWrites=[],cases=[],matrix=[];
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const connect=async(username,viewport)=>{
    const ctx=await browser.newContext({viewport});contexts.push(ctx);
    const r=await ctx.request.post(origin+'/auth/login',{data:{username,password:'fixture-password-123'}});assert(r.ok(),'隔离账号登录失败');const auth=await r.json();
    await ctx.addInitScript(({origin,access})=>{localStorage.setItem('ctrlz2.apiBase',JSON.stringify(origin));localStorage.setItem('ctrlz2.apiTok',JSON.stringify({access,refresh:'cookie'}));}, {origin,access:auth.accessToken});
    await ctx.route('**/*',route=>{if(!['GET','HEAD'].includes(route.request().method())&&!route.request().url().startsWith(origin+'/')){forbiddenWrites.push(route.request().url());return route.abort();}return route.continue();});
    const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#home',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>LIVE.contentReady&&STATE.role==='user');
    await p.evaluate(()=>{STATE.settings.rm=true;document.documentElement.classList.add('rm');});return p;
  };
  try{
    const sender=await connect('fixture_sender',{width:1280,height:800}),receiver=await connect('fixture_receiver',{width:393,height:852});
    const ids=await sender.evaluate(()=>({pid:POSTS.find(x=>x.title==='隔离回复交互验证').id,me:ME})),pid=ids.pid;
    await receiver.evaluate(()=>go('msg'));await receiver.waitForSelector('[data-act="note"][data-v="at"]');
    await sender.evaluate(id=>go('post-'+id),pid);await sender.waitForSelector('#post .cmt[data-cmt-id]');const parent=await sender.locator('#post .cmt').first().getAttribute('data-cmt-id');
    await sender.locator(`[data-cmt-id="${parent}"] [data-act="reply"]`).click();const body='已发表回复 · 刷新和通知定位检验 '+Date.now();await sender.locator('#cmtIn').fill(body);await sender.locator('#post [data-act="cmt"]').click();
    await sender.waitForFunction(({pid,body})=>UI.newCmts[pid]?.some(c=>c.t===body&&c.id&&!c.sendState),{pid,body});const reply=await sender.evaluate(({pid,body})=>UI.newCmts[pid].find(c=>c.t===body).id,{pid,body});
    assert((await sender.url()).includes('comment='+reply),'发表成功没有保留刷新定位');assert(await sender.locator(`[data-cmt-id="${reply}"] .cmt-parent`).count()===1,'发表回复没有原评论引用');cases.push('real-sender-posts-parent-linked-reply-with-reference');
    await receiver.bringToFront();await receiver.waitForFunction(id=>NOTES.at.some(n=>n.commentId===id),reply,{timeout:20000});
    assert(await receiver.evaluate(id=>NOTES.at.find(n=>n.commentId===id).k==='回复了你的评论',reply),'接收方没有真实reply通知');cases.push('recipient-visible-poll-receives-real-reply-notification');
    await receiver.locator('[data-act="note"][data-v="at"]').click();const note=receiver.locator('[data-act="at-open"]').filter({hasText:body});await note.click();await receiver.waitForSelector(`.cmt.flash[data-cmt-id="${reply}"]`);
    assert(await receiver.locator(`[data-cmt-id="${reply}"] .cmt-parent`).count()===1,'接收方回复关系没有显示');assert((await receiver.url()).includes('comment='+reply),'通知点击未留目标');cases.push('recipient-click-locates-new-reply-not-parent');
    await receiver.reload({waitUntil:'domcontentloaded'});await receiver.waitForSelector(`.cmt.flash[data-cmt-id="${reply}"]`);assert((await receiver.locator(`[data-cmt-id="${reply}"]`).innerText()).includes(body),'刷新丢已发表回复');cases.push('recipient-refresh-retains-visible-server-reply-and-target');
    await sender.reload({waitUntil:'domcontentloaded'});await sender.waitForSelector(`.cmt.flash[data-cmt-id="${reply}"]`);assert(await sender.evaluate(id=>!UI.newCmts[id]?.length,pid),'刷新依赖本地气泡');cases.push('sender-refresh-reads-published-reply-from-server');
    await receiver.locator('#post [data-act="pclose"]').click();await receiver.evaluate(()=>go('msg'));await receiver.waitForFunction(id=>NOTES.at.some(n=>n.commentId===id),reply);await receiver.locator('[data-act="note"][data-v="at"]').click();
    await receiver.locator(`[data-act="at-like"][data-cid="${reply}"]`).click();await receiver.waitForFunction(id=>document.querySelector(`[data-act="at-like"][data-cid="${id}"]`)?.getAttribute('aria-pressed')==='true'&&CMT_LIKES.size===0,reply);
    await sender.bringToFront();await sender.waitForFunction(id=>NOTES.likes.some(n=>n.commentId===id),reply,{timeout:20000});cases.push('notification-reply-like-writes-server-and-notifies-reply-author');
    await receiver.reload({waitUntil:'domcontentloaded'});await receiver.waitForFunction(id=>NOTES.at.some(n=>n.commentId===id),reply);await receiver.locator('[data-act="note"][data-v="at"]').click();await receiver.waitForFunction(id=>document.querySelector(`[data-act="at-like"][data-cid="${id}"]`)?.getAttribute('aria-pressed')==='true',reply);
    await receiver.locator(`[data-act="at-like"][data-cid="${reply}"]`).click();await receiver.waitForFunction(id=>document.querySelector(`[data-act="at-like"][data-cid="${id}"]`)?.getAttribute('aria-pressed')==='false'&&CMT_LIKES.size===0,reply);await receiver.locator('[data-act="at-open"]').filter({hasText:body}).click();await receiver.waitForSelector(`.cmt.flash[data-cmt-id="${reply}"]`);cases.push('notification-reply-like-refresh-and-unlike-restore-server-state');
    const like=sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`);await like.click();await sender.waitForFunction(({pid,parent})=>COMMENTS[pid].find(c=>c.id===parent)?.liked&&CMT_LIKES.size===0,{pid,parent});assert(await like.getAttribute('aria-pressed')==='true','点赞没有选中语义');
    await sender.reload({waitUntil:'domcontentloaded'});await sender.waitForSelector(`.cmt[data-cmt-id="${parent}"]`);assert(await sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`).getAttribute('aria-pressed')==='true','刷新丢点赞');assert(await sender.evaluate(({pid,parent})=>COMMENTS[pid].find(c=>c.id===parent).likes===1,{pid,parent}),'点赞刷新计数不为1');cases.push('comment-like-persists-across-sender-refresh');
    await receiver.locator('#post [data-act="pclose"]').click();await receiver.evaluate(()=>go('msg'));await receiver.bringToFront();await receiver.waitForFunction(id=>NOTES.likes.some(n=>n.commentId===id),parent,{timeout:20000});
    assert(await receiver.evaluate(id=>NOTES.likes.find(n=>n.commentId===id).k==='赞了你的评论',parent),'评论点赞通知文案或目标错误');await receiver.locator('[data-act="note"][data-v="likes"]').click();await receiver.locator('[data-act="like-open"]').click();await receiver.waitForSelector(`.cmt.flash[data-cmt-id="${parent}"]`);cases.push('recipient-comment-like-notice-opens-exact-comment');
    await sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`).click();await sender.waitForFunction(({pid,parent})=>!COMMENTS[pid].find(c=>c.id===parent)?.liked&&CMT_LIKES.size===0,{pid,parent});await sender.reload({waitUntil:'domcontentloaded'});await sender.waitForSelector(`[data-cmt-id="${parent}"]`);assert(await sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`).getAttribute('aria-pressed')==='false','取消后刷新仍被点赞');cases.push('comment-unlike-persists-and-count-restores');
    // 故障回滚：只拦截隔离后端的点赞，不发送到真实数据库。
    await sender.route('**/comments/*/like',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'fixture_offline',message:'隔离断网'}})}));await sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`).click();await sender.waitForFunction(()=>CMT_LIKES.size===0);assert(await sender.locator(`[data-cmt-id="${parent}"] [data-act="clike"]`).getAttribute('aria-pressed')==='false','失败没有回滚服务器状态');await sender.unroute('**/comments/*/like');cases.push('like-write-failure-rolls-back-without-false-success');
    // 声音入口使用同一真实帖子/评论API，只改隔离浏览器里的展示类型，暂停真实音频加载。
    await receiver.evaluate(({pid,reply})=>{closePostLayer();const p=POST(pid);p.type='audio';p.vis={tpl:'wave',pal:'pb'};p.dur='0:22';p.seed=3;toggleAudio=async()=>false;UI.commentRouteSeen=null;go('v-'+pid+'?comment='+reply);},{pid,reply});await receiver.waitForSelector(`.rl-cm.on .cmt.flash[data-cmt-id="${reply}"]`);assert(await receiver.locator('.rl-cm-l .cmt-parent').count()>=1,'声音评论缺回复引用');cases.push('audio-comment-entry-keeps-reference-and-exact-target');
    const sizes=[[320,740],[375,812],[393,852],[430,932],[844,390],[744,1133],[820,1180],[1024,1366],[1180,820],[1366,1024],[1280,800],[1920,1080]];
    for(const kind of ['audio','post']){
      if(kind==='post'){await receiver.locator('.rl-top [data-act="rl-close"]').click();await receiver.evaluate(({pid,reply})=>{POST(pid).type='text';UI.commentRouteSeen=null;go('post-'+pid+'?comment='+reply);},{pid,reply});await receiver.waitForSelector(`.cmt.flash[data-cmt-id="${reply}"]`);}
      for(const [w,h]of sizes)for(const theme of ['light','dark']){
        await receiver.setViewportSize({width:w,height:h});await receiver.evaluate(t=>{STATE.settings.theme=t;applyTheme();},theme);
        await receiver.waitForFunction(({kind,theme})=>getComputedStyle(document.querySelector(kind==='audio'?'#rlIn':'#cmtIn')).color===(theme==='dark'?'rgb(236, 236, 230)':'rgb(20, 20, 24)'),{kind,theme});
        await receiver.locator(`.cmt[data-cmt-id="${reply}"]`).scrollIntoViewIfNeeded();
        const layout=await receiver.evaluate(({kind,reply})=>{const row=document.querySelector(`.cmt[data-cmt-id="${reply}"]`),r=row.getBoundingClientRect(),ref=row.querySelector('.cmt-parent').getBoundingClientRect(),input=document.querySelector(kind==='audio'?'#rlIn':'#cmtIn').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,replyVisible:r.bottom>0&&r.top<innerHeight,referenceWidth:ref.width,referenceFits:ref.right<=innerWidth,inputVisible:input.width>40&&input.bottom<=innerHeight};},{kind,reply});
        assert(!layout.overflow&&layout.replyVisible&&layout.referenceFits&&layout.inputVisible,'回复布局异常 '+JSON.stringify({kind,w,h,theme,layout}));matrix.push({kind,w,h,theme,...layout});
        if(theme==='dark'&&(w===393||w===1280))await receiver.screenshot({path:`D:/ctrlz/output/playwright/reply-delivery/${kind}-${w}x${h}.png`});
      }
    }
    assert(!errors.length&&!forbiddenWrites.length,'页面异常/越界写入');return {passed:true,cases,matrix,errors,forbiddenWrites,postId:pid,parentId:parent,replyId:reply,source:'real isolated backend and two authenticated browser contexts; audio display-only case explicitly separate'};
  }catch(error){throw Error('after '+(cases.at(-1)||'setup')+': '+error.message);}finally{for(const ctx of contexts)await ctx.close();}
}
